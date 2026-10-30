"""Ticket attachments, watchers, notifications/SLA alerts and the calendar
filters, against a real Postgres (needs OPS_TEST_DATABASE_URL)."""
from __future__ import annotations

import asyncio
import datetime as dt
import os
import uuid

import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.common.storage import local_disk
    from app.config import get_settings
    from app.db.session import engine
    from app.main import app

    seeded = _seed()
    engine.sync_engine.dispose(close=False)
    s = get_settings()
    old_dir = s.STORAGE_DIR
    s.STORAGE_DIR = str(tmp_path_factory.mktemp("storage"))
    local_disk._storage_singleton = None
    os.environ["OPS_SLA_ALERTS"] = "false"

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    s.STORAGE_DIR = old_dir
    local_disk._storage_singleton = None
    engine.sync_engine.dispose(close=False)


def _ticket(client, seeded, headers, **over):
    body = {
        "title": f"Extras {uuid.uuid4().hex[:6]}",
        "type": "WEBSITE",
        "category": "Bug / fix",
        "subCategory": "Broken page",
        "priority": "HIGH",
        "projectId": seeded["project"],
        "assigneeId": seeded["sofia"][0],
    }
    body.update(over)
    r = client.post("/api/v1/ops/tickets", json=body, headers=headers("aima"))
    assert r.status_code == 201, r.text
    return r.json()


def _notes(client, headers, who, **params):
    r = client.get("/api/v1/ops/notifications", params=params, headers=headers(who))
    assert r.status_code == 200, r.text
    return r.json()


def test_attachments_upload_download_delete(ctx):
    client, seeded, headers = ctx
    t = _ticket(client, seeded, headers)
    url = f"/api/v1/ops/tickets/{t['key']}/attachments"
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    r = client.post(url, files={"file": ("screen shot.png", png, "image/png")}, headers=headers("jai"))
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["fileName"] == "screen shot.png" and a["isImage"] and a["sizeBytes"] == len(png) and a["uploadedBy"]["id"] == seeded["jai"][0]
    # Scripts are refused; empty files too.
    assert client.post(url, files={"file": ("run.exe", b"MZ", "application/octet-stream")}, headers=headers("jai")).status_code == 400
    assert client.post(url, files={"file": ("empty.txt", b"", "text/plain")}, headers=headers("jai")).status_code == 400

    d = client.get(f"/api/v1/ops/attachments/{a['id']}/download", headers=headers("sofia"))
    assert d.status_code == 200 and d.content == png and d.headers["content-disposition"].startswith("attachment;")
    inline = client.get(f"/api/v1/ops/attachments/{a['id']}/download", params={"inline": 1}, headers=headers("sofia"))
    assert inline.headers["content-disposition"].startswith("inline;")
    html = client.post(url, files={"file": ("page.html", b"<script>x</script>", "text/html")}, headers=headers("jai")).json()
    assert client.get(f"/api/v1/ops/attachments/{html['id']}/download", params={"inline": 1}, headers=headers("jai")).headers[
        "content-disposition"
    ].startswith("attachment;")

    detail = client.get(f"/api/v1/ops/tickets/{t['key']}", headers=headers("sofia")).json()
    assert [x["fileName"] for x in detail["attachments"]] == ["screen shot.png", "page.html"]
    acts = client.get(f"/api/v1/ops/tickets/{t['key']}/activity", headers=headers("sofia")).json()
    assert "ATTACHMENT_ADDED" in str(acts)

    # Only the uploader or a manager can delete.
    assert client.delete(f"/api/v1/ops/attachments/{a['id']}", headers=headers("sofia")).status_code == 403
    assert client.delete(f"/api/v1/ops/attachments/{a['id']}", headers=headers("jai")).status_code == 204
    assert client.delete(f"/api/v1/ops/attachments/{html['id']}", headers=headers("aima")).status_code == 204
    assert client.get(f"/api/v1/ops/tickets/{t['key']}/attachments", headers=headers("jai")).json() == []


