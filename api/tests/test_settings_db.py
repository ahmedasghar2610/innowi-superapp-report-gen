"""Settings API against a real Postgres (needs OPS_TEST_DATABASE_URL, like
test_ops_tickets_db.py): personal settings, sessions, workspace, SLA
targets driving the ticket clock, projects, and the Super Admin guards."""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


def _super_admin():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.common.security.password import hash_password
    from app.config import to_asyncpg_url
    from app.models.auth import User
    from app.models.enums import Role

    async def run():
        engine = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(engine, expire_on_commit=False)() as s:
            u = User(email=f"root-{uuid.uuid4().hex[:8]}@innowi.test", password_hash=hash_password("x-Password-1"), role=Role.SUPER_ADMIN)
            s.add(u)
            await s.commit()
            out = (u.id, u.email, u.role.value)
        await engine.dispose()
        return out

    return asyncio.run(run())


@pytest.fixture(scope="module")
def ctx():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app
    from app.modules.ops import sla

    seeded = _seed()
    seeded["root"] = _super_admin()
    engine.sync_engine.dispose(close=False)

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
        # Leave the shared database on the built-in defaults for other modules.
        client.delete("/api/v1/settings/sla", headers=headers("root"))
        client.put("/api/v1/settings/workspace", json={"timezone": "Asia/Karachi"}, headers=headers("root"))
    sla.apply_settings(None, None)
    sla.reset_cache()
    engine.sync_engine.dispose(close=False)


def test_my_settings_roundtrip(ctx):
    client, seeded, headers = ctx
    me = client.get("/api/v1/settings/me", headers=headers("jai")).json()
    assert me["preferences"]["startPage"] == "home"
    assert me["preferences"]["notifications"]["assigned"] == {"inApp": True, "email": True, "teams": True}

    r = client.patch(
        "/api/v1/settings/me",
        json={"firstName": " Jai ", "lastName": "Kumar", "preferences": {"startPage": "my-work", "notifications": {"mentioned": {"inApp": True, "email": False, "teams": True}}}},
        headers=headers("jai"),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["firstName"] == "Jai" and body["user"]["lastName"] == "Kumar"
    assert body["preferences"]["startPage"] == "my-work"
    assert body["preferences"]["notifications"]["mentioned"] == {"inApp": True, "email": False, "teams": True}
    # Untouched events keep their defaults.
    assert body["preferences"]["notifications"]["slaBreached"]["teams"] is True
    # Role can't be changed through this endpoint.
    assert client.patch("/api/v1/settings/me", json={"role": "ADMIN"}, headers=headers("jai")).status_code == 400


def test_sessions_list_and_end(ctx):
    client, seeded, headers = ctx
    email = seeded["sofia"][1]
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "x-Password-1"}).status_code == 200
    sessions = client.get("/api/v1/settings/me/sessions", headers=headers("sofia")).json()
    assert len(sessions) >= 1 and sessions[0]["device"]
    sid = sessions[0]["id"]
    assert client.delete(f"/api/v1/settings/me/sessions/{sid}", headers=headers("jai")).status_code == 404
    assert client.delete(f"/api/v1/settings/me/sessions/{sid}", headers=headers("sofia")).status_code == 204
    assert sid not in [s["id"] for s in client.get("/api/v1/settings/me/sessions", headers=headers("sofia")).json()]


