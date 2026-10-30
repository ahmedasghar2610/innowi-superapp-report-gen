"""Ops CRM → Teams through the Power Automate flow (modules/ops/teams_flow.py),
against a real Postgres (OPS_TEST_DATABASE_URL, migrated to head). The flow
itself is faked: every call to it is captured instead of leaving the machine.

    OPS_TEST_DATABASE_URL=$URL DATABASE_URL=$URL pytest tests/test_ops_teams_db.py
"""
from __future__ import annotations

import asyncio
import datetime as dt
import os

import pytest

from tests.test_ops_tickets_db import _create, _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")

FLOW = "https://flow.example/invoke?sig=abc"
SECRET = "test-secret"


def _set_login_email(uid: str, addr: str) -> None:
    """Point a seeded user at a fixed address, freeing it from any earlier test run."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.config import to_asyncpg_url

    async def run():
        engine = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with engine.begin() as c:
            await c.execute(text('UPDATE auth."user" SET email = id || \'-old@innowi.test\' WHERE email = :a'), {"a": addr})
            await c.execute(text('UPDATE auth."user" SET email = :a WHERE id = :u'), {"a": addr, "u": uid})
        await engine.dispose()

    asyncio.run(run())


@pytest.fixture(scope="module")
def ctx():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app

    seeded = _seed()
    # Teams / Outlook use the login e-mail, so give two people real-looking ones.
    for who, addr in (("sofia", "sofia.rivera@innowi.com"), ("jai", "jai.patel@innowi.com")):
        _set_login_email(seeded[who][0], addr)
        seeded[who] = (seeded[who][0], addr, seeded[who][2])
    engine.sync_engine.dispose(close=False)

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    engine.sync_engine.dispose(close=False)


@pytest.fixture()
def flow(monkeypatch):
    """Configure the flow and capture what is sent to it."""
    from app.config import get_settings
    from app.modules.quotes import notify as quotes_notify

    s = get_settings()
    monkeypatch.setattr(s, "OPS_TEAMS_FLOW_URL", FLOW)
    monkeypatch.setattr(s, "OPS_TEAMS_FLOW_SECRET", SECRET)
    monkeypatch.setattr(s, "RESEND_API_KEY", None)
    sent: list[dict] = []

    def fake_post(url, payload, headers=None):
        sent.append({"url": url, "payload": payload, "headers": headers or {}})
        return 200

    monkeypatch.setattr(quotes_notify, "_post_json", fake_post)
    return sent


def _set_ms_email(client, headers, who, email, **notifications):
    """Set notification channels; `email` is the person's login e-mail (set in ctx) and is only documentary."""
    if not notifications:
        return None
    r = client.patch("/api/v1/settings/me", json={"preferences": {"notifications": notifications}}, headers=headers(who))
    assert r.status_code == 200, r.text
    return r.json()


def test_not_configured(ctx, monkeypatch):
    client, _, headers = ctx
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "OPS_TEAMS_FLOW_URL", None)
    st = client.get("/api/v1/ops/teams/status", headers=headers("sofia")).json()
    assert st["configured"] is False
    assert client.post("/api/v1/ops/teams/test", json={}, headers=headers("sofia")).status_code == 409


def test_teams_address_is_login_email(ctx):
    client, seeded, headers = ctx
    st = client.get("/api/v1/ops/teams/status", headers=headers("jai")).json()
    assert st["myMicrosoftEmail"] == seeded["jai"][1] == "jai.patel@innowi.com"
    assert "usingLoginEmail" not in st


def test_test_message_and_channel_rights(ctx, flow):
    client, _, headers = ctx
    _set_ms_email(client, headers, "sofia", "sofia.rivera@innowi.com")
    r = client.post("/api/v1/ops/teams/test", json={"target": "me"}, headers=headers("sofia"))
    assert r.status_code == 200 and r.json()["ok"] is True
    call = flow[-1]
    assert call["url"] == FLOW and call["headers"]["x-superapp-key"] == SECRET
    assert call["payload"]["kind"] == "dm" and call["payload"]["to"] == "sofia.rivera@innowi.com"
    assert call["payload"]["url"].startswith("http")
    # Only admins post to the channel.
    assert client.post("/api/v1/ops/teams/test", json={"target": "channel"}, headers=headers("sofia")).status_code == 403
    r = client.post("/api/v1/ops/teams/test", json={"target": "channel"}, headers=headers("admin"))
    assert r.status_code == 200 and flow[-1]["payload"]["kind"] == "channel"


