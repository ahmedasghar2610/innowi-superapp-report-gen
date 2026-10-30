"""End-to-end tests for the Ops CRM SLA clock, Team reports, CSV export,
Library and credentials vault against a real Postgres. Same setup and skip
rule as test_ops_tickets_db.py (needs OPS_TEST_DATABASE_URL)."""
from __future__ import annotations

import csv
import io
import os
import uuid

import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def ctx():
    from cryptography.fernet import Fernet
    from fastapi.testclient import TestClient

    from app.common.security import crypto
    from app.common.security.jwt import create_access_token
    from app.config import get_settings
    from app.db.session import engine
    from app.main import app

    seeded = _seed()
    engine.sync_engine.dispose(close=False)

    settings = get_settings()
    old_key = settings.CREDENTIAL_ENCRYPTION_KEY
    settings.CREDENTIAL_ENCRYPTION_KEY = Fernet.generate_key().decode()
    crypto._fernet.cache_clear()

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers

    settings.CREDENTIAL_ENCRYPTION_KEY = old_key
    crypto._fernet.cache_clear()
    engine.sync_engine.dispose(close=False)


def _ticket(client, seeded, headers, **over):
    body = {
        "title": f"SLA {uuid.uuid4().hex[:6]}",
        "type": "WEBSITE",
        "category": "Bug / fix",
        "subCategory": "Broken page",
        "priority": "HIGH",
        "projectId": seeded["project"],
        "merchantId": seeded["merchant"],
        "assigneeId": seeded["sofia"][0],
    }
    body.update(over)
    r = client.post("/api/v1/ops/tickets", json=body, headers=headers("aima"))
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------- SLA ----
def test_sla_lifecycle(ctx):
    client, seeded, headers = ctx
    t = _ticket(client, seeded, headers)
    url = f"/api/v1/ops/tickets/{t['key']}"
    sla = t["sla"]
    assert sla["state"] in ("on_track", "at_risk") and sla["responseState"] == "pending"
    assert sla["targetResponseHours"] == 4 and sla["targetResolutionHours"] == 48

    # A comment by someone else is not a first response…
    client.post(f"{url}/comments", json={"body": "FYI"}, headers=headers("jai"))
    assert client.get(url, headers=headers("jai")).json()["sla"]["firstResponseAt"] is None
    # …the assignee's is.
    client.post(f"{url}/comments", json={"body": "On it"}, headers=headers("sofia"))
    after = client.get(url, headers=headers("jai")).json()["sla"]
    assert after["firstResponseAt"] and after["responseState"] == "met"

    # Awaiting Merchant pauses the clock; resuming never moves the due date earlier.
    due_before = after["resolutionDueAt"]
    paused = client.patch(url, json={"status": "AWAITING_MERCHANT"}, headers=headers("sofia")).json()["sla"]
    assert paused["state"] == "paused"
    resumed = client.patch(url, json={"status": "IN_PROGRESS"}, headers=headers("sofia")).json()["sla"]
    assert resumed["state"] != "paused" and resumed["resolutionDueAt"] >= due_before

    # Priority change re-targets; Done in time is "met".
    urgent = client.patch(url, json={"priority": "URGENT"}, headers=headers("aima")).json()["sla"]
    assert urgent["targetResolutionHours"] == 24 and urgent["resolutionDueAt"] < due_before
    done = client.patch(url, json={"status": "DONE"}, headers=headers("sofia")).json()["sla"]
    assert done["state"] == "met" and done["remainingSeconds"] == 0


def test_moving_out_of_new_counts_as_response(ctx):
    client, seeded, headers = ctx
    t = _ticket(client, seeded, headers)
    r = client.patch(f"/api/v1/ops/tickets/{t['key']}", json={"status": "IN_PROGRESS"}, headers=headers("aima")).json()
    assert r["sla"]["responseState"] == "met"


def test_catalog_lists_sla_policy(ctx):
    client, seeded, headers = ctx
    policy = {p["priority"]: p for p in client.get("/api/v1/ops/catalog", headers=headers("jai")).json()["sla"]}
    assert policy["URGENT"] == {"priority": "URGENT", "responseHours": 2, "resolutionHours": 24}


