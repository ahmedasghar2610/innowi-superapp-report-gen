"""SEO end to end against a real Postgres with Google, PageSpeed and
the client websites mocked (httpx.MockTransport): connect callback → sync →
Command / scorecard / pages → findings workflow → re-sync verification →
reports (generate, sign off, send) → KPI Studio → compare.

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
DOM_A = f"olive{TAG}.com"
DOM_B = f"kabob{TAG}.us"


def html(title: str, *, noindex: bool = False, schema: bool = True) -> str:
    ld = '<script type="application/ld+json">{"@type":"Restaurant","name":"x"}</script>' if schema else ""
    robots = '<meta name="robots" content="noindex">' if noindex else ""
    return (f"<html><head><title>{title}</title><meta name='description' content='Fresh food daily.'>{robots}{ld}</head>"
            f"<body><h1>Welcome</h1><p>{'word ' * 300}</p></body></html>")


def mock(state: dict):
    """`state` toggles: menu_noindex, ga4_dead (no rows for the last days)."""

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url.startswith("https://oauth2.googleapis.com/token"):
            form = parse_qs(req.content.decode())
            if form.get("grant_type") == ["authorization_code"]:
                return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt-seo-secret",
                                                 "scope": "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly openid email"})
            return httpx.Response(200, json={"access_token": "at"})
        if url.startswith("https://openidconnect.googleapis.com/v1/userinfo"):
            return httpx.Response(200, json={"email": "seo@innowi.test"})
        if url.startswith("https://www.googleapis.com/pagespeedonline"):
            return httpx.Response(200, json={"lighthouseResult": {"categories": {"performance": {"score": 0.38}}, "audits": {}}, "loadingExperience": {}})
        if f"//{DOM_A}" in url or f"//www.{DOM_A}" in url:
            path = urlparse(url).path
            if path == "/menu/gone/":
                return httpx.Response(404, text="nope")
            return httpx.Response(200, text=html(f"Olive {path}", noindex=(path == "/menu/" and state.get("menu_noindex", True))), headers={"content-type": "text/html"})
        if f"//{DOM_B}" in url:
            return httpx.Response(200, text=html("Kabob", schema=False), headers={"content-type": "text/html"})
        if req.headers.get("authorization") != "Bearer at":
            return httpx.Response(401, json={"error": {"message": "no"}})
        if url == "https://www.googleapis.com/webmasters/v3/sites":
            return httpx.Response(200, json={"siteEntry": [
                {"siteUrl": f"sc-domain:{DOM_A}", "permissionLevel": "siteOwner"},
                {"siteUrl": f"https://{DOM_B}/", "permissionLevel": "siteFullUser"},
                {"siteUrl": f"https://unverified{TAG}.com/", "permissionLevel": "siteUnverifiedUser"},
            ]})
        if "/searchAnalytics/query" in url:
            body = json.loads(req.content)
            dim = body["dimensions"][0]
            a = DOM_A in url
            if dim == "date":
                start, end = dt.date.fromisoformat(body["startDate"]), dt.date.fromisoformat(body["endDate"])
                rows, d = [], start
                while d <= end - dt.timedelta(days=2):
                    clicks = 20 if a else 5
                    rows.append({"keys": [d.isoformat()], "clicks": clicks, "impressions": clicks * 30, "position": 7.5})
                    d += dt.timedelta(days=1)
                return httpx.Response(200, json={"rows": rows})
            if dim == "query" and body.get("dimensionFilterGroups"):  # one tracked keyword outside the top terms
                kw = body["dimensionFilterGroups"][0]["filters"][0]["expression"]
                return httpx.Response(200, json={"rows": [{"keys": [kw], "clicks": 4, "impressions": 90, "position": 12.4}] if kw == "olive catering" else []})
            if dim == "query":
                return httpx.Response(200, json={"rows": [{"keys": ["olive near me"], "clicks": 300, "impressions": 4000, "position": 3.2},
                                                          {"keys": ["best mediterranean food"], "clicks": 50, "impressions": 2000, "position": 9.1}]})
            if dim == "device":
                return httpx.Response(200, json={"rows": [{"keys": ["MOBILE"], "clicks": 280, "impressions": 5200, "position": 6.1},
                                                          {"keys": ["DESKTOP"], "clicks": 60, "impressions": 700, "position": 4.2}]})
            if dim == "country":
                return httpx.Response(200, json={"rows": [{"keys": ["usa"], "clicks": 330, "impressions": 5600, "position": 5.8},
                                                          {"keys": ["ind"], "clicks": 10, "impressions": 300, "position": 9.0}]})
            if dim == "page":
                site = f"https://www.{DOM_A}" if a else f"https://{DOM_B}"
                return httpx.Response(200, json={"rows": [{"keys": [f"{site}/"], "clicks": 200, "impressions": 3000, "position": 4},
                                                          {"keys": [f"{site}/menu/"], "clicks": 90, "impressions": 2000, "position": 6},
                                                          {"keys": [f"{site}/menu/gone/"], "clicks": 30, "impressions": 500, "position": 8}]})
        if url.startswith("https://searchconsole.googleapis.com/v1/urlInspection"):
            return httpx.Response(200, json={"inspectionResult": {"indexStatusResult": {"verdict": "PASS", "coverageState": "Submitted and indexed"}}})
        if url.startswith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries"):
            return httpx.Response(200, json={"accountSummaries": [{"displayName": "Innowi", "propertySummaries": [{"property": "properties/111", "displayName": "Olive web"}]}]})
        if url.startswith("https://analyticsadmin.googleapis.com/v1beta/properties/111/dataStreams"):
            return httpx.Response(200, json={"dataStreams": [{"type": "WEB_DATA_STREAM", "webStreamData": {"defaultUri": f"https://www.{DOM_A}"}}]})
        if url.startswith("https://analyticsdata.googleapis.com/v1beta/properties/111:runReport"):
            body = json.loads(req.content)
            start, end = dt.date.fromisoformat(body["dateRanges"][0]["startDate"]), dt.date.fromisoformat(body["dateRanges"][0]["endDate"])
            rows, d = [], start
            while d <= end:
                if not (state.get("ga4_dead") and (end - d).days < 4):
                    rows.append({"dimensionValues": [{"value": d.strftime("%Y%m%d")}, {"value": "Organic Search"}],
                                 "metricValues": [{"value": "30"}, {"value": "25"}, {"value": "15"}, {"value": "2"}]})
                d += dt.timedelta(days=1)
            return httpx.Response(200, json={"rows": rows})
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
    old = (s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET, s.PAGESPEED_API_KEY)
    s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET = "cid", "csecret"
    s.PAGESPEED_API_KEY = "psi-key"

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    (s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET, s.PAGESPEED_API_KEY) = old
    engine.sync_engine.dispose(close=False)


def _run_sync(transport: httpx.MockTransport) -> dict:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.seo import SeoSyncRun
    from app.modules.seo import sync

    async def go():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        S = async_sessionmaker(eng, expire_on_commit=False, autoflush=False)
        async with S() as db:
            for r in (await db.execute(select(SeoSyncRun).where(SeoSyncRun.status == "running"))).scalars():
                r.status = "failed"
            await db.commit()
            run = await sync.create_run(db, "manual", None)
            async with httpx.AsyncClient(transport=transport) as http:
                run = await sync.run_sync(db, run.id, http=http, today=TODAY)
            out = {"status": run.status, "sites": run.sites, "failed": run.sites_failed, "days": run.gsc_days, "pages": run.pages_checked,
                   "error": run.error}
        await eng.dispose()
        return out

    return asyncio.run(go())


def _site(client, h, domain):
    return next(r for r in client.get("/api/v1/seo/overview", headers=h).json()["rows"] if r["domain"] == domain)


def test_permissions_and_callback(ctx):
    client, seeded, h = ctx
    from app.modules.gbp import connection as gbp_conn
    from app.modules.seo import connection

    assert client.get("/api/v1/seo/overview").status_code == 401
    st = client.get("/api/v1/seo/status", headers=h("sofia")).json()
    assert st["canManage"] is False and st["canApprove"] is False
    assert client.post("/api/v1/seo/connect", headers=h("sofia")).status_code == 403
    assert client.post("/api/v1/seo/sample-data", headers=h("sofia")).status_code == 403
    r = client.post("/api/v1/seo/connect", headers=h("aima"))
    assert r.status_code == 200
    q = parse_qs(urlparse(r.json()["url"]).query)
    assert "webmasters.readonly" in q["scope"][0] and "analytics.readonly" in q["scope"][0]
    r = client.get("/api/v1/integrations/seo/callback?code=x&state=forged", follow_redirects=False)
    assert "seo=error" in r.headers["location"]
    r = client.get(f"/api/v1/integrations/seo/callback?code=x&state={connection.make_state(seeded['sofia'][0])}", follow_redirects=False)
    assert "managers" in r.headers["location"]
    # a GBP state can't be replayed against the SEO callback
    r = client.get(f"/api/v1/integrations/seo/callback?code=x&state={gbp_conn.make_state(seeded['aima'][0])}", follow_redirects=False)
    assert "expired" in r.headers["location"]


def test_connect_sync_command_scorecard(ctx, monkeypatch):
    client, seeded, h = ctx
    from app.modules.seo import connection, router, sync

    transport = mock({})
    monkeypatch.setattr(router, "_http", lambda: httpx.AsyncClient(transport=transport))
    started: list[str] = []
    async def fake_start(run_id):  # start_background is async (it may run the sync inline)
        started.append(run_id)

    monkeypatch.setattr(sync, "start_background", fake_start)
    r = client.get(f"/api/v1/integrations/seo/callback?code=good&state={connection.make_state(seeded['aima'][0])}", follow_redirects=False)
    assert r.headers["location"].endswith("/web/seo?seo=connected"), r.headers["location"]
    assert started
    st = client.get("/api/v1/seo/status", headers=h("aima")).json()
    assert st["connected"] and st["connection"]["email"] == "seo@innowi.test"
    assert st["connection"]["scopes"] == {"searchConsole": True, "analytics": True, "gmail": False}
    assert "rt-seo-secret" not in json.dumps(st)

    out = _run_sync(transport)
    assert out["status"] == "success", out
    assert out["sites"] >= 2 and out["days"] > 600 and out["pages"] >= 5

    ov = client.get("/api/v1/seo/overview", headers=h("sofia")).json()
    a = next(r for r in ov["rows"] if r["domain"] == DOM_A)
    b = next(r for r in ov["rows"] if r["domain"] == DOM_B)
    assert not any(r["domain"] == f"unverified{TAG}.com" for r in ov["rows"])
    assert a["gscLinked"] and a["ga4Linked"] and not b["ga4Linked"]  # GA4 matched by stream host
    assert a["health"] is not None and a["grade"] in "ABCD" and len(a["spark"]) == 12
    assert a["s1"] >= 1  # /menu/gone/ answers 404 with clicks
    assert {s["key"] for s in ov["sources"]} >= {"gsc", "ga4", "pagespeed", "screamingfrog"}
    assert "serper" not in {s["key"] for s in ov["sources"]}

    d = client.get(f"/api/v1/seo/sites/{a['id']}", headers=h("sofia")).json()
    assert d["kpis"]["clicks"] == 20 * 28 and d["kpis"]["sessions"] > 0
    assert d["score"]["pillars"]["ls"]["score"] is None and d["score"]["pillars"]["ls"]["missing"]
    assert d["queries"]["rows"][0]["query"] == "olive near me"
    # Tracked keywords: seeded from the top Search Console terms, positions from Search Console (month vs month).
    kw = next(k for k in d["keywords"] if k["keyword"] == "olive near me")
    assert kw["position"] == 3.2 and kw["previous"] == 3.2 and kw["hasPrevious"] and kw["clicks"] == 300 and kw["source"] == "gsc"
    assert d["keywordMonths"]["month"] and d["kpis"]["rankingSearches"] == 2 and d["kpis"]["top10Searches"] == 2
    # PageSpeed: measured during the sync, and again on demand ("Check speed")
    assert d["sync"]["lastPsiAt"] and "lastRankAt" not in d["sync"]
    ps = client.post(f"/api/v1/seo/sites/{a['id']}/pagespeed", headers=h("aima"))
    assert ps.status_code == 200 and ps.json()["checked"] >= 1 and not ps.json()["errors"], ps.text
    assert client.post(f"/api/v1/seo/sites/{a['id']}/pagespeed", headers=h("sofia")).status_code == 403
    assert {"page_error", "noindex_page", "slow_mobile"} <= {f["code"] for f in d["findings"]}
    pages = client.get(f"/api/v1/seo/sites/{a['id']}/pages", headers=h("sofia")).json()
    gone = next(p for p in pages["rows"] if p["path"] == "/menu/gone/")
    assert gone["statusCode"] == 404 and gone["issues"][0]["severity"] == "S1"
    assert pages["rows"][0]["type"] == "home"
    kb = client.get(f"/api/v1/seo/sites/{b['id']}", headers=h("sofia")).json()
    codes = {f["code"] for f in kb["findings"]}
    assert "ga4_not_linked" in codes and "schema_missing" in codes


def test_findings_workflow_and_verification(ctx):
    client, seeded, h = ctx
    a = _site(client, h("aima"), DOM_A)
    lst = client.get(f"/api/v1/seo/findings?siteId={a['id']}", headers=h("sofia")).json()
    f = next(x for x in lst["data"] if x["code"] == "noindex_page")
    assert f["state"] == "recommended" and lst["counts"]["needsDecision"] >= 3
    fid = f["id"]
    # closing straight away needs a reason (dismiss) — not a silent close
    assert client.patch(f"/api/v1/seo/findings/{fid}", json={"state": "closed"}, headers=h("sofia")).status_code == 409
    r = client.patch(f"/api/v1/seo/findings/{fid}", json={"state": "task_created"}, headers=h("sofia"))
    assert r.status_code == 200 and r.json()["owner"]["id"] == seeded["sofia"][0]
    client.patch(f"/api/v1/seo/findings/{fid}", json={"state": "in_progress"}, headers=h("sofia"))
    r = client.patch(f"/api/v1/seo/findings/{fid}", json={"state": "awaiting_verification", "note": "Removed the tag"}, headers=h("sofia"))
    assert r.json()["state"] == "awaiting_verification" and "Removed the tag" in r.json()["note"]

    # the site still has noindex → the re-check sends it back to in progress
    _run_sync(mock({"menu_noindex": True}))
    f = next(x for x in client.get(f"/api/v1/seo/findings?siteId={a['id']}&group=in_flight", headers=h("sofia")).json()["data"] if x["id"] == fid)
    assert f["state"] == "in_progress" and "still detected" in f["note"]

    # fixed for real → awaiting verification → next sync verifies and closes it
    client.patch(f"/api/v1/seo/findings/{fid}", json={"state": "awaiting_verification"}, headers=h("sofia"))
    _run_sync(mock({"menu_noindex": False}))
    f = next(x for x in client.get(f"/api/v1/seo/findings?siteId={a['id']}&group=closed", headers=h("sofia")).json()["data"] if x["id"] == fid)
    assert f["state"] == "closed" and f["outcome"] == "fixed"


def test_tracking_alert(ctx):
    client, seeded, h = ctx
    _run_sync(mock({"menu_noindex": False, "ga4_dead": True}))
    a = _site(client, h("aima"), DOM_A)
    codes = {f["code"]: f for f in client.get(f"/api/v1/seo/findings?siteId={a['id']}", headers=h("sofia")).json()["data"]}
    assert codes["tracking_broken"]["severity"] == "S1" and "Google Search still sent" in codes["tracking_broken"]["detail"]
    wd = client.get("/api/v1/seo/watchdog", headers=h("sofia")).json()
    assert wd["counts"]["S1"] >= 2 and wd["data"][0]["severity"] == "S1"


def test_site_settings_and_keywords(ctx):
    client, seeded, h = ctx
    a = _site(client, h("aima"), DOM_A)
    assert client.patch(f"/api/v1/seo/sites/{a['id']}", json={"package": "299"}, headers=h("sofia")).status_code == 403
    r = client.patch(f"/api/v1/seo/sites/{a['id']}", json={"package": "299", "ownerId": seeded["sofia"][0], "reportRecipients": ["Owner@Olive-Cafe.com"],
                                                         "merchantId": seeded["merchant"]}, headers=h("aima"))
    assert r.status_code == 200 and r.json()["package"] == "299" and r.json()["reportRecipients"] == ["owner@olive-cafe.com"]
    assert client.patch(f"/api/v1/seo/sites/{a['id']}", json={"ga4Property": "nope"}, headers=h("aima")).status_code == 400
    # Recipients: the merchant's Owner / Marketing contacts (automatic) + the hand-written ones, no duplicates.
    m = seeded["merchant"]
    _exec(f"DELETE FROM profiling.contact WHERE merchant_id = '{m}'")
    _exec(f"INSERT INTO profiling.contact (id, merchant_id, name, role, email) VALUES "
          f"('seoc1{TAG}', '{m}', 'Omar', 'OWNER', 'Omar@Olive-Cafe.com'), "
          f"('seoc2{TAG}', '{m}', 'Billing', 'BILLING', 'billing@olive-cafe.com'), "
          f"('seoc3{TAG}', '{m}', 'Mona', 'MARKETING', 'owner@olive-cafe.com')")
    row = next(x for x in client.get("/api/v1/seo/sites", headers=h("aima")).json()["data"] if x["id"] == a["id"])
    assert [c["email"] for c in row["merchantRecipients"]] == ["omar@olive-cafe.com", "owner@olive-cafe.com"]
    assert row["merchantRecipients"][0]["role"] == "Owner" and row["reportRecipients"] == ["owner@olive-cafe.com"]
    assert row["allRecipients"] == ["omar@olive-cafe.com", "owner@olive-cafe.com"]  # billing excluded, duplicate merged
    _exec(f"DELETE FROM profiling.contact WHERE merchant_id = '{m}'")
    r = client.post(f"/api/v1/seo/sites/{a['id']}/keywords", json={"keyword": "Olive Catering"}, headers=h("aima"))
    assert r.status_code == 201
    assert client.post(f"/api/v1/seo/sites/{a['id']}/keywords", json={"keyword": "olive catering"}, headers=h("aima")).status_code == 409
    # Not among the site's top terms → the next sync asks Search Console for it by name.
    assert _run_sync(mock({}))["status"] in ("success", "partial")
    kw = client.get(f"/api/v1/seo/sites/{a['id']}/keywords", headers=h("aima")).json()
    row = next(k for k in kw["data"] if k["keyword"] == "olive catering")
    assert row["position"] == 12.4 and row["impressions"] == 90 and kw["month"] and "serper" not in kw
    assert client.delete(f"/api/v1/seo/keywords/{r.json()['id']}", headers=h("aima")).status_code == 204
    r = client.post("/api/v1/seo/sites", json={"domain": f"https://www.manual{TAG}.com/menu"}, headers=h("aima"))
    assert r.status_code == 201 and r.json()["domain"] == f"manual{TAG}.com"
    assert client.post("/api/v1/seo/sites", json={"domain": f"manual{TAG}.com"}, headers=h("aima")).status_code == 409
    assert client.delete(f"/api/v1/seo/sites/{a['id']}", headers=h("aima")).status_code == 409
    assert client.delete(f"/api/v1/seo/sites/{r.json()['id']}", headers=h("aima")).status_code == 204
    opts = client.get("/api/v1/seo/link-options?q=", headers=h("aima")).json()
    assert opts["ga4Properties"][0]["property"] == "properties/111" and opts["owners"]


def test_reports_signoff_send(ctx, monkeypatch):
    client, seeded, h = ctx
    a = _site(client, h("aima"), DOM_A)
    center = client.get("/api/v1/seo/reports/center?days=90", headers=h("sofia")).json()
    proj = next(p for p in center["projects"] if p["id"] == a["id"])
    rid = proj["due"]["reportId"]  # the sync already auto-assembled the due report
    assert rid and proj["due"]["reportStatus"] == "awaiting_signoff"
    rep = client.get(f"/api/v1/seo/reports/{rid}", headers=h("sofia")).json()
    snap = rep["snapshot"]
    assert snap["site"]["domain"] == DOM_A and snap["firstGlance"]["organicClicks"]["value"] > 0 and rep["auto"] is True
    assert snap["whatChanged"] and snap["queries"][0]["query"] == "olive near me"
    assert client.post(f"/api/v1/seo/reports/{rid}/sign-off", headers=h("sofia")).status_code == 403  # executives can't sign
    assert client.post(f"/api/v1/seo/reports/{rid}/send", json={"recipients": ["a@olive-cafe.com"]}, headers=h("aima")).status_code == 409  # unsigned never sends
    assert snap["nextSteps"] and "prevDailyClicks" in snap
    r = client.patch(f"/api/v1/seo/reports/{rid}/next-steps", json={"nextSteps": ["Fix the menu page.", " ", "Add schema."]}, headers=h("aima"))
    assert r.status_code == 200 and r.json()["snapshot"]["nextSteps"] == ["Fix the menu page.", "Add schema."]
    assert r.json()["snapshot"]["v2"]["recommendations"] == ["Fix the menu page.", "Add schema."]
    # New-format sections (report_v2): written summary, branded split, devices, countries, recommendations.
    v2 = snap["v2"]
    assert v2["version"] == 2 and v2["summary"] and not v2["summaryEdited"] and v2["recommendations"] and v2["dataNotes"]
    assert v2["brand"]["branded"]["clicks"] == 300 and v2["brand"]["generic"]["clicks"] == 50  # "olive near me" vs "best mediterranean food"
    assert [d["device"] for d in v2["devices"]] == ["Mobile", "Desktop"] and v2["countries"]["home"] == "United States"
    assert v2["months"] and v2["queries"][0]["query"] == "olive near me" and v2["alert"] is None
    r = client.patch(f"/api/v1/seo/reports/{rid}/summary", json={"paragraphs": ["Olive had a strong month.", " "]}, headers=h("aima"))
    assert r.status_code == 200 and r.json()["snapshot"]["v2"]["summary"] == ["Olive had a strong month."] and r.json()["snapshot"]["v2"]["summaryEdited"]
    assert client.patch(f"/api/v1/seo/reports/{rid}/summary", json={"paragraphs": ["x"]}, headers=h("sofia")).status_code == 403
    assert set(v2["notes"]) >= {"metrics", "brand", "queries", "pages", "devices", "geo", "crawl"} and v2["notesEdited"] == []
    r = client.patch(f"/api/v1/seo/reports/{rid}/summary", json={"section": "pages", "paragraphs": ["Homepage carries the site."]}, headers=h("aima"))
    v = r.json()["snapshot"]["v2"]
    assert r.status_code == 200 and v["notes"]["pages"] == ["Homepage carries the site."] and v["notesEdited"] == ["pages"]
    assert v["summary"] == ["Olive had a strong month."]  # section edit leaves the summary alone
    assert client.patch(f"/api/v1/seo/reports/{rid}/summary", json={"section": "bogus", "paragraphs": ["x"]}, headers=h("aima")).status_code == 409
    from app.modules.seo import client_reports as _cr

    assert "Executive Summary" in _cr.email_html(r.json()["snapshot"]) and "Olive had a strong month." in _cr.email_html(r.json()["snapshot"])
    r = client.post(f"/api/v1/seo/reports/{rid}/sign-off", headers=h("aima"))
    assert r.status_code == 200 and r.json()["status"] == "signed" and r.json()["signedBy"]["id"] == seeded["aima"][0]
    assert client.patch(f"/api/v1/seo/reports/{rid}/summary", json={"paragraphs": ["late edit"]}, headers=h("aima")).status_code == 409
    assert client.post(f"/api/v1/seo/sites/{a['id']}/reports", json={}, headers=h("aima")).status_code == 409  # signed is frozen
    r = client.post(f"/api/v1/seo/reports/{rid}/send", json={"recipients": ["owner@olive-cafe.com"]}, headers=h("aima"))
    assert r.status_code == 409 and "Send email on your behalf" in json.dumps(r.json())  # connected without gmail.send

    from app.modules.seo import client_reports

    st = client.get("/api/v1/seo/status", headers=h("aima")).json()["email"]
    assert st["state"] == "no_permission" and st["provider"] == "Gmail" and st["from"] == "seo@innowi.test" and not st["configured"]
    assert client.post("/api/v1/seo/email/test", json={}, headers=h("aima")).status_code == 409
    _exec("UPDATE marketing.seo_connection SET scopes = scopes || ' https://www.googleapis.com/auth/gmail.send'")
    sent: list[dict] = []
    real = httpx.AsyncClient

    def gmail(req: httpx.Request) -> httpx.Response:
        if str(req.url).startswith("https://oauth2.googleapis.com/token"):
            return httpx.Response(200, json={"access_token": "at"})
        assert str(req.url) == client_reports.GMAIL_SEND_URL and req.headers["authorization"] == "Bearer at"
        import base64
        from email import message_from_bytes
        m = message_from_bytes(base64.urlsafe_b64decode(json.loads(req.content)["raw"]))
        html_part = next(p for p in m.walk() if p.get_content_type() == "text/html")
        sent.append({"to": m["To"], "from": m["From"], "subject": m["Subject"], "html": html_part.get_payload(decode=True).decode()})
        return httpx.Response(200, json={"id": "msg_1"})

    monkeypatch.setattr(client_reports.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(gmail)))
    st = client.get("/api/v1/seo/status", headers=h("aima")).json()
    assert st["email"]["configured"] and st["connection"]["scopes"]["gmail"]
    assert client.post("/api/v1/seo/email/test", json={}, headers=h("sofia")).status_code == 403  # needs seo.approve
    t = client.post("/api/v1/seo/email/test", json={"to": "check@olive-cafe.com"}, headers=h("aima"))
    assert t.status_code == 200 and t.json() == {"sentTo": "check@olive-cafe.com", "from": "seo@innowi.test"}
    assert sent.pop()["to"] == "check@olive-cafe.com"
    r = client.post(f"/api/v1/seo/reports/{rid}/send", json={"recipients": ["owner@olive-cafe.com"]}, headers=h("aima"))
    assert r.status_code == 200 and r.json()["status"] == "sent" and r.json()["sentAt"]
    assert sent[0]["to"] == "owner@olive-cafe.com" and "seo@innowi.test" in sent[0]["from"] and DOM_A in sent[0]["html"]
    assert "Recommendations" in sent[0]["html"] and "Fix the menu page." in sent[0]["html"] and "digitally signed" in sent[0]["html"]
    assert client.patch(f"/api/v1/seo/reports/{rid}/next-steps", json={"nextSteps": ["x"]}, headers=h("aima")).status_code == 409  # frozen once signed
    r = client.post(f"/api/v1/seo/sites/{a['id']}/reports", json={"periodStart": (TODAY - dt.timedelta(days=60)).isoformat(),
                                                                   "periodEnd": (TODAY - dt.timedelta(days=31)).isoformat()}, headers=h("sofia"))
    assert r.status_code == 201 and r.json()["status"] == "awaiting_signoff" and r.json()["auto"] is False


def test_kpis_and_compare(ctx):
    client, seeded, h = ctx
    k = client.get("/api/v1/seo/kpis", headers=h("sofia")).json()
    assert [s["set"] for s in k["sets"]] == [1, 2, 3, 4]
    cp = next(x for x in k["sets"][0]["kpis"] if x["key"] == "K1-CP")
    assert cp["current"] and "avg" in cp["current"]["text"]
    original = cp["target"]
    assert next(x for x in k["sets"][1]["kpis"] if x["key"] == "K2-GATE")["current"]["tone"] == "hold"
    assert client.patch("/api/v1/seo/kpis/K1-CP", json={"target": "≥ 70"}, headers=h("sofia")).status_code == 403
    r = client.patch("/api/v1/seo/kpis/K1-CP", json={"target": "≥ 70", "status": "active"}, headers=h("aima"))
    assert r.status_code == 200 and r.json()["target"] == "≥ 70"
    client.patch("/api/v1/seo/kpis/K1-CP", json={"target": original, "status": "proposed"}, headers=h("aima"))
    r = client.post("/api/v1/seo/kpis", json={"set": 3, "name": "Reviews answered", "grader": "sla", "target": "48h", "source": "GBP"}, headers=h("aima"))
    assert r.status_code == 201 and r.json()["key"].startswith("K3-C")
    assert client.delete("/api/v1/seo/kpis/K1-CP", headers=h("aima")).status_code == 409
    assert client.delete(f"/api/v1/seo/kpis/{r.json()['key']}", headers=h("aima")).status_code == 204

    a, b = _site(client, h("aima"), DOM_A), _site(client, h("aima"), DOM_B)
    c = client.get(f"/api/v1/seo/compare?ids={a['id']},{b['id']}", headers=h("sofia")).json()
    assert [s["domain"] for s in c["sites"]] == [DOM_A, DOM_B] and c["sites"][0]["kpis"]["clicks"] > c["sites"][1]["kpis"]["clicks"]
    assert client.get(f"/api/v1/seo/compare?ids={a['id']}", headers=h("sofia")).status_code == 400
    assert client.post("/api/v1/seo/sample-data", headers=h("aima")).status_code == 409  # never next to real sites
    integ = client.get("/api/v1/settings/integrations", headers=h("aima")).json()["data"]
    assert any(x["key"] == "seo" and x["status"] == "connected" for x in integ)



def _exec(sql: str) -> None:
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.config import to_asyncpg_url

    async def go():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with eng.begin() as c:
            for stmt in sql.split(";"):
                if stmt.strip():
                    await c.execute(text(stmt))
        await eng.dispose()

    asyncio.run(go())


def test_sources_follow_gbp_and_ads_connections(ctx):
    """GBP / Ads pills on the SEO pages follow those modules' own Google connections,
    even when no SEO site is linked to a listing or account yet."""
    client, _, h = ctx
    pills = lambda: {p["key"]: p for p in client.get("/api/v1/seo/overview", headers=h("aima")).json()["sources"]}  # noqa: E731
    _exec("DELETE FROM marketing.gbp_connection; DELETE FROM marketing.ads_connection")
    assert pills()["gbp"]["state"] == "pending" and pills()["ads"]["state"] == "pending"
    _exec("INSERT INTO marketing.gbp_connection (id, google_email, refresh_token_encrypted, status, connected_at, created_at, updated_at) "
          "VALUES ('gbpc1', 'gbp@innowi.test', 'x', 'connected', now(), now(), now())")
    _exec("INSERT INTO marketing.ads_connection (id, google_email, refresh_token_encrypted, status, connected_at, created_at, updated_at) "
          "VALUES ('adsc1', 'ads@innowi.test', 'x', 'error', now(), now(), now())")
    try:
        p = pills()
        assert p["gbp"]["state"] == "connected" and "gbp@innowi.test" in p["gbp"]["detail"], p["gbp"]
        assert p["ads"]["state"] == "error", p["ads"]
    finally:
        _exec("DELETE FROM marketing.gbp_connection; DELETE FROM marketing.ads_connection")


def test_screaming_frog_import_and_remove(ctx, tmp_path):
    """A Screaming Frog export folder imports into the matching site, shows on the crawl endpoints,
    and --remove takes it all out again (only the seo_crawl* tables are touched)."""
    import asyncio
    import csv as _csv

    from app.modules.seo import sf_import

    client, seeded, h = ctx
    a = _site(client, h("aima"), DOM_A)
    base = f"https://www.{DOM_A}"

    def write(name: str, header: list[str], rows: list[list]) -> None:
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", newline="", encoding="utf-8") as f:
            w = _csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    write("internal_all.csv",
          ["Address", "Content Type", "Status Code", "Indexability", "Indexability Status", "Title 1", "Title 1 Length", "H1-1",
           "Word Count", "Crawl Depth", "Unique Inlinks", "Response Time", "Crawl Timestamp"],
          [[f"{base}/", "text/html; charset=UTF-8", "200", "Indexable", "", "Olive", "5", "", "300", "0", "10", "0.2", "2026-10-15 18:35:45"],
           [f"{base}/menu/", "text/html", "200", "Indexable", "", "Menu", "4", "Menu", "40", "1", "3", "0.4", "2026-10-15 18:35:50"],
           [f"{base}/old/", "text/html", "301", "Non-Indexable", "Redirected", "", "", "", "", "1", "1", "0.1", "2026-10-15 18:35:51"],
           [f"{base}/style.css", "text/css", "200", "Indexable", "", "", "", "", "", "1", "2", "0.05", "2026-10-15 18:35:52"]])
    write("issues_overview_report.csv", ["Issue Name", "Issue Type", "Issue Priority", "URLs", "% of Total", "Description", "How To Fix", "Help URL"],
          [["H1: Missing", "Issue", "Medium", "1", "33.3", "No h1.", "Add one.", "https://example.com/h1"],
           ["H2: Missing", "Warning", "Low", "2", "66.6", "No h2.", "Add one.", ""],
           ["Images: Over 100 kB", "Opportunity", "Medium", "0", "0", "Big images.", "Compress.", ""]])
    write("issues_reports/h1_missing.csv", ["Address", "Occurrences", "H1-1"], [[f"{base}/", "0", ""]])
    write("issues_reports/h2_missing.csv", ["Address", "Occurrences", "H2-1"], [[f"{base}/", "0", ""], [f"{base}/menu/", "0", ""]])
    write("issues_reports/response_codes_internal_redirection_(3xx)_inlinks.csv", ["Type", "Source", "Destination", "Anchor", "Status Code"],
          [["Hyperlink", f"{base}/", f"{base}/old/", "Old", "301"]])
    write("orphan_pages.csv", ["URL", "Source"], [[f"{base}/lost/", "Sitemap"]])
    write("link_metrics_all.csv", ["Address", "Moz Domain Authority", "Moz Root Domains Linking - Root Domain", "Moz External Links - Exact URL"],
          [[f"{base}/", "21", "64", "150"]])
    write("custom_extraction_all.csv", ["Address", "Status Code", "Status", "Phone 1", "Hours 1"],
          [[f"{base}/", "200", "OK", "tel:5105550199", "Daily 11am - 10pm"]])

    parsed = sf_import.parse(tmp_path)
    assert parsed.domain == DOM_A and parsed.totals["urls"] == 4 and parsed.totals["html"] == 3 and parsed.totals["redirects"] == 1
    assert parsed.totals["orphans"] == 1 and parsed.totals["avgWords"] == 170 and parsed.crawled_at is not None
    home = next(p for p in parsed.pages if p["path"] == "/")
    assert home["issues"] == ["h1missing", "h2missing"]  # Medium before Low; H1 and H2 never mix
    assert "responsecodesinternalredirection3xxinlinks.csv" not in parsed.unmatched_files

    async def run(fn):
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from app.config import to_asyncpg_url

        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        try:
            async with async_sessionmaker(eng, expire_on_commit=False)() as db:
                return await fn(db)
        finally:
            await eng.dispose()

    async def do_import(db):
        site = await sf_import.find_site(db, parsed.domain)
        return await sf_import.store(db, site, parsed, str(tmp_path))

    asyncio.run(run(do_import))

    async def rescore(db):  # what scripts/seo_import_sf.py does right after an import / --remove
        from app.modules.seo import data

        site = await sf_import.find_site(db, DOM_A)
        out = await data.recompute(db, site)
        await db.commit()
        return out

    asyncio.run(run(rescore))
    sd = client.get(f"/api/v1/seo/sites/{a['id']}", headers=h("sofia")).json()
    au = sd["score"]["pillars"]["au"]
    assert au["parts"][0]["label"] == "Pages with no errors (Screaming Frog)" and au["parts"][0]["value"] == "2 of 3", au
    assert "Whole-site crawl" in au["missing"]
    lm = sd["sfExtras"]["linkMetrics"]
    assert lm["provider"] == "Moz" and lm["authority"] == 21 and lm["referringDomains"] == 64 and lm["backlinks"] == 150
    assert sd["sfExtras"]["nap"]["extractors"] == ["Phone", "Hours"]
    crawl_f = [x for x in sd["findings"] if x["code"] == "sf_issue"]
    assert [x["title"] for x in crawl_f] == ["Crawl: H1: Missing"] and crawl_f[0]["severity"] == "S3"  # H2 Missing is a low warning
    from app.modules.seo import views as seo_views

    errs = asyncio.run(run(lambda db: seo_views.crawl_errors(db, dt.date.today())))
    assert errs[a["id"]] == {"broken": 0, "chains": 0}  # feeds the Reports → Top risk score
    assert client.get("/api/v1/seo/reports/center", headers=h("aima")).status_code == 200
    d = client.get(f"/api/v1/seo/sites/{a['id']}/crawl", headers=h("sofia")).json()
    assert d["crawl"]["totals"]["urls"] == 4 and d["issues"][0]["key"] == "h1missing" and d["issues"][0]["howToFix"] == "Add one."
    assert [x["key"] for x in d["sections"]] == ["home", "menu", "other"] and d["sections"][0]["withErrors"] == 1
    assert d["issues"][-1]["urls"] == 0  # checks with no URLs sort last
    pg = client.get(f"/api/v1/seo/sites/{a['id']}/crawl/pages?issue=h2missing&kind=all", headers=h("sofia")).json()
    assert pg["total"] == 2 and pg["issueNames"]["h2missing"] == "H2: Missing"
    assert client.get(f"/api/v1/seo/sites/{a['id']}/crawl/pages?kind=html", headers=h("sofia")).json()["total"] == 3
    # The client report picks the crawl up when it is (re)generated.
    r = client.post(f"/api/v1/seo/sites/{a['id']}/reports", json={"periodStart": (TODAY - dt.timedelta(days=90)).isoformat(),
                                                                   "periodEnd": (TODAY - dt.timedelta(days=61)).isoformat()}, headers=h("aima"))
    assert r.status_code == 201, r.text
    cr = r.json()["snapshot"]["crawl"]
    assert cr["pages"] == 3 and cr["redirects"] == 1 and cr["top"][0]["name"] == "H1: Missing"
    assert any("H1: Missing" in x for x in r.json()["snapshot"]["nextSteps"])
    from app.modules.seo import client_reports
    assert "Full-site technical check" in client_reports.email_html(r.json()["snapshot"])

    async def do_remove(db):
        return await sf_import.remove(db, await sf_import.find_site(db, DOM_A))

    assert asyncio.run(run(do_remove)) == 1
    assert client.get(f"/api/v1/seo/sites/{a['id']}/crawl", headers=h("sofia")).json()["crawl"] is None
    asyncio.run(run(rescore))  # crawl gone → back to the app's page checks; its finding closes by itself
    sd = client.get(f"/api/v1/seo/sites/{a['id']}", headers=h("sofia")).json()
    assert not any(x["code"] == "sf_issue" and x["state"] != "closed" for x in sd["findings"])
    try:
        sf_import.parse(tmp_path / "nope")
        raise AssertionError("expected ImportProblem")
    except sf_import.ImportProblem:
        pass


def test_stuck_refresh_is_closed(ctx):
    """A refresh left "running" by an API that restarted mid-way is shown as failed, not spinning forever."""
    import datetime as _dt

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.config import to_asyncpg_url

    client, seeded, h = ctx

    async def plant():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM marketing.seo_sync_run WHERE id = 'stuckrun0000000000000001'"))
            await c.execute(text("UPDATE marketing.seo_sync_run SET status='success' WHERE status='running'"))
            await c.execute(text("INSERT INTO marketing.seo_sync_run (id, trigger, status, started_at, sites, sites_failed, gsc_days, pages_checked, rank_checks) "
                                 "VALUES ('stuckrun0000000000000001', 'manual', 'running', :t, 31, 0, 0, 0, 0)"),
                            {"t": _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(seconds=2)})
        await eng.dispose()

    asyncio.run(plant())
    from app.modules.seo import sync

    old = sync._PROCESS_STARTED
    sync._PROCESS_STARTED = _dt.datetime.now(_dt.timezone.utc)  # as if the API restarted after the run began
    try:
        st = client.get("/api/v1/seo/status", headers=h("aima")).json()
    finally:
        sync._PROCESS_STARTED = old
    assert st["running"] is False
    assert st["lastRun"]["status"] == "failed" and "after 31 sites" in st["lastRun"]["error"]


def _sf_zip(domain: str, *, folder_prefix: str = "") -> bytes:
    """A minimal Screaming Frog export, zipped the way helper.py sends it."""
    import csv as _csv
    import io as _io
    import zipfile

    def csv_bytes(header, rows):
        buf = _io.StringIO()
        w = _csv.writer(buf)
        w.writerow(header)
        w.writerows(rows)
        return buf.getvalue().encode("utf-8")

    base = f"https://{domain}"
    out = _io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(folder_prefix + "internal_all.csv", csv_bytes(
            ["Address", "Content Type", "Status Code", "Indexability", "Title 1", "H1-1", "Word Count", "Crawl Depth", "Crawl Timestamp"],
            [[f"{base}/", "text/html", "200", "Indexable", "Home", "", "300", "0", "2026-10-27 10:00:00"],
             [f"{base}/menu/", "text/html", "200", "Indexable", "Menu", "Menu", "80", "1", "2026-10-27 10:00:05"],
             [f"{base}/gone/", "text/html", "404", "Non-Indexable", "", "", "", "1", "2026-10-27 10:00:06"]]))
        z.writestr(folder_prefix + "issues_overview_report.csv", csv_bytes(
            ["Issue Name", "Issue Type", "Issue Priority", "URLs", "% of Total", "Description", "How To Fix", "Help URL"],
            [["H1: Missing", "Issue", "Medium", "1", "33.3", "No h1.", "Add one.", ""],
             ["Response Codes: Internal Client Error (4xx)", "Issue", "High", "1", "33.3", "Broken.", "Fix it.", ""]]))
        z.writestr(folder_prefix + "issues_reports/h1_missing.csv", csv_bytes(["Address", "H1-1"], [[f"{base}/", ""]]))
        z.writestr(folder_prefix + "screamingfrog.log", b"not a csv")
        z.writestr("../../evil.csv", b"Address\nx")  # never written outside the temp folder
    return out.getvalue()


def test_crawler_helper_flow(ctx, monkeypatch):
    """Settings: a key per helper PC (shown once) → "Crawl all sites" queues every active site → the helper
    claims jobs one at a time with its key, uploads the export zip → crawl stored, site rescored."""
    import asyncio

    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.seo import SeoCrawlJob

    from app.config import get_settings

    client, seeded, h = ctx
    a = _site(client, h("aima"), DOM_A)
    # The upload is saved as a job of its own: inline here (as on Vercel), in the background further down.
    monkeypatch.setattr(get_settings(), "JOBS_MODE", "inline")

    async def clear_queue():  # jobs other runs left in the test database
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(eng)() as db:
            await db.execute(update(SeoCrawlJob).where(SeoCrawlJob.status.in_(("queued", "running"))).values(status="cancelled"))
            await db.commit()
        await eng.dispose()

    asyncio.run(clear_queue())

    # keys: managers only; the key itself is returned once
    assert client.post("/api/v1/seo/crawler/keys", headers=h("sofia"), json={"name": "Usama laptop"}).status_code == 403
    r = client.post("/api/v1/seo/crawler/keys", headers=h("aima"), json={"name": "Usama laptop"})
    assert r.status_code == 201, r.text
    key, key_id = r.json()["key"], r.json()["id"]
    assert key.startswith("sfk_") and r.json()["hint"] == key[-4:]
    assert all("key" not in k for k in client.get("/api/v1/seo/crawler/keys", headers=h("aima")).json()["data"])
    hk = {"X-Crawler-Key": key, "X-Crawler-Name": "Usama laptop", "X-Crawler-Version": "2.0.0"}

    # the helper endpoints take no user: only the key
    assert client.get("/api/v1/seo/crawler/next").status_code == 401
    assert client.get("/api/v1/seo/crawler/next", headers={"X-Crawler-Key": "sfk_wrong"}).status_code == 401
    assert client.get("/api/v1/seo/crawler/ping", headers=hk).json()["ok"] is True
    st = client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()
    assert st["online"] >= 1 and any(x["name"] == "Usama laptop" and x["online"] for x in st["helpers"])

    # queue: one site, then "all" doesn't queue it twice
    assert client.post("/api/v1/seo/crawler/crawl", headers=h("sofia"), json={"siteIds": [a["id"]]}).status_code == 403
    r = client.post("/api/v1/seo/crawler/crawl", headers=h("aima"), json={"siteIds": [a["id"]]})
    assert r.json()["queued"] == 1, r.text
    r = client.post("/api/v1/seo/crawler/crawl", headers=h("aima"), json={"all": True}).json()
    assert r["skipped"] >= 1 and a["id"] not in [j["siteId"] for j in r["jobs"]]
    others = [j["id"] for j in r["jobs"]]

    # the helper gets our site first (queued first), then reports and uploads
    job = client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"]
    assert job["domain"] == DOM_A and job["url"].startswith("https://")
    assert client.post(f"/api/v1/seo/crawler/jobs/{job['id']}/status", headers=hk, json={"status": "running", "message": "Crawling"}).status_code == 200
    st = client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()
    assert st["sites"][a["id"]]["status"] == "running" and st["sites"][a["id"]]["helper"] == "Usama laptop"
    # a wrong domain in the export fails the job with the reason
    bad = client.post(f"/api/v1/seo/crawler/jobs/{job['id']}/result", headers={**hk, "Content-Type": "application/zip"}, content=_sf_zip(DOM_B))
    assert bad.status_code == 400 and "not" in bad.json()["message"]
    assert client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()["sites"][a["id"]]["status"] == "failed"

    # again, properly (the export inside a folder in the zip, as Windows zips it)
    client.post("/api/v1/seo/crawler/crawl", headers=h("aima"), json={"siteIds": [a["id"]]})
    # cancel the other sites' jobs so ours is next
    for jid in others:
        assert client.post(f"/api/v1/seo/crawler/jobs/{jid}/cancel", headers=h("aima")).status_code == 200
    job = client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"]
    assert job["domain"] == DOM_A
    r = client.post(f"/api/v1/seo/crawler/jobs/{job['id']}/result", headers={**hk, "Content-Type": "application/zip", "X-Crawl-Duration": "42"},
                    content=_sf_zip(DOM_A, folder_prefix="20261027-100000/"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done" and r.json()["urls"] == 3 and "2 issue types" in r.json()["message"]
    st = client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()
    mine = st["sites"][a["id"]]
    assert mine["status"] == "done" and mine["durationSec"] == 42 and mine["crawlId"] and mine["lastCrawledAt"]
    d = client.get(f"/api/v1/seo/sites/{a['id']}/crawl", headers=h("sofia")).json()
    assert d["crawl"]["totals"]["urls"] == 3 and {i["key"] for i in d["issues"]} >= {"h1missing"}
    assert client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"] is None  # nothing left

    # a job can't be finished twice, nor by another helper
    assert client.post(f"/api/v1/seo/crawler/jobs/{job['id']}/status", headers=hk, json={"status": "failed"}).status_code == 400
    # a helper restarted mid-crawl: its running job fails when it asks for work again
    client.post("/api/v1/seo/crawler/crawl", headers=h("aima"), json={"siteIds": [a["id"]]})
    j2 = client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"]
    assert client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"] is None
    st = client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()
    assert st["sites"][a["id"]]["id"] == j2["id"] and st["sites"][a["id"]]["status"] == "failed" and "restarted" in st["sites"][a["id"]]["message"]

    # On a server the upload is accepted at once ("saving") and saved in the background → "done".
    import time

    monkeypatch.setattr(get_settings(), "JOBS_MODE", "background")
    client.post("/api/v1/seo/crawler/crawl", headers=h("aima"), json={"siteIds": [a["id"]]})
    j3 = client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"]
    r = client.post(f"/api/v1/seo/crawler/jobs/{j3['id']}/result", headers={**hk, "Content-Type": "application/zip"}, content=_sf_zip(DOM_A))
    assert r.status_code == 200 and r.json()["status"] == "saving", r.text
    for _ in range(50):
        mine = client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()["sites"][a["id"]]
        if mine["status"] != "saving":
            break
        time.sleep(0.2)
    assert mine["id"] == j3["id"] and mine["status"] == "done" and mine["urls"] == 3, mine
    # a second upload for a finished job is refused; a non-zip fails the job with the reason
    assert client.post(f"/api/v1/seo/crawler/jobs/{j3['id']}/result", headers={**hk, "Content-Type": "application/zip"}, content=_sf_zip(DOM_A)).status_code == 400
    client.post("/api/v1/seo/crawler/crawl", headers=h("aima"), json={"siteIds": [a["id"]]})
    j4 = client.get("/api/v1/seo/crawler/next", headers=hk).json()["job"]
    r = client.post(f"/api/v1/seo/crawler/jobs/{j4['id']}/result", headers={**hk, "Content-Type": "application/zip"}, content=b"not a zip")
    assert r.status_code == 400 and "zip" in r.json()["message"]
    assert client.get("/api/v1/seo/crawler/status", headers=h("sofia")).json()["sites"][a["id"]]["status"] == "failed"

    # revoke: the helper is shut out
    assert client.delete(f"/api/v1/seo/crawler/keys/{key_id}", headers=h("aima")).status_code == 200
    assert client.get("/api/v1/seo/crawler/ping", headers=hk).status_code == 401
