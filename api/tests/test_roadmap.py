"""Roadmap API: who can read, plan and update; status rules; the first-run seed.

Runs against the configured Postgres (skipped when unreachable or not migrated).
"""
from __future__ import annotations

import datetime as dt

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password
from app.config import get_settings
from app.db.schemas import qualified
from app.db.session import engine_kwargs
from app.db.session import get_db
from app.main import app
from app.models import roadmap as m
from app.models.audit import AuditLog
from app.models.auth import User
from app.models.enums import Role, UserStatus
from app.modules.roadmap import service
from app.modules.roadmap.seed_data import PHASES
from scripts import seed_roadmap

DOMAIN = "@test.roadmap"


@pytest.fixture()
async def sessions():
    settings = get_settings()
    engine = create_async_engine(settings.database_url_async, **{**engine_kwargs(), "poolclass": NullPool})
    try:
        async with engine.connect() as conn:
            exists = (await conn.execute(text("select to_regclass(:t)"), {"t": f"{qualified('roadmap')}.item"})).scalar()
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"database not reachable: {exc}")
    if not exists:
        await engine.dispose()
        pytest.skip("roadmap schema not migrated")
    async with engine.begin() as conn:
        await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."item"'))
        await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."phase"'))
        await conn.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%{DOMAIN}\''))
    yield async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with engine.begin() as conn:
        await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."item"'))
        await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."phase"'))
        await conn.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%{DOMAIN}\''))
    await engine.dispose()


@pytest.fixture()
async def api(sessions):
    async def _db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = _db
    users = {}
    async with sessions() as db:
        for key, role, status in [("admin", Role.ADMIN, UserStatus.ACTIVE),
                                  ("manager", Role.SALES_MANAGER, UserStatus.ACTIVE),
                                  ("rep", Role.SALES_EXECUTIVE, UserStatus.ACTIVE),
                                  ("marketing", Role.MARKETING_EXECUTIVE, UserStatus.ACTIVE),
                                  ("gone", Role.MARKETING_EXECUTIVE, UserStatus.INACTIVE)]:
            u = User(email=f"{key}{DOMAIN}", password_hash=hash_password("x" * 12), role=role, status=status,
                     first_name=key.title() if key != "rep" else None)
            db.add(u)
            users[key] = u
        await db.commit()
    clients = {}
    for key, u in users.items():
        token, _ = create_access_token({"sub": u.id, "email": u.email, "role": u.role.value})
        clients[key] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1",
                                         headers={"Authorization": f"Bearer {token}"})
    clients["anon"] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1")
    yield clients, users, sessions
    for c in clients.values():
        await c.aclose()
    app.dependency_overrides.pop(get_db, None)


