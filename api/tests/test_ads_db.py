"""Google Ads end to end against a real Postgres with Google mocked
(httpx.MockTransport): permissions → connect callback → sync → portfolio /
restaurant page / weekly breakdown / assets / offers → merchant link →
comments → sheet import → sample data.

Needs OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import io
import json
import os
import uuid
from urllib.parse import parse_qs

import httpx
import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")

TODAY = dt.date.today()
TAG = uuid.uuid4().hex[:6]
MCC = "1316498631"
# Unique 10-digit ids per run so the suite can run against a database with data.
N = int(uuid.uuid4().int % 9_000_000) + 1_000_000
CID_A, CID_B = f"7{N:07d}01", f"7{N:07d}02"
# C: cancelled account (Google refuses every report call); D: card-billed account
# (getIdentityVerification answers BILLING_NOT_ON_MONTHLY_INVOICING).
CID_C, CID_D = f"7{N:07d}03", f"7{N:07d}04"
NAME_A = f"Casa Villa {TAG}"


def google_mock(calls: list[str], dev_tokens: list[str]):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        try:
            q0 = json.loads(req.content or b"{}").get("query", "") if req.method == "POST" else ""
        except ValueError:
            q0 = ""
        calls.append(f"{req.method} {url.split('?')[0]} {q0[:70]}".rstrip())
        if url.startswith("https://oauth2.googleapis.com/token"):
            form = parse_qs(req.content.decode())
            if form.get("grant_type") == ["authorization_code"]:
                return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt-secret", "scope": "https://www.googleapis.com/auth/adwords openid email"})
            return httpx.Response(200, json={"access_token": "at2"})
        if url.startswith("https://openidconnect.googleapis.com/v1/userinfo"):
            return httpx.Response(200, json={"email": "ads@innowi.test"})
        if req.headers.get("authorization") not in ("Bearer at", "Bearer at2"):
            return httpx.Response(401, json={"error": {"message": "no"}})
        dev_tokens.append(f"{req.headers.get('developer-token')}|{req.headers.get('login-customer-id')}")
        cust0 = url.split("/customers/")[1].split("/")[0] if "/customers/" in url else ""
        if cust0 == CID_C:
            return httpx.Response(403, json=[{"error": {"code": 403, "message": "The caller does not have permission", "details": [{"errors": [{"errorCode": {"authorizationError": "CUSTOMER_NOT_ENABLED"}}]}]}}])
        if url.endswith("/getIdentityVerification") and cust0 == CID_D:
            return httpx.Response(400, json={"error": {"code": 400, "message": "Request contains an invalid argument.", "details": [{"errors": [{"errorCode": {"identityVerificationError": "BILLING_NOT_ON_MONTHLY_INVOICING"}, "message": "API advertiser verification is only open to customers with billing setup for monthly invoicing."}]}]}})
        if url.endswith("/getIdentityVerification"):
            return httpx.Response(200, json={"identityVerification": [{"verificationProgress": {"programStatus": "PENDING_USER_ACTION"}}]})
        q = json.loads(req.content or b"{}").get("query", "")
        cust = url.split("/customers/")[1].split("/")[0]
        if "FROM customer_client" in q:
            assert cust == MCC
            return httpx.Response(200, json=[{"results": [
                {"customerClient": {"id": CID_A, "descriptiveName": NAME_A, "manager": False, "status": "ENABLED", "currencyCode": "USD"}},
                {"customerClient": {"id": CID_B, "descriptiveName": f"Beanie Cafe NY {TAG}", "manager": False, "status": "ENABLED"}},
                {"customerClient": {"id": CID_C, "descriptiveName": f"Golden Catch {TAG}", "manager": False, "status": "CANCELED"}},
                {"customerClient": {"id": CID_D, "descriptiveName": f"Thai Basil {TAG}", "manager": False, "status": "ENABLED"}},
                {"customerClient": {"id": MCC, "descriptiveName": "Innowi MCC", "manager": True}},
            ]}])
        if cust == CID_B and "segments.date" in q:
            return httpx.Response(403, json=[{"error": {"code": 403, "message": "nope", "details": [{"errors": [{"errorCode": {"authorizationError": "USER_PERMISSION_DENIED"}}]}]}}])
        if "start_date_time" in q:  # newer field names not known by this "API version" → fallback
            return httpx.Response(400, json=[{"error": {"code": 400, "message": "Unrecognized field"}}])
        if "campaign.start_date" in q:
            return httpx.Response(200, json=[{"results": [{"campaign": {"id": "11", "startDate": "2025-10-01", "endDate": "2037-12-30"}}]}])
        if "segments.date" in q:
            rows = []
            first = TODAY.replace(day=1) - dt.timedelta(days=1)
            first = first.replace(day=1)  # previous month
            d = first
            while d < TODAY:
                rows.append({"campaign": {"id": "11", "name": "Casa Villa - PMAX", "status": "ENABLED"}, "segments": {"date": d.isoformat()},
                             "metrics": {"costMicros": "10000000", "impressions": "1000", "clicks": "40", "allConversionsFromLocationAssetClickToCall": 1,
                                         "allConversionsFromLocationAssetDirections": 3, "allConversionsFromLocationAssetWebsite": 2,
                                         "allConversionsFromLocationAssetOrder": 1, "allConversionsFromLocationAssetMenu": 4}})
                rows.append({"campaign": {"id": "99", "name": "Old removed", "status": "REMOVED"}, "segments": {"date": d.isoformat()},
                             "metrics": {"costMicros": "0", "impressions": "0"}})
                d += dt.timedelta(days=1)
            return httpx.Response(200, json=[{"results": rows}])
        if "FROM campaign WHERE" in q:
            return httpx.Response(200, json=[{"results": [{"campaign": {"id": "11", "name": "Casa Villa - PMAX", "status": "ENABLED", "advertisingChannelType": "PERFORMANCE_MAX"}, "campaignBudget": {"amountMicros": "10000000"}}]}])
        if "FROM asset_group_asset" in q:
            return httpx.Response(200, json=[{"results": [
                {"assetGroup": {"campaign": f"customers/{cust}/campaigns/11"}, "assetGroupAsset": {"fieldType": "HEADLINE", "status": "ENABLED"}, "asset": {"id": "1", "type": "TEXT", "textAsset": {"text": "Order Online Today"}}},
                {"assetGroup": {"campaign": f"customers/{cust}/campaigns/11"}, "assetGroupAsset": {"fieldType": "LOGO", "status": "ENABLED"}, "asset": {"id": "2", "type": "IMAGE", "imageAsset": {"fullSize": {"url": "https://img/logo.png", "widthPixels": 1200, "heightPixels": 1200}}}},
            ]}])
        if "FROM campaign_asset" in q:
            # Google rejects a WHERE on campaign.status unless it is selected too.
            if "campaign.status != " in q and "campaign.status," not in q.split("FROM")[0]:
                return httpx.Response(400, json=[{"error": {"code": 400, "message": "EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE"}}])
            return httpx.Response(200, json=[{"results": [
                {"campaign": {"id": "11"}, "campaignAsset": {"fieldType": "SITELINK", "status": "ENABLED"}, "asset": {"id": "3", "finalUrls": ["https://casa/menu"], "sitelinkAsset": {"linkText": "View Menu"}}},
                {"campaign": {"id": "11"}, "campaignAsset": {"fieldType": "PROMOTION", "status": "ENABLED"}, "asset": {"id": "4", "promotionAsset": {"promotionTarget": "Family meal", "percentOff": "200000", "promotionCode": "FAMILY20"}}},
            ]}])
        if "FROM customer_asset" in q:
            return httpx.Response(200, json=[{"results": []}])
        return httpx.Response(404, json={"error": {"message": f"unmocked {q[:80]}"}})

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
    keys = ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "ADS_AUTO_SYNC")
    old = {k: getattr(s, k) for k in keys}
    s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET = "cid", "csecret"
    s.GOOGLE_ADS_DEVELOPER_TOKEN, s.GOOGLE_ADS_LOGIN_CUSTOMER_ID, s.ADS_AUTO_SYNC = "dev-token", "131-649-8631", False

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    for k, v in old.items():
        setattr(s, k, v)
    engine.sync_engine.dispose(close=False)


def _run_sync(transport: httpx.MockTransport, trigger: str = "manual") -> dict:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.ads import AdsSyncRun
    from app.modules.ads import sync

    async def go():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        S = async_sessionmaker(eng, expire_on_commit=False)
        async with S() as db:
            for r in (await db.execute(select(AdsSyncRun).where(AdsSyncRun.status == "running"))).scalars():
                r.status = "failed"
            await db.commit()
            run = await sync.create_run(db, trigger, None)
            async with httpx.AsyncClient(transport=transport) as http:
                run = await sync.run_sync(db, run.id, http=http, today=TODAY)
            out = {"status": run.status, "accounts": run.accounts, "failed": run.accounts_failed, "rows": run.metric_rows, "new": run.new_accounts, "error": run.error}
        await eng.dispose()
        return out

    return asyncio.run(go())


def _clear_ads():
    """Other runs may have left real accounts behind; this module needs a clean slate for the demo checks."""
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url
    from app.models.ads import AdsAccount, AdsConnection

    async def go():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        async with async_sessionmaker(eng)() as db:
            await db.execute(delete(AdsAccount))
            await db.execute(delete(AdsConnection))
            await db.commit()
        await eng.dispose()

    asyncio.run(go())


def test_permissions_and_sample_data(ctx):
    client, seeded, h = ctx
    _clear_ads()
    st = client.get("/api/v1/ads/status", headers=h("sofia"))
    assert st.status_code == 200 and st.json()["canManage"] is False and st.json()["managerCustomerId"] == "131-649-8631"
    assert client.get("/api/v1/ads/portfolio").status_code == 401
    for method, path in (("post", "/ads/connect"), ("post", "/ads/sync"), ("post", "/ads/sample-data"), ("patch", "/ads/accounts/x")):
        assert getattr(client, method)(f"/api/v1{path}", headers=h("sofia"), **({"json": {}} if method == "patch" else {})).status_code == 403
    r = client.post("/api/v1/ads/sample-data", headers=h("aima"))
    assert r.status_code == 200 and r.json()["accounts"] >= 25
    p = client.get("/api/v1/ads/portfolio", headers=h("sofia")).json()
    assert p["counts"]["budgetMismatch"] >= 3 and p["counts"]["verificationRequired"] >= 3 and p["counts"]["archived"] == 1
    assert all(row["isDemo"] for row in p["rows"])
    un = client.get("/api/v1/ads/unmapped", headers=h("sofia")).json()
    assert un["summary"]["total"] == 5


def test_connect_sync_and_reports(ctx, monkeypatch):
    client, seeded, h = ctx
    from app.modules.ads import connection, router, sync

    calls: list[str] = []
    devs: list[str] = []
    transport = google_mock(calls, devs)
    monkeypatch.setattr(router, "_http", lambda: httpx.AsyncClient(transport=transport))
    started: list[str] = []
    async def fake_start(run_id):  # start_background is async (it may run the sync inline)
        started.append(run_id)

    monkeypatch.setattr(sync, "start_background", fake_start)

    # Executives can't connect, even with a valid state.
    st = connection.make_state(seeded["sofia"][0])
    r = client.get(f"/api/v1/integrations/google-ads/callback?code=x&state={st}", follow_redirects=False)
    assert "ads=error" in r.headers["location"]
    r = client.get("/api/v1/integrations/google-ads/callback?code=x&state=forged", follow_redirects=False)
    assert "ads=error" in r.headers["location"]

    st = connection.make_state(seeded["aima"][0])
    r = client.get(f"/api/v1/integrations/google-ads/callback?code=good&state={st}", follow_redirects=False)
    assert r.headers["location"].endswith("/ads?ads=connected"), r.headers["location"]
    assert started, "a first sync is queued right after connecting"
    status = client.get("/api/v1/ads/status", headers=h("aima")).json()
    assert status["connected"] and status["connection"]["email"] == "ads@innowi.test"
    assert "rt-secret" not in json.dumps(status)

    out = _run_sync(transport)
    assert out["status"] == "partial" and out["failed"] == 1 and out["new"] == 4, out
    assert not any(f"/customers/{CID_C}/" in c for c in calls), "cancelled accounts aren't queried"
    assert out["rows"] > 28
    assert all(d == "dev-token|1316498631" for d in devs)

    p = client.get("/api/v1/ads/portfolio", headers=h("sofia")).json()
    assert not any(row["isDemo"] for row in p["rows"]), "the first real sync removes the sample data"
    a = next(r for r in p["rows"] if r["name"] == NAME_A)
    b = next(r for r in p["rows"] if r["name"].startswith("Beanie"))
    # Previous month, $10/day, 1 order/day; no ticket yet → no revenue.
    days = p["period"]["days"]
    assert a["metrics"]["spend"] == pytest.approx(10 * days) and a["metrics"]["orders"] == days
    assert a["revenue"] is None and a["roas"] is None and a["costPerOrder"] == 10
    assert a["verification"] == "required" and any(x["type"] == "verification_required" for x in a["alerts"])
    assert a["merchant"] is None and a["restaurantStatus"] == "active" and a["googleDailyBudget"] == 10
    assert b["syncState"] == "issue" and any(x["type"] == "sync_issue" for x in b["alerts"])
    gc = next(r for r in p["rows"] if r["name"].startswith("Golden Catch"))
    assert gc["state"] == "archived" and gc["syncState"] != "issue", gc["syncState"]
    d = next(r for r in p["rows"] if r["name"] == f"Thai Basil {TAG}")
    assert d["syncState"] != "issue" and d["verification"] == "unknown"


    # Avg ticket inputs (managers) → revenue / ROAS.
    assert client.patch(f"/api/v1/ads/accounts/{a['id']}", headers=h("sofia"), json={"ticketTotalSales": 6835}).status_code == 403
    r = client.patch(f"/api/v1/ads/accounts/{a['id']}", headers=h("aima"), json={"ticketTotalSales": 6835, "ticketOrderCount": 155})
    assert r.status_code == 200
    assert client.patch(f"/api/v1/ads/accounts/{a['id']}", headers=h("aima"), json={"nope": 1}).status_code in (400, 422)

    # vs previous period: two full 7-day windows inside the mocked history ($10 + 1 order a day).
    s7, e7 = (TODAY - dt.timedelta(days=14)).isoformat(), (TODAY - dt.timedelta(days=8)).isoformat()
    d = client.get(f"/api/v1/ads/accounts/{a['id']}?start={s7}&end={e7}&compare=previous", headers=h("sofia")).json()
    assert d["comparePeriod"] == {"start": (TODAY - dt.timedelta(days=21)).isoformat(), "end": (TODAY - dt.timedelta(days=15)).isoformat(), "days": 7}
    assert d["previous"]["metrics"]["spend"] == 70 and d["previous"]["metrics"]["orders"] == 7 and d["previous"]["hasData"]
    assert d["previous"]["revenue"] == pytest.approx(7 * 6835 / 155, abs=0.01) and d["previous"]["roasStatus"]["key"] == "excellent"
    assert d["campaigns"][0]["previous"]["metrics"]["spend"] == 70
    assert "previous" not in client.get(f"/api/v1/ads/accounts/{a['id']}?start={s7}&end={e7}", headers=h("sofia")).json()
    assert client.get(f"/api/v1/ads/accounts/{a['id']}?compare=year", headers=h("sofia")).status_code == 400
    p2 = client.get("/api/v1/ads/portfolio?compare=previous", headers=h("sofia")).json()
    a2 = next(r for r in p2["rows"] if r["id"] == a["id"])
    assert p2["comparePeriod"]["end"] < p2["period"]["start"] and a2["previous"]["hasData"] is False  # nothing synced before last month
    assert "previous" not in next(r for r in client.get("/api/v1/ads/portfolio", headers=h("sofia")).json()["rows"] if r["id"] == a["id"])

    # Daily trend: synced days carry values, days after the last synced day are gaps.
    t0, t1 = (TODAY - dt.timedelta(days=2)).isoformat(), TODAY.isoformat()
    tr = client.get(f"/api/v1/ads/accounts/{a['id']}/trend?start={t0}&end={t1}&compare=previous", headers=h("sofia")).json()
    assert [x["date"] for x in tr["days"]] == [t0, (TODAY - dt.timedelta(days=1)).isoformat(), t1]
    assert [x["spend"] for x in tr["days"]] == [10, 10, None] and tr["days"][0]["revenue"] == pytest.approx(6835 / 155, abs=0.01)
    assert [x["orders"] for x in tr["previousDays"]] == [1, 1, 1] and tr["dataThrough"] == (TODAY - dt.timedelta(days=1)).isoformat()
    assert [c["name"] for c in tr["campaigns"]] == ["Casa Villa - PMAX", "Old removed"]
    cid = tr["campaigns"][1]["id"]
    one = client.get(f"/api/v1/ads/accounts/{a['id']}/trend?start={t0}&end={t1}&campaign={cid}", headers=h("sofia")).json()
    assert [x["spend"] for x in one["days"]] == [0, 0, None] and one["previousDays"] is None
    assert client.get(f"/api/v1/ads/accounts/{a['id']}/trend?campaign=nope", headers=h("sofia")).status_code == 400

    # Quick refresh: accounts + campaigns + daily metrics only — no assets, dates or verification.
    r = client.post("/api/v1/ads/sync?mode=quick", headers=h("aima"))
    assert r.status_code == 200 and r.json()["mode"] == "quick" and r.json()["trigger"] == "quick", r.text
    assert client.post("/api/v1/ads/sync?mode=quick", headers=h("sofia")).status_code == 403
    calls.clear()
    out = _run_sync(transport, "quick")
    assert out["status"] == "partial" and out["accounts"] == 4 and out["rows"] > 0, out
    assert not any("getIdentityVerification" in c or "asset" in c or "start_date" in c for c in calls), calls
    assert any("segments.date" in c for c in calls)
    d = client.get(f"/api/v1/ads/accounts/{a['id']}", headers=h("sofia")).json()
    assert d["tabCounts"]["assets"] == 4 and d["verification"] == "required", "a quick refresh keeps assets and verification"
    runs = client.get("/api/v1/ads/sync-runs", headers=h("sofia")).json()["data"]
    assert runs[0]["mode"] == "quick"

    d = client.get(f"/api/v1/ads/accounts/{a['id']}", headers=h("sofia")).json()
    assert d["avgTicket"] == 44.1 and d["roas"] == pytest.approx(4.41, abs=0.01)
    assert d["roasStatus"]["key"] == "excellent" and d["analysis"].startswith("Strong performance")
    assert [c["name"] for c in d["campaigns"]] == ["Casa Villa - PMAX"], "removed campaigns without spend are hidden"
    assert d["campaigns"][0]["startDate"] == "2025-10-01" and d["campaigns"][0]["endDate"] is None
    assert d["tabCounts"] == {"campaigns": 1, "assets": 4, "offers": 1, "sitelinks": 1}
    assert d["budget"]["status"] == "no_budget"  # not linked → no approved budget

    bd = client.get(f"/api/v1/ads/accounts/{a['id']}/breakdown", headers=h("sofia")).json()
    assert len(bd["rows"]) == 1 and [w["label"] for w in bd["rows"][0]["weeks"]] == ["Week 01", "Week 02", "Week 03", "Week 04"]
    w4 = bd["rows"][0]["weeks"][3]
    assert w4["end"] == bd["monthEnd"] and w4["metrics"]["orders"] == (dt.date.fromisoformat(bd["monthEnd"]).day - 21)
    assert bd["rows"][0]["month"]["analysis"]
    assert client.get(f"/api/v1/ads/accounts/{a['id']}/breakdown?month=2026-13", headers=h("sofia")).status_code == 400

    assets = client.get(f"/api/v1/ads/accounts/{a['id']}/assets", headers=h("sofia")).json()["data"]
    assert sorted(x["kind"] for x in assets) == ["logo", "promotion", "sitelink", "text"]
    offers = client.get(f"/api/v1/ads/accounts/{a['id']}/offers", headers=h("sofia")).json()
    assert offers["merchantLinked"] is False and offers["google"][0]["details"]["code"] == "FAMILY20"

    mr = client.get("/api/v1/ads/monthly-report", headers=h("sofia")).json()
    assert [r["campaignName"] for r in mr["rows"] if r["accountId"] == a["id"]] == ["Casa Villa - PMAX"]

    # Link to the seeded merchant → budget from the Profile, row in the merchant tab.
    sug = client.get(f"/api/v1/ads/accounts/{a['id']}/merchant-suggestions", headers=h("sofia"))
    assert sug.status_code == 200
    assert client.put(f"/api/v1/ads/accounts/{a['id']}/merchant", headers=h("sofia"), json={"merchantId": seeded["merchant"]}).status_code == 403
    r = client.put(f"/api/v1/ads/accounts/{a['id']}/merchant", headers=h("aima"), json={"merchantId": seeded["merchant"]})
    assert r.status_code == 200
    r = client.patch(f"/api/v1/merchants/{seeded['merchant']}/fields/googleAdsBudget", headers=h("aima"), json={"value": 200})
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/v1/merchants/{seeded['merchant']}/fields/adsPaidBy", headers=h("aima"), json={"value": "Innowi"})
    assert r.status_code == 200, r.text
    d = client.get(f"/api/v1/ads/accounts/{a['id']}", headers=h("sofia")).json()
    assert d["approvedMonthly"] == 200 and d["adsPaidBy"] == "Innowi" and d["merchant"]["id"] == seeded["merchant"]
    assert d["budget"]["status"] == "mismatch"  # $10/day ≈ $300/month vs $200 approved
    assert any(x["type"] == "budget_mismatch" for x in d["alerts"])
    m = client.get(f"/api/v1/merchants/{seeded['merchant']}/ads", headers=h("sofia")).json()
    assert [x["id"] for x in m["data"]] == [a["id"]]
    un = client.get("/api/v1/ads/unmapped", headers=h("sofia")).json()
    assert a["id"] not in [x["id"] for x in un["rows"]] and b["id"] in [x["id"] for x in un["rows"]]
    # Linked accounts can't take sample data any more.
    assert client.post("/api/v1/ads/sample-data", headers=h("aima")).status_code == 409


def test_comments(ctx):
    client, seeded, h = ctx
    acc = client.get("/api/v1/ads/accounts", headers=h("sofia")).json()["data"][0]["id"]
    r = client.post(f"/api/v1/ads/accounts/{acc}/comments", headers=h("jai"), json={"body": "Raised budget to $60/day."})
    assert r.status_code == 201 and r.json()["canEdit"] is True
    cid = r.json()["id"]
    assert client.patch(f"/api/v1/ads/comments/{cid}", headers=h("sofia"), json={"body": "x"}).status_code == 403
    r = client.patch(f"/api/v1/ads/comments/{cid}", headers=h("aima"), json={"body": "Raised budget to $65/day."})
    assert r.status_code == 200 and r.json()["edited"] is True
    lst = client.get(f"/api/v1/ads/accounts/{acc}/comments", headers=h("sofia")).json()["data"]
    assert lst[0]["body"] == "Raised budget to $65/day." and lst[0]["canEdit"] is False
    assert client.delete(f"/api/v1/ads/comments/{cid}", headers=h("jai")).status_code == 204


def test_sheet_import_and_manual_add(ctx):
    client, seeded, h = ctx
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "GBP Dashboard"
    ws.append(["ACCOUNT NAME", "CUSTOMER ID", "MANAGER ID", "Total Sales", "No of Orders", "STATUS"])
    new_cid = f"6{N:07d}03"
    ws.append([f"Kabob Fusion {TAG}", float(new_cid), 1316498631.0, 14153.0, 370.0, "Ready"])
    ws.append([NAME_A, float(CID_A), 1316498631.0, 7000, 140, "Ready"])  # existing → ticket updated
    ws.append(["bad row", "12", None, None, None, "Ready"])
    buf = io.BytesIO()
    wb.save(buf)
    files = {"file": ("sheet.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    assert client.post("/api/v1/ads/accounts/import", headers=h("sofia"), files=files).status_code == 403
    r = client.post("/api/v1/ads/accounts/import", headers=h("aima"), files=files)
    assert r.status_code == 200, r.text
    assert (r.json()["created"], r.json()["updated"]) == (1, 1)
    accounts = {x["customerId"]: x for x in client.get("/api/v1/ads/accounts", headers=h("sofia")).json()["data"]}
    assert accounts[f"{new_cid[:3]}-{new_cid[3:6]}-{new_cid[6:]}"]["source"] == "SHEET"
    bad = client.post("/api/v1/ads/accounts/import", headers=h("aima"), files={"file": ("x.xlsx", b"not a workbook", "application/octet-stream")})
    assert bad.status_code == 400

    r = client.post("/api/v1/ads/accounts", headers=h("aima"), json={"customerId": "123-45", "name": "x"})
    assert r.status_code in (400, 422)
    manual = f"5{N:07d}04"
    r = client.post("/api/v1/ads/accounts", headers=h("aima"), json={"customerId": manual, "name": f"Manual {TAG}"})
    assert r.status_code == 201
    assert client.post("/api/v1/ads/accounts", headers=h("aima"), json={"customerId": manual, "name": "dup"}).status_code == 409
    # Ignore it → gone from the portfolio and the unmapped list.
    r = client.patch(f"/api/v1/ads/accounts/{r.json()['id']}", headers=h("aima"), json={"state": "ignored"})
    assert r.status_code == 200
    names = [x["name"] for x in client.get("/api/v1/ads/unmapped", headers=h("sofia")).json()["rows"]]
    assert f"Manual {TAG}" not in names


def test_integrations_card(ctx):
    client, seeded, h = ctx
    cards = {c["key"]: c for c in client.get("/api/v1/settings/integrations", headers=h("sofia")).json()["data"]}
    assert cards["google_ads"]["status"] in ("connected", "attention", "configured")
