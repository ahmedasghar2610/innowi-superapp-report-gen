"""Sales API: who sees what, logins for salespeople, and the sync endpoints.

Runs against the configured Postgres (skipped when unreachable), with data
copied from the fake Salesforce in tests/salesforce_fake.py:
  Adam Smith (005...AAA)       owns deals O02 (open), O03 (won), O04, O05 on Casa Mia + Kantipur Cafe
  Freddie Williams (005...BBB) owns deal O01 on Tolin's Tacos
  Saad Ahmed (005...FSE)       owns the visit at Husky Boy Burgers and Casa Mia's touchpoint
  Casa Mia has an open support case owned by Manal (support)
"""
from __future__ import annotations

import datetime as dt

import httpx
import pytest
from sqlalchemy import select, text

from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password
from app.db.schemas import qualified
from app.db.session import get_db
from app.main import app
from app.models import salesforce as m
from app.models.audit import AuditLog
from app.models.auth import User
from app.models.enums import Role
from app.modules.salesforce import router as sales_router
from app.modules.salesforce.sync import run_sync
from tests.salesforce_fake import FakeSalesforce, seed
from tests.test_salesforce_sync import _factory
from tests.test_salesforce_sync import sessions  # noqa: F401 - pytest fixture, used by name

ADAM, FREDDIE, SAAD = "005000000000000AAA", "005000000000000BBB", "005000000000000FSE"


@pytest.fixture()
async def api(sessions, monkeypatch):
    async with sessions() as db:
        await db.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%@test.sales\''))
        await db.commit()
    await run_sync(sessions, trigger="manual", client_factory=_factory(seed(FakeSalesforce())))

    async def _db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = _db
    monkeypatch.setattr(sales_router, "SessionLocal", sessions)
    users: dict[str, User] = {}
    async with sessions() as db:
        for key, role in [("admin", Role.ADMIN), ("manager", Role.SALES_MANAGER), ("adam", Role.SALES_EXECUTIVE),
                          ("saad", Role.SALES_EXECUTIVE), ("unlinked", Role.SALES_EXECUTIVE), ("marketing", Role.MARKETING_EXECUTIVE)]:
            user = User(email=f"{key}@test.sales", password_hash=hash_password("x" * 12), role=role)
            db.add(user)
            users[key] = user
        await db.flush()
        db.add(m.SfUserLink(user_id=users["adam"].id, sf_user_id=ADAM))
        db.add(m.SfUserLink(user_id=users["saad"].id, sf_user_id=SAAD))
        await db.commit()

    clients: dict[str, httpx.AsyncClient] = {}
    for key, user in users.items():
        token, _ = create_access_token({"sub": user.id, "email": user.email, "role": user.role.value})
        clients[key] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1",
                                         headers={"Authorization": f"Bearer {token}"})
    clients["anon"] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1")
    yield clients, users, sessions
    for client in clients.values():
        await client.aclose()
    app.dependency_overrides.pop(get_db, None)
    async with sessions() as db:
        await db.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%@test.sales\''))
        await db.commit()


def _ids(body) -> set[str]:
    return {row["id"] for row in body["data"]}


async def test_rep_sees_only_their_own_deals(api):
    c, _, _ = api
    body = (await c["adam"].get("/sales/deals", params={"state": "all", "limit": 100})).json()
    assert _ids(body) == {"006000000000000O02", "006000000000000O03", "006000000000000O04", "006000000000000O05"}
    # Asking for someone else's records is ignored for a rep.
    body = (await c["adam"].get("/sales/deals", params={"state": "all", "ownerId": FREDDIE})).json()
    assert "006000000000000O01" not in _ids(body)


async def test_rep_cannot_open_another_reps_deal(api):
    c, _, _ = api
    assert (await c["adam"].get("/sales/deals/006000000000000O01")).status_code == 404
    deal = (await c["adam"].get("/sales/deals/006000000000000O02")).json()
    assert deal["accountName"] == "Casa Mia" and deal["customer"]["openCases"] == 1
    # Only Adam's deals on the customer page; the support case is the restaurant's, so it shows.
    assert {d["id"] for d in deal["customer"]["deals"]} == {"006000000000000O02", "006000000000000O03"}


async def test_manager_sees_everyone_and_can_filter(api):
    c, _, _ = api
    body = (await c["manager"].get("/sales/deals", params={"state": "all", "limit": 100})).json()
    assert len(_ids(body)) == 5
    body = (await c["manager"].get("/sales/deals", params={"state": "all", "ownerId": FREDDIE})).json()
    assert _ids(body) == {"006000000000000O01"}
    assert (await c["manager"].get("/sales/deals/006000000000000O01")).status_code == 200