async def _phase(c, **kw):
    body = {"name": "Phase A", "goal": "Ship it", "startMonth": "2026-11-15", "endMonth": "2026-12-03"}
    body.update(kw)
    res = await c["admin"].post("/roadmap/phases", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def _item(c, phase_id, **kw):
    body = {"phaseId": phase_id, "title": "Do the thing", "area": "SALES"}
    body.update(kw)
    res = await c["admin"].post("/roadmap/items", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def test_everyone_reads_only_admins_plan(api):
    c, users, _ = api
    assert (await c["anon"].get("/roadmap")).status_code == 401
    phase = await _phase(c)
    # Months are stored as the first day of the month.
    assert phase["startMonth"] == "2026-11-01" and phase["endMonth"] == "2026-12-01"
    await _item(c, phase["id"], ownerId=users["rep"].id)

    for who in ("rep", "manager", "marketing"):
        body = (await c[who].get("/roadmap")).json()
        assert body["canManage"] is False and body["me"] == users[who].id
        assert body["phases"][0]["items"][0]["title"] == "Do the thing"
        assert (await c[who].post("/roadmap/phases", json={"name": "x", "startMonth": "2026-01-01",
                                                             "endMonth": "2026-01-01"})).status_code == 403
        assert (await c[who].post("/roadmap/items", json={"phaseId": phase["id"], "title": "x",
                                                            "area": "SALES"})).status_code == 403
    admin_view = (await c["admin"].get("/roadmap")).json()
    assert admin_view["canManage"] is True
    assert admin_view["counts"] == {"total": 1, "done": 0, "inProgress": 0, "blocked": 0, "todo": 1}
    # Owners list: active users only, with a readable name.
    owners = {o["email"]: o for o in admin_view["owners"]}
    assert f"gone{DOMAIN}" not in owners
    assert owners[f"admin{DOMAIN}"]["name"] == "Admin"
    assert owners[f"rep{DOMAIN}"]["name"] == "rep"  # no name on file: the e-mail's first part


async def test_owner_updates_status_notes_and_date_only(api):
    c, users, sessions = api
    phase = await _phase(c)
    item = await _item(c, phase["id"], ownerId=users["rep"].id)
    url = f"/roadmap/items/{item['id']}"

    res = await c["rep"].patch(url, json={"status": "DONE", "notes": "Shipped", "targetDate": "2026-11-20"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "DONE" and body["notes"] == "Shipped"
    assert body["doneOn"] == dt.datetime.now(dt.timezone.utc).date().isoformat()
    assert body["updatedByEmail"] == f"rep{DOMAIN}"

    # Leaving DONE clears the finish date.
    body = (await c["rep"].patch(url, json={"status": "IN_PROGRESS"})).json()
    assert body["status"] == "IN_PROGRESS" and body["doneOn"] is None

    # The owner can't re-plan: title, owner, phase, priority are admin-only.
    for change in ({"title": "New"}, {"ownerId": None}, {"priority": "HIGH"}, {"phaseId": phase["id"]}):
        res = await c["rep"].patch(url, json=change)
        assert res.status_code == 403, change
    # Someone else (not owner, not admin) can't touch it at all.
    assert (await c["marketing"].patch(url, json={"status": "DONE"})).status_code == 403
    assert (await c["manager"].patch(url, json={"notes": "x"})).status_code == 403

    # Every change is in the audit log.
    async with sessions() as db:
        rows = (await db.execute(select(AuditLog).where(AuditLog.entity_id == item["id"]))).scalars().all()
    assert len(rows) >= 3 and {r.actor_email for r in rows} >= {f"admin{DOMAIN}", f"rep{DOMAIN}"}


async def test_admin_replans_and_clears_fields(api):
    c, users, _ = api
    p1 = await _phase(c, name="One")
    p2 = await _phase(c, name="Two", startMonth="2027-01-01", endMonth="2027-02-01")
    item = await _item(c, p1["id"], ownerId=users["rep"].id, targetDate="2026-11-30", link="https://example.com/x")
    url = f"/roadmap/items/{item['id']}"
    body = (await c["admin"].patch(url, json={"phaseId": p2["id"], "ownerId": None, "targetDate": None,
                                             "link": None, "priority": "HIGH", "area": "PLATFORM"})).json()
    assert body["phaseId"] == p2["id"] and body["ownerId"] is None and body["targetDate"] is None
    assert body["link"] is None and body["priority"] == "HIGH" and body["area"] == "PLATFORM"
    # A required field sent as null is left alone, not wiped.
    assert (await c["admin"].patch(url, json={"title": None})).json()["title"] == "Do the thing"


async def test_validation(api):
    c, users, _ = api
    phase = await _phase(c)
    bad = [
        {"phaseId": phase["id"], "title": "x", "area": "NOPE"},
        {"phaseId": phase["id"], "title": "x", "area": "SALES", "status": "MAYBE"},
        {"phaseId": phase["id"], "title": "", "area": "SALES"},
        {"phaseId": phase["id"], "title": "x", "area": "SALES", "link": "javascript:alert(1)"},
        {"phaseId": phase["id"], "title": "x", "area": "SALES", "surprise": 1},
    ]
    for body in bad:
        assert (await c["admin"].post("/roadmap/items", json=body)).status_code in (400, 422), body
    # Owner must be an active user; phase must exist.
    assert (await c["admin"].post("/roadmap/items", json={"phaseId": phase["id"], "title": "x", "area": "SALES",
                                                          "ownerId": users["gone"].id})).status_code == 400
    assert (await c["admin"].post("/roadmap/items", json={"phaseId": "nope", "title": "x",
                                                          "area": "SALES"})).status_code == 404
    # Months in the right order.
    res = await c["admin"].post("/roadmap/phases", json={"name": "x", "startMonth": "2027-03-01",
                                                         "endMonth": "2027-01-01"})
    assert res.status_code in (400, 422)
    res = await c["admin"].patch(f"/roadmap/phases/{phase['id']}", json={"endMonth": "2026-01-01"})
    assert res.status_code == 400
    assert (await c["admin"].patch("/roadmap/items/nope", json={"status": "DONE"})).status_code == 404


async def test_delete_phase_only_when_empty(api):
    c, _, _ = api
    phase = await _phase(c)
    item = await _item(c, phase["id"])
    assert (await c["admin"].delete(f"/roadmap/phases/{phase['id']}")).status_code == 409
    assert (await c["marketing"].delete(f"/roadmap/items/{item['id']}")).status_code == 403
    assert (await c["admin"].delete(f"/roadmap/items/{item['id']}")).status_code == 204
    assert (await c["admin"].delete(f"/roadmap/phases/{phase['id']}")).status_code == 204
    assert (await c["admin"].get("/roadmap")).json()["phases"] == []


async def test_seed_writes_once(api, monkeypatch):
    c, users, sessions = api
    monkeypatch.setattr(seed_roadmap, "SessionLocal", sessions)
    await seed_roadmap.main()
    body = (await c["admin"].get("/roadmap")).json()
    assert [p["name"] for p in body["phases"]] == [p[0] for p in PHASES]
    assert body["counts"]["total"] == sum(len(p[4]) for p in PHASES)
    done = [i for p in body["phases"] for i in p["items"] if i["status"] == "DONE"]
    assert done and all(i["doneOn"] for i in done)
    # Edits survive a second run (the seed only writes an empty roadmap).
    first = body["phases"][0]["items"][0]
    await c["admin"].patch(f"/roadmap/items/{first['id']}", json={"title": "Edited"})
    await seed_roadmap.main()
    again = (await c["admin"].get("/roadmap")).json()
    assert again["counts"]["total"] == body["counts"]["total"]
    assert again["phases"][0]["items"][0]["title"] == "Edited"


def test_find_owner_matches_email_case_insensitively():
    u = User(id="u1", email="Person@Innowi.com", password_hash="x", role=Role.ADMIN)
    assert service.find_owner([u], "person@innowi.com") == "u1"
    assert service.find_owner([u], "other@innowi.com") is None
    assert service.find_owner([u], None) is None


def test_seed_data_is_valid():
    """Every seeded item uses a real area/status/priority and DONE items carry a date."""
    for name, goal, start, end, rows in PHASES:
        assert start.day == 1 and end.day == 1 and end >= start, name
        for area, title, desc, status, priority, owner, target, done_on in rows:
            assert area in m.AREAS and status in m.STATUSES and priority in m.PRIORITIES, title
            assert (status == m.STATUS_DONE) == (done_on is not None), title
            assert len(title) <= 200, title
