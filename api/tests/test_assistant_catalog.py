"""The assistant's change catalog: it can propose what the signed-in person can do, and no more.

- every write endpoint is classified (catalog / hand-written tool / excluded with a reason);
- change_options lists only what the person's role holds, read from the routes' own checks;
- propose_change refuses other roles' operations, unseen ids, and fields the endpoint would refuse;
- a confirmed proposal runs through the real endpoint as the person (audit row included);
- show-once values (a new quote link) reach the person who confirmed, and are never stored.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select, text

from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser
from app.db.schemas import qualified
from app.main import app
from app.models.assistant import AssistantAction
from app.models.audit import AuditLog
from app.models.profiling import Merchant
from app.modules.assistant import catalog, engine
from app.modules.assistant import router as assistant_router
from app.modules.assistant.provider import ToolCall
from app.modules.assistant.tools_base import Ctx
from tests.test_sales_api import api  # noqa: F401 - pytest fixture, used by name
from tests.test_salesforce_sync import sessions  # noqa: F401 - pytest fixture, used by name

MARK = "Catalog Test Bistro"


@pytest.fixture()
async def world(api, monkeypatch):
    clients, users, sessions_ = api
    monkeypatch.setattr(assistant_router, "SessionLocal", sessions_)
    P = qualified("profiling")
    async with sessions_() as db:
        await db.execute(text(f"delete from {P}.merchant where restaurant_name_dba like :m"), {"m": f"{MARK}%"})
        merchant = Merchant(restaurant_name=MARK)
        db.add(merchant)
        await db.commit()
        mid = merchant.id
    yield clients, users, sessions_, mid
    async with sessions_() as db:
        await db.execute(text(f"delete from {P}.merchant where restaurant_name_dba like :m"), {"m": f"{MARK}%"})
        await db.execute(text(f"delete from {qualified('quotes')}.quote_link where restaurant_name like :m"),
                         {"m": f"{MARK}%"})
        await db.commit()


async def _run(sessions_, user, name, args, *, role=None, ctx=None):
    """Run one tool. Pass ctx to keep seen ids across calls, as within one answer."""
    own = ctx is None
    if own:
        cm = sessions_()
        db = await cm.__aenter__()
        await engine.begin_readonly(db)
        ctx = Ctx(db=db, user=AuthenticatedUser(id=user.id, email=user.email, role=role or user.role.value),
                  session_factory=sessions_)
        ctx._cm = cm  # type: ignore[attr-defined]
    raw, is_error = await engine.run_tool(ctx, ToolCall("t", name, args))
    return json.loads(raw), is_error, ctx


async def _close(ctx):
    await ctx._cm.__aexit__(None, None, None)


# ------------------------------------------------------------ coverage ----
def test_every_write_endpoint_is_classified():
    from app.modules.assistant.catalog import COVERED, EXCLUDED, OPERATIONS, route_table

    routes = set(route_table())
    classified = {(o.method, o.path) for o in OPERATIONS} | set(COVERED) | set(EXCLUDED)
    assert routes - classified == set(), "new write endpoint: add it to the assistant catalog (or exclude it, with why)"
    assert classified - routes == set(), "catalog lists an endpoint that no longer exists"
    assert not ({(o.method, o.path) for o in OPERATIONS} & (set(COVERED) | set(EXCLUDED)))
    for o in OPERATIONS:
        assert route_table()[(o.method, o.path)].capabilities, f"{o.key}: route has no capability check"
        for p in o.params:
            assert "{" + p + "}" in o.path, f"{o.key}: {p} not in path"
        for e in o.params.values():
            assert e is None or e == "team_member" or e in catalog.ENTITIES, f"{o.key}: unknown entity {e}"
    assert len({o.key for o in OPERATIONS}) == len(OPERATIONS)


def test_every_catalog_operation_documents_its_fields():
    for o in catalog.OPERATIONS:
        doc = catalog.fields_doc(o)
        assert doc is None or isinstance(doc, dict), o.key


# --------------------------------------------------------------- roles ----
async def _op_keys(sessions_, user, role=None) -> set[str]:
    out, is_error, ctx = await _run(sessions_, user, "change_options", {}, role=role)
    assert not is_error
    keys: set[str] = set()
    for a in out["areas"]:
        o2, err, _ = await _run(sessions_, user, "change_options", {"area": a["area"]}, ctx=ctx)
        assert not err
        keys |= {x["operation"] for x in o2["operations"]}
    await _close(ctx)
    return keys


@pytest.mark.parametrize("role", ["SUPER_ADMIN", "ADMIN", "MARKETING_MANAGER", "MARKETING_EXECUTIVE",
                                  "SALES_MANAGER", "SALES_EXECUTIVE"])
async def test_options_match_exactly_what_the_role_can_do(world, role):
    _, users, sessions_, _ = world
    keys = await _op_keys(sessions_, users["admin"], role=role)
    expected = {o.key for o in catalog.OPERATIONS
                if all(has_capability(role, c) for c in catalog.route_table()[(o.method, o.path)].capabilities)}
    assert keys == expected
    if role == "SUPER_ADMIN":
        assert keys == {o.key for o in catalog.OPERATIONS}
    if role == "MARKETING_EXECUTIVE":
        assert "merchant.update" in keys and "invitation.create" not in keys and "quote_link.create" not in keys
    if role == "SALES_EXECUTIVE":
        assert "quote_link.create" in keys and "merchant.update" not in keys and "user.update" not in keys


async def test_a_role_cannot_propose_what_it_cannot_do(world):
    _, users, sessions_, mid = world
    out, is_error, ctx = await _run(sessions_, users["marketing"], "propose_change",
                                    {"operation": "invitation.create",
                                     "changes": [{"fields": {"email": "x@innowi.com", "role": "ADMIN"}}]})
    await _close(ctx)
    assert is_error and "role can't" in out["error"]
    out, is_error, ctx = await _run(sessions_, users["adam"], "find_records", {"entity": "merchant"})
    await _close(ctx)
    assert is_error and "can't see" in out["error"]


# --------------------------------------------------------- the id rule ----
async def test_ids_must_come_from_a_lookup_in_the_same_answer(world):
    _, users, sessions_, mid = world
    args = {"operation": "merchant.update", "changes": [{"ids": {"id": mid}, "fields": {"accountHealth": "RED"}}]}
    out, is_error, ctx = await _run(sessions_, users["admin"], "propose_change", args)
    assert is_error and "Look the merchant up first" in out["error"]
    found, err, _ = await _run(sessions_, users["admin"], "find_records", {"entity": "merchant", "search": MARK}, ctx=ctx)
    assert not err and found["records"][0]["id"] == mid
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change", args, ctx=ctx)
    assert not is_error and out["proposed"] is True, out
    card = ctx.actions[-1]
    assert card["items"] == [f"Change a merchant's details: {MARK} — account health → RED"]
    # An id inside the fields (the account manager) has to be looked up too.
    bad = {"operation": "merchant.update",
           "changes": [{"ids": {"id": mid}, "fields": {"accountManagerId": "notlookedup123"}}]}
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change", bad, ctx=ctx)
    assert is_error and "notlookedup123" in out["error"]
    await _close(ctx)


async def test_fields_are_checked_with_the_endpoints_own_rules(world):
    _, users, sessions_, mid = world
    _, _, ctx = await _run(sessions_, users["admin"], "find_records", {"entity": "merchant", "search": MARK})
    for fields, want in [({"accountHealth": "PURPLE"}, "accountHealth"), ({"googleAdsBudget": -5}, "googleAdsBudget"),
                         ({"nonsense": 1}, "nonsense")]:
        out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                      {"operation": "merchant.update", "changes": [{"ids": {"id": mid}, "fields": fields}]},
                                      ctx=ctx)
        assert is_error and want in out["error"], (fields, out)
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                  {"operation": "made.up", "changes": [{}]}, ctx=ctx)
    assert is_error
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                  {"operation": "merchant.field.update",
                                   "changes": [{"ids": {"id": mid, "key": "not_a_field"}, "fields": {"value": "x"}}]},
                                  ctx=ctx)
    assert is_error and "unknown profile field key" in out["error"]
    await _close(ctx)


# ------------------------------------------------------- end to end ----
async def test_confirmed_change_runs_through_the_endpoint_as_the_person(world):
    clients, users, sessions_, mid = world
    _, _, ctx = await _run(sessions_, users["admin"], "find_records", {"entity": "merchant", "search": MARK})
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                  {"operation": "keyword.create",
                                   "changes": [{"ids": {"merchant_id": mid}, "fields": {"term": "best tacos", "type": "PRIMARY"}},
                                               {"ids": {"merchant_id": mid}, "fields": {"term": "late night food", "type": "SECONDARY"}}]},
                                  ctx=ctx)
    await _close(ctx)
    assert not is_error, out
    P = qualified("profiling")
    async with sessions_() as db:
        n = (await db.execute(text(f"select count(*) from {P}.keyword where merchant_id = :m"), {"m": mid})).scalar_one()
    assert n == 0  # nothing until Confirm

    res = await clients["admin"].post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.status_code == 200, res.text
    assert res.json()["action"]["status"] == "done"
    async with sessions_() as db:
        terms = (await db.execute(text(f"select term from {P}.keyword where merchant_id = :m order by term"), {"m": mid})).scalars().all()
        logs = (await db.execute(select(AuditLog).where(AuditLog.merchant_id == mid, AuditLog.entity_type == "Keyword"))).scalars().all()
    assert terms == ["best tacos", "late night food"]
    assert len(logs) == 2 and all("SuperApp assistant" in (l.user_agent or "") for l in logs)
    assert {l.actor_id for l in logs} == {users["admin"].id}


async def test_permission_is_checked_again_when_confirming(world):
    """Proposed while the person was an admin; by Confirm their login is a Marketing Executive's
    (as after a role change). The endpoint refuses, and the card says it didn't work."""
    clients, users, sessions_, mid = world
    _, _, ctx = await _run(sessions_, users["marketing"], "find_records", {"entity": "merchant", "search": MARK},
                           role="ADMIN")
    out, is_error, _ = await _run(sessions_, users["marketing"], "propose_change",
                                  {"operation": "merchant.delete", "changes": [{"ids": {"id": mid}}]}, ctx=ctx)
    await _close(ctx)
    assert not is_error and ctx.actions[-1]["destructive"] is True
    res = await clients["marketing"].post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.status_code == 200, res.text
    action = res.json()["action"]
    assert action["status"] == "failed" and action["results"][0]["status"] == 403
    async with sessions_() as db:
        n = (await db.execute(text(f"select count(*) from {qualified('profiling')}.merchant where id = :m"), {"m": mid})).scalar_one()
    assert n == 1  # still there

    # And a real Marketing Executive isn't even offered it.
    _, _, ctx = await _run(sessions_, users["marketing"], "find_records", {"entity": "merchant", "search": MARK})
    out, is_error, _ = await _run(sessions_, users["marketing"], "propose_change",
                                  {"operation": "merchant.delete", "changes": [{"ids": {"id": mid}}]}, ctx=ctx)
    await _close(ctx)
    assert is_error and "role can't" in out["error"]


