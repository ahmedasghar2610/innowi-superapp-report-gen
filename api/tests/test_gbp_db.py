"""GBP end to end against a real Postgres with Google mocked (httpx.MockTransport):
connect callback → sync → overview / report → notes → merchant link.

Needs OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")

TODAY = dt.date.today()
TAG = uuid.uuid4().hex[:6]
LOC_A = f"locations/a{TAG}"
LOC_B = f"locations/b{TAG}"


def google_mock(calls: list[str], fail_metrics_for: str | None = None, revoke_token: bool = False):
    """A fake Google: one account, two listings."""

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        calls.append(f"{req.method} {url.split('?')[0]}")
        if url.startswith("https://oauth2.googleapis.com/token"):
            form = parse_qs(req.content.decode())
            if revoke_token and form.get("grant_type") == ["refresh_token"]:
                return httpx.Response(400, json={"error": "invalid_grant"})
            if form.get("grant_type") == ["authorization_code"]:
                return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt-secret", "scope": "https://www.googleapis.com/auth/business.manage openid email"})
            return httpx.Response(200, json={"access_token": "at2"})
        if url.startswith("https://openidconnect.googleapis.com/v1/userinfo"):
            return httpx.Response(200, json={"email": "listings@innowi.test"})
        if req.headers.get("authorization") not in ("Bearer at", "Bearer at2"):
            return httpx.Response(401, json={"error": {"message": "no"}})
        if url.startswith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts"):
            return httpx.Response(200, json={"accounts": [{"name": "accounts/77"}]})
        if "/accounts/77/locations?" in url or url.endswith("/accounts/77/locations"):
            return httpx.Response(200, json={"locations": [
                {"name": LOC_A, "title": f"Zyka Indian Fusion {TAG}", "storeCode": "SC1", "phoneNumbers": {"primaryPhone": "(510) 555-0199"},
                 "storefrontAddress": {"addressLines": ["47890 Warm Springs Blvd"], "locality": "Fremont", "administrativeArea": "CA"},
                 "categories": {"primaryCategory": {"displayName": "Indian restaurant"}}, "websiteUri": "https://zyka.example", "openInfo": {"status": "OPEN"}},
                {"name": LOC_B, "title": f"Who Made This BBQ {TAG}", "openInfo": {"status": "OPEN"}},
            ]})
        loc = LOC_A if LOC_A in url else LOC_B
        if url.endswith("/VoiceOfMerchantState"):
            return httpx.Response(200, json={"hasVoiceOfMerchant": True} if loc == LOC_A else {"verify": {}})
        if url.endswith("/attributes"):
            return httpx.Response(200, json={"attributes": [{"name": "attributes/url_menu", "uriValues": [{"uri": "https://zyka.example/menu"}]}]})
        if "/media" in url:
            return httpx.Response(403, json={"error": {"message": "Google My Business API has not been used in project 1 before or it is disabled."}})
        if ":fetchMultiDailyMetricsTimeSeries" in url:
            if fail_metrics_for == loc:
                return httpx.Response(404, json={"error": {"message": "not found"}})
            q = parse_qs(urlparse(url).query)
            start = dt.date(int(q["dailyRange.start_date.year"][0]), int(q["dailyRange.start_date.month"][0]), int(q["dailyRange.start_date.day"][0]))
            series = []
            for metric, base in (("CALL_CLICKS", 2), ("WEBSITE_CLICKS", 5), ("BUSINESS_IMPRESSIONS_MOBILE_MAPS", 40)):
                vals = []
                d = start
                while d <= TODAY:
                    e = {"date": {"year": d.year, "month": d.month, "day": d.day}}
                    if d <= TODAY - dt.timedelta(days=3):
                        e["value"] = str(base)
                    vals.append(e)
                    d += dt.timedelta(days=1)
                series.append({"dailyMetric": metric, "timeSeries": {"datedValues": vals}})
            return httpx.Response(200, json={"multiDailyMetricTimeSeries": [{"dailyMetricTimeSeries": series}]})
        if "/searchkeywords/impressions/monthly" in url:
            return httpx.Response(200, json={"searchKeywordsCounts": [
                {"searchKeyword": "biryani near me", "insightsValue": {"value": "140"}},
                {"searchKeyword": "nihari", "insightsValue": {"threshold": "15"}},
            ]})
        if url.split("?")[0].endswith("/reviews"):
            now = dt.datetime.now(dt.timezone.utc)
            return httpx.Response(200, json={"averageRating": 4.4, "totalReviewCount": 212, "reviews": [
                {"name": f"{loc}/reviews/1", "starRating": "FIVE", "createTime": (now - dt.timedelta(days=5)).isoformat(), "updateTime": (now - dt.timedelta(days=5)).isoformat()},
                {"name": f"{loc}/reviews/2", "starRating": "TWO", "createTime": (now - dt.timedelta(days=6)).isoformat(), "reviewReply": {"comment": "Sorry!"}},
            ]})
        if url.split("?")[0].endswith("/localPosts"):
            return httpx.Response(200, json={"localPosts": [
                {"name": f"{loc}/localPosts/1", "topicType": "STANDARD", "summary": "Weekend special", "state": "LIVE", "createTime": "2026-01-01T00:00:00Z"},
                {"name": f"{loc}/localPosts/2", "topicType": "OFFER", "summary": "10% off", "state": "LIVE", "createTime": "2026-01-02T00:00:00Z", "offer": {"couponCode": "TEN"}},
            ]})
        return httpx.Response(404, json={"error": {"message": f"unmocked {url}"}})

    return httpx.MockTransport(handler)


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
    old = (s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET)
    s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET = "cid", "csecret"

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET = old
    engine.sync_engine.dispose(close=False)


def _run_sync(transport: httpx.MockTransport) -> dict:
    """Run a sync to completion in its own loop/engine (as the background task would)."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.gbp import GbpSyncRun
    from app.modules.gbp import sync

    async def go():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        S = async_sessionmaker(eng, expire_on_commit=False)
        async with S() as db:
            for r in (await db.execute(__import__("sqlalchemy").select(GbpSyncRun).where(GbpSyncRun.status == "running"))).scalars():
                r.status = "failed"
            await db.commit()
            run = await sync.create_run(db, "manual", None)
            async with httpx.AsyncClient(transport=transport) as http:
                run = await sync.run_sync(db, run.id, http=http, today=TODAY)
            out = {"status": run.status, "locations": run.locations, "failed": run.locations_failed, "days": run.metric_days, "reviews": run.reviews, "error": run.error}
        await eng.dispose()
        return out

    return asyncio.run(go())


