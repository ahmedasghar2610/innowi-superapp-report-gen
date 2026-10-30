"""AI assistant: the streaming parser, the answer loop, permissions and the HTTP API.

The model is replaced by scripted fakes, so these tests never call the AI
service. Database tests reuse the Sales fixture (fake Salesforce data, see
tests/test_sales_api.py) and skip when Postgres isn't reachable:
  Adam Smith (rep)  owns deals O02-O05 on Casa Mia + Kantipur Cafe
  Freddie Williams  owns deal O01 on Tolin's Tacos
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from sqlalchemy import select, text

from app.common.deps import AuthenticatedUser
from app.config import get_settings
from app.db.schemas import qualified
from app.models.assistant import AssistantChat, AssistantUsage
from app.modules.assistant import catalog, engine, registry
from app.modules.assistant import router as assistant_router
from app.modules.assistant.provider import MessagesApiProvider, ProviderError, RoundEnd, TextDelta, ToolCall, Usage
from app.modules.assistant.tools_base import Ctx
from tests.test_sales_api import ADAM, FREDDIE, api  # noqa: F401 - pytest fixture, used by name
from tests.test_salesforce_sync import sessions  # noqa: F401 - pytest fixture, used by name


# ------------------------------------------------------------- helpers ----
def sse_body(*events: dict[str, Any]) -> bytes:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def messages_stream(text: str = "", tool: tuple[str, str, dict] | None = None, stop: str = "end_turn") -> bytes:
    events: list[dict[str, Any]] = [
        {"type": "message_start", "message": {"usage": {"input_tokens": 120, "output_tokens": 1,
                                                        "cache_read_input_tokens": 100}}},
        {"type": "ping"},
    ]
    idx = 0
    if text:
        events.append({"type": "content_block_start", "index": idx, "content_block": {"type": "text", "text": ""}})
        half = len(text) // 2
        for part in (text[:half], text[half:]):
            events.append({"type": "content_block_delta", "index": idx, "delta": {"type": "text_delta", "text": part}})
        events.append({"type": "content_block_stop", "index": idx})
        idx += 1
    if tool:
        tid, name, args = tool
        raw = json.dumps(args)
        events.append({"type": "content_block_start", "index": idx,
                       "content_block": {"type": "tool_use", "id": tid, "name": name, "input": {}}})
        for part in (raw[: len(raw) // 2], raw[len(raw) // 2:]):
            events.append({"type": "content_block_delta", "index": idx,
                           "delta": {"type": "input_json_delta", "partial_json": part}})
        events.append({"type": "content_block_stop", "index": idx})
    events.append({"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": 42}})
    events.append({"type": "message_stop"})
    return sse_body(*events)


async def collect(gen) -> list:
    return [e async for e in gen]


class ScriptedProvider:
    """Plays back one scripted round per model call and records what it was sent."""

    name = "fake"
    model = "fake-model"

    def __init__(self, rounds: list[list]):
        self.rounds = list(rounds)
        self.calls: list[dict[str, Any]] = []

    async def stream(self, *, system, messages, tools, max_tokens):
        self.calls.append({"system": system, "messages": json.loads(json.dumps(messages, default=str)),
                           "tools": [t["name"] for t in tools]})
        for ev in self.rounds.pop(0):
            yield ev


def say(text: str) -> list:
    return [TextDelta(text), RoundEnd("end_turn", [{"type": "text", "text": text}], Usage(10, 5))]


def call(name: str, args: dict, tid: str = "toolu_1", preface: str = "") -> list:
    content = ([{"type": "text", "text": preface}] if preface else []) + [
        {"type": "tool_use", "id": tid, "name": name, "input": args}]
    out = [TextDelta(preface)] if preface else []
    return out + [ToolCall(tid, name, args), RoundEnd("tool_use", content, Usage(10, 5))]


def tool_results(provider_call: dict) -> list[dict]:
    last = provider_call["messages"][-1]
    assert last["role"] == "user" and isinstance(last["content"], list)
    return last["content"]


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    out = []
    for chunk in raw.strip().split("\n\n"):
        lines = chunk.split("\n")
        name = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        out.append((name, data))
    return out


# --------------------------------------------------- provider (no DB) ----
async def test_stream_is_parsed_into_text_tool_calls_and_usage():
    body = messages_stream("Let me check.", ("toolu_9", "sales_deals", {"group_by": "stage", "status": "open"}),
                            stop="tool_use")
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    p = MessagesApiProvider(api_key="test-key", model="test-model", base_url="https://ai.example.test/",
                            extra_headers={"x-api-version": "2023-06-01"}, transport=httpx.MockTransport(handler))
    events = await collect(p.stream(system=[{"type": "text", "text": "s"}], messages=[{"role": "user", "content": "q"}],
                                    tools=[{"name": "x"}], max_tokens=100))
    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == "Let me check."
    calls = [e for e in events if isinstance(e, ToolCall)]
    assert calls == [ToolCall("toolu_9", "sales_deals", {"group_by": "stage", "status": "open"})]
    end = events[-1]
    assert isinstance(end, RoundEnd) and end.stop_reason == "tool_use"
    assert end.usage.input_tokens == 120 and end.usage.output_tokens == 42 and end.usage.cache_read_tokens == 100
    assert [b["type"] for b in end.content] == ["text", "tool_use"]
    assert end.content[1]["input"] == {"group_by": "stage", "status": "open"}
    assert seen["headers"]["x-api-key"] == "test-key"
    assert seen["headers"]["x-api-version"] == "2023-06-01"  # extra headers come from settings
    assert seen["url"] == "https://ai.example.test/v1/messages"
    assert seen["body"]["stream"] is True and seen["body"]["model"] == "test-model"


@pytest.mark.parametrize("code,phrase", [(401, "key was rejected"), (429, "too many requests"), (500, "error (500)")])
async def test_http_errors_become_plain_messages(code, phrase):
    p = MessagesApiProvider(api_key="k", model="m", base_url="https://ai.example.test",
                            transport=httpx.MockTransport(lambda r: httpx.Response(code, json={"error": {}})))
    with pytest.raises(ProviderError) as e:
        await collect(p.stream(system=[], messages=[], tools=[], max_tokens=10))
    assert phrase in str(e.value)


async def test_error_event_mid_stream():
    body = sse_body({"type": "message_start", "message": {"usage": {}}},
                    {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})
    p = MessagesApiProvider(api_key="k", model="m", base_url="https://ai.example.test", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})))
    with pytest.raises(ProviderError, match="overloaded"):
        await collect(p.stream(system=[], messages=[], tools=[], max_tokens=10))


# ------------------------------------------------ permissions (no DB) ----
def _ctx(role: str) -> Ctx:
    return Ctx(db=None, user=AuthenticatedUser(id="u", email="u@test", role=role))  # type: ignore[arg-type]


def test_each_role_only_gets_the_lookups_its_screens_allow():
    names = lambda role: {t.name for t in registry.tools_for(_ctx(role))}  # noqa: E731
    marketing = names("MARKETING_EXECUTIVE")
    assert "merchants" in marketing and "websites" in marketing and "show_chart" in marketing
    assert not any(n.startswith(("sales_", "partner_", "quotes", "price_list")) for n in marketing)
    assert "audit_log" not in marketing and "superapp_users" not in marketing

    rep = names("SALES_EXECUTIVE")
    assert {"sales_deals", "partner_leads", "quotes"} <= rep
    assert "sales_team" not in rep and "merchants" not in rep and "audit_log" not in rep

    manager = names("SALES_MANAGER")
    assert "sales_team" in manager and "merchants" not in manager

    admin = names("ADMIN")
    assert {"sales_team", "merchants", "audit_log", "superapp_users"} <= admin
    assert names("SUPER_ADMIN") == {t.name for t in registry.ALL_TOOLS}


async def test_a_lookup_outside_the_persons_role_is_refused_even_if_the_model_asks():
    raw, is_error = await engine.run_tool(_ctx("MARKETING_EXECUTIVE"), ToolCall("t", "sales_deals", {}))
    assert is_error and "No lookup called sales_deals" in raw
    raw, is_error = await engine.run_tool(_ctx("SALES_EXECUTIVE"), ToolCall("t", "drop_tables", {}))
    assert is_error


def test_tool_schemas_are_valid_and_cache_the_last_one():
    schemas = engine.tool_schemas(_ctx("SUPER_ADMIN"))
    assert schemas[-1]["cache_control"] == {"type": "ephemeral"}
    for s in schemas:
        assert s["input_schema"]["type"] == "object" and s["description"]
        assert set(s["input_schema"]["required"]) <= set(s["input_schema"]["properties"])


async def test_chart_tool_validates_and_records_the_chart():
    ctx = _ctx("SALES_EXECUTIVE")
    good = {"type": "bar", "title": "Won by month", "labels": ["2026-08", "2026-09"],
            "series": [{"name": "Won", "values": [3, "4"]}], "format": "count"}
    raw, is_error = await engine.run_tool(ctx, ToolCall("t", "show_chart", good))
    assert not is_error and ctx.charts[0]["series"][0]["values"] == [3.0, 4.0]
    for bad in ({**good, "type": "pie3d"}, {**good, "series": [{"name": "x", "values": [1]}]},
                {**good, "labels": []}, {**good, "type": "donut", "series": good["series"] * 2},
                {**good, "series": [{"name": "x", "values": ["a", "b"]}]}):
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", "show_chart", bad))
        assert is_error, bad
    assert len(ctx.charts) == 1


def test_history_is_plain_text_and_alternates():
    msgs = [
        {"role": "user", "blocks": [{"type": "text", "text": "How many deals?"}]},
        {"role": "assistant", "blocks": [{"type": "text", "text": "**5** deals."},
                                         {"type": "chart", "chart": {"title": "Deals by stage"}}]},
        {"role": "user", "blocks": [{"type": "text", "text": "And won?"}]},
        {"role": "assistant", "blocks": [], "error": "boom"},  # failed answer: nothing to carry over
    ]
    h = assistant_router._history(msgs)
    assert [t["role"] for t in h] == ["user", "assistant"]
    assert "[Chart shown: Deals by stage]" in h[1]["content"]


# ------------------------------------------- answer loop with the DB ----
async def _ctx_for(api_fixture, key: str):
    clients, users, sessions_ = api_fixture
    user = users[key]
    db = sessions_()
    session = await db.__aenter__()
    await engine.begin_readonly(session)
    return Ctx(db=session, user=AuthenticatedUser(id=user.id, email=user.email, role=user.role.value)), db


async def test_loop_runs_lookups_streams_text_and_draws_charts(api):
    ctx, cm = await _ctx_for(api, "manager")
    try:
        chart = {"type": "bar", "title": "Deals by stage", "labels": ["A"], "series": [{"name": "n", "values": [1]}]}
        provider = ScriptedProvider([
            call("sales_deals", {"group_by": "owner"}, preface="Checking."),
            call("show_chart", chart, tid="toolu_2"),
            say("Adam has the most deals."),
        ])
        events = await collect(engine.answer(ctx, provider, history=[], question="Who has the most deals?"))
    finally:
        await cm.__aexit__(None, None, None)
    kinds = [e["type"] for e in events]
    assert kinds[-1] == "done" and "chart" in kinds and "status" in kinds
    text_out = "".join(e["text"] for e in events if e["type"] == "text")
    assert text_out == "Checking.\n\nAdam has the most deals."
    groups = json.loads(tool_results(provider.calls[1])[0]["content"])["groups"]
    assert {g["key"]: g["count"] for g in groups} == {"Adam Smith": 4, "Freddie Williams": 1}
    assert provider.calls[0]["messages"][-1] == {"role": "user", "content": [
        {"type": "text", "text": "Who has the most deals?", "cache_control": {"type": "ephemeral"}}]}
    # Exactly one moving cache breakpoint in the conversation each round, on its last block.
    for c in provider.calls:
        marks = json.dumps(c["messages"]).count("cache_control")
        assert marks == 1 and "cache_control" in c["messages"][-1]["content"][-1]
    assert "Sales Manager" in provider.calls[0]["system"][1]["text"]
    assert events[-1]["tools"] == ["Looking up deals"]


async def test_rep_lookups_never_include_other_reps_records(api):
    ctx, cm = await _ctx_for(api, "adam")
    try:
        async def run(name, args):
            raw, is_error = await engine.run_tool(ctx, ToolCall("t", name, args))
            return json.loads(raw), is_error

        deals, _ = await run("sales_deals", {"limit": 50})
        assert {r["id"][-3:] for r in deals["rows"]} == {"O02", "O03", "O04", "O05"}
        assert "Adam Smith" in deals["visibility"]
        # Naming another salesperson changes nothing for a rep.
        freddie, _ = await run("sales_deals", {"owner": "Freddie Williams"})
        assert freddie["totals"]["deals"] == 4 and "ignored" in freddie["note"]
        by_owner, _ = await run("sales_deals", {"group_by": "owner"})
        assert [g["key"] for g in by_owner["groups"]] == ["Adam Smith"]
        found, _ = await run("sales_deals", {"search": "Tolin"})
        assert found["totals"]["deals"] == 0
        _, is_error = await run("sales_deal_detail", {"deal_id": "006000000000000O01"})
        assert is_error
        _, is_error = await run("sales_restaurant_detail", {"restaurant_id": "001000000000000A01"})
        assert is_error
        rest, _ = await run("sales_restaurants", {"limit": 50})
        assert "Tolin's Tacos" not in {r["name"] for r in rest["rows"]}
        _, is_error = await run("sales_team", {})
        assert is_error  # managers only
    finally:
        await cm.__aexit__(None, None, None)


async def test_unlinked_rep_sees_no_salesforce_records(api):
    ctx, cm = await _ctx_for(api, "unlinked")
    try:
        raw, _ = await engine.run_tool(ctx, ToolCall("t", "sales_deals", {}))
        data = json.loads(raw)
        assert data["totals"]["deals"] == 0 and "isn't linked" in data["visibility"]
    finally:
        await cm.__aexit__(None, None, None)


async def test_manager_can_filter_by_salesperson_name(api):
    ctx, cm = await _ctx_for(api, "manager")
    try:
        raw, _ = await engine.run_tool(ctx, ToolCall("t", "sales_deals", {"owner": "freddie"}))
        assert json.loads(raw)["totals"]["deals"] == 1
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", "sales_deals", {"owner": "Nobody Here"}))
        assert is_error and "No salesperson" in raw
    finally:
        await cm.__aexit__(None, None, None)


async def test_lookups_cannot_write(api):
    ctx, cm = await _ctx_for(api, "admin")
    try:
        with pytest.raises(Exception, match="read-only"):
            await ctx.db.execute(text("create temporary table should_fail (x int)"))
    finally:
        await cm.__aexit__(None, None, None)


PARTNER_DDL = [
    """create table if not exists public.partner_leads (id uuid primary key, created_at timestamptz default now(),
       updated_at timestamptz default now(), partner_type text, full_name text, title text, company text, email text,
       phone text, website text, region text, portfolio_size text, restaurant_share text, processors text,
       interests text[], timeline text, heard_about text, message text, wants_call bool, source_cta text,
       landing_url text, referrer text, utm_source text, utm_medium text, utm_campaign text, utm_term text,
       utm_content text, user_agent text, status text, assigned_to text, assigned_at timestamptz,
       last_contacted_at timestamptz, notified_at timestamptz, reminder_sent_at timestamptz, teams_notified_at timestamptz)""",
    "create table if not exists public.partner_lead_notes (id uuid, lead_id uuid, author_email text, body text, created_at timestamptz)",
    "create table if not exists public.partner_lead_events (id uuid, lead_id uuid, actor_email text, type text, detail jsonb, created_at timestamptz)",
    """create table if not exists public.partner_team (email text, name text, role text, added_by text,
       created_at timestamptz, receives_new_leads bool, assignable bool)""",
    """create table if not exists public.partner_contacts (id uuid primary key, created_at timestamptz default now(),
       updated_at timestamptz, status text, full_name text, title text, company text, email text, phone text,
       website text, address text, partner_type text, notes text, tags text[], met_at text, met_on date, source text,
       scanned_by text, card_id text, other_text text, photo_url text, batch_id text, promoted_lead_id uuid,
       promoted_at timestamptz, promoted_by text)""",
]


async def test_every_lookup_and_grouping_runs_against_the_database(api):
    """Catches SQL mistakes in rarely used filters: every lookup, every group_by, as Super Admin."""
    clients, users, sessions_ = api
    async with sessions_() as db:
        for ddl in PARTNER_DDL:  # the partner portal's tables, for a local test database
            await db.execute(text(ddl))
        await db.execute(text("delete from public.partner_leads where email like '%@assistant.test'"))
        await db.execute(text("insert into public.partner_leads (id, full_name, email, status, source_cta) values "
                              "(gen_random_uuid(), 'Pat Partner', 'pat@assistant.test', 'new', 'hero')"))
        await db.commit()
    async with sessions_() as session:
        await engine.begin_readonly(session)
        ctx = Ctx(db=session, user=AuthenticatedUser(id=users["admin"].id, email="a@test", role="SUPER_ADMIN"))
        argsets: dict[str, list[dict]] = {
            "sales_deals": [{}, {"freshness": "not_stale"}, {"freshness": "stuck"}, {"freshness": "stale"},
                            {"status": "won", "freshness": "active", "closed_from": "2026-01-01",
                                 "created_to": "2030-01-01", "min_amount": 1, "sort": "amount", "stage": "Live",
                                 "lead_source": "Advertisement", "search": "Deal"},
                            *[{"group_by": g} for g in ("stage", "owner", "close_month", "created_month", "lead_source",
                                                        "type", "restaurant", "record_type")]],
            "sales_visits": [{}, {"status": "open", "when": "overdue", "due_from": "2026-01-01", "search": "Husky"},
                             *[{"group_by": g} for g in ("status", "type", "owner", "due_month", "completed_month",
                                                         "restaurant")], {"sort": "completed_latest"}],
            "sales_cases": [{}, {"status": "open", "priority": "Medium", "opened_from": "2020-01-01", "search": "Printer",
                                 "department": "Menu", "issue_category": "Printer"},
                            *[{"group_by": g} for g in ("status", "priority", "origin", "handled_by", "opened_month",
                                                        "restaurant", "department", "issue_category",
                                                        "department_source")]],
            "sales_restaurants": [{}, {"city": "Los Angeles", "state": "CA", "health": "Red", "only_customers": True},
                                  *[{"group_by": g} for g in ("health", "city", "state", "owner")]],
            "sales_restaurant_detail": [{"name": "Casa"}, {"restaurant_id": "001000000000000A02"}],
            "sales_deal_detail": [{"deal_id": "006000000000000O02"}],
            "sales_overview": [{}, {"owner": "Adam Smith"}],
            "sales_team": [{}],
            "sales_data_freshness": [{}],
            "partner_leads": [{}, {"status": "new", "created_from": "2020-01-01", "created_to": "2030-01-01",
                                   "assigned_to": "unassigned", "search": "Pat"},
                              *[{"group_by": g} for g in ("status", "source", "assigned_to", "partner_type", "region",
                                                          "utm_source", "month")]],
            "partner_team": [{}],
            "partner_contacts": [{}, {"promoted": False, "event": "Expo", "created_from": "2020-01-01"},
                                 *[{"group_by": g} for g in ("status", "event", "partner_type", "source", "scanned_by",
                                                             "month")]],
            "quotes": [{}, {"kind": "links"}, {"kind": "links", "status": "active", "sent_by": "x", "search": "a"},
                       *[{"group_by": g} for g in ("status", "plan", "mode", "sent_by", "month")],
                       *[{"kind": "links", "group_by": g} for g in ("status", "mode", "sent_by", "month")]],
            "price_list": [{}, {"search": "station", "include_inactive": True}],
            "merchants": [{}, {"health": "GREEN", "search": "a"},
                          *[{"group_by": g} for g in ("health", "cuisine", "pos", "website_platform", "account_manager")]],
            "websites": [{}, {"group_by": "status"}, {"status": "live", "search": "a"}],
            "audit_log": [{}, {"action": "UPDATE", "from": "2020-01-01", "actor": "a"},
                          *[{"group_by": g} for g in ("actor", "action", "entity_type", "day")]],
            "superapp_users": [{}],
            "roadmap": [{}, {"status": "DONE", "area": "SALES", "owner": "a", "search": "x"}],
            # Every catalog area, and every kind of record with and without a search (SQL per entity).
            "change_options": [{}, *[{"area": a} for a in catalog.AREAS]],
            "find_records": [*[{"entity": e} for e in catalog.ENTITIES],
                             *[{"entity": e, "search": "a_%"} for e in catalog.ENTITIES],
                             *[{"entity": e, "merchant_id": "x"} for e, d in catalog.ENTITIES.items() if d.parent]],
        }
        # Action tools (propose_*) have their own tests in test_assistant_actions.py.
        missing = ({t.name for t in registry.ALL_TOOLS} - set(argsets)
                   - {"show_chart", "partner_lead_detail", "merchant_detail"}
                   - {t.name for t in registry.ALL_TOOLS if t.name.startswith("propose_")})
        assert not missing, missing
        for name, sets in argsets.items():
            for args in sets:
                raw, is_error = await engine.run_tool(ctx, ToolCall("t", name, args))
                assert not is_error, (name, args, raw)
        # Detail lookups with an id found above.
        leads = json.loads((await engine.run_tool(ctx, ToolCall("t", "partner_leads", {"search": "Pat"})))[0])
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", "partner_lead_detail", {"lead_id": leads["rows"][0]["id"]}))
        assert not is_error and "Pat Partner" in raw
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", "merchant_detail", {"name": "zzz-no-such"}))
        assert is_error
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", "quotes", {"kind": "links", "group_by": "plan"}))
        assert is_error and "requests" in raw
        await session.rollback()
    async with sessions_() as db:
        await db.execute(text("delete from public.partner_leads where email like '%@assistant.test'"))
        await db.commit()


# ----------------------------------------------------------- HTTP API ----
@pytest.fixture()
def fake_model(monkeypatch, api):
    clients, users, sessions_ = api
    monkeypatch.setattr(assistant_router, "SessionLocal", sessions_)
    holder: dict[str, ScriptedProvider] = {}

    def use(*rounds):
        holder["p"] = ScriptedProvider(list(rounds))
        return holder["p"]

    monkeypatch.setattr(assistant_router, "make_provider", lambda: holder.get("p"))
    return use


async def _clear_assistant(sessions_):
    async with sessions_() as db:
        auth = qualified("auth")
        await db.execute(text(f"delete from {auth}.assistant_usage where user_id in "
                              f"(select id from {auth}.\"user\" where email like '%@test.sales')"))
        await db.commit()


async def test_chat_streams_saves_and_continues_a_conversation(api, fake_model):
    clients, users, sessions_ = api
    await _clear_assistant(sessions_)
    fake_model(call("sales_deals", {"status": "open"}), say("You have **3** open deals."))
    res = await clients["adam"].post("/assistant/chat", json={"message": "How many open deals do I have?"})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(res.text)
    assert events[0][0] == "chat" and events[-1][0] == "done"
    chat_id = events[0][1]["id"]

    detail = (await clients["adam"].get(f"/assistant/chats/{chat_id}")).json()
    assert detail["title"] == "How many open deals do I have?"
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["blocks"] == [{"type": "text", "text": "You have **3** open deals."}]
    assert detail["messages"][1]["tools"] == ["Looking up deals"]

    # Follow-up: the earlier turn goes to the model as plain text.
    provider = fake_model(say("**1** of them is won."))
    res = await clients["adam"].post("/assistant/chat", json={"message": "And won?", "chatId": chat_id})
    assert parse_sse(res.text)[-1][0] == "done"
    sent = provider.calls[0]["messages"]
    assert sent[0] == {"role": "user", "content": "How many open deals do I have?"}
    assert sent[1]["role"] == "assistant" and sent[-1]["content"][0]["text"] == "And won?"

    listed = (await clients["adam"].get("/assistant/chats")).json()
    assert listed[0]["id"] == chat_id
    async with sessions_() as db:
        usage = (await db.execute(select(AssistantUsage).where(AssistantUsage.chat_id == chat_id))).scalars().all()
        assert len(usage) == 2 and usage[0].provider == "fake" and usage[0].tool_calls in (0, 1)


async def test_chats_are_private_to_their_owner(api, fake_model):
    clients, users, sessions_ = api
    fake_model(say("Hi."))
    res = await clients["adam"].post("/assistant/chat", json={"message": "hello"})
    chat_id = parse_sse(res.text)[0][1]["id"]
    assert (await clients["saad"].get(f"/assistant/chats/{chat_id}")).status_code == 404
    assert (await clients["saad"].patch(f"/assistant/chats/{chat_id}", json={"title": "x"})).status_code == 404
    assert (await clients["saad"].delete(f"/assistant/chats/{chat_id}")).status_code == 404
    fake_model(say("Hi."))
    assert (await clients["saad"].post("/assistant/chat", json={"message": "x", "chatId": chat_id})).status_code == 404
    assert chat_id not in {c["id"] for c in (await clients["saad"].get("/assistant/chats")).json()}
    # The owner can rename, pin and delete it. Renaming doesn't count as activity.
    before = (await clients["adam"].get(f"/assistant/chats/{chat_id}")).json()["updatedAt"]
    renamed = (await clients["adam"].patch(f"/assistant/chats/{chat_id}", json={"title": "Greeting", "pinned": True})).json()
    assert renamed["pinned"] and renamed["title"] == "Greeting" and renamed["updatedAt"] == before
    assert (await clients["adam"].delete(f"/assistant/chats/{chat_id}")).status_code == 204
    assert (await clients["adam"].get(f"/assistant/chats/{chat_id}")).status_code == 404


async def test_model_errors_end_the_stream_and_are_saved(api, fake_model, monkeypatch):
    clients, users, sessions_ = api

    class Broken(ScriptedProvider):
        async def stream(self, **kw):
            yield TextDelta("Partial ")
            raise ProviderError("The AI service is overloaded right now. Try again in a minute.")

    broken = Broken([])
    monkeypatch.setattr(assistant_router, "make_provider", lambda: broken)
    res = await clients["adam"].post("/assistant/chat", json={"message": "anything"})
    events = parse_sse(res.text)
    assert events[-1][0] == "error" and "overloaded" in events[-1][1]["message"]
    chat = (await clients["adam"].get(f"/assistant/chats/{events[0][1]['id']}")).json()
    assert chat["messages"][1]["error"].startswith("The AI service is overloaded")
    assert chat["messages"][1]["blocks"] == [{"type": "text", "text": "Partial "}]


async def test_not_configured_daily_limit_and_status(api, fake_model, monkeypatch):
    clients, users, sessions_ = api
    await _clear_assistant(sessions_)
    # No provider configured.
    res = await clients["adam"].post("/assistant/chat", json={"message": "hi"})
    assert res.status_code == 503
    status = (await clients["adam"].get("/assistant/status")).json()
    assert status["configured"] is False and status["salesScope"] == "own" and status["usedToday"] == 0
    assert "Looking up deals" in status["areas"] and "Looking up merchants" not in status["areas"]
    assert (await clients["marketing"].get("/assistant/status")).json()["salesScope"] is None
    assert (await clients["anon"].get("/assistant/status")).status_code == 401

    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "ASSISTANT_DAILY_LIMIT", 1)
    fake_model(say("one"))
    assert (await clients["adam"].post("/assistant/chat", json={"message": "first"})).status_code == 200
    fake_model(say("two"))
    res = await clients["adam"].post("/assistant/chat", json={"message": "second"})
    assert res.status_code == 429 and "daily limit" in res.json()["message"].lower()
    # The question is counted when it starts, not when it ends, so parallel tabs can't overshoot.
    async with sessions_() as db:
        rows = (await db.execute(select(AssistantUsage).where(AssistantUsage.user_id == users["adam"].id))).scalars().all()
        assert len(rows) == 1 and rows[0].rounds == 1 and rows[0].chat_id
    assert (await clients["adam"].post("/assistant/chat", json={"message": ""})).status_code in (400, 422)


def test_assistant_stays_off_until_url_key_and_model_are_set(monkeypatch):
    s = get_settings()
    for k in ("ASSISTANT_API_URL", "ASSISTANT_API_KEY", "ASSISTANT_MODEL"):
        monkeypatch.setattr(s, k, None)
    assert assistant_router.make_provider() is None
    monkeypatch.setattr(s, "ASSISTANT_API_URL", "https://ai.example.test")
    monkeypatch.setattr(s, "ASSISTANT_API_KEY", "k")
    assert assistant_router.make_provider() is None  # still no model
    monkeypatch.setattr(s, "ASSISTANT_MODEL", "test-model")
    monkeypatch.setattr(s, "ASSISTANT_API_HEADERS", {"x-api-version": "1"})
    p = assistant_router.make_provider()
    assert p is not None and p.model == "test-model" and p._extra_headers == {"x-api-version": "1"}
