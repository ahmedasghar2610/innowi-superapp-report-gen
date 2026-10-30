"""Invitations against a real Postgres (needs a migrated database).

Runs only when INTEGRATION_DATABASE=1 and DATABASE_URL points at a disposable,
migrated database (see README). Skipped otherwise, like the rest of the suite
which is DB-independent.
"""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.skipif(os.getenv("INTEGRATION_DATABASE") != "1", reason="needs INTEGRATION_DATABASE=1 + a migrated DB")

from app.common.deps import AuthenticatedUser, require_capability  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.invitations import router as inv  # noqa: E402

ADMIN = AuthenticatedUser(id="admin-1", email="admin@innowi.com", role="ADMIN")


@pytest.fixture
def client(monkeypatch):
    sent = []

    async def fake_send(invitation_id, token, url):
        sent.append((invitation_id, token, url))
        return True

    monkeypatch.setattr(inv, "send_invite_email", fake_send)
    # The admin router's dependency is a fresh closure per require_capability() call,
    # so override by walking the router's dependencies.
    for route in inv.admin_router.routes:
        for dep in route.dependant.dependencies:
            if dep.call.__qualname__.startswith("require_capability"):
                app.dependency_overrides[dep.call] = lambda: ADMIN
    with TestClient(app) as c:
        yield c, sent
    app.dependency_overrides.clear()


def _email():
    return f"invitee-{uuid.uuid4().hex[:8]}@innowi.com"


def test_full_invite_flow(client):
    c, sent = client
    email = _email()
    r = c.post("/api/v1/invitations", json={"email": email.upper(), "role": "SALES_EXECUTIVE"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invitation"]["email"] == email and body["invitation"]["role"] == "SALES_EXECUTIVE"
    assert body["emailed"] is True and body["inviteUrl"].startswith("https://") and "/invite?token=" in body["inviteUrl"]
    token = body["inviteUrl"].split("token=")[1]
    assert sent and sent[0][1] == token

    # pending list shows it; the raw token is never in the list
    lst = c.get("/api/v1/invitations").json()["data"]
    assert any(i["email"] == email for i in lst) and token not in str(lst)

    # the invited person sees who/which role
    p = c.get(f"/api/v1/auth/invitations/{token}")
    assert p.status_code == 200 and p.json()["role"] == "SALES_EXECUTIVE"

    # accept → account created; can sign in with their own password
    a = c.post("/api/v1/auth/invitations/accept", json={"token": token, "password": "MyOwnPass-1", "firstName": "Ann"})
    assert a.status_code == 201 and a.json()["email"] == email
    login = c.post("/api/v1/auth/login", json={"email": email, "password": "MyOwnPass-1"})
    assert login.status_code == 200, login.text
    assert login.json()["user"]["role"] == "SALES_EXECUTIVE"

    # the link is single-use
    assert c.get(f"/api/v1/auth/invitations/{token}").status_code == 404
    assert c.post("/api/v1/auth/invitations/accept", json={"token": token, "password": "Another-123"}).status_code == 404
    # and the address now has an account, so it can't be invited again
    assert c.post("/api/v1/invitations", json={"email": email, "role": "ADMIN"}).status_code == 409


def test_reinvite_and_resend_kill_old_links(client):
    c, _ = client
    email = _email()
    t1 = c.post("/api/v1/invitations", json={"email": email, "role": "MARKETING_EXECUTIVE"}).json()["inviteUrl"].split("token=")[1]
    second = c.post("/api/v1/invitations", json={"email": email, "role": "MARKETING_MANAGER"}).json()
    t2 = second["inviteUrl"].split("token=")[1]
    assert c.get(f"/api/v1/auth/invitations/{t1}").status_code == 404  # replaced
    assert c.get(f"/api/v1/auth/invitations/{t2}").json()["role"] == "MARKETING_MANAGER"

    t3 = c.post(f"/api/v1/invitations/{second['invitation']['id']}/resend").json()["inviteUrl"].split("token=")[1]
    assert t3 != t2
    assert c.get(f"/api/v1/auth/invitations/{t2}").status_code == 404  # resend issues a new link
    assert c.get(f"/api/v1/auth/invitations/{t3}").status_code == 200

    assert c.delete(f"/api/v1/invitations/{second['invitation']['id']}").status_code == 204
    assert c.get(f"/api/v1/auth/invitations/{t3}").status_code == 404  # revoked


def test_rules(client):
    c, _ = client
    assert c.post("/api/v1/invitations", json={"email": _email(), "role": "SUPER_ADMIN"}).status_code == 400
    assert c.post("/api/v1/invitations", json={"email": "not-an-email", "role": "ADMIN"}).status_code in (400, 422)
    t = c.post("/api/v1/invitations", json={"email": _email(), "role": "ADMIN"}).json()["inviteUrl"].split("token=")[1]
    short = c.post("/api/v1/auth/invitations/accept", json={"token": t, "password": "short"})
    assert short.status_code in (400, 422)
    assert c.get("/api/v1/auth/invitations/" + "x" * 43).status_code == 404


def test_admin_routes_need_login():
    app.dependency_overrides.clear()
    c = TestClient(app)
    assert c.get("/api/v1/invitations").status_code == 401
    assert c.post("/api/v1/invitations", json={"email": _email(), "role": "ADMIN"}).status_code == 401


def test_non_admin_cannot_invite():
    c = TestClient(app)
    for route in inv.admin_router.routes:
        for dep in route.dependant.dependencies:
            if dep.call.__qualname__.startswith("require_capability"):
                app.dependency_overrides[dep.call] = require_capability("users.manage")
    # A Sales Executive token would 403 at require_capability; simulate via has_capability directly.
    from app.common.capabilities import has_capability

    assert not has_capability("SALES_EXECUTIVE", "users.manage")
    assert not has_capability("MARKETING_MANAGER", "users.manage")
    app.dependency_overrides.clear()
    assert c.get("/api/v1/invitations").status_code == 401
