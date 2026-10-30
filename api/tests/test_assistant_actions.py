"""Assistant actions: proposals change nothing; Confirm carries them out as the person.

Uses the Sales API fixture (logins for admin, manager, reps, marketing) and the
partner portal tables created locally by tests.test_assistant.PARTNER_DDL.
"""
from __future__ import annotations

import datetime as dt
import json
import uuid

import pytest
from sqlalchemy import select, text

from app.common.deps import AuthenticatedUser
from app.models import quotes as qm
from app.models import roadmap as rm
from app.models.assistant import AssistantAction
from app.models.audit import AuditLog
from app.db.schemas import qualified
from app.modules.assistant import engine
from app.modules.assistant import router as assistant_router
from app.modules.assistant.provider import ToolCall
from app.modules.assistant.tools_base import Ctx
from tests.test_assistant import PARTNER_DDL, ScriptedProvider, call, parse_sse, say
from tests.test_sales_api import api  # noqa: F401 - pytest fixture, used by name
from tests.test_salesforce_sync import sessions  # noqa: F401 - pytest fixture, used by name

MARK = "@actions.test"


@pytest.fixture()
async def world(api, monkeypatch):
    clients, users, sessions_ = api
    monkeypatch.setattr(assistant_router, "SessionLocal", sessions_)
    async with sessions_() as db:
        for ddl in PARTNER_DDL:
            await db.execute(text(ddl))
        await db.execute(text(f"delete from public.partner_leads where email like '%{MARK}'"))
        await _clear_team(db)
        # The partner team comes from Super App people: two pending sales invitations, one
        # switched off for leads, plus a past owner with no login at all.
        for who, name, assignable in (("sam", "Sam Seller", None), ("nope", "Not Assignable", False), ("gone", "Gone Person", None)):
            if who != "gone":
                await db.execute(text(f"insert into {AUTH}.invitation (id, email, role, token_hash, expires_at) values "
                                      "(:id, :e, 'SALES_EXECUTIVE', :h, now() + interval '7 days')"),
                                 {"id": f"inv{uuid.uuid4().hex[:20]}", "e": f"{who}{MARK}", "h": uuid.uuid4().hex})
            await db.execute(text(f"insert into {AUTH}.lead_routing (email, name, assignable) values (:e, :n, :a)"),
                             {"e": f"{who}{MARK}", "n": name, "a": assignable})
        ids = {}
        for name in ("Maheen", "Test value", "Shayan Test", "Freddie Williams"):
            lead_id = str(uuid.uuid4())
            ids[name] = lead_id
            await db.execute(text("insert into public.partner_leads (id, full_name, email, status, wants_call) values "
                                  "(:id, :n, :e, 'new', false)"), {"id": lead_id, "n": name, "e": f"{lead_id[:8]}{MARK}"})
        await db.commit()
    yield clients, users, sessions_, ids
    async with sessions_() as db:
        await db.execute(text(f"delete from public.partner_leads where email like '%{MARK}'"))
        await _clear_team(db)
        await db.commit()


AUTH = qualified("auth")


async def _clear_team(db):
    await db.execute(text(f"delete from {AUTH}.invitation where email like '%{MARK}'"))
    await db.execute(text(f"delete from {AUTH}.lead_routing where email like '%{MARK}'"))


async def _ctx(sessions_, user, *, role=None):
    cm = sessions_()
    db = await cm.__aenter__()
    await engine.begin_readonly(db)
    ctx = Ctx(db=db, user=AuthenticatedUser(id=user.id, email=user.email, role=role or user.role.value),
              session_factory=sessions_)
    return ctx, cm


def _ids_in(args) -> set[str]:
    out = set()
    for v in args.values():
        for x in (v if isinstance(v, list) else [v]):
            if isinstance(x, str):
                out.add(x)
    return out


async def _propose(sessions_, user, name, args, role=None, seen=True):
    """Run a propose_ tool. By default the targets count as already looked up in this answer."""
    ctx, cm = await _ctx(sessions_, user, role=role)
    if seen:
        ctx.seen_ids |= _ids_in(args)
    try:
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", name, args))
    finally:
        await cm.__aexit__(None, None, None)
    return json.loads(raw), is_error, ctx


async def _leads(sessions_, ids):
    async with sessions_() as db:
        rows = (await db.execute(text("select id::text, status, assigned_to from public.partner_leads "
                                      "where id = any(cast(:ids as uuid[]))"), {"ids": list(ids)})).mappings().all()
    return {r["id"]: dict(r) for r in rows}


