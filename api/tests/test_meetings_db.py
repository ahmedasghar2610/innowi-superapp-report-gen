"""Meetings (Fathom) against a real Postgres — needs OPS_TEST_DATABASE_URL,
like test_ops_tickets_db.py."""
from __future__ import annotations

import base64
import json
import os
import time
import uuid

import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")

GUEST = f"ivy@cha2cha-{uuid.uuid4().hex[:6]}.com"
SECRET = "whsec_" + base64.b64encode(b"meetings-test-secret-meetings-test").decode()


@pytest.fixture(scope="module")
def ctx():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.config import get_settings
    from app.db.session import engine
    from app.main import app

    seeded = _seed()
    engine.sync_engine.dispose(close=False)
    s = get_settings()
    old = s.FATHOM_WEBHOOK_SECRET
    s.FATHOM_WEBHOOK_SECRET = SECRET

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    s.FATHOM_WEBHOOK_SECRET = old
    engine.sync_engine.dispose(close=False)


def _payload(seeded, rid: int, **over) -> dict:
    p = {
        "recording_id": rid,
        "meeting_title": "Cha2Cha · menu review",
        "url": f"https://fathom.video/calls/{rid}",
        "share_url": f"https://fathom.video/share/{rid}",
        "created_at": "2026-10-05T10:40:00Z",
        "recording_start_time": "2026-10-05T10:00:00Z",
        "recording_end_time": "2026-10-05T10:30:00Z",
        "transcript_language": "en",
        "calendar_invitees": [
            {"name": "Sofia Rivera", "email": seeded["sofia"][1], "is_external": False},
            {"name": "Jai Patel", "email": seeded["jai"][1], "is_external": False},
            {"name": "Ivy", "email": GUEST, "is_external": True},
        ],
        "recorded_by": {"name": "Aima", "email": seeded["aima"][1]},
        "transcript": [{"speaker": {"display_name": "Sofia Rivera", "matched_calendar_invitee_email": seeded["sofia"][1]}, "text": "Hi", "timestamp": "00:00:05"}],
        "default_summary": {"markdown_formatted": "## Summary\nMenu review."},
        "action_items": [
            {"description": "Update the dessert menu", "assignee": {"name": "Sofia Rivera", "email": seeded["sofia"][1]}, "recording_timestamp": "00:03:00"},
            {"description": "Send new photos", "assignee": {"name": "Ivy", "email": GUEST}},
        ],
    }
    p.update(over)
    return p


def _post(client, payload: dict, secret: str = SECRET):
    from app.modules.ops.fathom import sign_webhook

    body = json.dumps(payload).encode()
    ts = int(time.time())
    return client.post(
        "/api/v1/integrations/fathom/webhook",
        content=body,
        headers={"content-type": "application/json", "webhook-id": "msg_1", "webhook-timestamp": str(ts),
                 "webhook-signature": sign_webhook(secret, "msg_1", ts, body)},
    )


def _add_contact(merchant_id: str, email: str):
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.enums import ContactRole
    from app.models.profiling import Contact

    async def run():
        engine = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(engine)() as s:
            s.add(Contact(merchant_id=merchant_id, email=email, name="Ivy", role=list(ContactRole)[0]))
            await s.commit()
        await engine.dispose()

    asyncio.run(run())


def test_webhook_ingest_matching_and_redelivery(ctx):
    client, seeded, headers = ctx
    _add_contact(seeded["merchant"], f"owner@{uuid.uuid4().hex[:6]}.other-domain.com")  # different domain: no match
    rid = int(time.time() * 1000) % 2_000_000_000
    assert _post(client, _payload(seeded, rid), secret="whsec_" + base64.b64encode(b"wrong-secret-wrong-secret").decode()).status_code == 401
    r = _post(client, _payload(seeded, rid))
    assert r.status_code == 200 and r.json()["created"] is True
    mid = r.json()["meetingId"]

    d = client.get(f"/api/v1/ops/meetings/{mid}", headers=headers("jai")).json()
    assert d["title"] == "Cha2Cha · menu review" and d["durationMinutes"] == 30 and d["merchant"] is None
    att = {a["name"]: a for a in d["attendees"]}
    assert att["Sofia Rivera"]["spoke"] and att["Sofia Rivera"]["userId"] == seeded["sofia"][0]
    assert not att["Jai Patel"]["spoke"] and att["Ivy"]["isExternal"]
    items = {a["description"]: a for a in d["actionItems"]}
    assert items["Update the dessert menu"]["assignee"]["id"] == seeded["sofia"][0]
    assert items["Send new photos"]["assignee"] is None
    assert d["canManage"] is False

    # A contact with the guest's exact email → merchant matched on re-delivery.
    _add_contact(seeded["merchant"], GUEST)
    r = _post(client, _payload(seeded, rid, meeting_title="Cha2Cha · menu review (v2)"))
    assert r.json()["created"] is False and r.json()["meetingId"] == mid
    d = client.get(f"/api/v1/ops/meetings/{mid}", headers=headers("jai")).json()
    assert d["merchant"]["id"] == seeded["merchant"] and d["title"].endswith("(v2)")
    assert len(d["actionItems"]) == 2  # refreshed, not duplicated


