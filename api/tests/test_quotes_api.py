"""Quote builder API: staff links/requests and the public builder.

Runs against the configured Postgres (skipped when unreachable or not migrated).
The most important guarantee here: a hidden-price link never sends a price,
total or discount to the restaurant.
"""
from __future__ import annotations

import datetime as dt
import json
from decimal import Decimal as D

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password
from app.config import get_settings
from app.db.schemas import qualified
from app.db.session import engine_kwargs
from app.db.session import get_db
from app.main import app
from app.models import quotes as m
from app.models.audit import AuditLog
from app.models.auth import User
from app.models.enums import Role
from app.modules.quotes import notify as notify_mod
from scripts import seed_quotes

DOMAIN = "@test.quotes"


@pytest.fixture()
async def sessions():
    settings = get_settings()
    engine = create_async_engine(settings.database_url_async, **{**engine_kwargs(), "poolclass": NullPool})
    try:
        async with engine.connect() as conn:
            exists = (await conn.execute(text("select to_regclass(:t)"), {"t": f"{qualified('quotes')}.quote_link"})).scalar()
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"database not reachable: {exc}")
    if not exists:
        await engine.dispose()
        pytest.skip("quotes schema not migrated")
    async with engine.begin() as conn:
        await conn.execute(text(f'TRUNCATE {qualified("quotes")}."quote_link" CASCADE'))
    yield async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    await engine.dispose()


@pytest.fixture()
async def api(sessions, monkeypatch):
    # The price list as seeded from the sheet (insert-only; restore any test edits).
    monkeypatch.setattr(seed_quotes, "SessionLocal", sessions)
    async with sessions() as db:
        await db.execute(text(f'DELETE FROM {qualified("quotes")}."price_item"'))
        await db.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%{DOMAIN}\''))
        await db.commit()
    await seed_quotes.main()

    async def _db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = _db
    sent: list[tuple[str, dict]] = []

    def fake_post(url, payload, headers=None):
        sent.append((url, payload))
        return 200

    monkeypatch.setattr(notify_mod, "_post_json", fake_post)
    settings = get_settings()
    monkeypatch.setattr(settings, "QUOTES_TEAMS_WEBHOOK_URL", "https://teams.example/hook")
    monkeypatch.setattr(settings, "RESEND_API_KEY", None)

    users = {}
    async with sessions() as db:
        for key, role in [("admin", Role.ADMIN), ("manager", Role.SALES_MANAGER), ("rep", Role.SALES_EXECUTIVE),
                          ("marketing", Role.MARKETING_EXECUTIVE)]:
            u = User(email=f"{key}{DOMAIN}", password_hash=hash_password("x" * 12), role=role)
            db.add(u)
            users[key] = u
        await db.commit()
    clients = {}
    for key, u in users.items():
        token, _ = create_access_token({"sub": u.id, "email": u.email, "role": u.role.value})
        clients[key] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1",
                                         headers={"Authorization": f"Bearer {token}"})
    clients["anon"] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1")
    yield clients, sessions, sent
    for c in clients.values():
        await c.aclose()
    app.dependency_overrides.pop(get_db, None)
    async with sessions() as db:
        await db.execute(text(f'TRUNCATE {qualified("quotes")}."quote_link" CASCADE'))
        await db.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%{DOMAIN}\''))
        await db.commit()


async def _items(c) -> dict[str, dict]:
    body = (await c["admin"].get("/quotes/price-list")).json()
    return {i["sku"]: i for i in body["data"]}


async def _link(c, who="manager", **kw):
    body = {"mode": "SHOW_PRICES", "restaurantName": "Casa Mia", "contactName": "Maria", "contactEmail": "maria@example.com"}
    body.update(kw)
    res = await c[who].post("/quotes/links", json=body)
    assert res.status_code == 201, res.text
    data = res.json()
    return data["link"], data["url"].rsplit("/q/", 1)[1]


PRICE_KEYS = {"listMonthly", "listPurchase", "listLease", "monthly", "purchase", "lease", "unitList", "unitPrice",
              "total", "listTotal", "totals", "firstStationMonthly", "discountPercent", "percentOff"}