def test_workspace_permissions_and_validation(ctx):
    client, seeded, headers = ctx
    ws = client.get("/api/v1/settings/workspace", headers=headers("jai")).json()
    assert ws["canEdit"] is False and ws["ticketPrefix"] == "OPS"
    body = {**ws["workspace"], "companyName": "Innowi Ops"}
    assert client.put("/api/v1/settings/workspace", json=body, headers=headers("aima")).status_code == 403
    assert client.put("/api/v1/settings/workspace", json={**body, "timezone": "Mars/Base"}, headers=headers("admin")).status_code == 400
    assert client.put("/api/v1/settings/workspace", json={**body, "workDays": []}, headers=headers("admin")).status_code == 400
    r = client.put("/api/v1/settings/workspace", json=body, headers=headers("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["workspace"]["companyName"] == "Innowi Ops" and r.json()["updatedBy"]


def test_sla_targets_drive_new_tickets(ctx):
    client, seeded, headers = ctx
    cur = client.get("/api/v1/settings/sla", headers=headers("root")).json()
    assert cur["canEdit"] is True
    targets = [{"priority": t["priority"], "responseHours": t["responseHours"], "resolutionHours": t["resolutionHours"]} for t in cur["targets"]]
    for t in targets:
        if t["priority"] == "HIGH":
            t.update(responseHours=8, resolutionHours=72)
    bad = [dict(t, responseHours=99, resolutionHours=10) if t["priority"] == "LOW" else t for t in targets]
    assert client.put("/api/v1/settings/sla", json={"targets": bad}, headers=headers("root")).status_code == 400
    assert client.put("/api/v1/settings/sla", json={"targets": targets[:2]}, headers=headers("root")).status_code == 400
    assert client.put("/api/v1/settings/sla", json={"targets": targets}, headers=headers("jai")).status_code == 403

    r = client.put("/api/v1/settings/sla", json={"targets": targets}, headers=headers("root"))
    assert r.status_code == 200, r.text
    assert r.json()["isDefault"] is False

    t = client.post(
        "/api/v1/ops/tickets",
        json={"title": "SLA settings", "type": "INTERNAL", "category": "Ops", "subCategory": "Process", "priority": "HIGH",
              "projectId": seeded["project"], "assigneeId": seeded["sofia"][0]},
        headers=headers("aima"),
    )
    if t.status_code == 400:  # category names differ — fall back to a known one
        t = client.post(
            "/api/v1/ops/tickets",
            json={"title": "SLA settings", "type": "WEBSITE", "category": "Bug / fix", "subCategory": "Broken page",
                  "priority": "HIGH", "projectId": seeded["project"], "assigneeId": seeded["sofia"][0]},
            headers=headers("aima"),
        )
    assert t.status_code == 201, t.text
    assert t.json()["sla"]["targetResponseHours"] == 8 and t.json()["sla"]["targetResolutionHours"] == 72
    policy = {p["priority"]: p for p in client.get("/api/v1/ops/catalog", headers=headers("jai")).json()["sla"]}
    assert policy["HIGH"]["resolutionHours"] == 72

    reset = client.delete("/api/v1/settings/sla", headers=headers("root")).json()
    assert reset["isDefault"] is True
    assert {t["priority"]: t["resolutionHours"] for t in reset["targets"]}["HIGH"] == 48


def test_projects_rename_and_archive(ctx):
    client, seeded, headers = ctx
    p = client.post("/api/v1/ops/projects", json={"name": f"Settings {uuid.uuid4().hex[:6]}"}, headers=headers("aima")).json()
    assert client.patch(f"/api/v1/ops/projects/{p['id']}", json={"archived": True}, headers=headers("jai")).status_code == 403
    r = client.patch(f"/api/v1/ops/projects/{p['id']}", json={"name": p["name"] + " v2", "archived": True}, headers=headers("admin"))
    assert r.status_code == 200 and r.json()["archived"] is True
    ids = [x["id"] for x in client.get("/api/v1/ops/projects", headers=headers("jai")).json()["data"]]
    assert p["id"] not in ids
    ids = [x["id"] for x in client.get("/api/v1/ops/projects?includeArchived=true", headers=headers("jai")).json()["data"]]
    assert p["id"] in ids


def test_super_admin_guards_and_reset_password(ctx):
    client, seeded, headers = ctx
    root_id = seeded["root"][0]
    # An Admin can't touch a Super Admin, nor create or promote one.
    assert client.patch(f"/api/v1/users/{root_id}", json={"status": "SUSPENDED"}, headers=headers("admin")).status_code == 403
    assert client.post(f"/api/v1/users/{root_id}/reset-password", headers=headers("admin")).status_code == 403
    assert client.patch(f"/api/v1/users/{seeded['jai'][0]}", json={"role": "SUPER_ADMIN"}, headers=headers("admin")).status_code == 403
    assert client.post(
        "/api/v1/users", json={"email": f"x-{uuid.uuid4().hex[:6]}@innowi-qa.com", "password": "x-Password-1", "role": "SUPER_ADMIN"}, headers=headers("admin")
    ).status_code == 403
    # Admin can still grant capabilities to staff.
    r = client.patch(f"/api/v1/users/{seeded['jai'][0]}", json={"grantedCapabilities": ["credentials.reveal"]}, headers=headers("admin"))
    assert r.status_code == 200 and r.json()["grantedCapabilities"] == ["credentials.reveal"]
    # Reset: new password works, old one doesn't, never stored in the audit log.
    r = client.post(f"/api/v1/users/{seeded['sofia'][0]}/reset-password", headers=headers("root"))
    assert r.status_code == 200, r.text
    temp = r.json()["temporaryPassword"]
    email = seeded["sofia"][1]
    assert client.post("/api/v1/auth/login", json={"email": email, "password": temp}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "x-Password-1"}).status_code == 401
    logs = client.get("/api/v1/audit-logs", params={"entityType": "User", "entityId": seeded["sofia"][0]}, headers=headers("root"))
    assert temp not in logs.text
    assert client.post(f"/api/v1/users/{root_id}/reset-password", headers=headers("root")).status_code == 400


def test_integrations_status(ctx):
    client, seeded, headers = ctx
    items = {i["key"]: i for i in client.get("/api/v1/settings/integrations", headers=headers("jai")).json()["data"]}
    assert set(items) == {"outlook_sync", "fathom", "gbp", "google_ads", "seo", "vault", "teams_flow", "email"}
    assert items["outlook_sync"]["status"] in ("connected", "configured", "attention", "not_connected")
    # Depends on RESEND_API_KEY / OPS_TEAMS_FLOW_* in the environment running the tests.
    assert items["email"]["status"] in ("connected", "not_connected")
    assert items["teams_flow"]["status"] in ("connected", "not_connected")