async def test_show_once_values_reach_the_confirmer_and_are_never_stored(world):
    clients, users, sessions_, mid = world
    _, _, ctx = await _run(sessions_, users["adam"], "change_options", {"area": "quotes"})
    out, is_error, _ = await _run(sessions_, users["adam"], "propose_change",
                                  {"operation": "quote_link.create",
                                   "changes": [{"fields": {"mode": "HIDE_PRICES", "restaurantName": f"{MARK} Quote"}}]}, ctx=ctx)
    await _close(ctx)
    assert not is_error, out
    res = await clients["adam"].post(f"/assistant/actions/{out['actionId']}/confirm")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["action"]["status"] == "done"
    url = body["revealed"][0]["url"]
    assert "/q/" in url
    async with sessions_() as db:
        row = await db.get(AssistantAction, out["actionId"])
    assert url not in json.dumps(row.results) and url not in json.dumps(row.steps) and url not in json.dumps(row.items)
    # Reading the action back later doesn't bring it back either.
    again = (await clients["adam"].get(f"/assistant/actions/{out['actionId']}")).json()
    assert url not in json.dumps(again)


async def test_find_records_scopes_to_a_merchant_and_feeds_seen_ids(world):
    _, users, sessions_, mid = world
    out, is_error, ctx = await _run(sessions_, users["admin"], "find_records", {"entity": "keyword", "merchant_id": mid})
    assert not is_error and out["records"] == []
    out, is_error, _ = await _run(sessions_, users["admin"], "find_records", {"entity": "user", "search": "adam@test"},
                                  ctx=ctx)
    assert not is_error and out["records"][0]["email"] == "adam@test.sales"
    assert out["records"][0]["id"] in ctx.seen_ids
    out, is_error, _ = await _run(sessions_, users["admin"], "find_records", {"entity": "nope"}, ctx=ctx)
    assert is_error
    await _close(ctx)