def test_action_item_to_ticket_and_permissions(ctx):
    client, seeded, headers = ctx
    rid = int(time.time() * 1000) % 2_000_000_000 + 7
    mid = _post(client, _payload(seeded, rid)).json()["meetingId"]
    d = client.get(f"/api/v1/ops/meetings/{mid}", headers=headers("aima")).json()
    a1, a2 = d["actionItems"]
    assert d["canManage"] is True

    # Staff can read but not decide.
    assert client.post(f"/api/v1/ops/meetings/{mid}/actions/{a2['id']}/dismiss", headers=headers("jai")).status_code == 403
    assert client.patch(f"/api/v1/ops/meetings/{mid}", json={"merchantId": None}, headers=headers("jai")).status_code == 403

    body = {"title": a1["description"], "type": "DESIGN", "category": "Menu", "subCategory": "Menu update", "priority": "MEDIUM",
            "projectId": seeded["project"], "assigneeId": a1["assignee"]["id"], "actionItemId": a1["id"]}
    assert client.post("/api/v1/ops/tickets", json=body, headers=headers("jai")).status_code == 403
    t = client.post("/api/v1/ops/tickets", json=body, headers=headers("aima"))
    assert t.status_code == 201, t.text
    assert t.json()["source"] == "MEETING" and t.json()["meeting"]["id"] == mid
    assert client.post("/api/v1/ops/tickets", json=body, headers=headers("aima")).status_code == 409

    r = client.post(f"/api/v1/ops/meetings/{mid}/actions/{a2['id']}/dismiss", headers=headers("aima")).json()
    st = {a["description"]: a for a in r["actionItems"]}
    assert st[a1["description"]]["status"] == "TICKET" and st[a1["description"]]["ticket"]["key"] == t.json()["key"]
    assert st[a2["description"]]["status"] == "DISMISSED" and st[a2["description"]]["decidedBy"]
    assert r["linkedTickets"][0]["key"] == t.json()["key"]
    # Re-delivery keeps decided items.
    _post(client, _payload(seeded, rid))
    again = client.get(f"/api/v1/ops/meetings/{mid}", headers=headers("aima")).json()
    assert sorted(a["status"] for a in again["actionItems"]) == ["DISMISSED", "TICKET"]
    # Reopen a dismissed one; a ticketed one can't be reopened.
    assert client.post(f"/api/v1/ops/meetings/{mid}/actions/{a2['id']}/reopen", headers=headers("aima")).status_code == 200
    assert client.post(f"/api/v1/ops/meetings/{mid}/actions/{a1['id']}/reopen", headers=headers("aima")).status_code == 409

    # Manual merchant choice sticks through re-delivery.
    client.patch(f"/api/v1/ops/meetings/{mid}", json={"merchantId": None, "summary": "Edited"}, headers=headers("aima"))
    _post(client, _payload(seeded, rid))
    d = client.get(f"/api/v1/ops/meetings/{mid}", headers=headers("aima")).json()
    assert d["merchant"] is None and d["merchantMatch"] == "manual"


def test_list_filters_status_and_sync_without_key(ctx):
    client, seeded, headers = ctx
    rid = int(time.time() * 1000) % 2_000_000_000 + 13
    mid = _post(client, _payload(seeded, rid, meeting_title=f"Filter {rid}")).json()["meetingId"]
    lst = client.get("/api/v1/ops/meetings", params={"search": f"Filter {rid}"}, headers=headers("jai")).json()
    assert [m["id"] for m in lst["data"]] == [mid]
    mine = client.get("/api/v1/ops/meetings", params={"mine": True, "search": f"Filter {rid}"}, headers=headers("sofia")).json()
    assert mine["meta"]["total"] == 1
    not_mine = client.get("/api/v1/ops/meetings", params={"mine": True, "search": f"Filter {rid}"}, headers=headers("admin")).json()
    assert not_mine["meta"]["total"] == 0
    assert client.get("/api/v1/ops/meetings", params={"openActions": True, "search": f"Filter {rid}"}, headers=headers("jai")).json()["meta"]["total"] == 1
    st = client.get("/api/v1/ops/meetings/status", headers=headers("jai")).json()
    assert st["webhookSecretSet"] is True and st["lastWebhookAt"] and st["canSync"] is False
    assert client.post("/api/v1/ops/meetings/sync", headers=headers("jai")).status_code == 403
    assert client.post("/api/v1/ops/meetings/sync", headers=headers("aima")).status_code in (409, 502)
    assert client.delete(f"/api/v1/ops/meetings/{mid}", headers=headers("aima")).status_code == 403
    assert client.delete(f"/api/v1/ops/meetings/{mid}", headers=headers("admin")).status_code == 204


def test_webhook_refused_without_secret(ctx):
    client, seeded, headers = ctx
    from app.config import get_settings

    s = get_settings()
    s.FATHOM_WEBHOOK_SECRET = None
    try:
        assert _post(client, _payload(seeded, 1)).status_code == 503
    finally:
        s.FATHOM_WEBHOOK_SECRET = SECRET
