"""Settings → Data setup: link GBP listings, Ads accounts, Websites and SEO sites to
merchants in one go (sure matches, review choices, merchants created from listings),
then undo it all.

Needs OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from tests.test_ops_tickets_db import _seed

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")

TAG = uuid.uuid4().hex[:6]
NUM = str(int(TAG, 16) % 10_000_000).zfill(7)


def _db(fn):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url

    async def go():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        try:
            async with async_sessionmaker(eng, expire_on_commit=False)() as db:
                return await fn(db)
        finally:
            await eng.dispose()

    return asyncio.run(go())


@pytest.fixture(scope="module")
def ctx():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app

    seeded = _seed()
    engine.sync_engine.dispose(close=False)

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    engine.sync_engine.dispose(close=False)


def _setup(db):
    from app.models.ads import AdsAccount
    from app.models.enums import ContactRole
    from app.models.gbp import GbpLocation
    from app.models.profiling import Contact, Location, Merchant
    from app.models.seo import SeoSite
    from app.models.website import Website

    async def go():
        ids = {}
        a = Merchant(restaurant_name=f"Olive Tree {TAG}", website_url=f"https://www.olivetree{TAG}.com",
                     online_ordering=f"https://online-ordering.innowi.com/brand/olive{TAG}")
        b = Merchant(restaurant_name=f"Kabob House {TAG}")
        c = Merchant(restaurant_name=f"Zaytoon {TAG}")
        db.add_all([a, b, c])
        await db.flush()
        db.add(Contact(merchant_id=b.id, role=ContactRole.OWNER, phone=f"(510) 5{NUM[:2]}-{NUM[2:6]}"))
        db.add(Location(merchant_id=b.id, city="Fremont", is_primary=True))
        ids.update(a=a.id, b=b.id, c=c.id)

        def loc(key, title, **kw):
            l = GbpLocation(google_location_id=f"locations/{key}{TAG}", title=title, source=kw.pop("source", "GOOGLE"), **kw)
            db.add(l)
            return l

        l1 = loc("l1", "Olive Tree Downtown", ordering_url=f"https://online-ordering.innowi.com/brand/olive{TAG}/", city="Oakland")
        l2 = loc("l2", "Kabob Spot", phone=f"+1 510-5{NUM[:2]}-{NUM[2:6]}", city="Fremont")
        l3a = loc("l3a", f"Brand New Diner {TAG}", city="Hayward", address_line="1 Main St", phone="+1 510-555-0101",
                  primary_category="Diner", regular_hours=[{"day": "MONDAY", "open": "09:00", "close": "17:00"}])
        l3b = loc("l3b", f"Brand New Diner {TAG}", city="Dublin")
        l4 = loc("l4", f"Zaytoon Grill {TAG}", city="Berkeley")
        demo = loc("demo", "Olive Tree Sample", source="DEMO", ordering_url=f"https://online-ordering.innowi.com/brand/olive{TAG}")
        await db.flush()
        ids.update(l1=l1.id, l2=l2.id, l3a=l3a.id, l3b=l3b.id, l4=l4.id, demo=demo.id)

        acc1 = AdsAccount(customer_id=f"1{NUM}01"[:12], name=f"Olive Tree {TAG}")
        acc2 = AdsAccount(customer_id=f"1{NUM}02"[:12], name=f"Brand New Diner {TAG}")
        db.add_all([acc1, acc2])
        site = SeoSite(name=f"olivetree{TAG}.com", domain=f"olivetree{TAG}.com", home_url=f"https://olivetree{TAG}.com/", source="MANUAL")
        db.add(site)
        web = Website(slug=f"kabob{TAG}", name=f"Kabob House {TAG}", values={"business": {"name": f"Kabob House {TAG}"}})
        db.add(web)
        await db.commit()
        ids.update(acc1=acc1.id, acc2=acc2.id, site=site.id, web=web.id)
        return ids

    return go()


def test_link_all_then_undo(ctx):
    from sqlalchemy import delete, select

    from app.models.ads import AdsAccount
    from app.models.gbp import GbpLocation
    from app.models.ops import AppSetting
    from app.models.profiling import Location, Merchant
    from app.models.seo import SeoSite
    from app.models.website import Website

    client, seeded, h = ctx
    ids = _db(_setup)
    base = "/api/v1/settings/data-setup"
    assert client.get(f"{base}/plan", headers=h("sofia")).status_code == 403  # admins only

    # GBP is off in the connector by default (no API access yet); this test covers it, so turn it on.
    assert client.put("/api/v1/settings/connector", headers=h("admin"), json={"modules": {"gbp": True}}).json()["modules"]["gbp"] is True
    st = client.get(f"{base}/status", headers=h("admin")).json()
    assert {m["key"] for m in st["modules"]} == {"gbp", "ads", "seo"}

    plan = client.get(f"{base}/plan", headers=h("admin")).json()
    sure = {i["entityId"]: i for i in plan["sure"]}
    review = {i["entityId"]: i for i in plan["review"]}
    assert sure[ids["l1"]]["merchantId"] == ids["a"] and "Same ordering link" in sure[ids["l1"]]["reasons"]
    assert sure[ids["l2"]]["merchantId"] == ids["b"] and "Same phone" in sure[ids["l2"]]["reasons"]
    assert sure[ids["acc1"]]["merchantId"] == ids["a"]
    assert sure[ids["site"]]["merchantId"] == ids["a"]
    assert sure[ids["web"]]["merchantId"] == ids["b"]
    assert review[ids["l4"]]["candidates"][0]["merchantId"] == ids["c"] and review[ids["l4"]]["canCreate"]
    grp = next(g for g in plan["create"] if g["name"] == f"Brand New Diner {TAG}")
    assert {x["id"] for x in grp["listings"]} == {ids["l3a"], ids["l3b"]}
    assert ids["demo"] not in sure and ids["demo"] not in review  # sample rows are never touched

    r = client.post(f"{base}/apply", headers=h("admin"), json={"decisions": {f"gbp:{ids['l4']}": ids["c"]}})
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["merchantsCreated"] >= 1

    async def check(db):
        g = {k: await db.get(GbpLocation, ids[k]) for k in ("l1", "l2", "l3a", "l3b", "l4", "demo")}
        assert g["l1"].merchant_id == ids["a"] and g["l2"].merchant_id == ids["b"] and g["l4"].merchant_id == ids["c"]
        assert g["demo"].merchant_id is None
        new = g["l3a"].merchant_id
        assert new and new == g["l3b"].merchant_id  # one merchant, two locations
        m = await db.get(Merchant, new)
        locs = (await db.execute(select(Location).where(Location.merchant_id == new).order_by(Location.city))).scalars().all()
        assert m.restaurant_name == f"Brand New Diner {TAG}" and m.cuisine_category == "Diner" and len(locs) == 2
        assert (m.source, m.source_detail) == ("GOOGLE_PROFILE", f"Brand New Diner {TAG}")
        assert any(l.hours == "Mon 09:00–17:00" and l.is_primary for l in locs)
        assert (await db.get(AdsAccount, ids["acc1"])).merchant_id == ids["a"]
        assert (await db.get(AdsAccount, ids["acc2"])).merchant_id == new  # matched through its GBP listing's name
        s = await db.get(SeoSite, ids["site"])
        assert s.merchant_id == ids["a"] and s.gbp_location_id == ids["l1"] and s.ads_account_id == ids["acc1"]
        assert s.name == f"Olive Tree {TAG}"  # domain-only name replaced by the merchant's
        assert (await db.get(Website, ids["web"])).merchant_id == ids["b"]
        return new

    new_merchant = _db(check)

    # Already-linked rows never show up again; coverage shows the merchant's modules.
    plan2 = client.get(f"{base}/plan", headers=h("admin")).json()
    assert ids["l1"] not in {i["entityId"] for i in plan2["sure"] + plan2["review"]}
    cov = {r["merchantId"]: r for r in client.get(f"{base}/coverage", headers=h("admin")).json()["rows"]}
    assert cov[ids["a"]]["gbp"] == 1 and cov[ids["a"]]["ads"] == 1 and cov[ids["a"]]["seoSites"] == 1
    assert cov[new_merchant]["gbp"] == 2
    assert client.get(f"{base}/status", headers=h("admin")).json()["lastLink"]["summary"]["gbp"] >= 4

    u = client.post(f"{base}/undo", headers=h("admin")).json()
    assert u["undone"] > 0

    async def check_undone(db):
        assert (await db.get(GbpLocation, ids["l1"])).merchant_id is None
        assert (await db.get(GbpLocation, ids["l3a"])).merchant_id is None
        assert await db.get(Merchant, new_merchant) is None  # created by the run, removed by undo
        s = await db.get(SeoSite, ids["site"])
        assert s.merchant_id is None and s.gbp_location_id is None and s.ads_account_id is None
        assert s.name == f"olivetree{TAG}.com"
        assert (await db.get(Website, ids["web"])).merchant_id is None
        assert (await db.get(AdsAccount, ids["acc1"])).merchant_id is None

    _db(check_undone)
    client.put("/api/v1/settings/connector", headers=h("admin"), json={"modules": {"gbp": False}})
