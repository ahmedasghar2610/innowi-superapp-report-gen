"""Comment visibility and @mentions, Library links, merchant info, saved
views, catch-up / handover and the completed-date filter (needs
OPS_TEST_DATABASE_URL)."""
from __future__ import annotations

import datetime as dt
import os
import uuid

import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def ctx():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app

    seeded = _seed()
    engine.sync_engine.dispose(close=False)
    os.environ["OPS_SLA_ALERTS"] = "false"

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    engine.sync_engine.dispose(close=False)


def _ticket(client, seeded, headers, **over):
    body = {
        "title": f"More {uuid.uuid4().hex[:6]}",
        "type": "DESIGN",
        "category": "Logo",
        "subCategory": "New logo",
        "priority": "MEDIUM",
        "projectId": seeded["project"],
        "merchantId": seeded["merchant"],
        "assigneeId": seeded["sofia"][0],
    }
    body.update(over)
    r = client.post("/api/v1/ops/tickets", json=body, headers=headers("aima"))
    assert r.status_code == 201, r.text
    return r.json()


def test_comment_visibility_and_mentions(ctx):
    client, seeded, headers = ctx
    t = _ticket(client, seeded, headers)
    url = f"/api/v1/ops/tickets/{t['key']}/comments"
    r = client.post(url, json={"body": "Shared with the merchant", "visibility": "MERCHANT"}, headers=headers("sofia"))
    assert r.status_code == 201 and r.json()["visibility"] == "MERCHANT"
    r = client.post(url, json={"body": "@Jai Patel can you check?", "mentions": [seeded["jai"][0]]}, headers=headers("sofia"))
    assert r.status_code == 201 and r.json()["visibility"] == "INTERNAL" and r.json()["mentions"][0]["id"] == seeded["jai"][0]
    # Unknown / suspended users can't be mentioned.
    assert client.post(url, json={"body": "x", "mentions": [seeded["gone"][0]]}, headers=headers("sofia")).status_code == 400

    jai = client.get("/api/v1/ops/notifications", headers=headers("jai")).json()["data"]
    assert any(n["kind"] == "MENTIONED" and n["ticketKey"] == t["key"] for n in jai)
    # Aima (watcher) gets COMMENTED for the mention comment, not MENTIONED.
    aima = client.get("/api/v1/ops/notifications", headers=headers("aima")).json()["data"]
    assert not any(n["kind"] == "MENTIONED" and n["ticketKey"] == t["key"] for n in aima)

    acts = client.get(f"/api/v1/ops/tickets/{t['key']}/activity", headers=headers("jai")).json()["data"]
    comments = [a for a in acts if a["kind"] == "comment"]
    assert [c["visibility"] for c in comments] == ["MERCHANT", "INTERNAL"]
    assert comments[1]["mentions"][0]["name"] == "Jai Patel"

    internal = _ticket(client, seeded, headers, merchantId=None)
    r = client.post(f"/api/v1/ops/tickets/{internal['key']}/comments", json={"body": "x", "visibility": "MERCHANT"}, headers=headers("sofia"))
    assert r.status_code == 400