# ------------------------------------------------- review fixes (2026-10-19) ----
def test_secret_fields_are_never_offered():
    for o in catalog.OPERATIONS:
        assert not catalog.SECRET_FIELD.search(json.dumps(catalog.fields_doc(o) or {})), o.key


async def test_passwords_and_secrets_are_refused(world):
    _, users, sessions_, _ = world
    _, _, ctx = await _run(sessions_, users["admin"], "find_records", {"entity": "website"})
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                  {"operation": "website.create",
                                   "changes": [{"fields": {"name": "X", "slug": "x", "adminPassword": "Sup3rSecret-Pw!"}}]},
                                  ctx=ctx)
    assert is_error and "adminPassword" in out["error"] and "Sup3rSecret" not in out["error"]
    assert not ctx.actions  # nothing saved
    await _close(ctx)


async def test_card_shows_every_value_in_full(world):
    _, users, sessions_, mid = world
    long_note = "Call before 5pm. " * 20 + "Then visit https://example.com/at-the-very-end"
    _, _, ctx = await _run(sessions_, users["admin"], "find_records", {"entity": "merchant", "search": MARK})
    out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                  {"operation": "merchant.update", "changes": [{"ids": {"id": mid}, "fields": {"notes": long_note}}]},
                                  ctx=ctx)
    await _close(ctx)
    assert not is_error and long_note in ctx.actions[-1]["items"][0]


