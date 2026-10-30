"""The partner team comes from Super App people, not the retired portal's list.

- auth.lead_team(): sales roles and admins, signed up or invited; role defaults and switches;
  past owners listed for their name only.
- /partner-leads/team: read by anyone who sees leads, switches changed by admins only.
- Assigning a lead: to anyone who can take leads (an invited person too), never to a past owner.
- The e-mail buttons' SQL (api/sql/partner_team_superapp.sql) checks the same team.
- The public /lead-action route forwards to the Supabase function and trims its answer.
"""
from __future__ import annotations

import pathlib
import uuid

import pytest
from sqlalchemy import select, text

from app.db.schemas import qualified
from app.models.audit import AuditLog
from app.modules.partner_leads import public_router
from tests.test_assistant import PARTNER_DDL
from tests.test_sales_api import api  # noqa: F401 - pytest fixture, used by name
from tests.test_salesforce_sync import sessions  # noqa: F401 - pytest fixture, used by name

A = qualified("auth")
MARK = "@team.test"


async def _invite(db, email, role="SALES_EXECUTIVE", *, days=7, revoked=False):
    await db.execute(
        text(f"insert into {A}.invitation (id, email, role, token_hash, expires_at, revoked_at) values "
             f"(:id, :e, :r, :h, now() + make_interval(days => :d), case when :rv then now() end)"),
        {"id": f"i{uuid.uuid4().hex[:24]}", "e": email, "r": role, "h": uuid.uuid4().hex, "d": days, "rv": revoked},
    )


@pytest.fixture()
async def team(api):
    clients, users, sessions_ = api
    async with sessions_() as db:
        for ddl in PARTNER_DDL:
            await db.execute(text(ddl))
        await db.execute(text(f"delete from {A}.invitation where email like '%{MARK}'"))
        await db.execute(text(f"delete from {A}.lead_routing where email like '%{MARK}' or email like '%@test.sales'"))
        await db.execute(text(f"delete from public.partner_leads where email like '%{MARK}'"))
        await _invite(db, f"emma{MARK}")                      # pending sales invite -> on the team
        await _invite(db, f"old{MARK}", days=-1)              # expired -> not on the team
        await _invite(db, f"gone{MARK}", revoked=True)        # cancelled -> not on the team
        await _invite(db, f"mkt{MARK}", role="MARKETING_EXECUTIVE")  # other role -> not on the team
        await db.execute(text(f"insert into {A}.lead_routing (email, name, assignable, receives_new_leads) values "
                              f"('freddie{MARK}', 'Freddie Williams', true, false)"))  # portal-era owner, no login
        lead_id = str(uuid.uuid4())
        await db.execute(text("insert into public.partner_leads (id, full_name, email, status, wants_call) values "
                              "(:id, 'Team Test Lead', :e, 'new', false)"), {"id": lead_id, "e": f"lead{MARK}"})
        await db.commit()
    yield clients, users, sessions_, lead_id
    async with sessions_() as db:
        await db.execute(text(f"delete from {A}.invitation where email like '%{MARK}'"))
        await db.execute(text(f"delete from {A}.lead_routing where email like '%{MARK}' or email like '%@test.sales'"))
        await db.execute(text(f"delete from public.partner_leads where email like '%{MARK}'"))
        await db.commit()


async def _team(sessions_) -> dict[str, dict]:
    async with sessions_() as db:
        rows = (await db.execute(text(f"select * from {A}.lead_team()"))).mappings().all()
    return {r["email"]: dict(r) for r in rows}


async def test_team_is_built_from_superapp_people(team):
    _, users, sessions_, _ = team
    t = await _team(sessions_)
    assert t["adam@test.sales"]["status"] == "active" and t["adam@test.sales"]["assignable"] is True
    assert t["manager@test.sales"]["assignable"] is True                     # Sales Manager: on by default
    assert t["admin@test.sales"]["assignable"] is False                      # admins: off unless switched on
    assert "marketing@test.sales" not in t                                    # role doesn't work leads
    assert t[f"emma{MARK}"]["status"] == "invited" and t[f"emma{MARK}"]["assignable"] is True
    for email in (f"old{MARK}", f"gone{MARK}", f"mkt{MARK}"):
        assert email not in t
    fred = t[f"freddie{MARK}"]
    assert fred["status"] == "no_login" and fred["assignable"] is False and fred["name"] == "Freddie Williams"
    assert all(not m["receives_new_leads"] for e, m in t.items() if e.endswith(MARK) or e.endswith("@test.sales"))


