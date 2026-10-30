"""Blog Impact (modules/seo/blogs.py): the pure helpers, and a full run
against a real Postgres with Google and the website mocked — including the
rule that matters most: a run where Google's freshness markers haven't moved
fetches nothing again.

The DB part needs OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import uuid

import httpx
import pytest

from app.modules.seo import blogs


# ============================================================ pure ====


def test_norm_url_and_path():
    assert blogs.norm_url("https://www.Example.com/Best-Noodles/?utm=x#top") == "example.com/best-noodles"
    assert blogs.norm_url("http://example.com/best-noodles") == "example.com/best-noodles"
    assert blogs.norm_url("https://example.com/") == "example.com/"
    assert blogs.norm_path("/Best-Noodles/?a=1") == "/best-noodles"
    assert blogs.norm_path("") == "/"


def test_parse_metadata_snake_and_camel():
    d, h = blogs.parse_metadata({"metadata": {"first_incomplete_date": "2026-10-20", "first_incomplete_hour": "2026-10-22T09:00:00-07:00"}})
    assert d == dt.date(2026, 10, 20) and h == dt.datetime(2026, 10, 22, 9, tzinfo=dt.timezone(dt.timedelta(hours=-7)))
    d, h = blogs.parse_metadata({"metadata": {"firstIncompleteDate": "2026-10-19"}})
    assert d == dt.date(2026, 10, 19) and h is None
    assert blogs.parse_metadata({}) == (None, None)
    assert blogs.parse_metadata({"metadata": {"first_incomplete_date": "junk"}}) == (None, None)


def test_final_through():
    today = dt.date(2026, 10, 22)
    assert blogs.final_through(dt.date(2026, 10, 20), [], today) == dt.date(2026, 10, 19)
    rows = [{"keys": ["2026-10-17"]}, {"keys": ["2026-10-18"]}]
    assert blogs.final_through(None, rows, today) == dt.date(2026, 10, 18)  # no marker: everything returned is final
    assert blogs.final_through(None, [], today) == dt.date(2026, 10, 19)


def test_unchanged():
    from app.models.seo import SeoBlogState

    h = dt.datetime(2026, 10, 22, 9, tzinfo=dt.timezone.utc)
    st = SeoBlogState(site_id="x", gsc_first_incomplete_date=dt.date(2026, 10, 20), gsc_first_incomplete_hour=h, checked_at=None)
    assert blogs.unchanged(st, dt.date(2026, 10, 20), h) is False  # never checked
    st.checked_at = h
    assert blogs.unchanged(st, dt.date(2026, 10, 20), h) is True
    assert blogs.unchanged(st, dt.date(2026, 10, 21), h) is False
    assert blogs.unchanged(st, dt.date(2026, 10, 20), h + dt.timedelta(hours=1)) is False
    assert blogs.unchanged(None, None, None) is False


def test_default_brand_terms():
    from app.models.seo import SeoSite

    assert blogs.default_brand_terms(SeoSite(domain="phohaplus.com", name="phohaplus.com")) == ["phohaplus"]
    assert blogs.default_brand_terms(SeoSite(domain="phohaplus.com", name="Pho Ha Plus!")) == ["phohaplus", "pho ha plus"]
    assert blogs.default_brand_terms(SeoSite(domain="ab.com", name="ab.com")) == []


def test_parse_wp_posts_and_sitemap():
    items = [
        {"link": "https://www.olive.com/best-spicy-noodles/", "date": "2026-10-17T10:00:00", "title": {"rendered": "Best &amp; Spicy <b>Noodles</b>"}},
        {"link": "https://other.com/x/", "date": "2026-10-01T10:00:00", "title": {"rendered": "Elsewhere"}},
        {"date": "2026-10-01T10:00:00"},
    ]
    got = blogs.parse_wp_posts(items, "olive.com")
    assert got == [{"url": "https://www.olive.com/best-spicy-noodles/", "title": "Best & Spicy Noodles", "published_on": dt.date(2026, 10, 17)}]
    assert blogs.parse_wp_posts({"code": "rest_no_route"}, "olive.com") == []
    xml = ('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
           '<url><loc>https://olive.com/</loc></url>'
           '<url><loc>https://olive.com/family-dinner-guide/</loc><lastmod>2026-09-22T08:00:00+00:00</lastmod></url>'
           '<url><loc>https://elsewhere.com/a/</loc></url></urlset>')
    assert blogs.parse_sitemap(xml, "olive.com") == [{"url": "https://olive.com/family-dinner-guide/", "title": None, "published_on": dt.date(2026, 9, 22)}]
    assert blogs.parse_sitemap("<not xml", "olive.com") == []


def test_gsc_page_rows_keeps_posts_and_merges_variants():
    by_url = {"olive.com/a": "p1"}
    rows = [
        {"keys": ["2026-10-01", "https://olive.com/a/"], "clicks": 2, "impressions": 10, "position": 4.0},
        {"keys": ["2026-10-01", "https://www.olive.com/a"], "clicks": 1, "impressions": 30, "position": 8.0},
        {"keys": ["2026-10-01", "https://olive.com/menu/"], "clicks": 9, "impressions": 90, "position": 1.0},
    ]
    got = blogs.gsc_page_rows(rows, by_url, "date")
    assert got == [{"post_id": "p1", "date": dt.date(2026, 10, 1), "clicks": 3, "impressions": 40, "position": 7.0}]
    hourly = blogs.gsc_page_rows([{"keys": ["2026-10-22T09:00:00-07:00", "https://olive.com/a/"], "clicks": 0, "impressions": 3}], by_url, "hour")
    assert hourly[0]["hour"].hour == 9 and hourly[0]["position"] is None


def test_ga4_by_post():
    landing = {"rows": [
        {"dimensionValues": [{"value": "20261020"}, {"value": "/a/"}, {"value": "Organic Search"}], "metricValues": [{"value": "5"}, {"value": "3"}]},
        {"dimensionValues": [{"value": "20261020"}, {"value": "/a?x=1"}, {"value": "Direct"}], "metricValues": [{"value": "2"}, {"value": "1"}]},
        {"dimensionValues": [{"value": "20261020"}, {"value": "/menu/"}, {"value": "Organic Search"}], "metricValues": [{"value": "50"}, {"value": "30"}]},
    ]}
    clicks = {"rows": [{"dimensionValues": [{"value": "20261020"}, {"value": "/a/"}], "metricValues": [{"value": "4"}]}]}
    got = blogs.ga4_by_post(landing, clicks, {"/a": "p1"})
    assert got == {("p1", dt.date(2026, 10, 20)): {"sessions": 7, "organic_sessions": 5, "engaged_sessions": 4, "order_clicks": 4}}


def test_ga4_click_filter_targets_innowi_ordering():
    _, clicks = blogs.ga4_bodies(dt.date(2026, 10, 1), dt.date(2026, 10, 3))
    exprs = clicks["dimensionFilter"]["andGroup"]["expressions"]
    assert {"fieldName": "linkDomain", "stringFilter": {"matchType": "CONTAINS", "value": "online-ordering.innowi.com"}} in [e["filter"] for e in exprs]


def test_parse_inspection_reads_last_crawl():
    got = blogs.parse_inspection({"inspectionResult": {"indexStatusResult": {"verdict": "PASS", "coverageState": "Submitted and indexed",
                                                                            "lastCrawlTime": "2026-10-21T09:12:00Z"}}})
    assert got == {"index_verdict": "PASS", "coverage_state": "Submitted and indexed",
                   "google_last_crawl_at": dt.datetime(2026, 10, 21, 9, 12, tzinfo=dt.timezone.utc)}
    assert blogs.parse_inspection({})["google_last_crawl_at"] is None


# ============================================================== DB ====

db_only = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")

NOW = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)  # 05:00 in Los Angeles → Search Console day 2026-10-22
TAG = uuid.uuid4().hex[:6]
DOM = f"blogolive{TAG}.com"
POST_A = f"https://{DOM}/best-spicy-noodle-dishes-fall/"  # published 2026-10-17 (hourly data)
POST_B = f"https://{DOM}/family-dinner-combos-guide/"  # published 2026-09-22


def google_mock(state: dict, calls: list):
    def day_range(body):
        a, b = dt.date.fromisoformat(body["startDate"]), dt.date.fromisoformat(body["endDate"])
        while a <= b:
            yield a
            a += dt.timedelta(days=1)

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url.startswith("https://oauth2.googleapis.com/token"):
            return httpx.Response(200, json={"access_token": "at"})
        if f"//{DOM}/wp-json/wp/v2/posts" in url:
            return httpx.Response(200, headers={"content-type": "application/json", "x-wp-totalpages": "1"}, json=[
                {"link": POST_A, "date": "2026-10-17T10:00:00", "title": {"rendered": "Best Spicy Noodle Dishes to Try This Fall"}},
                {"link": POST_B, "date": "2026-09-22T10:00:00", "title": {"rendered": "Our Guide to Family Dinner Combos"}},
            ])
        if "searchAnalytics/query" in url:
            body = json.loads(req.content)
            dims, ds = body.get("dimensions"), body.get("dataState", "final")
            flts = [f for g in body.get("dimensionFilterGroups") or [] for f in g.get("filters", [])]
            us = any(f["dimension"] == "country" and f["expression"] == "usa" for f in flts)
            by_query = any(f["dimension"] == "query" for f in flts)
            calls.append(("gsc", tuple(dims), ds, body["startDate"], body["endDate"], by_query, us))
            k = 2 if us else 1  # US numbers: half of the clicks / impressions
            if dims == ["date"] and ds == "all":
                return httpx.Response(200, json={"rows": [{"keys": [d.isoformat()], "clicks": 1, "impressions": 9} for d in day_range(body)],
                                                 "metadata": {"first_incomplete_date": state["fid"]}})
            if dims == ["hour"]:
                return httpx.Response(200, json={"rows": [], "metadata": {"first_incomplete_hour": state["fih"]}})
            if dims == ["date"] and by_query:  # non-brand totals
                return httpx.Response(200, json={"rows": [{"keys": [d.isoformat()], "clicks": 3 if not us else 2, "impressions": 40 // k}
                                                          for d in day_range(body)]})
            if dims == ["date"] and us:  # the site's US totals
                return httpx.Response(200, json={"rows": [{"keys": [d.isoformat()], "clicks": 30, "impressions": 300} for d in day_range(body)]})
            if dims == ["date", "page"]:
                rows = []
                for d in day_range(body):
                    if d >= dt.date(2026, 10, 18):
                        rows.append({"keys": [d.isoformat(), POST_A], "clicks": 2 // k, "impressions": 20 // k, "position": 8.0})
                    if d >= dt.date(2026, 9, 23) and not us:  # post B has no US searches
                        rows.append({"keys": [d.isoformat(), POST_B.rstrip("/")], "clicks": 1, "impressions": 10, "position": 6.0})
                    rows.append({"keys": [d.isoformat(), f"https://{DOM}/menu/"], "clicks": 50 // k, "impressions": 500 // k, "position": 2.0})
                return httpx.Response(200, json={"rows": rows})
            if dims == ["hour", "page"]:
                return httpx.Response(200, json={"rows": [{"keys": ["2026-10-22T03:00:00-07:00", POST_A], "clicks": 0, "impressions": 4, "position": 12.0}]})
            if dims == ["page", "query"]:
                q = "spicy noodles near me" if not us else "spicy noodles san jose"
                return httpx.Response(200, json={"rows": [{"keys": [POST_A, q], "clicks": 5, "impressions": 80, "position": 8.4}]})
        if "urlInspection" in url:
            calls.append(("inspect", json.loads(req.content)["inspectionUrl"]))
            return httpx.Response(200, json={"inspectionResult": {"indexStatusResult": {"verdict": "PASS", "coverageState": "Submitted and indexed",
                                                                                      "lastCrawlTime": "2026-10-19T16:40:00Z"}}})
        if ":runReport" in url:
            body = json.loads(req.content)
            us = '"countryId"' in json.dumps(body.get("dimensionFilter") or {})
            dims = [d["name"] for d in body["dimensions"]]
            calls.append(("ga4", body["dateRanges"][0]["startDate"], "dimensionFilter" in body, us, tuple(dims)))
            if dims == ["date"]:  # the site's US organic sessions
                return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": "20261020"}], "metricValues": [{"value": "11"}]}]})
            if dims == ["date", "pagePath"]:  # order clicks
                return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": "20261021"}, {"value": "/best-spicy-noodle-dishes-fall/"}],
                                                           "metricValues": [{"value": "1" if us else "3"}]}]})
            return httpx.Response(200, json={"rows": [{"dimensionValues": [{"value": "20261021"}, {"value": "/best-spicy-noodle-dishes-fall"},
                                                                           {"value": "Organic Search"}], "metricValues": [{"value": "4" if us else "6"}, {"value": "4"}]}]})
        return httpx.Response(404, text="not mocked: " + url)

    return httpx.MockTransport(handler)


@pytest.fixture()
def dbenv():
    from app.config import get_settings

    s = get_settings()
    old = (s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET)
    s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET = "cid", "csecret"
    yield
    s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET = old


def _go(fn):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url

    async def wrapper():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        S = async_sessionmaker(eng, expire_on_commit=False, autoflush=False)
        try:
            async with S() as db:
                return await fn(db)
        finally:
            await eng.dispose()

    return asyncio.run(wrapper())


async def _setup(db):
    from sqlalchemy import delete, update

    from app.common.security.crypto import encrypt_secret
    from app.models.seo import SeoBlogRun, SeoConnection, SeoSite

    await db.execute(delete(SeoConnection))
    await db.execute(delete(SeoSite).where(SeoSite.domain == DOM))  # a fresh site per test
    await db.execute(update(SeoSite).where(SeoSite.status == "active").values(status="paused"))  # only our site in these runs
    await db.execute(update(SeoBlogRun).where(SeoBlogRun.status == "running").values(status="failed"))
    db.add(SeoConnection(google_email="seo@innowi.test", refresh_token_encrypted=encrypt_secret("rt"), status="connected",
                         scopes="https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly",
                         ga4_properties=[]))
    site = SeoSite(source="GOOGLE", name="Olive Blog Test", domain=DOM, home_url=f"https://{DOM}/", gsc_property=f"sc-domain:{DOM}",
                   ga4_property="properties/123")
    db.add(site)
    await db.commit()
    return site.id


async def _run(db, transport, now=NOW):
    from app.modules.seo import blogs as b

    run = await b.create_run(db, "manual", None)
    async with httpx.AsyncClient(transport=transport) as http:
        run = await b.run_blogs(db, run.id, http=http, now=now)
    return run


@db_only
def test_blog_run_end_to_end_and_no_refetch(dbenv):
    from sqlalchemy import func, select

    from app.models.seo import SeoBlogGa4Daily, SeoBlogGscDaily, SeoBlogGscHourly, SeoBlogPost, SeoBlogQuery, SeoBlogSiteDaily, SeoBlogState

    state = {"fid": "2026-10-20", "fih": "2026-10-22T04:00:00-07:00"}
    calls: list = []
    transport = google_mock(state, calls)

    async def first(db):
        site_id = await _setup(db)
        run = await _run(db, transport)
        assert (run.status, run.sites, run.sites_unchanged, run.sites_failed) == ("success", 1, 0, 0), run.error
        posts = {p.url: p for p in (await db.execute(select(SeoBlogPost).where(SeoBlogPost.site_id == site_id))).scalars()}
        assert set(posts) == {POST_A, POST_B}
        a, b_ = posts[POST_A], posts[POST_B]
        assert a.title == "Best Spicy Noodle Dishes to Try This Fall" and a.published_on == dt.date(2026, 10, 17) and a.source == "wordpress"
        assert a.gsc_final_through == dt.date(2026, 10, 19) and a.indexed_on == dt.date(2026, 10, 18)  # first impression
        assert a.index_verdict == "PASS" and a.google_last_crawl_at == dt.datetime(2026, 10, 19, 16, 40, tzinfo=dt.timezone.utc)
        daily = (await db.execute(select(SeoBlogGscDaily).where(SeoBlogGscDaily.post_id == a.id, SeoBlogGscDaily.scope == "all")
                                  .order_by(SeoBlogGscDaily.date))).scalars().all()
        assert [(r.date.day, r.clicks, r.is_final) for r in daily] == [(18, 2, True), (19, 2, True), (20, 2, False), (21, 2, False), (22, 2, False)]
        # US-only numbers stored next to them, with their own "fetched through" marker
        us_daily = (await db.execute(select(SeoBlogGscDaily).where(SeoBlogGscDaily.post_id == a.id, SeoBlogGscDaily.scope == "us")
                                     .order_by(SeoBlogGscDaily.date))).scalars().all()
        assert [(r.date.day, r.clicks, r.is_final) for r in us_daily] == [(18, 1, True), (19, 1, True), (20, 1, False), (21, 1, False), (22, 1, False)]
        assert a.us_gsc_final_through == dt.date(2026, 10, 19) and a.us_ga4_through == dt.date(2026, 10, 21)
        # the slash-less URL Search Console reported still lands on post B; the menu page is not a post
        nb = await db.scalar(select(func.count()).select_from(SeoBlogGscDaily).where(SeoBlogGscDaily.post_id == b_.id, SeoBlogGscDaily.is_final.is_(True),
                                                                                     SeoBlogGscDaily.scope == "all"))
        assert nb == (dt.date(2026, 10, 19) - dt.date(2026, 9, 23)).days + 1
        assert await db.scalar(select(func.count()).select_from(SeoBlogGscHourly).where(SeoBlogGscHourly.post_id == a.id)) == 2  # all + us
        assert await db.scalar(select(func.count()).select_from(SeoBlogGscHourly).where(SeoBlogGscHourly.post_id == b_.id)) == 0  # not young
        q = (await db.execute(select(SeoBlogQuery).where(SeoBlogQuery.post_id == a.id).order_by(SeoBlogQuery.scope))).scalars().all()
        assert [(x.scope, x.query, x.clicks) for x in q] == [("all", "spicy noodles near me", 5), ("us", "spicy noodles san jose", 5)]
        ga = (await db.execute(select(SeoBlogGa4Daily).where(SeoBlogGa4Daily.post_id == a.id).order_by(SeoBlogGa4Daily.scope))).scalars().all()
        assert [(g.scope, g.date, g.sessions, g.organic_sessions, g.order_clicks) for g in ga] == [
            ("all", dt.date(2026, 10, 21), 6, 6, 3), ("us", dt.date(2026, 10, 21), 4, 4, 1)]
        st = await db.get(SeoBlogState, site_id)
        assert st.brand_terms == [f"blogolive{TAG}", "olive blog test"]
        assert st.gsc_first_incomplete_date == dt.date(2026, 10, 20) and st.gsc_final_through == dt.date(2026, 10, 19)
        assert st.nonbrand_through == st.us_nonbrand_through == st.us_site_through == dt.date(2026, 10, 19)
        assert st.us_ga4_site_through == dt.date(2026, 10, 21)
        assert await db.scalar(select(func.count()).select_from(SeoBlogSiteDaily).where(SeoBlogSiteDaily.site_id == site_id,
                                                                                         SeoBlogSiteDaily.scope == "all")) > 300
        us_day = (await db.execute(select(SeoBlogSiteDaily).where(SeoBlogSiteDaily.site_id == site_id, SeoBlogSiteDaily.scope == "us",
                                                                  SeoBlogSiteDaily.date == dt.date(2026, 10, 19)))).scalar_one()
        assert (us_day.clicks, us_day.impressions, us_day.nonbrand_clicks, us_day.organic_sessions) == (30, 300, 2, 0)
        return site_id

    site_id = _go(first)
    assert any(c[0] == "gsc" and c[1] == ("date", "page") and c[2] == "final" and not c[6] for c in calls)
    assert any(c[0] == "gsc" and c[1] == ("date", "page") and c[2] == "final" and c[6] for c in calls)
    assert {(c[3], c[4]) for c in calls if c[0] == "ga4"} and any(c[0] == "ga4" and c[3] for c in calls)
    assert sum(1 for c in calls if c[0] == "inspect") == 2

    # ---- same freshness markers, later the same day: nothing is fetched again ----
    calls.clear()

    async def second(db):
        run = await _run(db, transport, NOW + dt.timedelta(hours=7))
        assert (run.status, run.sites_unchanged) == ("success", 1), run.error
        st = await db.get(SeoBlogState, site_id)
        assert st.checked_at == NOW + dt.timedelta(hours=7) and st.changed_at == NOW

    _go(second)
    gsc = [c for c in calls if c[0] == "gsc"]
    assert [c[1] for c in gsc] == [("date",), ("hour",)], gsc  # the two freshness probes only
    assert not [c for c in calls if c[0] == "inspect"]  # indexed and checked < 7 days ago

    # ---- Google finalised two more days: only those are fetched as final ----
    calls.clear()
    state.update(fid="2026-10-22", fih="2026-10-22T11:00:00-07:00")

    async def third(db):
        run = await _run(db, transport, NOW + dt.timedelta(hours=10))
        assert (run.status, run.sites_unchanged) == ("success", 0), run.error
        a = (await db.execute(select(SeoBlogPost).where(SeoBlogPost.url == POST_A))).scalar_one()
        assert a.gsc_final_through == dt.date(2026, 10, 21)
        for scope in ("all", "us"):
            daily = (await db.execute(select(SeoBlogGscDaily).where(SeoBlogGscDaily.post_id == a.id, SeoBlogGscDaily.scope == scope)
                                      .order_by(SeoBlogGscDaily.date))).scalars().all()
            assert [(r.date.day, r.is_final) for r in daily] == [(18, True), (19, True), (20, True), (21, True), (22, False)], scope

    _go(third)
    final = [c for c in calls if c[0] == "gsc" and c[1] == ("date", "page") and c[2] == "final"]
    assert [(c[3], c[4], c[6]) for c in final] == [("2026-10-20", "2026-10-21", False), ("2026-10-20", "2026-10-21", True)]
    nonbrand = [c for c in calls if c[0] == "gsc" and c[1] == ("date",) and c[5]]
    assert [(c[3], c[4], c[6]) for c in nonbrand] == [("2026-10-20", "2026-10-21", False), ("2026-10-20", "2026-10-21", True)]
    site_us = [c for c in calls if c[0] == "gsc" and c[1] == ("date",) and c[6] and not c[5]]
    assert [(c[3], c[4]) for c in site_us] == [("2026-10-20", "2026-10-21")]


@db_only
def test_blog_run_is_one_at_a_time(dbenv):
    async def go(db):
        from app.models.seo import SeoBlogRun
        from sqlalchemy import update

        await db.execute(update(SeoBlogRun).where(SeoBlogRun.status == "running").values(status="failed"))
        await db.commit()
        await blogs.create_run(db, "manual", None)
        with pytest.raises(blogs.RunBusy):
            await blogs.create_run(db, "manual", None)
        await db.execute(update(SeoBlogRun).where(SeoBlogRun.status == "running").values(status="failed"))
        await db.commit()

    _go(go)


# ========================================================== schedule ====


def test_clean_times():
    from app.modules.seo import blog_schedule as bs

    assert bs.clean_times(["20:00", "6:00", "13:00", "06:00"]) == ["06:00", "13:00", "20:00"]
    for bad in (["25:00"], ["6pm"], [""], ["12:60"]):
        with pytest.raises(ValueError):
            bs.clean_times(bad)
    with pytest.raises(ValueError):
        bs.clean_times([f"{h:02d}:00" for h in range(9)])


def test_slots_and_due_in_karachi_time():
    from app.modules.seo import blog_schedule as bs

    times, tz = ["06:00", "13:00", "20:00"], "Asia/Karachi"  # UTC+5
    now = dt.datetime(2026, 10, 22, 9, 0, tzinfo=dt.timezone.utc)  # 14:00 in Karachi
    assert bs.last_slot(now, times, tz) == dt.datetime(2026, 10, 22, 8, 0, tzinfo=dt.timezone.utc)  # 13:00 PKT
    assert bs.next_slot(now, times, tz) == dt.datetime(2026, 10, 22, 15, 0, tzinfo=dt.timezone.utc)  # 20:00 PKT
    early = dt.datetime(2026, 10, 22, 0, 30, tzinfo=dt.timezone.utc)  # 05:30 PKT → yesterday 20:00 was the last one
    assert bs.last_slot(early, times, tz) == dt.datetime(2026, 10, 21, 15, 0, tzinfo=dt.timezone.utc)
    assert bs.is_due(now, None, times, tz) is True
    assert bs.is_due(now, dt.datetime(2026, 10, 22, 8, 5, tzinfo=dt.timezone.utc), times, tz) is False  # 13:05 run already done
    assert bs.is_due(now, dt.datetime(2026, 10, 22, 1, 5, tzinfo=dt.timezone.utc), times, tz) is True  # last run 06:05; 13:00 passed
    # API down from 05:00 to 21:00: the missed 06:00, 13:00 and 20:00 make one run, not three
    late = dt.datetime(2026, 10, 22, 16, 0, tzinfo=dt.timezone.utc)
    last = dt.datetime(2026, 10, 21, 15, 2, tzinfo=dt.timezone.utc)
    assert bs.is_due(late, last, times, tz) is True and bs.is_due(late, late, times, tz) is False
    assert bs.is_due(now, None, [], tz) is False and bs.next_slot(now, [], tz) is None


# ========================================================== API (DB) ====


@db_only
def test_blog_api_schedule_refresh_and_impact(dbenv, monkeypatch):
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app
    from app.modules.seo import blogs as b
    from tests.test_ops_tickets_db import _seed

    seeded = _seed()
    engine.sync_engine.dispose(close=False)

    def h(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    state = {"fid": "2026-10-20", "fih": "2026-10-22T04:00:00-07:00"}
    transport = google_mock(state, [])

    async def setup(db):
        from sqlalchemy import delete

        from app.models.seo import SeoBlogSchedule

        await db.execute(delete(SeoBlogSchedule))  # back to the defaults
        site_id = await _setup(db)
        await _run(db, transport)
        return site_id

    site_id = _go(setup)
    engine.sync_engine.dispose(close=False)

    with TestClient(app) as client:
        st = client.get("/api/v1/seo/blogs/status", headers=h("sofia")).json()
        assert st["schedule"]["times"] == ["06:00", "13:00", "20:00"] and st["schedule"]["enabled"] is True
        assert st["schedule"]["timezone"] == "Asia/Karachi" and st["schedule"]["nextAt"]
        assert st["lastRun"]["status"] == "success"
        assert client.put("/api/v1/seo/blogs/schedule", headers=h("sofia"), json={"enabled": True, "times": ["09:00"]}).status_code == 403
        r = client.put("/api/v1/seo/blogs/schedule", headers=h("aima"), json={"enabled": True, "times": ["21:30", "9:00", "09:00"]})
        assert r.status_code == 200 and r.json()["times"] == ["09:00", "21:30"]
        assert client.put("/api/v1/seo/blogs/schedule", headers=h("aima"), json={"enabled": True, "times": ["9pm"]}).status_code == 400
        assert client.put("/api/v1/seo/blogs/schedule", headers=h("aima"), json={"enabled": True, "times": []}).status_code == 400
        r = client.put("/api/v1/seo/blogs/schedule", headers=h("aima"), json={"enabled": False, "times": []})
        assert r.status_code == 200 and r.json()["nextAt"] is None
        client.put("/api/v1/seo/blogs/schedule", headers=h("aima"), json={"enabled": True, "times": ["06:00", "13:00", "20:00"]})

        sites = client.get("/api/v1/seo/blogs/sites", headers=h("sofia")).json()["data"]
        mine = next(x for x in sites if x["id"] == site_id)
        assert mine["posts"] == 2 and mine["checkedAt"]

        monkeypatch.setattr(b, "gsc_today", lambda now=None: dt.date(2026, 10, 22))
        imp = client.get(f"/api/v1/seo/blogs/sites/{site_id}", headers=h("sofia")).json()
        assert imp["freshness"]["finalThrough"] == "2026-10-19" and imp["window"]["end"] == "2026-10-19"
        k = imp["kpis"]
        assert k["postsLive"] == 2 and k["postsIndexed"] == 2 and k["postsThisMonth"] == 1
        # 28 final days to Oct 19: post A Oct 18–19 (2 × 2 clicks), post B Sep 23–Oct 19 (27 × 1)
        assert k["clicks"] == 4 + 27 and k["avgDaysToIndex"] == 1.0  # A: Oct 17 → first impression Oct 18; B: Sep 22 → Sep 23
        rows = {r["url"]: r for r in imp["posts"]}
        a = rows[POST_A]
        assert (a["clicks"], a["impressions"], a["ctr"], a["position"]) == (4, 40, 10.0, 8.0)
        assert a["freshClicks"] == 6 and a["topQuery"] == "spicy noodles near me" and a["orderClicks"] == 3
        assert a["lastCrawlAt"].startswith("2026-10-19T16:40")
        assert [e["title"] for e in imp["early"]] == ["Best Spicy Noodle Dishes to Try This Fall"]
        assert sum(p["impressions"] for p in imp["early"][0]["series"]) == 4
        assert len(imp["weeks"]) == 12 and imp["weeks"][-1]["end"] == "2026-10-19"
        assert imp["beforeAfter"]["available"] is True and imp["beforeAfter"]["firstPostOn"] == "2026-09-22"
        assert imp["country"] == "all" and imp["countryReady"] is True

        # US only: post A at half the clicks, post B had no US searches; site-wide figures from the US totals
        us = client.get(f"/api/v1/seo/blogs/sites/{site_id}?country=us", headers=h("sofia")).json()
        assert us["country"] == "us" and us["countryReady"] is True
        ku = us["kpis"]
        assert ku["clicks"] == 2 and ku["orderClicks"] == 1
        assert ku["shareOfOrganicClicks"] == round(2 / (30 * 28) * 100, 1)
        ua = {r["url"]: r for r in us["posts"]}[POST_A]
        assert (ua["clicks"], ua["impressions"], ua["topQuery"], ua["sessions"]) == (2, 20, "spicy noodles san jose", 4)
        assert us["weeks"][-1]["otherClicks"] == 30 * 7 - us["weeks"][-1]["blogClicks"]
        ba = {m["key"]: m for m in us["beforeAfter"]["metrics"]}
        assert us["beforeAfter"]["available"] and ba["nonbrandClicks"]["after"] == 2 * us["beforeAfter"]["days"]
        assert client.get(f"/api/v1/seo/blogs/sites/{site_id}?country=fr", headers=h("sofia")).status_code in (400, 422)

        assert client.put(f"/api/v1/seo/blogs/sites/{site_id}/brand-terms", headers=h("sofia"), json={"terms": ["olive"]}).status_code == 403
        r = client.put(f"/api/v1/seo/blogs/sites/{site_id}/brand-terms", headers=h("aima"), json={"terms": ["Olive  Kitchen", "olive kitchen", "olive"]})
        assert r.json() == {"brandTerms": ["olive kitchen", "olive"]}
        imp = client.get(f"/api/v1/seo/blogs/sites/{site_id}", headers=h("sofia")).json()
        assert imp["freshness"]["brandTerms"] == ["olive kitchen", "olive"]
        assert imp["beforeAfter"]["available"] is False  # non-brand history is fetched again on the next run

        # Refresh now: one at a time
        async def plant(db):
            from app.models.seo import SeoBlogRun

            db.add(SeoBlogRun(trigger="manual", status="running", started_at=dt.datetime.now(dt.timezone.utc), sites=0, sites_unchanged=0, sites_failed=0, rows=0))
            await db.commit()

        _go(plant)
        r = client.post("/api/v1/seo/blogs/refresh", headers=h("aima"))
        assert r.status_code == 409 and "already" in r.json()["message"]
        assert client.get("/api/v1/seo/blogs/status", headers=h("sofia")).json()["running"] is True

        async def clear(db):
            from sqlalchemy import update

            from app.models.seo import SeoBlogRun

            await db.execute(update(SeoBlogRun).where(SeoBlogRun.status == "running").values(status="failed"))
            await db.commit()

        _go(clear)
    engine.sync_engine.dispose(close=False)


@db_only
def test_one_failing_site_does_not_stop_the_run(dbenv):
    """A Google error on one site (e.g. 403 on its property) is recorded on that site; the run carries on.
    Regression: the rollback after the error expired every loaded object and the next attribute read
    raised MissingGreenlet ("Unexpected error"), failing the whole run."""
    from sqlalchemy import select

    from app.models.seo import SeoBlogPost, SeoBlogState, SeoSite

    bad = f"blogbroken{TAG}.com"
    good = google_mock({"fid": "2026-10-20", "fih": "2026-10-22T04:00:00-07:00"}, [])

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if f"//{bad}/" in url:
            return httpx.Response(404, text="no")
        if "searchAnalytics/query" in url and bad in url:
            return httpx.Response(403, json={"error": {"message": "User does not have sufficient permission for site"}})
        return good.handle_request(req)

    async def go(db):
        from sqlalchemy import delete

        site_id = await _setup(db)
        await db.execute(delete(SeoSite).where(SeoSite.domain == bad))
        # Checked never → goes first, before the healthy site
        db.add(SeoSite(source="GOOGLE", name="Broken", domain=bad, home_url=f"https://{bad}/", gsc_property=f"sc-domain:{bad}"))
        await db.commit()
        run = await _run(db, httpx.MockTransport(handler))
        assert (run.status, run.sites, run.sites_failed) == ("partial", 2, 1), run.error
        assert run.error is None
        broken = (await db.execute(select(SeoSite).where(SeoSite.domain == bad))).scalar_one()
        st = await db.get(SeoBlogState, broken.id)
        assert st.last_error and "permission" in st.last_error.lower() or "403" in (st.last_error or "")
        assert st.checked_at is not None
        n = len((await db.execute(select(SeoBlogPost).where(SeoBlogPost.site_id == site_id))).scalars().all())
        assert n == 2  # the healthy site after it was still done
        await db.execute(delete(SeoSite).where(SeoSite.domain == bad))
        await db.commit()

    _go(go)


@db_only
def test_run_left_by_a_restarted_api_is_closed(dbenv):
    """A refresh still marked running that began before this API process started is shown as failed."""
    from sqlalchemy import update

    from app.models.seo import SeoBlogRun

    async def go(db):
        await db.execute(update(SeoBlogRun).where(SeoBlogRun.status == "running").values(status="failed"))
        run = SeoBlogRun(trigger="manual", status="running", started_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=22),
                         sites=4, sites_unchanged=0, sites_failed=0, rows=0)
        db.add(run)
        await db.commit()
        old = blogs._PROCESS_STARTED
        blogs._PROCESS_STARTED = dt.datetime.now(dt.timezone.utc)  # as if the API restarted after the run began
        try:
            assert await blogs.running(db) is None
        finally:
            blogs._PROCESS_STARTED = old
        await db.refresh(run)
        assert run.status == "failed" and "after 4 sites" in run.error
        # A run this process is executing is left alone.
        live = SeoBlogRun(trigger="manual", status="running", started_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1),
                          sites=0, sites_unchanged=0, sites_failed=0, rows=0)
        db.add(live)
        await db.commit()
        blogs._live.add(live.id)
        blogs._PROCESS_STARTED = dt.datetime.now(dt.timezone.utc)
        try:
            assert (await blogs.running(db)).id == live.id
        finally:
            blogs._PROCESS_STARTED = old
            blogs._live.discard(live.id)
        live.status = "failed"
        await db.commit()

    _go(go)


@db_only
def test_us_numbers_backfill_after_the_update(dbenv):
    """Sites refreshed before the US toggle existed: the page says US numbers aren't in yet, and the
    next refresh fetches the US history even though Search Console has nothing new."""
    from sqlalchemy import delete, select, update

    from app.models.seo import SeoBlogGscDaily, SeoBlogPost, SeoBlogState, SeoSite
    from app.modules.seo import blog_views

    state = {"fid": "2026-10-20", "fih": "2026-10-22T04:00:00-07:00"}
    calls: list = []
    transport = google_mock(state, calls)

    async def go(db):
        site_id = await _setup(db)
        await _run(db, transport)
        # what an older version left: no US rows, no US markers
        ids = [p.id for p in (await db.execute(select(SeoBlogPost).where(SeoBlogPost.site_id == site_id))).scalars()]
        await db.execute(delete(SeoBlogGscDaily).where(SeoBlogGscDaily.post_id.in_(ids), SeoBlogGscDaily.scope == "us"))
        await db.execute(update(SeoBlogPost).where(SeoBlogPost.id.in_(ids)).values(us_gsc_final_through=None))
        await db.commit()
        site = await db.get(SeoSite, site_id)
        out = await blog_views.impact(db, site, 28, now=NOW + dt.timedelta(hours=1), country="us")
        assert out["countryReady"] is False and out["kpis"]["clicks"] == 0

        calls.clear()
        await _run(db, transport, NOW + dt.timedelta(hours=2))  # same freshness markers as before
        assert [c[6] for c in calls if c[0] == "gsc" and c[1] == ("date", "page") and c[2] == "final"] == [True], calls
        db.expire_all()
        out = await blog_views.impact(db, await db.get(SeoSite, site_id), 28, now=NOW + dt.timedelta(hours=3), country="us")
        assert out["countryReady"] is True and out["kpis"]["clicks"] == 2
        st = await db.get(SeoBlogState, site_id)
        assert st.us_site_through is not None

    _go(go)