# --------------------------------------------------------------- reports ----
def test_reports(ctx):
    client, seeded, headers = ctx
    project = client.post("/api/v1/ops/projects", json={"name": f"Rep {uuid.uuid4().hex[:6]}"}, headers=headers("aima")).json()
    a = _ticket(client, seeded, headers, projectId=project["id"], priority="URGENT")
    _ticket(client, seeded, headers, projectId=project["id"], dueDate="2020-01-01", type="DESIGN", category="Logo", subCategory="New logo")
    client.patch(f"/api/v1/ops/tickets/{a['key']}", json={"status": "DONE"}, headers=headers("sofia"))

    r = client.get("/api/v1/ops/reports", params={"projectId": project["id"], "days": 30}, headers=headers("jai"))
    assert r.status_code == 200, r.text
    rep = r.json()
    k = rep["kpis"]
    assert k["open"] == 1 and k["overdue"] == 1 and k["overdueShare"] == 1
    assert k["created"] == 2 and k["resolved"] == 1
    assert k["resolutionSla"] == {"met": 1, "total": 1}
    assert k["openByType"]["DESIGN"] == 1
    assert sum(w["created"] for w in rep["weekly"]) == 2 and sum(w["closed"] for w in rep["weekly"]) == 1
    assert rep["byAssignee"][0]["name"] == "Sofia Rivera" and rep["byAssignee"][0]["overdue"] == 1
    assert rep["byProject"] == [{"id": project["id"], "name": project["name"], "open": 1}]
    assert {c["category"] for c in rep["topCategories"]} == {"Bug / fix", "Logo"}
    assert rep["bySource"] == [{"source": "MANUAL", "count": 2}]
    assert client.get("/api/v1/ops/reports", params={"days": 3}, headers=headers("jai")).status_code == 400