def test_watchers_and_notifications(ctx):
    client, seeded, headers = ctx
    t = _ticket(client, seeded, headers)
    key = t["key"]
    detail = client.get(f"/api/v1/ops/tickets/{key}", headers=headers("aima")).json()
    assert [w["id"] for w in detail["watchers"]] == [seeded["aima"][0]] and detail["viewer"]["watching"]  # creator auto-watches

    # Assignee got an ASSIGNED notice; the creator didn't notify herself.
    sofia = _notes(client, headers, "sofia", unread=True)
    assert any(n["kind"] == "ASSIGNED" and n["ticketKey"] == key for n in sofia["data"])
    assert not any(n["ticketKey"] == key for n in _notes(client, headers, "aima")["data"])

    # Jai watches; adding someone else needs ticket.manage.
    w = client.post(f"/api/v1/ops/tickets/{key}/watchers", json={}, headers=headers("jai")).json()
    assert w["watching"] and len(w["data"]) == 2
    assert client.post(f"/api/v1/ops/tickets/{key}/watchers", json={"userId": seeded["admin"][0]}, headers=headers("jai")).status_code == 403
    assert client.post(f"/api/v1/ops/tickets/{key}/watchers", json={"userId": seeded["admin"][0]}, headers=headers("aima")).status_code == 200

    # A comment by Sofia → Jai, Aima and Admin (watchers) hear about it, Sofia doesn't.
    client.post(f"/api/v1/ops/tickets/{key}/comments", json={"body": "Looking into it"}, headers=headers("sofia"))
    for who in ("jai", "aima", "admin"):
        assert any(n["kind"] == "COMMENTED" and n["ticketKey"] == key for n in _notes(client, headers, who)["data"]), who
    assert not any(n["kind"] == "COMMENTED" and n["ticketKey"] == key for n in _notes(client, headers, "sofia")["data"])

    # Status change by Sofia → watchers notified.
    client.patch(f"/api/v1/ops/tickets/{key}", json={"status": "IN_PROGRESS"}, headers=headers("sofia"))
    assert any(n["kind"] == "STATUS_CHANGED" and n["ticketKey"] == key for n in _notes(client, headers, "jai")["data"])

    # Watching filter.
    mine = client.get("/api/v1/ops/tickets", params={"watching": True, "view": "all", "limit": 200}, headers=headers("jai")).json()
    assert key in [x["key"] for x in mine["data"]]

    # Turning "watching" off in Settings stops comment notices.
    client.patch("/api/v1/settings/me", json={"preferences": {"notifications": {"watching": {"inApp": False, "email": False, "teams": False}}}}, headers=headers("jai"))
    before = len([n for n in _notes(client, headers, "jai", limit=100)["data"] if n["ticketKey"] == key])
    client.post(f"/api/v1/ops/tickets/{key}/comments", json={"body": "Another"}, headers=headers("sofia"))
    after = len([n for n in _notes(client, headers, "jai", limit=100)["data"] if n["ticketKey"] == key])
    assert after == before

    # Unwatch; mark read.
    assert client.delete(f"/api/v1/ops/tickets/{key}/watchers/me", headers=headers("jai")).json()["watching"] is False
    assert client.delete(f"/api/v1/ops/tickets/{key}/watchers/{seeded['admin'][0]}", headers=headers("jai")).status_code == 403
    n = _notes(client, headers, "jai", unread=True)
    assert n["unread"] >= 1
    client.post("/api/v1/ops/notifications/read", json={"ids": [n["data"][0]["id"]]}, headers=headers("jai"))
    assert _notes(client, headers, "jai")["unread"] == n["unread"] - 1
    client.post("/api/v1/ops/notifications/read", json={"all": True}, headers=headers("jai"))
    assert _notes(client, headers, "jai")["unread"] == 0


def _age(ticket_id: str, days: int):
    """Move a ticket's SLA clock into the past."""
    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.ops import Ticket
    from app.modules.ops import sla

    async def run():
        engine = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(engine)() as s:
            t = await s.get(Ticket, ticket_id)
            created = t.created_at - dt.timedelta(days=days)
            await s.execute(
                update(Ticket)
                .where(Ticket.id == ticket_id)
                .values(
                    created_at=created,
                    response_due_at=sla.response_due(created, t.priority),
                    resolution_due_at=sla.resolution_due(created, t.priority),
                )
            )
            await s.commit()
        await engine.dispose()

    asyncio.run(run())


def test_sla_alerts_breach_escalates_once(ctx):
    client, seeded, headers = ctx
    from app.modules.ops import alerts

    t = _ticket(client, seeded, headers, priority="URGENT")
    _age(t["id"], 10)  # far past both targets

    async def scan_once():
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from app.config import to_asyncpg_url

        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(eng, expire_on_commit=False)() as db:
            await alerts.scan_sla(db)
        await eng.dispose()

    def scan():
        return scan_once()

    asyncio.run(scan())

    sofia = [n for n in _notes(client, headers, "sofia", limit=100)["data"] if n["ticketKey"] == t["key"]]
    kinds = {n["kind"] for n in sofia}
    assert {"SLA_BREACHED", "RESPONSE_OVERDUE"} <= kinds
    # Aima manages tickets (and watches) → escalated to her too.
    assert any(n["kind"] == "SLA_BREACHED" and n["ticketKey"] == t["key"] for n in _notes(client, headers, "aima", limit=100)["data"])

    # A second scan sends nothing new.
    asyncio.run(scan())
    again = [n for n in _notes(client, headers, "sofia", limit=100)["data"] if n["ticketKey"] == t["key"]]
    assert len(again) == len(sofia)

    # SLA-breached filter on the list.
    lst = client.get("/api/v1/ops/tickets", params={"slaBreached": True, "limit": 200}, headers=headers("jai")).json()
    assert t["key"] in [x["key"] for x in lst["data"]]


def test_calendar_due_range(ctx):
    client, seeded, headers = ctx
    y = 2100 + int(uuid.uuid4().hex[:4], 16) % 800  # a month no other run uses
    a = _ticket(client, seeded, headers, dueDate=f"{y}-03-03")
    b = _ticket(client, seeded, headers, dueDate=f"{y}-03-28")
    _ticket(client, seeded, headers, dueDate=f"{y}-04-02")
    r = client.get("/api/v1/ops/tickets", params={"dueFrom": f"{y}-03-01", "dueTo": f"{y}-03-31", "view": "all", "limit": 200}, headers=headers("jai")).json()
    assert sorted(x["key"] for x in r["data"]) == sorted([a["key"], b["key"]])