def test_assignment_sends_teams_card_and_urgent_posts_channel(ctx, flow):
    client, seeded, headers = ctx
    _set_ms_email(client, headers, "sofia", "sofia.rivera@innowi.com")
    r = _create(client, seeded, headers)  # HIGH: assignee only ("assigned" has Teams on by default)
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    dms = [c["payload"] for c in flow if c["payload"]["kind"] == "dm"]
    assert dms and dms[-1]["to"] == "sofia.rivera@innowi.com" and key in dms[-1]["title"]
    assert dms[-1]["url"].endswith(f"/ops/tickets/{key}")
    assert not [c for c in flow if c["payload"]["kind"] == "channel"]

    flow.clear()
    r = _create(client, seeded, headers, priority="URGENT")
    assert r.status_code == 201
    kinds = [c["payload"]["kind"] for c in flow]
    assert "channel" in kinds and "dm" in kinds
    ch = next(c["payload"] for c in flow if c["payload"]["kind"] == "channel")
    assert ch["title"].startswith("Urgent ticket") and "Sofia" in ch["text"]


def test_teams_off_means_no_card(ctx, flow):
    client, seeded, headers = ctx
    _set_ms_email(client, headers, "sofia", "sofia.rivera@innowi.com",
                  assigned={"inApp": True, "email": False, "teams": False})
    try:
        assert _create(client, seeded, headers).status_code == 201
        assert not [c for c in flow if c["payload"]["kind"] == "dm"]
    finally:
        _set_ms_email(client, headers, "sofia", "sofia.rivera@innowi.com",
                      assigned={"inApp": True, "email": True, "teams": True})


def test_mention_card(ctx, flow):
    client, seeded, headers = ctx
    key = _create(client, seeded, headers).json()["key"]
    _set_ms_email(client, headers, "jai", "jai.patel@innowi.com", mentioned={"inApp": True, "email": False, "teams": True})
    flow.clear()
    r = client.post(f"/api/v1/ops/tickets/{key}/comments",
                    json={"body": "@Jai Patel please check", "mentions": [seeded["jai"][0]]}, headers=headers("sofia"))
    assert r.status_code == 201, r.text
    dms = [c["payload"] for c in flow if c["payload"]["kind"] == "dm"]
    assert [d["to"] for d in dms] == ["jai.patel@innowi.com"] and "mentioned you" in dms[0]["title"]


def test_meeting(ctx, flow):
    client, seeded, headers = ctx
    key = _create(client, seeded, headers).json()["key"]
    start = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    body = {"subject": f"{key} review", "start": start.isoformat(), "durationMinutes": 45,
            "attendeeIds": [seeded["sofia"][0], seeded["jai"][0]], "ticketKey": key}
    # Jai isn't a manager or the assignee.
    assert client.post("/api/v1/ops/teams/meeting", json=body, headers=headers("jai")).status_code == 403
    # Past start is refused.
    past = dict(body, start=(start - dt.timedelta(days=10)).isoformat())
    assert client.post("/api/v1/ops/teams/meeting", json=past, headers=headers("aima")).status_code == 400
    flow.clear()
    r = client.post("/api/v1/ops/teams/meeting", json=body, headers=headers("aima"))
    assert r.status_code == 200 and r.json()["ok"] is True, r.text
    ev = flow[-1]["payload"]
    assert ev["kind"] == "event" and ev["subject"] == f"{key} review"
    # 10:00 UTC → 15:00 Karachi wall clock, 45 minutes long.
    assert ev["start"].endswith("T15:00:00") and ev["end"].endswith("T15:45:00")
    assert "sofia.rivera@innowi.com" in ev["attendees"] and f"/ops/tickets/{key}" in ev["text"]
    acts = client.get(f"/api/v1/ops/tickets/{key}/activity", headers=headers("aima")).json()["data"]
    assert any("Booked a Teams meeting" in (a.get("body") or "") for a in acts)
    # The assignee may book one about their own ticket.
    assert client.post("/api/v1/ops/teams/meeting", json=dict(body, attendeeIds=[seeded["aima"][0]]),
                       headers=headers("sofia")).status_code == 200