def test_csv_export(ctx):
    client, seeded, headers = ctx
    tag = uuid.uuid4().hex[:6]
    t = _ticket(client, seeded, headers, title=f"Export, \"quoted\" {tag}")
    r = client.get("/api/v1/ops/tickets/export", params={"search": tag}, headers=headers("jai"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0][:3] == ["Key", "Title", "Merchant"]
    assert rows[1][0] == t["key"] and rows[1][1] == f"Export, \"quoted\" {tag}"
    assert len(rows) == 2


# --------------------------------------------------------------- library ----
def test_library_pages(ctx):
    client, seeded, headers = ctx
    L = "/api/v1/ops/library"
    folder = client.post(L, json={"title": "Processes & SOPs", "section": "PROCESS"}, headers=headers("sofia"))
    assert folder.status_code == 201, folder.text
    fid = folder.json()["id"]
    child = client.post(L, json={"title": "Ticket routing", "section": "PROCESS", "parentId": fid, "body": "# Rules"}, headers=headers("sofia")).json()
    assert child["version"] == 1 and child["owner"]["name"] == "Sofia Rivera"

    # Placement rules.
    assert client.post(L, json={"title": "x", "section": "MERCHANT"}, headers=headers("sofia")).status_code == 400
    assert client.post(L, json={"title": "x", "section": "COMPANY", "merchantId": seeded["merchant"]}, headers=headers("sofia")).status_code == 400
    assert client.post(L, json={"title": "x", "section": "PROCESS", "parentId": child["id"]}, headers=headers("sofia")).status_code == 400  # 2 levels
    assert client.post(L, json={"title": "x", "section": "TEMPLATE", "parentId": fid}, headers=headers("sofia")).status_code == 400  # other section
    m = client.post(L, json={"title": "Brand guidelines", "section": "MERCHANT", "merchantId": seeded["merchant"]}, headers=headers("jai"))
    assert m.status_code == 201 and m.json()["merchant"]["id"] == seeded["merchant"]

    # Edits keep versions; a stale save is refused.
    u = client.patch(f"{L}/{child['id']}", json={"body": "# Rules v2", "baseVersion": 1}, headers=headers("jai")).json()
    assert u["version"] == 2 and u["updatedBy"]["name"] == "Jai Patel" and u["body"] == "# Rules v2"
    assert client.patch(f"{L}/{child['id']}", json={"body": "stale", "baseVersion": 1}, headers=headers("sofia")).status_code == 409
    vers = client.get(f"{L}/{child['id']}/versions", headers=headers("jai")).json()["data"]
    assert [v["version"] for v in vers] == [1] and vers[0]["body"] == "# Rules"
    # Moving a page or changing its owner doesn't create a version.
    assert client.patch(f"{L}/{child['id']}", json={"ownerId": seeded["jai"][0]}, headers=headers("jai")).json()["version"] == 2

    tree = client.get(L, headers=headers("jai")).json()["data"]
    assert {fid, child["id"]} <= {p["id"] for p in tree}
    assert client.get(L, params={"merchantId": seeded["merchant"]}, headers=headers("jai")).json()["data"][0]["title"] == "Brand guidelines"

    # Delete: managers only, and not while it has sub-pages.
    assert client.delete(f"{L}/{child['id']}", headers=headers("sofia")).status_code == 403
    assert client.delete(f"{L}/{fid}", headers=headers("aima")).status_code == 400
    assert client.delete(f"{L}/{child['id']}", headers=headers("aima")).status_code == 204
    assert client.delete(f"{L}/{fid}", headers=headers("aima")).status_code == 204


# ----------------------------------------------------------------- vault ----
def test_credentials_vault(ctx):
    client, seeded, headers = ctx
    C = "/api/v1/ops/credentials"
    body = {"label": "Instagram · @cha2cha", "username": "cha2cha", "secret": "hunter2!", "merchantId": seeded["merchant"]}
    assert client.post(C, json=body, headers=headers("sofia")).status_code == 403  # exec can't add
    created = client.post(C, json=body, headers=headers("aima"))
    assert created.status_code == 201, created.text
    cid = created.json()["id"]
    assert "secret" not in created.json() and "hunter2" not in created.text

    listed = client.get(C, params={"merchantId": seeded["merchant"]}, headers=headers("sofia")).json()
    assert listed["configured"] is True and listed["canReveal"] is False and listed["canManage"] is False
    assert "hunter2" not in str(listed)

    # Reveal: managers only, reason required, logged.
    assert client.post(f"{C}/{cid}/reveal", json={"reason": "OPS-1 post"}, headers=headers("sofia")).status_code == 403
    assert client.post(f"{C}/{cid}/reveal", json={"reason": ""}, headers=headers("aima")).status_code in (400, 422)
    r = client.post(f"{C}/{cid}/reveal", json={"reason": "Posting the new logo"}, headers=headers("aima"))
    assert r.status_code == 200 and r.json()["secret"] == "hunter2!"

    # Rotate the secret, then delete; the log survives the delete.
    client.patch(f"{C}/{cid}", json={"secret": "new-secret"}, headers=headers("aima"))
    assert client.post(f"{C}/{cid}/reveal", json={"reason": "check"}, headers=headers("aima")).json()["secret"] == "new-secret"
    assert client.delete(f"{C}/{cid}", headers=headers("aima")).status_code == 204
    log = client.get(f"{C}/log", params={"merchantId": seeded["merchant"]}, headers=headers("aima")).json()["data"]
    actions = [e["action"] for e in log if e["credentialLabel"] == body["label"]]
    assert actions == ["DELETED", "REVEALED", "UPDATED", "REVEALED", "CREATED"]
    assert next(e for e in log if e["reason"] == "Posting the new logo")["user"]["name"] == "Aima Raza"
    assert client.get(f"{C}/log", headers=headers("sofia")).status_code == 403


def test_vault_without_key_says_so(ctx):
    client, seeded, headers = ctx
    from app.common.security import crypto
    from app.config import get_settings

    s = get_settings()
    key = s.CREDENTIAL_ENCRYPTION_KEY
    s.CREDENTIAL_ENCRYPTION_KEY = None
    crypto._fernet.cache_clear()
    try:
        assert client.get("/api/v1/ops/credentials", headers=headers("aima")).json()["configured"] is False
        r = client.post("/api/v1/ops/credentials", json={"label": "x", "secret": "y"}, headers=headers("aima"))
        assert r.status_code == 503 and "CREDENTIAL_ENCRYPTION_KEY" in r.text
    finally:
        s.CREDENTIAL_ENCRYPTION_KEY = key
        crypto._fernet.cache_clear()
