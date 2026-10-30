"""The merchant connector (linking/connector.py + engine.py): settings, better name / domain
matching, SEO sites with no merchant offered as new merchants (with their Ads account), each
merchant's connections (list, suggestions, link, unlink, search) and linking right after a
merchant is created.

Pure parts always run; the DB parts need OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import os
import uuid

import pytest

from app.modules.linking import connector
from app.modules.linking import engine as eng

TAG = uuid.uuid4().hex[:6]
NUM = str(int(TAG, 16) % 10_000_000).zfill(7)
db_only = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


# ============================================================ pure ====


def test_settings_clean():
    s = connector.clean(None)
    assert s["modules"] == {"seo": True, "ads": True, "gbp": False, "website": True}
    assert s["autoLinkSure"] and s["runAfterCreate"] and s["offerCreateMerchants"]
    s = connector.clean({"modules": {"gbp": True, "nope": True}, "ignoreDomains": "https://www.Foo.com/x, bar.com\nbar.com", "junk": 1,
                         "extraStopWords": [" Express ", ""]})
    assert s["modules"]["gbp"] is True and "nope" not in s["modules"] and "junk" not in s
    assert s["ignoreDomains"] == ["foo.com", "bar.com"] and s["extraStopWords"] == ["express"]
    assert connector.domain_ignored("innowi.com", connector.clean(None)) and connector.domain_ignored("blog.innowi.com", connector.clean(None))
    assert not connector.domain_ignored("notinnowi.com", connector.clean(None))
    assert connector.ads_ignored("Innowi Inc - Ads", connector.clean(None)) and not connector.ads_ignored("Thai Basil", connector.clean(None))


def _ix(*names, sites=()):
    from app.models.profiling import Merchant

    ms = []
    for i, n in enumerate(names):
        m = Merchant(restaurant_name=n, website_url=sites[i] if i < len(sites) else None)
        m.id = f"m{i}"
        m.locations, m.contacts = [], []
        ms.append(m)
    ix = eng.MerchantIndex(by_id={m.id: m for m in ms})
    for m in ms:
        ix.by_norm[eng.norm_name(m.restaurant_name)].append(m.id)
        ix.tokens[m.id] = eng.name_tokens(m.restaurant_name)
        ix.token_df.update(ix.tokens[m.id])
        if eng.host(m.website_url):
            ix.by_host[eng.host(m.website_url)].add(m.id)
    return ix


def _acc(name):
    from app.models.ads import AdsAccount

    return AdsAccount(name=name, customer_id="1234567890")


def test_ads_names():
    ix = _ix("Thai Basil Restaurant", "De Los Altos Grill", "Holyland", "Pho Ha Plus Diamond Bar", "Shishkabob Mediterranean")
    # same apart from common words → sure
    assert eng.match_account(_acc("Thai Basil"), ix, {})[0] == "m0"
    assert eng.match_account(_acc("De Los Altos"), ix, {})[0] == "m1"
    # contains / nearly / starts the same → review, the good ones pre-chosen
    _, _, c = eng.match_account(_acc("HolyLand Restaurant and Catering"), ix, {})
    assert c[0]["merchantId"] == "m2" and c[0]["score"] == 85 and eng._suggest(c) == "m2"
    _, _, c = eng.match_account(_acc("ShishKebab Mediterranean"), ix, {})
    assert c[0]["merchantId"] == "m4" and c[0]["score"] >= 85
    _, _, c = eng.match_account(_acc("Pho Ha plus Vietnamese Cuisine"), ix, {})
    assert c[0]["merchantId"] == "m3" and eng._suggest(c) is None  # asked, not pre-chosen
    # two extra words is a different restaurant
    _, _, c = eng.match_account(_acc("Los Altos Taqueria Mexican Inc"), ix, {})
    assert not any(x["score"] >= 85 for x in c)


def test_near_domain():
    from app.models.seo import SeoSite

    ix = _ix("Siam Thai Cuisine", sites=["https://siamthaicuisinesanjose.com"])
    site = SeoSite(name="siamthaicuisinesj.com", domain="siamthaicuisinesj.com", home_url="https://siamthaicuisinesj.com/")
    mid, _, c = eng.match_site(site, ix, {})
    assert mid is None and c[0]["merchantId"] == "m0" and "siamthaicuisinesanjose.com" in c[0]["reasons"][0]


def test_pair_account():
    from app.models.seo import SeoSite

    accs = {a: _acc(n) for a, n in [("a1", "Cairo Grill"), ("a2", "Gaters Restaurant"), ("a3", "Rancho Steve's Pizza"), ("a4", "Beanie Cafe NY")]}
    for k, a in accs.items():
        a.id, a.state = k, "active"
    free = set(accs)
    site = lambda d, **kw: SeoSite(name=d, domain=d, home_url=f"https://{d}/", **kw)  # noqa: E731
    assert eng._pair_account(site("cairogrill.us"), accs, free)[0].id == "a1"
    assert eng._pair_account(site("gaters.com"), accs, free)[0].id == "a2"
    assert eng._pair_account(site("ranchostevepizza.com"), accs, free)[0].id == "a3"
    assert eng._pair_account(site("beaniecafeny.com", ads_account_id="a4"), accs, free)[1].startswith("The site already")
    assert eng._pair_account(site("arigatobato.com"), accs, free)[0] is None


# ============================================================== db ====


@pytest.fixture(scope="module")
def ctx():
    if not os.getenv("OPS_TEST_DATABASE_URL"):
        pytest.skip("needs OPS_TEST_DATABASE_URL")
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app
    from tests.test_ops_tickets_db import _seed

    seeded = _seed()
    engine.sync_engine.dispose(close=False)

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, headers
    engine.sync_engine.dispose(close=False)


def _setup(db):
    from app.models.ads import AdsAccount
    from app.models.profiling import Merchant
    from app.models.seo import SeoSite

    async def go():
        m = Merchant(restaurant_name=f"Lotus Garden {TAG}", website_url=f"https://lotusgarden{TAG}.com")
        db.add(m)
        await db.flush()
        mk = lambda d: SeoSite(name=d, domain=d, home_url=f"https://{d}/", source="MANUAL")  # noqa: E731
        s1, s2, s3, sx = mk(f"lotusgarden{TAG}.com"), mk(f"cedarhouse{TAG}.com"), mk(f"lonelysite{TAG}.com"), mk(f"blog{TAG}.innowi.com")
        a1 = AdsAccount(customer_id=f"7{NUM}1"[:10], name=f"Lotus Garden {TAG} Restaurant")
        a2 = AdsAccount(customer_id=f"7{NUM}2"[:10], name=f"Cedar House {TAG}")
        a3 = AdsAccount(customer_id=f"7{NUM}3"[:10], name=f"Innowi {TAG} Ads")
        db.add_all([s1, s2, s3, sx, a1, a2, a3])
        await db.commit()
        return {"m": m.id, "s1": s1.id, "s2": s2.id, "s3": s3.id, "sx": sx.id, "a1": a1.id, "a2": a2.id, "a3": a3.id}

    return go()


def _db(fn):
    from tests.test_data_setup_db import _db as run

    return run(fn)


@db_only
def test_connector_end_to_end(ctx):
    from app.models.ads import AdsAccount
    from app.models.profiling import Merchant
    from app.models.seo import SeoSite

    client, h = ctx
    ids = _db(_setup)

    # Settings: admins only; GBP off by default.
    assert client.get("/api/v1/settings/connector", headers=h("sofia")).status_code == 403
    st = client.get("/api/v1/settings/connector", headers=h("admin")).json()
    assert st["modules"]["gbp"] is False and "innowi.com" in st["ignoreDomains"]

    plan = client.get("/api/v1/settings/data-setup/plan", headers=h("admin")).json()
    assert plan["modules"]["gbp"]["enabled"] is False
    sure = {i["entityId"]: i for i in plan["sure"]}
    assert sure[ids["s1"]]["merchantId"] == ids["m"] and sure[ids["a1"]]["merchantId"] == ids["m"]
    grp = next(g for g in plan["create"] if g.get("seo", {}).get("id") == ids["s2"])
    assert grp["ads"]["id"] == ids["a2"] and grp["name"] == f"Cedar House {TAG}" and grp["preselect"]
    lonely = next(g for g in plan["create"] if g.get("seo", {}).get("id") == ids["s3"])
    assert lonely["ads"] is None and not lonely["preselect"]
    every = {i["entityId"] for k in ("sure", "review", "unmatched") for i in plan[k]} | {g["seo"]["id"] for g in plan["create"] if g.get("seo")}
    assert ids["sx"] not in every and ids["a3"] not in every  # Innowi's own site / Ads account are ignored

    # The merchant page: suggestions before anything is linked.
    c = client.get(f"/api/v1/merchants/{ids['m']}/links", headers=h("admin")).json()
    assert c["modules"]["gbp"]["enabled"] is False
    assert [s["id"] for s in c["modules"]["seo"]["suggestions"]] == [ids["s1"]] and c["modules"]["seo"]["suggestions"][0]["sure"]
    assert c["modules"]["ads"]["suggestions"][0]["id"] == ids["a1"]

    # Connect this merchant: its sure matches are linked (and nothing else).
    r = client.post("/api/v1/merchants/connect", headers=h("admin"), json={"merchantIds": [ids["m"]]}).json()
    assert r["summary"]["seo"] == 1 and r["summary"]["ads"] == 1, r  # + seoFields: the site got its Ads account
    c = client.get(f"/api/v1/merchants/{ids['m']}/links", headers=h("admin")).json()
    assert [x["id"] for x in c["modules"]["seo"]["linked"]] == [ids["s1"]] and not c["modules"]["seo"]["suggestions"]

    async def site_has_ads(db):
        s = await db.get(SeoSite, ids["s1"])
        assert s.ads_account_id == ids["a1"] and s.name == f"Lotus Garden {TAG}"
        assert (await db.get(SeoSite, ids["s2"])).merchant_id is None  # other merchants' rows untouched
    _db(site_has_ads)

    # Unlink / search / link by hand.
    assert client.delete(f"/api/v1/merchants/{ids['m']}/links/ads/{ids['a1']}", headers=h("admin")).status_code == 204
    _db(lambda db: _assert_ads_cleared(db, ids))
    found = client.get(f"/api/v1/merchants/{ids['m']}/links/search", params={"module": "ads", "q": f"lotus garden {TAG}"}, headers=h("admin")).json()["data"]
    assert [f["id"] for f in found] == [ids["a1"]]
    r = client.post(f"/api/v1/merchants/{ids['m']}/links", headers=h("admin"), json={"module": "ads", "entityId": ids["a1"]})
    assert r.status_code == 200, r.text
    # Someone else's record can't be taken over.
    other = client.post("/api/v1/merchants", headers=h("admin"), json={"restaurantName": f"Other {TAG}"}).json()["id"]
    r = client.post(f"/api/v1/merchants/{other}/links", headers=h("admin"), json={"module": "ads", "entityId": ids["a1"]})
    assert r.status_code == 409 and "Lotus Garden" in r.json()["message"]

    # Data setup creates the merchant for the SEO site + Ads pair.
    r = client.post("/api/v1/settings/data-setup/apply", headers=h("admin"), json={"create": [grp["id"]]})
    assert r.status_code == 200, r.text

    async def created(db):
        s2 = await db.get(SeoSite, ids["s2"])
        m = await db.get(Merchant, s2.merchant_id)
        assert m.restaurant_name == f"Cedar House {TAG}" and m.website_url == f"https://cedarhouse{TAG}.com"
        assert (await db.get(AdsAccount, ids["a2"])).merchant_id == m.id
        assert (await db.get(SeoSite, ids["s3"])).merchant_id is None  # not ticked
        return m.id
    cedar = _db(created)
    assert client.post("/api/v1/settings/data-setup/undo", headers=h("admin")).json()["undone"] > 0
    _db(lambda db: _assert_gone(db, cedar, ids))
    _db(_cleanup)


async def _assert_ads_cleared(db, ids):
    from app.models.ads import AdsAccount
    from app.models.seo import SeoSite

    assert (await db.get(AdsAccount, ids["a1"])).merchant_id is None
    assert (await db.get(SeoSite, ids["s1"])).ads_account_id is None  # it came through this merchant


async def _assert_gone(db, cedar, ids):
    from app.models.profiling import Merchant
    from app.models.seo import SeoSite

    assert await db.get(Merchant, cedar) is None and (await db.get(SeoSite, ids["s2"])).merchant_id is None


@db_only
def test_new_merchant_connects_itself(ctx):
    from app.models.ads import AdsAccount
    from app.models.seo import SeoSite

    client, h = ctx

    async def setup(db):
        s = SeoSite(name=f"maplebistro{TAG}.com", domain=f"maplebistro{TAG}.com", home_url=f"https://maplebistro{TAG}.com/", source="MANUAL")
        a = AdsAccount(customer_id=f"8{NUM}1"[:10], name=f"Maple Bistro {TAG}")
        db.add_all([s, a])
        await db.commit()
        return s.id, a.id
    sid, aid = _db(setup)
    r = client.post("/api/v1/merchants", headers=h("admin"), json={"restaurantName": f"Maple Bistro {TAG}", "websiteUrl": f"https://www.maplebistro{TAG}.com/menu"})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]

    async def check(db):
        assert (await db.get(SeoSite, sid)).merchant_id == mid
        assert (await db.get(AdsAccount, aid)).merchant_id == mid
    _db(check)

    # Turned off → a new merchant links nothing by itself.
    client.put("/api/v1/settings/connector", headers=h("admin"), json={"runAfterCreate": False})
    try:
        async def setup2(db):
            s = SeoSite(name=f"quietplace{TAG}.com", domain=f"quietplace{TAG}.com", home_url=f"https://quietplace{TAG}.com/", source="MANUAL")
            db.add(s)
            await db.commit()
            return s.id
        sid2 = _db(setup2)
        client.post("/api/v1/merchants", headers=h("admin"), json={"restaurantName": f"Quiet Place {TAG}", "websiteUrl": f"https://quietplace{TAG}.com"})

        async def check2(db):
            assert (await db.get(SeoSite, sid2)).merchant_id is None
        _db(check2)
    finally:
        client.put("/api/v1/settings/connector", headers=h("admin"), json={"runAfterCreate": True})
        _db(_cleanup)


async def _cleanup(db):
    """Other suites count SEO sites with an Ads account; leave none of ours behind."""
    from sqlalchemy import delete

    from app.models.ads import AdsAccount
    from app.models.seo import SeoSite

    await db.execute(delete(SeoSite).where(SeoSite.domain.like(f"%{TAG}%")))
    await db.execute(delete(AdsAccount).where(AdsAccount.name.like(f"%{TAG}%")))
    await db.commit()