def test_permissions_and_status(ctx):
    client, seeded, h = ctx
    r = client.get("/api/v1/gbp/status", headers=h("sofia"))
    assert r.status_code == 200 and r.json()["canManage"] is False
    assert client.post("/api/v1/gbp/connect", headers=h("sofia")).status_code == 403
    assert client.post("/api/v1/gbp/sync", headers=h("sofia")).status_code == 403
    assert client.get("/api/v1/gbp/overview").status_code == 401
    r = client.post("/api/v1/gbp/connect", headers=h("aima"))
    assert r.status_code == 200
    q = parse_qs(urlparse(r.json()["url"]).query)
    assert q["client_id"] == ["cid"] and q["state"][0]


def test_callback_rejects_bad_state_and_non_managers(ctx):
    client, seeded, h = ctx
    from app.modules.gbp import connection

    r = client.get("/api/v1/integrations/gbp/callback?code=x&state=forged", follow_redirects=False)
    assert r.status_code in (302, 307) and "gbp=error" in r.headers["location"]
    st = connection.make_state(seeded["sofia"][0])  # an executive can't connect
    r = client.get(f"/api/v1/integrations/gbp/callback?code=x&state={st}", follow_redirects=False)
    assert "gbp=error" in r.headers["location"] and "managers" in r.headers["location"]
    r = client.get("/api/v1/integrations/gbp/callback?error=access_denied", follow_redirects=False)
    assert "cancelled" in r.headers["location"]
    # Started from Settings → Integrations → the browser goes back there.
    st = connection.make_state(seeded["sofia"][0], "settings")
    r = client.get(f"/api/v1/integrations/gbp/callback?error=access_denied&state={st}", follow_redirects=False)
    assert "/settings/integrations?gbp=error" in r.headers["location"]
    assert client.post("/api/v1/gbp/connect?returnTo=elsewhere", headers=h("aima")).status_code in (400, 422)