def test_digest(ctx, flow):
    client, seeded, headers = ctx
    _create(client, seeded, headers, priority="URGENT")
    assert client.post("/api/v1/ops/teams/digest", headers=headers("sofia")).status_code == 403
    flow.clear()
    r = client.post("/api/v1/ops/teams/digest", headers=headers("admin"))
    assert r.status_code == 200 and r.json()["ok"] is True
    p = flow[-1]["payload"]
    assert p["kind"] == "channel" and p["title"].startswith("Ops daily digest") and "Urgent:" in p["text"]

    # The scheduled tick won't post twice on the same day.
    from app.modules.ops import digest

    async def tick():
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from app.config import get_settings, to_asyncpg_url

        get_settings().OPS_DIGEST_HOUR = 0
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(eng, expire_on_commit=False)() as db:
            out = await digest.tick(db)
        await eng.dispose()
        return out

    out = asyncio.run(tick())
    assert out["ran"] is False and out["detail"] in ("Already posted today.", "Not a working day.")


def test_breach_posts_channel_once(ctx, flow):
    client, seeded, headers = ctx
    key = _create(client, seeded, headers).json()["key"]

    async def scan():
        from sqlalchemy import update
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from app.config import to_asyncpg_url
        from app.models.ops import Ticket
        from app.modules.ops import alerts

        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        Session = async_sessionmaker(eng, expire_on_commit=False)
        past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)
        async with Session() as db:
            await db.execute(update(Ticket).where(Ticket.number == int(key.split("-")[1]))
                             .values(resolution_due_at=past, response_due_at=past, first_response_at=past))
            await db.commit()
        async with Session() as db:
            await alerts.scan_sla(db)
        async with Session() as db:
            await alerts.scan_sla(db)
        await eng.dispose()

    flow.clear()
    asyncio.run(scan())
    posts = [c["payload"] for c in flow if c["payload"]["kind"] == "channel" and key in c["payload"]["title"]]
    assert len(posts) == 1 and posts[0]["title"] == f"SLA breached: {key}"


def test_personal_digest(ctx, flow):
    from zoneinfo import ZoneInfo

    if dt.datetime.now(ZoneInfo("Asia/Karachi")).weekday() >= 5:
        pytest.skip("the digest only runs on working days")
    client, seeded, headers = ctx
    _set_ms_email(client, headers, "sofia", "sofia.rivera@innowi.com",
                  dailyDigest={"inApp": False, "email": False, "teams": True})
    _create(client, seeded, headers, dueDate=dt.date.today().isoformat())

    async def tick():
        from sqlalchemy import delete
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from app.config import get_settings, to_asyncpg_url
        from app.models.ops import AppSetting
        from app.modules.ops import digest

        get_settings().OPS_DIGEST_HOUR = 0
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(eng, expire_on_commit=False)() as db:
            await db.execute(delete(AppSetting).where(AppSetting.key == digest.SETTING_KEY))
            await db.commit()
            out = await digest.tick(db)
        await eng.dispose()
        return out

    flow.clear()
    out = asyncio.run(tick())
    assert out["ran"] is True, out
    mine = [c["payload"] for c in flow if c["payload"]["kind"] == "dm" and c["payload"]["to"] == "sofia.rivera@innowi.com"]
    assert mine and mine[0]["title"].startswith("Your tickets today") and "Due today" in mine[0]["text"]
    assert any(c["payload"]["kind"] == "channel" for c in flow)


MAIL_TIPS_OOO = {"value": [{"emailAddress": {"name": "Sofia", "address": "Sofia.Rivera@innowi.com"},
                            "automaticReplies": {"message": "<p>On leave until Friday.</p>",
                                                 "scheduledStartTime": {"dateTime": "2026-01-01T00:00:00.0000000", "timeZone": "UTC"},
                                                 "scheduledEndTime": {"dateTime": "2099-01-01T00:00:00.0000000", "timeZone": "UTC"}}}]}
MAIL_TIPS_IN = {"value": [{"emailAddress": {"address": "jai.patel@innowi.com"}, "automaticReplies": {"message": ""}}]}