async def test_path_ids_cannot_walk_out_of_their_segment(world):
    _, users, sessions_, _ = world
    _, _, ctx = await _run(sessions_, users["admin"], "find_records", {"entity": "merchant"})
    ctx.seen_ids |= {"..", "."}
    for bad in ("..", ".", "a/b", "a?b", "a#b", "%2e%2e"):
        out, is_error, _ = await _run(sessions_, users["admin"], "propose_change",
                                      {"operation": "merchant.delete", "changes": [{"ids": {"id": bad}}]}, ctx=ctx)
        assert is_error, bad
    await _close(ctx)


async def test_limits_the_endpoint_checks_are_shown_to_roles_without_them(world):
    _, users, sessions_, _ = world
    out, _, ctx = await _run(sessions_, users["adam"], "change_options", {"area": "quotes"})
    await _close(ctx)
    link = next(o for o in out["operations"] if o["operation"] == "quote_link.create")
    assert any("special pricing" in x for x in link["limits"])
    out, _, ctx = await _run(sessions_, users["manager"], "change_options", {"area": "quotes"})
    await _close(ctx)
    link = next(o for o in out["operations"] if o["operation"] == "quote_link.create")
    assert "limits" not in link  # a Sales Manager may give special pricing


async def test_only_a_super_admin_can_make_a_super_admin(world):
    clients, users, sessions_, _ = world
    r = await clients["admin"].patch(f"/users/{users['manager'].id}", json={"role": "SUPER_ADMIN"})
    assert r.status_code == 403
    r = await clients["admin"].patch(f"/users/{users['manager'].id}", json={"role": "SALES_EXECUTIVE"})
    assert r.status_code == 200