async def test_switches_are_admin_only_and_carry_over(team):
    clients, users, sessions_, _ = team
    assert (await clients["adam"].patch(f"/partner-leads/team/emma{MARK}", json={"assignable": False})).status_code == 403
    r = await clients["admin"].patch(f"/partner-leads/team/Emma{MARK}", json={"receivesNewLeads": True})
    assert r.status_code == 200, r.text
    assert r.json()["receivesNewLeads"] is True and r.json()["assignable"] is True and r.json()["status"] == "invited"
    r = await clients["admin"].patch("/partner-leads/team/admin@test.sales", json={"assignable": True})
    assert r.status_code == 200 and r.json()["assignable"] is True
    r = await clients["admin"].patch("/partner-leads/team/admin@test.sales", json={"assignable": None})
    assert r.json()["assignable"] is False  # back to the admin default
    assert (await clients["admin"].patch(f"/partner-leads/team/freddie{MARK}", json={"assignable": True})).status_code == 400
    assert (await clients["admin"].patch("/partner-leads/team/nobody@x.com", json={"assignable": True})).status_code == 404
    assert (await clients["admin"].patch(f"/partner-leads/team/emma{MARK}", json={})).status_code == 400
    assert (await clients["admin"].patch(f"/partner-leads/team/emma{MARK}", json={"receivesNewLeads": None})).status_code == 400
    async with sessions_() as db:
        logs = (await db.execute(select(AuditLog).where(AuditLog.entity_type == "PartnerTeamMember"))).scalars().all()
    assert any(l.entity_id.lower() == f"emma{MARK}" and l.actor_id == users["admin"].id for l in logs)

    # The listing everyone sees reflects it (without people's exact Super App role).
    body = (await clients["adam"].get("/partner-leads/team")).json()["data"]
    emma = next(m for m in body if m["email"] == f"emma{MARK}")
    assert emma["receivesNewLeads"] is True and emma["status"] == "invited"
    assert all(m["superAppRole"] is None for m in body)
    body = (await clients["admin"].get("/partner-leads/team")).json()["data"]
    assert next(m for m in body if m["email"] == f"emma{MARK}")["superAppRole"] == "SALES_EXECUTIVE"


async def test_assigning_uses_the_same_team(team, monkeypatch):
    clients, users, sessions_, lead_id = team
    from app.modules.partner_leads import service

    async def no_notify(_lead_id):
        return True

    monkeypatch.setattr(service, "notify_assigned", no_notify)
    r = await clients["adam"].patch(f"/partner-leads/{lead_id}", json={"assignedTo": f"emma{MARK}"})
    assert r.status_code == 200, r.text
    assert r.json()["assignedTo"] == f"emma{MARK}"
    r = await clients["adam"].patch(f"/partner-leads/{lead_id}", json={"assignedTo": f"freddie{MARK}"})
    assert r.status_code == 400  # past owner, no login
    r = await clients["adam"].patch(f"/partner-leads/{lead_id}", json={"assignedTo": "admin@test.sales"})
    assert r.status_code == 400  # admins are off by default


# ------------------------------------------------------- e-mail buttons ----
SQL = pathlib.Path(__file__).resolve().parents[1] / "sql" / "partner_team_superapp.sql"