def _assert_no_prices(obj, path="$"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert k not in PRICE_KEYS, f"price field {path}.{k} leaked"
            _assert_no_prices(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _assert_no_prices(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        assert "$" not in obj, f"price text leaked at {path}: {obj!r}"


async def test_hidden_link_never_sends_prices(api):
    c, _, _ = api
    items = await _items(c)
    link, token = await _link(c, mode="HIDE_PRICES", discountPercent="15",
                              items=[{"itemId": items["SVC-DEPLOY"]["id"], "purchasePrice": "0"}])
    offer = (await c["anon"].get(f"/public/quotes/{token}")).json()
    assert offer["showPrices"] is False
    _assert_no_prices(offer)
    assert offer["sections"] and offer["sections"][0]["items"]

    sel = [{"itemId": items["DEV-POS"]["id"], "qty": 2}, {"itemId": items["SVC-DEPLOY"]["id"], "qty": 1}]
    assert (await c["anon"].post(f"/public/quotes/{token}/price", json={"items": sel})).status_code == 403
    res = await c["anon"].post(f"/public/quotes/{token}/requests",
                               json={"items": sel, "contact": {"name": "Maria", "email": "maria@example.com"}})
    assert res.status_code == 201, res.text
    req = res.json()
    assert req["status"] == "REQUESTED"
    _assert_no_prices(req)
    again = (await c["anon"].get(f"/public/quotes/{token}/requests/{req['id']}")).json()
    _assert_no_prices(again)
    assert (await c["anon"].get(f"/public/quotes/{token}/requests/{req['id']}/pdf")).status_code == 403
    assert (await c["anon"].post(f"/public/quotes/{token}/requests/{req['id']}/sign",
                                 json={"revisionNo": 1, "name": "Maria R", "method": "TYPED",
                                       "signatureData": "Maria R", "agree": True})).status_code == 403

    # Staff see the priced request, with the client's special pricing.
    staff = (await c["rep"].get(f"/quotes/requests/{req['id']}")).json()
    deploy = next(line for line in staff["lines"] if line["sku"] == "SVC-DEPLOY")
    assert D(deploy["unitPrice"]) == D("0") and D(deploy["unitList"]) == D("750")
    assert D(staff["totals"]["monthlySoftware"]) == D("105.36")  # (99 + 24.95) x 0.85


async def test_price_link_proposal_accept_and_pdf(api):
    c, sessions, sent = api
    items = await _items(c)
    link, token = await _link(c, discountPercent="10")
    offer = (await c["anon"].get(f"/public/quotes/{token}")).json()
    pos = next(i for s in offer["sections"] for i in s["items"] if i["sku"] == "DEV-POS")
    assert D(pos["listPurchase"]) == D("873") and D(pos["purchase"]) == D("785.70")
    assert D(offer["firstStationMonthly"]) == D("89.10")
    assert all(i["sku"] != "SW-POS-FIRST" for s in offer["sections"] for i in s["items"])

    sel = [{"itemId": items["DEV-POS"]["id"], "qty": 1}, {"itemId": items["DEV-HANDHELD"]["id"], "qty": 1}]
    preview = (await c["anon"].post(f"/public/quotes/{token}/price", json={"items": sel, "hardwarePlan": "LEASE"})).json()
    assert D(preview["totals"]["monthlyLease"]) == D("45.82")  # 30.56 + 15.26 (each rounded to cents)

    res = await c["anon"].post(f"/public/quotes/{token}/requests", json={
        "items": sel, "hardwarePlan": "LEASE", "contact": {"name": "Maria", "email": "maria@example.com"}})
    req = res.json()
    assert req["status"] == "PROPOSED" and req["totals"]["monthly"] == preview["totals"]["monthly"]
    assert req["terms"]
    assert sent and sent[-1][0] == "https://teams.example/hook"
    assert "Casa Mia" in json.dumps(sent[-1][1])

    pdf = await c["anon"].get(f"/public/quotes/{token}/requests/{req['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    bad = await c["anon"].post(f"/public/quotes/{token}/requests/{req['id']}/sign", json={"name": "Maria R"})
    assert bad.status_code == 400 or bad.status_code == 422
    ok = await c["anon"].post(f"/public/quotes/{token}/requests/{req['id']}/sign",
                              json={"revisionNo": 1, "name": "Maria Rossi", "title": "Owner",
                                    "method": "TYPED", "signatureData": "Maria Rossi", "agree": True})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["status"] == "SIGNED" and body["acceptedName"] == "Maria Rossi"
    assert [s["role"] for s in body["signatures"]] == ["CLIENT"]
    again = await c["anon"].post(f"/public/quotes/{token}/requests/{req['id']}/sign",
                                 json={"revisionNo": 1, "name": "Someone Else", "method": "TYPED",
                                       "signatureData": "Someone Else", "agree": True})
    assert again.json()["acceptedName"] == "Maria Rossi"  # idempotent, first signature stands
    staff = (await c["manager"].get(f"/quotes/requests/{req['id']}")).json()
    assert staff["notified"]["submitted"]["teams"] is True and staff["notified"]["signed"]["teams"] is True
    # A signed proposal's status is locked (send a revision instead).
    assert (await c["manager"].patch(f"/quotes/requests/{req['id']}", json={"status": "DECLINED"})).status_code == 409


async def test_rep_needs_manager_for_special_pricing(api):
    c, _, _ = api
    items = await _items(c)
    res = await c["rep"].post("/quotes/links", json={"mode": "SHOW_PRICES", "restaurantName": "X", "discountPercent": "5"})
    assert res.status_code == 403
    res = await c["rep"].post("/quotes/links", json={"mode": "SHOW_PRICES", "restaurantName": "X",
                                                     "items": [{"itemId": items["SVC-MENU"]["id"], "percentOff": "50"}]})
    assert res.status_code == 403
    link, _ = await _link(c, who="rep")  # list price is fine
    res = await c["rep"].patch(f"/quotes/links/{link['id']}", json={"discountPercent": "20"})
    assert res.status_code == 403
    # Hiding an item is not special pricing.
    res = await c["rep"].patch(f"/quotes/links/{link['id']}",
                               json={"items": [{"itemId": items["NET-SW24"]["id"], "hidden": True}]})
    assert res.status_code == 200
    assert (await c["marketing"].get("/quotes/links")).status_code == 403


async def test_hidden_items_and_unknown_items_rejected(api):
    c, _, _ = api
    items = await _items(c)
    link, token = await _link(c, items=[{"itemId": items["MKT-PACKAGE"]["id"], "hidden": True}])
    offer = (await c["anon"].get(f"/public/quotes/{token}")).json()
    assert all(i["sku"] != "MKT-PACKAGE" for s in offer["sections"] for i in s["items"])
    res = await c["anon"].post(f"/public/quotes/{token}/requests", json={
        "items": [{"itemId": items["MKT-PACKAGE"]["id"], "qty": 1}], "contact": {"name": "A", "email": "a@example.com"}})
    assert res.status_code == 400
    res = await c["anon"].post(f"/public/quotes/{token}/requests", json={
        "items": [{"itemId": items["SW-POS-FIRST"]["id"], "qty": 1}], "contact": {"name": "A", "email": "a@example.com"}})
    assert res.status_code == 400


async def test_revoke_expiry_and_new_url(api):
    c, sessions, _ = api
    link, token = await _link(c)
    assert (await c["anon"].get(f"/public/quotes/{token}")).status_code == 200
    assert (await c["anon"].get("/public/quotes/" + "x" * 32)).status_code == 404
    fresh = (await c["manager"].post(f"/quotes/links/{link['id']}/new-url")).json()
    new_token = fresh["url"].rsplit("/q/", 1)[1]
    assert (await c["anon"].get(f"/public/quotes/{token}")).status_code == 404
    assert (await c["anon"].get(f"/public/quotes/{new_token}")).status_code == 200
    await c["manager"].post(f"/quotes/links/{link['id']}/revoke")
    assert (await c["anon"].get(f"/public/quotes/{new_token}")).status_code == 404
    _, token2 = await _link(c)
    async with sessions() as db:
        row = (await db.execute(select(m.QuoteLink).where(m.QuoteLink.restaurant_name == "Casa Mia")
                                .order_by(m.QuoteLink.created_at.desc()))).scalars().first()
        row.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        await db.commit()
    assert (await c["anon"].get(f"/public/quotes/{token2}")).status_code == 404


async def test_price_list_edit_rights_and_snapshot(api):
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c)
    sel = [{"itemId": items["SVC-WEBSITE"]["id"], "qty": 1}]
    req = (await c["anon"].post(f"/public/quotes/{token}/requests",
                                json={"items": sel, "contact": {"name": "A", "email": "a@example.com"}})).json()
    assert (await c["manager"].patch(f"/quotes/price-list/{items['SVC-WEBSITE']['id']}",
                                     json={"purchasePrice": "900"})).status_code == 403
    res = await c["admin"].patch(f"/quotes/price-list/{items['SVC-WEBSITE']['id']}", json={"purchasePrice": "900"})
    assert res.status_code == 200 and D(res.json()["purchasePrice"]) == D("900")
    # A device must keep its prices.
    res = await c["admin"].patch(f"/quotes/price-list/{items['DEV-POS']['id']}", json={"clear": ["monthlyPrice"]})
    assert res.status_code == 400
    # The stored proposal keeps the price it was made with; new quotes use the new price.
    old = (await c["anon"].get(f"/public/quotes/{token}/requests/{req['id']}")).json()
    assert D(old["totals"]["oneTime"]) == D("1000")
    new = (await c["anon"].post(f"/public/quotes/{token}/price", json={"items": sel})).json()
    assert D(new["totals"]["oneTime"]) == D("900")


async def test_audit_log_has_no_link_url(api):
    c, sessions, _ = api
    link, token = await _link(c)
    async with sessions() as db:
        rows = list((await db.execute(select(AuditLog).where(AuditLog.entity_id == link["id"]))).scalars())
    assert rows and all(token not in json.dumps([r.before, r.after]) for r in rows)


async def test_staff_lists_and_summary(api):
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c)
    await c["anon"].post(f"/public/quotes/{token}/requests", json={
        "items": [{"itemId": items["DEV-KDS-15"]["id"], "qty": 2}], "contact": {"name": "A", "email": "a@example.com"}})
    links = (await c["rep"].get("/quotes/links")).json()
    assert links["meta"]["total"] == 1 and links["data"][0]["requestCount"] == 1
    assert links["data"][0]["openCount"] >= 0
    reqs = (await c["rep"].get("/quotes/requests", params={"q": "casa"})).json()
    assert reqs["meta"]["total"] == 1
    s = (await c["rep"].get("/quotes/summary")).json()
    assert s["activeLinks"] == 1 and s["requestsOpen"] == 1
    pdf = await c["rep"].get(f"/quotes/requests/{reqs['data'][0]['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


async def test_price_notes_hidden_when_they_would_contradict_the_link(api):
    """Sheet notes quote list prices ("First station $99/mo ..."): keep them only where the client pays list."""
    c, _, _ = api

    def note(offer, sku):
        return next(i for s in offer["sections"] for i in s["items"] if i["sku"] == sku).get("note")

    _, token = await _link(c)
    plain = (await c["anon"].get(f"/public/quotes/{token}")).json()
    assert "$99/mo" in note(plain, "DEV-POS")
    assert "$50/year" in note(plain, "SVC-WEBSITE")

    _, token = await _link(c, discountPercent="10")
    special = (await c["anon"].get(f"/public/quotes/{token}")).json()
    assert note(special, "DEV-POS") is None and note(special, "DEV-HANDHELD") is None
    assert note(special, "SVC-WEBSITE") is None
    assert note(special, "SW-ORDERHUB")  # no price in it, so it stays

    # Only the first-station price is special: station notes (which quote it) go, others stay.
    items = await _items(c)
    _, token = await _link(c, items=[{"itemId": items["SW-POS-FIRST"]["id"], "monthlyPrice": "79"}])
    first_only = (await c["anon"].get(f"/public/quotes/{token}")).json()
    assert note(first_only, "DEV-POS") is None
    assert "$50/year" in note(first_only, "SVC-WEBSITE")


async def test_pricing_rule_cannot_be_switched_off(api):
    c, _, _ = api
    items = await _items(c)
    rule = items["SW-POS-FIRST"]
    res = await c["admin"].patch(f"/quotes/price-list/{rule['id']}", json={"active": False})
    assert res.status_code == 400, res.text
    assert (await _items(c))["SW-POS-FIRST"]["active"] is True
    # its price can still change, and a normal product can still be switched off
    assert (await c["admin"].patch(f"/quotes/price-list/{rule['id']}", json={"monthlyPrice": "99.00"})).status_code == 200
    res = await c["admin"].patch(f"/quotes/price-list/{items['NET-CAT6-10']['id']}", json={"active": False})
    assert res.status_code == 200 and res.json()["active"] is False
    await c["admin"].patch(f"/quotes/price-list/{items['NET-CAT6-10']['id']}", json={"active": True})