async def test_unlinked_rep_sees_nothing(api):
    c, _, _ = api
    me = (await c["unlinked"].get("/sales/me")).json()
    assert me["linked"] is False and me["seeAll"] is False
    assert (await c["unlinked"].get("/sales/deals", params={"state": "all"})).json()["data"] == []
    assert (await c["unlinked"].get("/sales/customers")).json()["data"] == []
    assert (await c["unlinked"].get("/sales/cases", params={"state": "all"})).json()["data"] == []


async def test_roles_without_sales_access_are_refused(api):
    c, _, _ = api
    assert (await c["anon"].get("/sales/me")).status_code == 401
    assert (await c["marketing"].get("/sales/me")).status_code == 403
    assert (await c["marketing"].get("/sales/deals")).status_code == 403
    for path in ("/sales/team", "/sales/owners"):
        assert (await c["adam"].get(path)).status_code == 403
    for path in ("/sales/people", "/sales/sync"):
        assert (await c["manager"].get(path)).status_code == 403
    assert (await c["adam"].post("/sales/sync/run", json={})).status_code == 403


async def test_pipeline_groups_retired_and_unknown_stages(api):
    c, _, _ = api
    body = (await c["manager"].get("/sales/pipeline")).json()
    cols = {col["key"]: col for col in body["columns"]}
    # Active stages keep their own columns even when empty.
    assert cols["stage:Prospecting"]["count"] == 0
    assert cols["stage:Order Form Completed"]["count"] == 1
    # "Menu Created" (retired) and "Submitted to Elavon" (not in the stage list) -> In deployment.
    assert cols["in_deployment"]["count"] == 2
    assert cols["won"]["count"] == 1 and cols["won"]["isOpen"] is False
    assert body["openCount"] == 4
    keys = [col["key"] for col in body["columns"]]
    assert keys.index("stage:Appointment Set") < keys.index("in_deployment") < keys.index("won")
    rep = (await c["adam"].get("/sales/pipeline")).json()
    assert rep["openCount"] == 3


async def test_column_filter_matches_pipeline(api):
    c, _, _ = api
    body = (await c["manager"].get("/sales/deals", params={"column": "in_deployment"})).json()
    assert _ids(body) == {"006000000000000O04", "006000000000000O05"}
    body = (await c["manager"].get("/sales/deals", params={"column": "won", "state": "all"})).json()
    assert _ids(body) == {"006000000000000O03"}


async def test_stale_deals_hidden_by_default(api):
    c, _, sessions = api
    async with sessions() as db:
        deal = await db.get(m.SfOpportunity, "006000000000000O02")
        deal.sf_last_modified_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=400)
        await db.commit()
    body = (await c["adam"].get("/sales/deals")).json()
    assert "006000000000000O02" not in _ids(body)
    body = (await c["adam"].get("/sales/deals", params={"includeStale": "true"})).json()
    row = next(d for d in body["data"] if d["id"] == "006000000000000O02")
    assert row["isStale"] is True
    summary = (await c["adam"].get("/sales/summary")).json()
    assert summary["counts"]["staleDeals"] == 1


async def test_field_engineer_visits_and_customers(api):
    c, _, _ = api
    visits = (await c["saad"].get("/sales/visits", params={"state": "all"})).json()
    assert _ids(visits) == {"a0O00000000000V001"}
    assert (await c["adam"].get("/sales/visits", params={"state": "all"})).json()["data"] == []
    customers = (await c["saad"].get("/sales/customers")).json()
    # Saad's visit is at Husky Boy; his touchpoint is at Casa Mia.
    assert {r["name"] for r in customers["data"]} == {"Husky Boy Burgers", "Casa Mia"}
    casa = next(r for r in customers["data"] if r["name"] == "Casa Mia")
    assert casa["health"] == "Red" and casa["openDeals"] == 0  # Adam's deals don't count for Saad
    red = (await c["manager"].get("/sales/customers", params={"health": "Red"})).json()
    assert [r["name"] for r in red["data"]] == ["Casa Mia"]