def test_availability_flow(ctx, flow):
    client, seeded, headers = ctx
    _set_ms_email(client, headers, "sofia", "sofia.rivera@innowi.com")
    _set_ms_email(client, headers, "jai", "jai.patel@innowi.com")
    # The flow's endpoints need the secret.
    assert client.get("/api/v1/integrations/teams/people").status_code == 401
    assert client.get("/api/v1/integrations/teams/people", headers={"x-superapp-key": "nope"}).status_code == 401
    ppl = client.get("/api/v1/integrations/teams/people", headers={"x-superapp-key": SECRET}).json()
    assert "sofia.rivera@innowi.com" in ppl["emails"] and "jai.patel@innowi.com" in ppl["emails"]

    now = dt.datetime.now(dt.timezone.utc)
    fmt = lambda t: {"dateTime": t.strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "UTC"}  # noqa: E731
    schedule = {"value": [{"scheduleId": "jai.patel@innowi.com", "availabilityView": "2200", "scheduleItems": [
        {"status": "busy", "start": fmt(now - dt.timedelta(minutes=10)), "end": fmt(now + dt.timedelta(minutes=50))},
        {"status": "tentative", "start": fmt(now + dt.timedelta(hours=3)), "end": fmt(now + dt.timedelta(hours=4))},
        {"status": "free", "start": fmt(now + dt.timedelta(hours=5)), "end": fmt(now + dt.timedelta(hours=6))},
    ]}]}
    body = {"people": [{"email": "sofia.rivera@innowi.com", "mailTips": MAIL_TIPS_OOO},
                       {"email": "jai.patel@innowi.com", "mailTips": MAIL_TIPS_IN}], "schedule": schedule}
    r = client.post("/api/v1/integrations/teams/availability", json=body, headers={"x-superapp-key": SECRET})
    assert r.status_code == 200 and r.json()["onLeave"] >= 1, r.text

    av = client.get("/api/v1/ops/teams/availability", headers=headers("aima")).json()
    assert av["stale"] is False and av["hasSchedule"] is True
    by = {p["email"]: p for p in av["people"]}
    sofia, jai = by["sofia.rivera@innowi.com"], by["jai.patel@innowi.com"]
    assert sofia["onLeave"] is True and sofia["leaveMessage"] == "On leave until Friday." and sofia["known"] is True
    assert jai["onLeave"] is False and jai["busyNow"] is True
    assert [b["status"] for b in jai["nextBusy"]] == ["busy", "tentative"]  # "free" dropped
    assert av["people"][0]["onLeave"] is True  # people on leave first


def test_availability_parse_shapes():
    from app.modules.ops.availability import parse

    # Mail tips without the "value" wrapper, a bare list, and junk are all accepted.
    out = parse({"people": [
        {"email": "a@x.com", "mailTips": {"emailAddress": {"address": "a@x.com"}, "automaticReplies": {"message": "Away"}}},
        {"email": "b@x.com", "mailTips": [{"automaticReplies": {"message": "Out"}}]},
        {"email": "c@x.com", "mailTips": None},
        "junk",
    ]})
    assert out["a@x.com"]["onLeave"] and out["b@x.com"]["onLeave"] and not out["c@x.com"]["onLeave"]


def test_calendar_flags_and_no_override_endpoint(ctx, flow):
    client, seeded, headers = ctx
    uid = seeded["jai"][0]
    url = f"/api/v1/ops/teams/people/{uid}/microsoft-email"
    assert client.post(url, json={"email": "x@innowi.com"}, headers=headers("admin")).status_code in (404, 405)

    now = dt.datetime.now(dt.timezone.utc)
    fmt = lambda t: {"dateTime": t.strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "UTC"}  # noqa: E731
    body = {"people": [{"email": "jai.patel@innowi.com", "mailTips": MAIL_TIPS_IN}],
            "schedule": {"value": [
                {"scheduleId": "jai.patel@innowi.com", "scheduleItems": [
                    {"status": "busy", "start": fmt(now - dt.timedelta(minutes=1)), "end": fmt(now + dt.timedelta(minutes=1))}]},
                {"scheduleId": "sofia.rivera@innowi.com", "error": {"responseCode": "ErrorMailboxNotFound"}},
            ]}}
    assert client.post("/api/v1/integrations/teams/availability", json=body, headers={"x-superapp-key": SECRET}).status_code == 200
    by = {p["id"]: p for p in client.get("/api/v1/ops/teams/availability", headers=headers("aima")).json()["people"]}
    jai = by[uid]
    assert jai["hasCalendar"] is True and len(jai["today"]) == 1 and jai["role"]
    assert by[seeded["sofia"][0]]["hasCalendar"] is False