def test_connect_sync_and_reports(ctx, monkeypatch):
    client, seeded, h = ctx
    from app.modules.gbp import connection, router, sync

    calls: list[str] = []
    transport = google_mock(calls, fail_metrics_for=LOC_B)
    monkeypatch.setattr(router, "_http", lambda: httpx.AsyncClient(transport=transport))
    started: list[str] = []
    async def fake_start(run_id):  # start_background is async (it may run the sync inline)
        started.append(run_id)

    monkeypatch.setattr(sync, "start_background", fake_start)

    st = connection.make_state(seeded["aima"][0])
    r = client.get(f"/api/v1/integrations/gbp/callback?code=good&state={st}", follow_redirects=False)
    assert r.headers["location"].endswith("/web/gbp?gbp=connected"), r.headers["location"]
    assert started, "a first sync is queued right after connecting"

    status = client.get("/api/v1/gbp/status", headers=h("aima")).json()
    assert status["connected"] and status["connection"]["email"] == "listings@innowi.test"
    assert "rt-secret" not in json.dumps(status)

    # the queued run is replaced by a direct, awaited one
    asyncio.run(_mark_runs_done())
    res = _run_sync(transport)
    assert res["status"] == "partial", res  # LOC_B's metrics 404
    assert res["locations"] >= 2 and res["failed"] >= 1 and res["days"] > 300 and res["reviews"] >= 2

    ov = client.get("/api/v1/gbp/overview", headers=h("sofia")).json()
    assert ov["dataThrough"] == (TODAY - dt.timedelta(days=3)).isoformat()
    rows = {r["title"]: r for r in ov["rows"]}
    a, b = rows[f"Zyka Indian Fusion {TAG}"], rows[f"Who Made This BBQ {TAG}"]
    assert a["syncState"] == "ok" and a["calls"] == 60 and a["website"] == 150 and a["total"] == 210 and a["views"] == 1200
    assert a["totalReviews"] == 212 and a["rating"] == 4.4
    assert b["syncState"] == "failed" and b["hasData"] is False and b["calls"] is None
    flags = {f["location"]["title"]: {x["code"] for x in f["flags"]} for f in ov["attention"]}
    assert {"sync_failed", "verification_required"} <= flags[f"Who Made This BBQ {TAG}"]
    # one unanswered review is below the flag threshold (reports.UNANSWERED_FLAG_MIN)
    assert "unanswered_reviews" not in flags.get(f"Zyka Indian Fusion {TAG}", set())
    assert rep_unanswered(client, h, a["id"]) == 1

    rep = client.get(f"/api/v1/gbp/locations/{a['id']}/report", headers=h("sofia")).json()
    assert rep["kpis"]["calls"]["current"] == 60 and rep["kpis"]["calls"]["change"] == {"kind": "pct", "value": 0}
    assert rep["visibility"]["maps"]["current"] == 1200 and rep["visibility"]["mobile"] == 1200
    assert len(rep["series"]) == 30 and rep["missingDays"] == 0
    assert rep["keywords"]["rows"][0] == {
        "keyword": "biryani near me", "impressions": 140, "threshold": None, "previous": 140, "previousThreshold": None, "change": {"kind": "pct", "value": 0}
    }
    assert rep["keywords"]["rows"][1]["threshold"] == 15
    assert rep["posts"]["total"] == 1 and rep["posts"]["offers"][0]["coupon"] == "TEN"
    assert rep["location"]["verification"] == "verified" and rep["location"]["menuUrl"] == "https://zyka.example/menu"
    assert "Photos" in (rep["location"]["syncWarning"] or "")  # media API disabled → warning, not failure
    assert {f["key"] for f in rep["profile"]["fields"] if not f["done"]} >= {"photos", "logoCover", "description"}

    # A range before any data → no data, not zeros.
    old = client.get(f"/api/v1/gbp/locations/{a['id']}/report?start=2020-01-01&end=2020-01-31", headers=h("sofia")).json()
    assert old["kpis"]["calls"]["current"] is None and old["daysWithData"] == 0
    assert client.get("/api/v1/gbp/overview?start=2026-02-01&end=2026-01-01", headers=h("sofia")).status_code == 400

    # Second sync only asks for recent days.
    calls.clear()
    res2 = _run_sync(transport)
    assert res2["days"] < 30


def rep_unanswered(client, h, lid) -> int:
    return client.get(f"/api/v1/gbp/locations/{lid}/report", headers=h("sofia")).json()["reviews"]["unansweredInRange"]