async def test_proposing_a_delete_changes_nothing_until_confirmed(world):
    clients, users, sessions_, ids = world
    targets = [ids["Maheen"], ids["Test value"], ids["Shayan Test"]]
    out, is_error, ctx = await _propose(sessions_, users["admin"], "propose_partner_leads_delete", {"lead_ids": targets})
    assert not is_error and out["proposed"] is True and "NOT done" in out["note"]
    assert ctx.actions[0]["destructive"] is True and ctx.actions[0]["status"] == "pending"
    assert sorted(ctx.actions[0]["items"]) == ["Maheen", "Shayan Test", "Test value"]
    assert len(await _leads(sessions_, targets)) == 3  # still there

    res = await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.status_code == 200, res.text
    action = res.json()["action"]
    assert action["status"] == "done" and all(r["ok"] for r in action["results"])
    assert await _leads(sessions_, targets) == {}
    assert ids["Freddie Williams"] in await _leads(sessions_, [ids["Freddie Williams"]])  # untouched

    # It ran through the real endpoint: the audit log says who, and that it came from the assistant.
    async with sessions_() as db:
        logs = (await db.execute(select(AuditLog).where(AuditLog.entity_type == "PartnerLead",
                                                        AuditLog.entity_id.in_(targets)))).scalars().all()
    assert len(logs) == 3 and {l.actor_id for l in logs} == {users["admin"].id}
    assert all("SuperApp assistant" in (l.user_agent or "") for l in logs)

    # A second click can't run it again.
    assert (await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")).status_code == 409


async def test_only_the_proposer_can_confirm_or_cancel(world):
    clients, users, sessions_, ids = world
    out, _, _ = await _propose(sessions_, users["admin"], "propose_partner_leads_delete", {"lead_ids": [ids["Maheen"]]})
    for who in ("manager", "adam"):
        assert (await clients[who].post(f"/assistant/actions/{out['actionId']}/confirm")).status_code == 404
        assert (await clients[who].post(f"/assistant/actions/{out['actionId']}/cancel")).status_code == 404
    res = await clients["admin"].post(f"/assistant/actions/{out['actionId']}/cancel")
    assert res.json()["action"]["status"] == "cancelled"
    assert (await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")).status_code == 409
    assert ids["Maheen"] in await _leads(sessions_, [ids["Maheen"]])


async def test_delete_is_admin_only_and_reps_can_change_status(world):
    clients, users, sessions_, ids = world
    # A rep may edit leads but not delete them: the tool isn't offered, and is refused if asked for.
    out, is_error, _ = await _propose(sessions_, users["adam"], "propose_partner_leads_delete", {"lead_ids": [ids["Maheen"]]})
    assert is_error and "No lookup called" in out["error"]
    out, is_error, ctx = await _propose(sessions_, users["adam"], "propose_partner_leads_update",
                                        {"lead_ids": [ids["Maheen"]], "status": "spam", "assigned_to": f"sam{MARK}"})
    assert not is_error and "new → spam" in ctx.actions[0]["items"][0] and "Sam Seller" in ctx.actions[0]["items"][0]
    res = await clients["adam"].post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.json()["action"]["status"] == "done", res.text
    lead = (await _leads(sessions_, [ids["Maheen"]]))[ids["Maheen"]]
    assert lead["status"] == "spam" and lead["assigned_to"] == f"sam{MARK}"
    # Marketing has no partner access at all.
    out, is_error, _ = await _propose(sessions_, users["marketing"], "propose_partner_leads_update",
                                      {"lead_ids": [ids["Maheen"]], "status": "new"})
    assert is_error


async def test_confirm_runs_with_the_persons_permissions_at_that_moment(world):
    """If someone's role changes after the proposal, the real endpoint refuses on confirm."""
    clients, users, sessions_, ids = world
    out, _, _ = await _propose(sessions_, users["adam"], "propose_partner_leads_update",
                               {"lead_ids": [ids["Test value"]], "status": "lost"})
    # Same proposal confirmed by a client whose token says MARKETING_EXECUTIVE (no partners.edit).
    from app.common.security.jwt import create_access_token
    import httpx
    from app.main import app

    token, _ = create_access_token({"sub": users["adam"].id, "email": users["adam"].email, "role": "MARKETING_EXECUTIVE"})
    async with sessions_() as db:
        from app.models.auth import User
        from app.models.enums import Role
        u = await db.get(User, users["adam"].id)
        u.role = Role.MARKETING_EXECUTIVE
        await db.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1",
                                 headers={"Authorization": f"Bearer {token}"}) as c:
        res = await c.post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.status_code == 200
    action = res.json()["action"]
    assert action["status"] == "failed" and action["results"][0]["status"] == 403
    assert (await _leads(sessions_, [ids["Test value"]]))[ids["Test value"]]["status"] == "new"


async def test_only_records_looked_up_in_this_answer_can_be_targeted(world):
    """Injected text naming another record's id can't add it: it wasn't in a lookup result."""
    clients, users, sessions_, ids = world
    out, is_error, _ = await _propose(sessions_, users["admin"], "propose_partner_leads_delete",
                                      {"lead_ids": [ids["Freddie Williams"]]}, seen=False)
    assert is_error and "Look these records up first" in out["error"]
    # After a real lookup that returned it, it's allowed.
    ctx, cm = await _ctx(sessions_, users["admin"])
    try:
        await engine.run_tool(ctx, ToolCall("t", "partner_leads", {"search": "Freddie"}))
        assert ids["Freddie Williams"] in ctx.seen_ids
        raw, is_error = await engine.run_tool(ctx, ToolCall("t", "propose_partner_leads_delete",
                                                            {"lead_ids": [ids["Freddie Williams"]]}))
        assert not is_error, raw
    finally:
        await cm.__aexit__(None, None, None)


async def test_bad_proposals_are_refused_with_reasons(world):
    clients, users, sessions_, ids = world
    admin = users["admin"]
    cases = [
        ("propose_partner_leads_delete", {"lead_ids": [str(uuid.uuid4())]}, "No partner lead"),
        ("propose_partner_leads_delete", {"lead_ids": ["drop table"]}, "must be an id"),
        ("propose_partner_leads_delete", {"lead_ids": [str(uuid.uuid4()) for _ in range(26)]}, "At most 25"),
        ("propose_partner_leads_update", {"lead_ids": [ids["Maheen"]]}, "status"),
        ("propose_partner_leads_update", {"lead_ids": [ids["Maheen"]], "status": "deleted"}, "status must be"),
        ("propose_partner_leads_update", {"lead_ids": [ids["Maheen"]], "assigned_to": "x@y.z"}, "partner team"),
        ("propose_partner_leads_update", {"lead_ids": [ids["Maheen"]], "assigned_to": f"nope{MARK}"}, "switched off"),
        ("propose_partner_leads_update", {"lead_ids": [ids["Maheen"]], "assigned_to": f"gone{MARK}"}, "no Super App login"),
        ("propose_partner_lead_note", {"lead_id": ids["Maheen"], "note": "  "}, "note"),
    ]
    for name, args, phrase in cases:
        out, is_error, _ = await _propose(sessions_, admin, name, args)
        assert is_error and phrase in out["error"], (name, args, out)
    async with sessions_() as db:
        n = (await db.execute(select(AssistantAction).where(AssistantAction.user_id == admin.id,
                                                            AssistantAction.status == "pending"))).scalars().all()
    assert not [a for a in n if a.name in ("partner_leads_delete",) and a.items == []]


async def test_expired_and_partial(world):
    clients, users, sessions_, ids = world
    out, _, _ = await _propose(sessions_, users["admin"], "propose_partner_leads_delete", {"lead_ids": [ids["Maheen"]]})
    async with sessions_() as db:
        a = await db.get(AssistantAction, out["actionId"])
        a.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        await db.commit()
    res = await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.status_code == 409 and "expired" in res.json()["message"]

    # One of two leads disappears between proposal and confirm: the other still goes, status partial.
    out, _, _ = await _propose(sessions_, users["admin"], "propose_partner_leads_update",
                               {"lead_ids": [ids["Test value"], ids["Shayan Test"]], "status": "spam"})
    async with sessions_() as db:
        await db.execute(text("delete from public.partner_leads where id = :id"), {"id": ids["Shayan Test"]})
        await db.commit()
    action = (await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")).json()["action"]
    assert action["status"] == "partial"
    assert [r["ok"] for r in action["results"]] == [True, False] and action["results"][1]["status"] == 404


async def test_roadmap_and_quote_actions(world):
    clients, users, sessions_, ids = world
    async with sessions_() as db:
        phase = rm.Phase(name="Test phase actions", start_month=dt.date(2026, 10, 1), end_month=dt.date(2026, 12, 1))
        db.add(phase)
        await db.flush()
        item = rm.Item(phase_id=phase.id, title="Owned by Adam", area="SALES", owner_id=users["adam"].id)
        link = qm.QuoteLink(token_hash=uuid.uuid4().hex * 2, mode=qm.MODE_SHOW, restaurant_name="Casa Test",
                            created_by_id=users["admin"].id, created_by_email=users["admin"].email)
        db.add_all([item, link])
        await db.commit()
        phase_id, item_id, link_id = phase.id, item.id, link.id
    try:
        # Admin adds an item.
        out, is_error, _ = await _propose(sessions_, users["admin"], "propose_roadmap_item_create",
                                          {"phase": "Test phase actions", "title": "Assistant can act", "area": "PLATFORM",
                                           "owner_email": users["adam"].email, "target_date": "2026-11-15"})
        assert not is_error, out
        action = (await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")).json()["action"]
        assert action["status"] == "done", action
        # The owner (a rep) may change status, not the title.
        out, is_error, _ = await _propose(sessions_, users["adam"], "propose_roadmap_item_update",
                                          {"item_id": item_id, "title": "Renamed"})
        assert is_error and "owner" in out["error"]
        out, is_error, _ = await _propose(sessions_, users["adam"], "propose_roadmap_item_update",
                                          {"item_id": item_id, "status": "DONE"})
        assert not is_error
        action = (await clients["adam"].post(f"/assistant/actions/{out['actionId']}/confirm")).json()["action"]
        assert action["status"] == "done", action
        # Someone else's item: refused before anything is proposed.
        out, is_error, _ = await _propose(sessions_, users["saad"], "propose_roadmap_item_update",
                                          {"item_id": item_id, "status": "TODO"})
        assert is_error
        # Revoking a quote link.
        out, is_error, _ = await _propose(sessions_, users["admin"], "propose_quote_links_revoke", {"link_ids": [link_id]})
        assert not is_error, out
        action = (await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")).json()["action"]
        assert action["status"] == "done", action
        async with sessions_() as db:
            assert (await db.get(qm.QuoteLink, link_id)).status == "REVOKED"
            assert (await db.get(rm.Item, item_id)).status == "DONE"
            created = (await db.execute(select(rm.Item).where(rm.Item.title == "Assistant can act"))).scalar_one()
            assert created.owner_id == users["adam"].id and created.area == "PLATFORM"
    finally:
        async with sessions_() as db:
            for model, cond in ((rm.Item, rm.Item.phase_id == phase_id), (rm.Phase, rm.Phase.id == phase_id),
                                (qm.QuoteLink, qm.QuoteLink.id == link_id)):
                for row in (await db.execute(select(model).where(cond))).scalars().all():
                    await db.delete(row)
            await db.commit()


async def test_card_streams_and_chat_shows_live_status(world, monkeypatch):
    clients, users, sessions_, ids = world
    provider = ScriptedProvider([
        call("partner_leads", {"search": "Maheen"}, tid="toolu_0"),
        call("propose_partner_leads_delete", {"lead_ids": [ids["Maheen"]]}),
        say("Ready to delete Maheen - confirm on the card."),
    ])
    monkeypatch.setattr(assistant_router, "make_provider", lambda: provider)
    res = await clients["admin"].post("/assistant/chat", json={"message": "delete the Maheen test lead"})
    events = parse_sse(res.text)
    kinds = [e[0] for e in events]
    assert "action" in kinds and kinds[-1] == "done"
    card = next(e[1]["action"] for e in events if e[0] == "action")
    assert card["status"] == "pending" and card["items"] == ["Maheen"]
    chat_id = events[0][1]["id"]
    # The proposal tool result told the model it isn't done.
    assert "NOT done" in provider.calls[2]["messages"][-1]["content"][0]["content"]

    await clients["admin"].post(f"/assistant/actions/{card['id']}/confirm")
    chat = (await clients["admin"].get(f"/assistant/chats/{chat_id}")).json()
    block = next(b for b in chat["messages"][1]["blocks"] if b["type"] == "action")
    assert block["action"]["status"] == "done"
    # And the next question's history tells the model what happened.
    provider2 = ScriptedProvider([say("Done earlier.")])
    monkeypatch.setattr(assistant_router, "make_provider", lambda: provider2)
    await clients["admin"].post("/assistant/chat", json={"message": "did it work?", "chatId": chat_id})
    history = json.dumps(provider2.calls[0]["messages"])
    assert "status: done" in history and "partner_leads_delete" in history
    assert "Permanently delete" not in history  # the card's title (record text) isn't replayed as the model's words
    # The live status is also available directly.
    got = (await clients["admin"].get(f"/assistant/actions/{card['id']}")).json()["action"]
    assert got["status"] == "done" and got["steps"] == 1