def test_calendar_meetings_busy_and_leave(ctx, flow):
    client, seeded, headers = ctx
    key = _create(client, seeded, headers).json()["key"]
    now = dt.datetime.now(dt.timezone.utc)
    start = (now + dt.timedelta(days=1)).replace(hour=6, minute=0, second=0, microsecond=0)
    body = {"subject": f"{key} kickoff", "start": start.isoformat(), "durationMinutes": 30,
            "attendeeIds": [seeded["jai"][0]], "ticketKey": key}
    assert client.post("/api/v1/ops/teams/meeting", json=body, headers=headers("aima")).json()["ok"] is True

    fmt = lambda t: {"dateTime": t.strftime("%Y-%m-%dT%H:%M:%S.0000000"), "timeZone": "UTC"}  # noqa: E731
    end = start + dt.timedelta(minutes=30)
    later = start + dt.timedelta(hours=2)
    sync = lambda items: {"people": [  # noqa: E731
        {"email": "sofia.rivera@innowi.com", "mailTips": MAIL_TIPS_OOO},
        {"email": "jai.patel@innowi.com", "mailTips": MAIL_TIPS_IN}],
        "schedule": {"value": [{"scheduleId": "jai.patel@innowi.com", "scheduleItems": items}]}}
    past = now - dt.timedelta(hours=3)
    items = [
        {"status": "busy", "start": fmt(start), "end": fmt(end), "subject": f"{key} kickoff"},  # same as booked
        {"status": "busy", "start": fmt(later), "end": fmt(later + dt.timedelta(hours=1)),
         "subject": "Merchant call", "location": "Teams"},
        {"status": "tentative", "start": fmt(past), "end": fmt(past + dt.timedelta(minutes=30))},
        {"status": "busy", "start": fmt(later), "end": fmt(later + dt.timedelta(hours=1)),
         "subject": "Secret", "isPrivate": True},
    ]
    k = {"x-superapp-key": SECRET}
    assert client.post("/api/v1/integrations/teams/availability", json=sync(items), headers=k).status_code == 200
    # Next sync no longer has the past block: it must be kept as history.
    assert client.post("/api/v1/integrations/teams/availability", json=sync(items[:2]), headers=k).status_code == 200

    lo, hi = (now - dt.timedelta(days=2)).date(), (now + dt.timedelta(days=3)).date()
    cal = client.get(f"/api/v1/ops/teams/calendar?start={lo}&end={hi}", headers=headers("aima")).json()
    ev = cal["events"]
    booked = [e for e in ev if e["kind"] == "meeting" and e["ticketKey"] == key]
    assert len(booked) == 1 and {p["email"] for p in booked[0]["people"]} >= {"jai.patel@innowi.com"}
    assert not [e for e in ev if e["kind"] == "busy" and e["title"] == f"{key} kickoff"]  # deduped
    call = [e for e in ev if e["title"] == "Merchant call"]
    assert call and call[0]["location"] == "Teams" and call[0]["people"][0]["name"].startswith("Jai")
    assert [e for e in ev if e["title"] == "Tentative"], "past block kept"
    assert not [e for e in ev if e["title"] == "Secret"]
    leave = [e for e in ev if e["kind"] == "leave" and e["people"][0]["email"] == "sofia.rivera@innowi.com"]
    assert leave and leave[0]["day"]
    # Only mine (Jai): his meetings, not Sofia's leave.
    mine = client.get(f"/api/v1/ops/teams/calendar?start={lo}&end={hi}&mine=true", headers=headers("jai")).json()["events"]
    assert mine and all(any(p["email"] == "jai.patel@innowi.com" for p in e["people"]) for e in mine)
    assert client.get(f"/api/v1/ops/teams/calendar?start={hi}&end={lo}", headers=headers("aima")).status_code == 400