def test_library_links_and_merchant_info(ctx):
    client, seeded, headers = ctx
    page = client.post(
        "/api/v1/ops/library",
        json={"title": f"Brand {uuid.uuid4().hex[:4]}", "section": "MERCHANT", "merchantId": seeded["merchant"], "body": "x"},
        headers=headers("jai"),
    ).json()
    t = _ticket(client, seeded, headers)
    d = client.get(f"/api/v1/ops/tickets/{t['key']}", headers=headers("sofia")).json()
    assert d["merchantInfo"] is not None and "services" in d["merchantInfo"]
    assert page["id"] in [p["id"] for p in d["librarySuggestions"]] and d["libraryLinks"] == []

    url = f"/api/v1/ops/tickets/{t['key']}/library"
    assert client.post(url, json={"pageId": page["id"]}, headers=headers("jai")).status_code == 403  # not assignee
    assert client.post(url, json={"pageId": page["id"]}, headers=headers("sofia")).status_code == 204
    d = client.get(f"/api/v1/ops/tickets/{t['key']}", headers=headers("jai")).json()
    assert [p["id"] for p in d["libraryLinks"]] == [page["id"]] and page["id"] not in [p["id"] for p in d["librarySuggestions"]]
    lp = client.get(f"/api/v1/ops/library/{page['id']}", headers=headers("jai")).json()
    assert t["key"] in [x["key"] for x in lp["linkedTickets"]]
    assert client.delete(f"{url}/{page['id']}", headers=headers("aima")).status_code == 204
    assert client.get(f"/api/v1/ops/tickets/{t['key']}", headers=headers("jai")).json()["libraryLinks"] == []


def test_saved_views(ctx):
    client, seeded, headers = ctx
    r = client.post("/api/v1/ops/views", json={"name": "My urgent", "filters": {"priority": "URGENT", "assigneeId": "me", "junk": "x", "page": 3}}, headers=headers("jai"))
    assert r.status_code == 201 and r.json()["filters"] == {"priority": "URGENT", "assigneeId": "me"}
    # Same name updates.
    r2 = client.post("/api/v1/ops/views", json={"name": "my urgent", "filters": {"priority": "HIGH"}}, headers=headers("jai")).json()
    assert r2["id"] == r.json()["id"] and r2["filters"] == {"priority": "HIGH"}
    assert [v["name"] for v in client.get("/api/v1/ops/views", headers=headers("jai")).json()] == ["My urgent"]
    assert client.get("/api/v1/ops/views", headers=headers("sofia")).json() == []
    assert client.delete(f"/api/v1/ops/views/{r2['id']}", headers=headers("sofia")).status_code == 404
    assert client.delete(f"/api/v1/ops/views/{r2['id']}", headers=headers("jai")).status_code == 204


def test_catch_up_and_handover(ctx):
    client, seeded, headers = ctx
    client.post("/api/v1/ops/catch-up/dismiss", headers=headers("sofia"))
    t = _ticket(client, seeded, headers, priority="URGENT")
    client.post(f"/api/v1/ops/tickets/{t['key']}/comments", json={"body": "Please start today"}, headers=headers("aima"))
    cu = client.get("/api/v1/ops/catch-up", headers=headers("sofia")).json()
    kinds = {(i["kind"], i["href"]) for i in cu["items"]}
    assert ("assigned", f"/ops/tickets/{t['key']}") in kinds
    assert cu["counts"]["assigned"] >= 1
    client.post("/api/v1/ops/catch-up/dismiss", headers=headers("sofia"))
    assert client.get("/api/v1/ops/catch-up", headers=headers("sofia")).json()["counts"]["assigned"] == 0

    h = client.get("/api/v1/ops/handover", headers=headers("sofia")).json()
    assert h["text"].startswith("HANDOVER") and t["key"] in h["text"] and "MY OPEN TICKETS" in h["text"]


def test_completed_range(ctx):
    client, seeded, headers = ctx
    t = _ticket(client, seeded, headers)
    client.patch(f"/api/v1/ops/tickets/{t['key']}", json={"status": "DONE"}, headers=headers("sofia"))
    today = dt.date.today()
    r = client.get(
        "/api/v1/ops/tickets",
        params={"view": "done", "completedFrom": (today - dt.timedelta(days=1)).isoformat(), "completedTo": (today + dt.timedelta(days=1)).isoformat(), "limit": 200},
        headers=headers("jai"),
    ).json()
    assert t["key"] in [x["key"] for x in r["data"]]
    r = client.get("/api/v1/ops/tickets", params={"view": "done", "completedTo": "2001-01-01", "limit": 200}, headers=headers("jai")).json()
    assert t["key"] not in [x["key"] for x in r["data"]]