async def _mark_runs_done():
    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.config import to_asyncpg_url
    from app.models.gbp import GbpSyncRun

    eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
    async with eng.begin() as c:
        await c.execute(update(GbpSyncRun).where(GbpSyncRun.status == "running").values(status="failed"))
    await eng.dispose()


def test_revoked_token_marks_connection(ctx):
    res = _run_sync(google_mock([], revoke_token=True))
    assert res["status"] == "failed" and "Connect" in res["error"]
    client, seeded, h = ctx
    st = client.get("/api/v1/gbp/status", headers=h("aima")).json()
    assert st["connected"] is False and st["connection"]["status"] == "error"


def test_notes_and_merchant_link(ctx):
    client, seeded, h = ctx
    ov = client.get("/api/v1/gbp/overview", headers=h("sofia")).json()
    lid = next(r["id"] for r in ov["rows"] if r["title"] == f"Zyka Indian Fusion {TAG}")

    n = client.post(f"/api/v1/gbp/locations/{lid}/notes", json={"body": "Menu link updated"}, headers=h("sofia"))
    assert n.status_code == 201 and n.json()["author"]["name"] == "Sofia Rivera"
    nid = n.json()["id"]
    assert client.patch(f"/api/v1/gbp/notes/{nid}", json={"body": "nope"}, headers=h("jai")).status_code == 403
    e = client.patch(f"/api/v1/gbp/notes/{nid}", json={"body": "Menu link updated mid-month"}, headers=h("sofia")).json()
    assert e["edited"] is True
    assert client.post(f"/api/v1/gbp/locations/{lid}/notes", json={"body": "x", "author": "y"}, headers=h("sofia")).status_code in (400, 422)
    assert client.delete(f"/api/v1/gbp/notes/{nid}", headers=h("aima")).status_code == 204  # managers can tidy up

    mid = seeded["merchant"]
    assert client.put(f"/api/v1/gbp/locations/{lid}/merchant", json={"merchantId": mid}, headers=h("sofia")).status_code == 403
    r = client.put(f"/api/v1/gbp/locations/{lid}/merchant", json={"merchantId": mid}, headers=h("aima"))
    assert r.status_code == 200 and r.json()["merchant"]["id"] == mid
    ml = client.get(f"/api/v1/merchants/{mid}/gbp", headers=h("sofia")).json()
    assert [x["id"] for x in ml["data"]] == [lid] and ml["data"][0]["total"] is not None
    assert client.get(f"/api/v1/gbp/locations/{lid}/merchant-suggestions", headers=h("sofia")).status_code == 200
    assert client.delete(f"/api/v1/gbp/locations/{lid}/merchant", headers=h("aima")).json()["merchantId"] is None


def test_scheduler_starts_daily_run_once(ctx, monkeypatch):
    """Connected + no run since today's slot → the tick starts a run; a second tick doesn't."""
    from app.modules.gbp import scheduler, sync

    started: list[str] = []

    async def fake_run(run_id, http=None):
        started.append(run_id)
        from app.db.session import SessionLocal
        from app.models.gbp import GbpSyncRun

        async with SessionLocal() as db:
            r = await db.get(GbpSyncRun, run_id)
            r.status = "success"
            await db.commit()

    monkeypatch.setattr(sync, "run_in_new_session", fake_run)
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "GBP_AUTO_SYNC", True)  # the test env may switch the daily sync off

    async def go():
        from sqlalchemy import delete, update

        from app.db.session import SessionLocal, engine
        from app.models.gbp import GbpConnection, GbpSyncRun

        engine.sync_engine.dispose(close=False)  # pool connections belong to the TestClient's loop
        async with SessionLocal() as db:
            await db.execute(update(GbpConnection).values(status="connected", last_error=None))
            await db.execute(delete(GbpSyncRun))  # no run since today's slot → due
            await db.commit()
        first = await scheduler.tick()
        second = await scheduler.tick()
        engine.sync_engine.dispose(close=False)
        return first, second

    first, second = asyncio.run(go())
    assert first and started == [first]
    assert second is None


def test_sample_data_endpoints(ctx):
    client, seeded, h = ctx
    assert client.post("/api/v1/gbp/sample-data", headers=h("sofia")).status_code == 403
    # Real listings are synced in this database → sample data is refused.
    r = client.post("/api/v1/gbp/sample-data", headers=h("aima"))
    assert r.status_code == 409, r.text
    assert client.get("/api/v1/gbp/status", headers=h("aima")).json()["autoSync"]["hour"] == 6