async def test_admin_creates_a_login_for_a_salesperson(api):
    c, _, sessions = api
    people = (await c["admin"].get("/sales/people")).json()
    freddie = next(p for p in people if p["sfUserId"] == FREDDIE)
    assert freddie["linkedUser"] is None and freddie["ownsDeals"] == 1

    resp = await c["admin"].post(f"/sales/people/{FREDDIE}/login",
                                 json={"role": "SALES_EXECUTIVE", "email": "freddie@test.sales"})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    password = created["temporaryPassword"]
    assert len(password) >= 12
    assert created["person"]["linkedUser"]["email"] == "freddie@test.sales"
    assert created["person"]["linkedUser"]["role"] == "SALES_EXECUTIVE"

    # The new login works and sees Freddie's deal only.
    login = await c["anon"].post("/auth/login", json={"email": "freddie@test.sales", "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["accessToken"]
    deals = (await c["anon"].get("/sales/deals", params={"state": "all"},
                                 headers={"Authorization": f"Bearer {token}"})).json()
    assert _ids(deals) == {"006000000000000O01"}

    # A second login for the same person is refused.
    again = await c["admin"].post(f"/sales/people/{FREDDIE}/login", json={"email": "other@test.sales"})
    assert again.status_code == 409

    # The audit log records the creation but never the password.
    async with sessions() as db:
        logs = (await db.execute(select(AuditLog).where(AuditLog.entity_type == "SalesLogin",
                                                        AuditLog.entity_id == FREDDIE))).scalars().all()
    assert logs and all(password not in str(log.after) for log in logs)


async def test_link_and_unlink_existing_login(api):
    c, users, _ = api
    resp = await c["admin"].put(f"/sales/people/{FREDDIE}/link", json={"userId": users["unlinked"].id})
    assert resp.status_code == 200 and resp.json()["linkedUser"]["id"] == users["unlinked"].id
    assert _ids((await c["unlinked"].get("/sales/deals")).json()) == {"006000000000000O01"}
    assert (await c["admin"].delete(f"/sales/people/{FREDDIE}/link")).status_code == 204
    assert (await c["unlinked"].get("/sales/deals")).json()["data"] == []


async def test_team_and_sync_status(api):
    c, _, _ = api
    team = {t["name"]: t for t in (await c["manager"].get("/sales/team")).json()}
    assert team["Adam Smith"]["openDeals"] == 3 and team["Adam Smith"]["wonDeals"] == 1
    assert team["Saad Ahmed"]["visitsPending"] == 1
    status_ = (await c["admin"].get("/sales/sync")).json()
    assert status_["runs"][0]["status"] == "success" and status_["apiCallsLast24h"] > 0
    assert {o["objectName"] for o in status_["objects"]} >= {"Opportunity", "Account", "Contact", "User"}


async def test_admin_sync_now_and_cron_token(api, monkeypatch):
    c, _, _ = api
    from app.config import get_settings
    from app.modules.salesforce import sync as sync_module

    fake = seed(FakeSalesforce())
    monkeypatch.setattr(sync_module, "default_client_factory", _factory(fake))
    original = sync_module.run_sync

    async def run_with_fake(*args, **kwargs):
        kwargs.setdefault("client_factory", _factory(fake))
        return await original(*args, **kwargs)

    monkeypatch.setattr(sales_router, "run_sync", run_with_fake)
    resp = await c["admin"].post("/sales/sync/run", json={})
    assert resp.status_code == 200 and resp.json()["status"] == "success" and resp.json()["trigger"] == "manual"

    # The scheduler endpoint doesn't exist until a token is configured, then demands it.
    assert (await c["anon"].post("/sales/sync/cron")).status_code == 404
    monkeypatch.setenv("SALESFORCE_SYNC_TOKEN", "t" * 32)
    get_settings.cache_clear()
    try:
        assert (await c["anon"].post("/sales/sync/cron", headers={"X-Sync-Token": "wrong"})).status_code == 401
        ok = await c["anon"].post("/sales/sync/cron", headers={"X-Sync-Token": "t" * 32})
        assert ok.status_code == 200 and ok.json()["trigger"] == "schedule"
    finally:
        monkeypatch.delenv("SALESFORCE_SYNC_TOKEN")
        get_settings.cache_clear()


async def test_create_login_rejects_a_bad_email_without_leaving_a_login(api):
    c, _, sessions = api
    resp = await c["admin"].post(f"/sales/people/{FREDDIE}/login", json={"role": "SALES_EXECUTIVE", "email": "not-an-email"})
    assert resp.status_code == 400, resp.text
    async with sessions() as db:
        assert await db.scalar(select(User).where(User.email == "not-an-email")) is None
        assert await db.scalar(select(m.SfUserLink).where(m.SfUserLink.sf_user_id == FREDDIE)) is None


async def test_deal_page_still_works_when_its_restaurant_is_not_copied(api):
    c, _, sessions = api
    async with sessions() as db:
        await db.execute(text(f'DELETE FROM {qualified("salesforce")}."account" WHERE id = \'001000000000000A02\''))
        await db.commit()
    resp = await c["adam"].get("/sales/deals/006000000000000O02")
    assert resp.status_code == 200, resp.text
    assert resp.json()["customer"] is None and resp.json()["name"] == "Deal 2"


async def test_visit_types_are_scoped_to_the_viewer(api):
    c, _, _ = api
    assert (await c["saad"].get("/sales/visit-types")).json() == ["Wellness/Remotely"]
    assert (await c["adam"].get("/sales/visit-types")).json() == []
    assert (await c["unlinked"].get("/sales/visit-types")).json() == []
    assert (await c["manager"].get("/sales/visit-types")).json() == ["Wellness/Remotely"]


async def test_quiet_filters_match_the_my_day_counts(api):
    c, _, sessions = api
    now = dt.datetime.now(dt.timezone.utc)
    async with sessions() as db:
        for deal_id, age in (("006000000000000O04", 40), ("006000000000000O05", 200)):
            await db.execute(text(f'UPDATE {qualified("salesforce")}."opportunity" SET sf_last_modified_at = :t '
                                  "WHERE id = :i"), {"t": now - dt.timedelta(days=age), "i": deal_id})
        await db.commit()
    counts = (await c["adam"].get("/sales/summary")).json()["counts"]
    stuck = (await c["adam"].get("/sales/deals", params={"quiet": "stuck"})).json()
    stale = (await c["adam"].get("/sales/deals", params={"quiet": "stale"})).json()
    assert _ids(stuck) == {"006000000000000O04"} and stuck["meta"]["total"] == counts["stuckDeals"] == 1
    assert _ids(stale) == {"006000000000000O05"} and stale["meta"]["total"] == counts["staleDeals"] == 1


async def test_sync_screen_hides_internal_position_rows(api):
    c, _, _ = api
    names = {o["objectName"] for o in (await c["admin"].get("/sales/sync")).json()["objects"]}
    assert names and not any("|" in n for n in names)


async def test_insights_are_scoped_and_add_up(api):
    c, _, sessions = api  # noqa: F811
    from app.modules.salesforce.service import sales_today

    today = sales_today()  # the insights count days in SALES_TIMEZONE, not the server's date
    async with sessions() as db:
        # Adam's won deal O03 closed this month; Freddie's O01 lost this month.
        await db.execute(text(f'UPDATE {qualified("salesforce")}."opportunity" SET close_date = :d '
                              "WHERE id IN ('006000000000000O03', '006000000000000O01')"), {"d": today})
        await db.execute(text(f'UPDATE {qualified("salesforce")}."opportunity" SET is_closed = true, '
                              "is_won = false, stage_name = 'DNC' WHERE id = '006000000000000O01'"))
        await db.commit()

    adam = (await c["adam"].get("/sales/insights")).json()
    manager = (await c["manager"].get("/sales/insights")).json()
    unlinked = (await c["unlinked"].get("/sales/insights")).json()

    assert len(adam["wonByMonth"]) == 12 and adam["wonByMonth"][-1]["month"] == today.strftime("%Y-%m")
    # Adam: 1 won this month (O03), no losses -> 100%; his open deals are O02, O04, O05.
    assert adam["totals"]["wonThisMonth"] == 1 and adam["totals"]["winRate"] == 1.0
    assert adam["totals"]["openDeals"] == 3
    assert sum(b["count"] for b in adam["pipelineByStage"]) == 3
    assert adam["leaderboard"] == []                      # reps never get the leaderboard
    # Manager sees everyone: Freddie's loss now counts, so 1 won / 2 decided.
    assert manager["totals"]["lostLast12Months"] == 1 and manager["totals"]["winRate"] == 0.5
    assert {l["name"] for l in manager["leaderboard"]} >= {"Adam Smith"}
    assert sum(s["count"] for s in manager["health"]) >= sum(s["count"] for s in adam["health"])
    # Unlinked rep: nothing at all.
    # Manager: every copied restaurant has a health slice (A01-A04; only Casa Mia has a check-in).
    assert {s["status"]: s["count"] for s in manager["health"]} == {"Red": 1, "No check-in": 3}
    assert unlinked["totals"]["openDeals"] == 0 and unlinked["health"] == []
    assert unlinked["totals"]["winRate"] is None
    assert (await c["marketing"].get("/sales/insights")).status_code == 403