async def test_email_button_sql_checks_the_superapp_team(team):
    """Runs api/sql/partner_team_superapp.sql locally (as on the shared database) and checks the
    one-click Assign buttons: someone on the team works; a past owner is refused, even in preview."""
    _, _, sessions_, lead_id = team
    if A != "superapp_auth":
        pytest.skip("the SQL file names the production schema (superapp_auth)")
    async with sessions_() as db:
        for role in ("anon", "authenticated", "service_role"):
            await db.execute(text(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{role}') "
                                  f"then create role {role} nologin; end if; end $$"))
        await db.execute(text("""create table if not exists public.partner_lead_tokens (
            token uuid primary key default gen_random_uuid(), lead_id uuid, action text, value text,
            recipient_email text, expires_at timestamptz default now() + interval '14 days', used_at timestamptz)"""))
        await db.commit()
        conn = await db.connection()
        raw = await conn.get_raw_connection()
        await raw.driver_connection.execute(SQL.read_text())  # several statements, like psql
        good, bad = uuid.uuid4(), uuid.uuid4()
        await db.execute(text("insert into public.partner_lead_tokens (token, lead_id, action, value, recipient_email) "
                              "values (:g, :l, 'assign', :ge, 'boss@x.com'), (:b, :l, 'assign', :be, 'boss@x.com')"),
                         {"g": good, "b": bad, "l": lead_id, "ge": f"emma{MARK}", "be": f"freddie{MARK}"})
        await db.commit()

        preview = (await db.execute(text("select public.partner_apply_token(:t, false)"), {"t": bad})).scalar_one()
        assert preview == {"ok": False, "error": "assignee_missing"}
        r = (await db.execute(text("select public.partner_apply_token(:t, true)"), {"t": good})).scalar_one()
        assert r["ok"] and r["committed"] and r["value_name"] == f"emma{MARK}"
        await db.commit()
        owner = (await db.execute(text("select assigned_to from public.partner_leads where id = :l"), {"l": lead_id})).scalar_one()
        assert owner == f"emma{MARK}"
        # Once someone has it, an old Assign button can't move it.
        late = uuid.uuid4()
        await db.execute(text("insert into public.partner_lead_tokens (token, lead_id, action, value, recipient_email) "
                              "values (:t, :l, 'assign', 'adam@test.sales', 'boss@x.com')"), {"t": late, "l": lead_id})
        await db.commit()
        r = (await db.execute(text("select public.partner_apply_token(:t, true)"), {"t": late})).scalar_one()
        assert r["ok"] is False and r["error"] == "already_assigned" and r["owner"] == f"emma{MARK}"
        # Status buttons: only the current owner, while on the team.
        mine, theirs = uuid.uuid4(), uuid.uuid4()
        await db.execute(text("insert into public.partner_lead_tokens (token, lead_id, action, value, recipient_email) values "
                              "(:a, :l, 'status', 'won', :emma), (:b, :l, 'status', 'lost', 'adam@test.sales')"),
                         {"a": mine, "b": theirs, "l": lead_id, "emma": f"emma{MARK}"})
        await db.commit()
        r = (await db.execute(text("select public.partner_apply_token(:t, false)"), {"t": theirs})).scalar_one()
        assert r == {"ok": False, "error": "not_owner"}
        r = (await db.execute(text("select public.partner_apply_token(:t, true)"), {"t": mine})).scalar_one()
        assert r["ok"] and r["committed"]
        await db.commit()
        await db.execute(text(f"update {A}.invitation set revoked_at = now() where email = :e"), {"e": f"emma{MARK}"})
        await db.execute(text("update public.partner_leads set status = 'new' where id = :l"), {"l": lead_id})
        await db.commit()
        r = (await db.execute(text("select public.partner_apply_token(:t, false)"), {"t": mine})).scalar_one()
        assert r == {"ok": False, "error": "not_on_team"}
        team_rows = (await db.execute(text("select count(*) from public.superapp_lead_team()"))).scalar_one()
        assert team_rows >= 1
        await db.execute(text("delete from public.partner_lead_tokens where lead_id = :l"), {"l": lead_id})
        await db.commit()


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data


class _FakeClient:
    calls: list = []
    answer: dict = {}

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeClient.calls.append((url, json, headers))
        return _FakeResponse(_FakeClient.answer)


async def test_public_lead_action_route(api, monkeypatch):
    clients, _, _ = api
    monkeypatch.setattr(public_router.httpx, "AsyncClient", _FakeClient)
    _FakeClient.calls = []
    r = await clients["anon"].post("/public/partner-leads/action", json={"token": "nope", "commit": True})
    assert r.json() == {"ok": False, "error": "invalid", "owner": None, "action": None, "valueLabel": None, "lead": None,
                        "already": False, "committed": False}
    assert _FakeClient.calls == []  # a malformed token never reaches the function

    tok = str(uuid.uuid4())
    _FakeClient.answer = {"ok": True, "action": "assign", "value": "a@x.com", "value_label": "Asif",
                          "lead": {"full_name": "Pat", "company": "Acme", "email": "secret@x.com"},
                          "already": False, "committed": True, "recipient": "boss@x.com"}
    body = (await clients["anon"].post("/public/partner-leads/action", json={"token": tok, "commit": True})).json()
    assert body["ok"] and body["valueLabel"] == "Asif" and body["lead"] == {"fullName": "Pat", "company": "Acme"}
    assert "secret@x.com" not in str(body) and "boss@x.com" not in str(body)
    url, sent, headers = _FakeClient.calls[-1]
    assert url.endswith("/partner-lead-action") and sent == {"token": tok, "commit": True} and headers["apikey"]

    _FakeClient.answer = {"ok": False, "error": "expired"}
    assert (await clients["anon"].post("/public/partner-leads/action", json={"token": tok})).json()["error"] == "expired"
    _FakeClient.answer = {"ok": False, "error": "already_assigned", "owner": "Asif Rao"}
    body = (await clients["anon"].post("/public/partner-leads/action", json={"token": tok})).json()
    assert body["error"] == "already_assigned" and body["owner"] == "Asif Rao"
    _FakeClient.answer = {"ok": True, "lead": "not a dict"}
    assert (await clients["anon"].post("/public/partner-leads/action", json={"token": tok})).status_code == 200
    _FakeClient.answer = {"ok": False, "error": "<script>"}
    assert (await clients["anon"].post("/public/partner-leads/action", json={"token": tok})).json()["error"] == "server"
