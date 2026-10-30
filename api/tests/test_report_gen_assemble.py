"""Report Generator assembly from frozen inputs (no database): periods, the Ads,
Search and Blogs adapters, the composed payload and its wording."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from app.modules.ads import calc
from app.modules.report_gen import narrative, periods, whitelist
from app.modules.report_gen.assemble import SECTION_ORDER, Ctx, ads, blogs, compose, find_metric, package_switch, seo, section, stub, website

FIX = json.loads((Path(__file__).parent / "fixtures" / "report_gen" / "sample_month.json").read_text(encoding="utf-8"))
SEPT = periods.month_period(2026, 9)


def _d(v):
    return dt.date.fromisoformat(v) if v else None


# ---------------------------------------------------------------- periods ----
def test_calendar_month_maths():
    assert SEPT.start == dt.date(2026, 9, 1) and SEPT.end == dt.date(2026, 9, 30) and SEPT.days == 30
    assert SEPT.month == "2026-09" and SEPT.label == "September 2026"
    assert periods.previous_month(SEPT) == periods.month_period(2026, 8)
    assert periods.previous_month(periods.month_period(2026, 1)) == periods.month_period(2025, 12)
    assert periods.report_month(dt.date(2026, 10, 3)) == SEPT
    assert periods.parse_month("2026-09") == SEPT
    assert periods.parse_month(None, today=dt.date(2026, 10, 3)) == SEPT
    for bad in ("2026-13", "2026/09", "Sept 2026"):
        with pytest.raises(ValueError):
            periods.parse_month(bad)
    assert periods.has_ended(SEPT, dt.date(2026, 10, 1)) and not periods.has_ended(SEPT, dt.date(2026, 9, 30))
    assert periods.shift_months(SEPT, 12) == periods.month_period(2025, 9)
    assert periods.yoy_available(dt.date(2025, 8, 15), SEPT) and not periods.yoy_available(dt.date(2025, 10, 1), SEPT)
    assert periods.change(120, 100) == 0.2 and periods.change(80, 100) == -0.2
    assert periods.change(5, 0) is None and periods.change(None, 1) is None


# ------------------------------------------------------------------- ads ----
def _totals(d):
    return {k: calc.Totals.of(v) for k, v in d.items()}


def test_ads_section_sums_accounts_and_labels_modelled_revenue():
    a = FIX["ads"]
    accounts = [{**x, "lastMetricsDate": _d(x["lastMetricsDate"])} for x in a["accounts"]]
    s = ads.compute(accounts, a["campaigns"], _totals(a["cur"]), _totals(a["prev"]), budget=None)
    m = {x["id"]: x for x in s["metrics"]}
    assert s["included"] and s["missing"] == [{"id": "ADS11", "reason": "budget_not_set", "text": "No monthly ad budget is recorded for this merchant."}]
    assert m["ADS01"]["value"] == 800.0 and m["ADS01"]["prev"] == 700.0 and m["ADS01"]["change"] == pytest.approx(0.1429, abs=1e-4)
    assert m["ADS02"]["value"] == 25000 and m["ADS03"]["value"] == 1200
    assert m["ADS04"]["value"] == pytest.approx(0.048) and m["ADS05"]["value"] == pytest.approx(0.67)
    assert m["ADS06"]["value"] == 60 and m["ADS06"]["tag"] == "tracked"
    # 60 orders × $35.68 ticket = $2,140.80, modelled
    assert m["ADS07"]["value"] == pytest.approx(2140.8) and m["ADS07"]["tag"] == "modelled"
    assert m["ADS08"]["value"] == pytest.approx(13.33)
    assert m["ADS09"]["value"] == pytest.approx(2.68) and m["ADS09"]["unit"] == "multiple" and m["ADS09"]["tag"] == "modelled"
    assert [r["campaign"] for r in s["tables"]["topCampaigns"]] == ["Local orders", "Brand"]  # removed/zero-spend campaign hidden
    assert s["tables"]["tickets"] == [{"account": "Gaters Restaurant", "avgTicket": 35.68, "asOf": "2026-09-30"}]
    assert s["dataThrough"] == "2026-09-30" and s["sources"] == ["Google Ads · Gaters Restaurant"]
    assert whitelist.scan(s) == []


def test_ads_section_without_ticket_or_link_or_data():
    a = FIX["ads"]
    no_ticket = [{**a["accounts"][0], "ticketSales": None, "ticketOrders": None, "lastMetricsDate": None}]
    s = ads.compute(no_ticket, a["campaigns"], _totals(a["cur"]), _totals(a["prev"]), budget=1000.0)
    m = {x["id"]: x for x in s["metrics"]}
    assert m["ADS07"]["value"] is None and m["ADS07"]["reason"] == "ticket_not_set"
    assert m["ADS09"]["value"] is None and m["ADS09"]["reason"] == "ticket_not_set"
    assert m["ADS11"]["value"] == pytest.approx(0.8)  # $800 of a $1,000 budget
    assert m["ADS01"]["value"] == 800.0
    unlinked = ads.compute([], [], {}, {}, None)
    assert all(x["reason"] == "ads_not_linked" for x in unlinked["metrics"]) and len(unlinked["missing"]) == 10
    empty = ads.compute(no_ticket, a["campaigns"], {}, {}, None)
    assert all(x["reason"] == "no_data_in_period" for x in empty["metrics"])


# ---------------------------------------------------------------- search ----
def _seo_section():
    s = FIX["seo"]
    sites = [{**x, "lastGscDate": _d(x["lastGscDate"])} for x in s["sites"]]
    return seo.compute(sites, s["cur"], s["prev"], s["queries"], s["prevQueries"], s["pages"], s["devicesCur"], s["devicesPrev"],
                       s["fixed"], s["fixedPrev"], s["openCount"], city="Concord", merchant_name="Gaters Restaurant")


def test_search_section_figures_tables_and_branded_split():
    s = _seo_section()
    m = {x["id"]: x for x in s["metrics"]}
    assert s["missing"] == []
    assert m["SEO01"]["value"] == 1200 and m["SEO01"]["change"] == 0.2
    assert m["SEO03"]["value"] == 0.03 and m["SEO04"]["value"] == 8.4 and m["SEO04"]["unit"] == "position"
    assert m["SEO05"]["value"] == 850  # "gaters restaurant" + "gaters concord"
    assert m["SEO14"]["value"] == 3 and m["SEO14"]["prev"] == 1
    t = s["tables"]
    assert t["topQueries"][0] == {"query": "gaters restaurant", "clicks": 700, "impressions": 3000, "position": 1.2, "prevClicks": 650}
    # by impressions, then clicks: "gaters concord" (900 / 150) beats "sports bar delivery" (900 / 10)
    assert [q["query"] for q in t["localQueries"]] == ["burgers near me", "best burger concord", "gaters concord", "sports bar delivery"]
    assert t["topPages"][0]["page"] == "https://gaters.example/" and t["devices"][0]["device"] == "Mobile"
    assert t["branded"]["brandedShare"] == pytest.approx(850 / 960, abs=1e-4) and t["branded"]["trackedClicks"] == 960
    assert t["issues"] == {"openCount": 4, "fixedThisMonth": 3}
    assert "tracked search terms (960 of 1200 clicks)" in s["caption"]
    assert s["dataThrough"] == "2026-09-28" and s["sources"] == ["Search Console · gaters.example"]
    assert whitelist.scan(s) == []


def test_search_section_reasons_when_unlinked_or_unconnected():
    none = seo.compute([], {}, {}, [], [], [], [], [], 0, 0, 0, None, "X")
    assert all(x["reason"] == "seo_not_linked" for x in none["metrics"])
    site = [{"id": "s1", "name": "X", "domain": "x.example", "gscProperty": None, "lastGscDate": None}]
    noc = seo.compute(site, {"clicks": 0, "impressions": 0, "position": None}, {"clicks": 0, "impressions": 0, "position": None}, [], [], [], [], [], 0, 0, 0, None, "X")
    assert all(x["reason"] == "gsc_not_connected" for x in noc["metrics"])


# ----------------------------------------------------------------- blogs ----
def test_blogs_section_counts_posts_published_in_month_and_their_clicks():
    b = FIX["blogs"]
    posts = [{**p, "publishedOn": _d(p["publishedOn"])} for p in b["posts"]]
    s = blogs.compute(posts, b["monthStats"], b["prevStats"], SEPT.start, SEPT.end, site_clicks=1200, final_through=_d(b["finalThrough"]))
    m = {x["id"]: x for x in s["metrics"]}
    assert m["SEO15"]["value"] == 1 and s["tables"]["published"][0]["title"] == "Game day specials"
    assert m["SEO16"]["value"] == 65 and m["SEO16"]["prev"] == 20
    assert s["tables"]["topPosts"][0]["title"] == "Best burgers in Concord"
    assert s["tables"]["totals"]["shareOfSiteClicks"] == pytest.approx(65 / 1200, abs=1e-4)
    assert s["tables"]["totals"]["planned"] is None and s["dataThrough"] == "2026-09-27"
    empty = blogs.compute([], {}, {}, SEPT.start, SEPT.end, None, None)
    assert all(x["reason"] == "no_blog_posts" for x in empty["metrics"])


# --------------------------------------------------------------- website ----
# WEB01 only. `sessions` on marketing.seo_ga4_daily is all-channel (seo/google.py's
# parse_ga4_daily sums every sessionDefaultChannelGroup row), which is why it differs
# from the Search section's organic clicks.
LINKED = [{"id": "s1", "name": "Gaters", "domain": "gaters.example", "ga4Property": "properties/123",
           "lastGa4Date": dt.date(2026, 10, 14)}]
UNLINKED = [{"id": "s1", "name": "Gaters", "domain": "gaters.example", "ga4Property": None, "lastGa4Date": None}]


def test_website_section_reports_visits_with_the_change_on_the_prior_month():
    s = website.compute(LINKED, 4200, 3500, data_through=dt.date(2026, 9, 30))
    m = {x["id"]: x for x in s["metrics"]}
    assert s["included"] and m["WEB01"]["value"] == 4200 and m["WEB01"]["prev"] == 3500
    assert m["WEB01"]["change"] == 0.2 and m["WEB01"]["unit"] == "count"
    assert m["WEB01"]["reason"] is None and s["dataThrough"] == "2026-09-30"
    assert s["sources"] == ["Google Analytics · gaters.example"]
    assert "every visit to the site" in s["caption"]
    # WEB01 is all traffic, so it is not the Search section's click count
    assert m["WEB01"]["value"] != find_metric(_seo_section(), "SEO01")["value"]
    assert whitelist.scan(s) == []


def test_website_section_without_a_prior_month_shows_no_change():
    m = {x["id"]: x for x in website.compute(LINKED, 4200, None)["metrics"]}
    assert m["WEB01"]["value"] == 4200 and m["WEB01"]["prev"] is None and m["WEB01"]["change"] is None


def test_website_visits_of_zero_is_a_figure_not_a_gap():
    # the sync stores a 0 row for every day GA4 reports no visits, so 0 is measured
    m = {x["id"]: x for x in website.compute(LINKED, 0, 120)["metrics"]}
    assert m["WEB01"]["value"] == 0 and m["WEB01"]["reason"] is None
    assert m["WEB01"]["change"] == -1.0


def test_website_section_says_not_supplied_when_ga4_stored_no_day():
    s = website.compute(LINKED, None, None)
    m = {x["id"]: x for x in s["metrics"]}
    assert m["WEB01"]["value"] is None and m["WEB01"]["reason"] == "no_data_in_period"
    assert m["WEB01"]["reasonText"] == "No data was recorded for this month."
    assert {"id": "WEB01", "reason": "no_data_in_period", "text": "No data was recorded for this month."} in s["missing"]


def test_website_section_is_unchanged_when_no_analytics_property_is_linked():
    # identical to what the stub produced before this adapter existed
    assert website.compute(UNLINKED, None, None) == stub.build("website", "website_analytics_not_connected")
    assert website.compute([], None, None) == stub.build("website", "website_analytics_not_connected")


def test_the_other_website_figures_keep_their_heading_and_a_reason():
    s = website.compute(LINKED, 4200, 3500)
    ids = [m["id"] for m in s["metrics"]]
    assert ids == [i for i, _, _ in stub.P1["website"]]  # every P1 figure of the segment, in order
    others = [m for m in s["metrics"] if m["id"] != "WEB01"]
    assert others and all(m["value"] is None and m["reason"] == "website_metric_not_collected" for m in others)
    assert all(m["reasonText"].startswith("Only website visits are collected today") for m in others)


# --------------------------------------------------------------- compose ----
def _ctx(**over):
    base = dict(merchant=FIX["merchant"], period=SEPT, prev=periods.previous_month(SEPT), services=FIX["services"],
                ads_account_ids=["acc1"], seo_site_ids=["s1"], recipients=FIX["recipients"], today=dt.date(2026, 10, 3))
    base.update(over)
    return Ctx(**base)


def _sections(ctx):
    a = FIX["ads"]
    inc = package_switch(ctx)
    accounts = [{**x, "lastMetricsDate": _d(x["lastMetricsDate"])} for x in a["accounts"]]
    b = FIX["blogs"]
    posts = [{**p, "publishedOn": _d(p["publishedOn"])} for p in b["posts"]]
    return {
        "sales": stub.build("sales", "sales_feed_not_connected", included=inc["sales"]),
        "search": _seo_section() if inc["search"] else section("search", included=False),
        "blogs": blogs.compute(posts, b["monthStats"], b["prevStats"], SEPT.start, SEPT.end, 1200, _d(b["finalThrough"])) if inc["blogs"] else section("blogs", included=False),
        "website": stub.build("website", "website_analytics_not_connected", included=inc["website"]),
        "gbp": stub.build("gbp", "gbp_pending_google", included=inc["gbp"]),
        "ads": ads.compute(accounts, a["campaigns"], _totals(a["cur"]), _totals(a["prev"]), None) if inc["ads"] else section("ads", included=False),
        "email_sms": stub.build("email_sms", "module_not_connected", included=inc["email_sms"]),
        "rewards": stub.build("rewards", "module_not_connected", included=inc["rewards"]),
        "reviews": stub.build("reviews", "reviews_module_not_connected", included=inc["reviews"]),
        "ops": stub.build("ops", "ops_not_assembled", included=inc["ops"]),
    }


def test_package_switch_follows_services_and_links():
    inc = package_switch(_ctx())
    assert inc == {"sales": True, "search": True, "blogs": True, "website": True, "gbp": False, "ads": True, "email_sms": False,
                   "rewards": False, "reviews": False, "ops": True}
    bare = package_switch(_ctx(services=[], ads_account_ids=[], seo_site_ids=[], merchant={**FIX["merchant"], "website": None}))
    assert bare == {"sales": True, "search": False, "blogs": False, "website": False, "gbp": False, "ads": False, "email_sms": False,
                    "rewards": False, "reviews": False, "ops": True}
    full = package_switch(_ctx(services=["SMS/Email", "Rewards", "Review Management", "GMB"]))
    assert full["email_sms"] and full["rewards"] and full["reviews"] and full["gbp"]


def test_composed_payload_has_the_prd_shape():
    ctx = _ctx()
    p = compose(ctx, _sections(ctx), generated_at=dt.datetime(2026, 10, 3, 9, 0, tzinfo=dt.timezone.utc))
    assert p["sectionOrder"] == [k for k, _ in SECTION_ORDER]
    assert list(p["sections"]) == p["sectionOrder"]  # MFR02 order
    assert p["merchant"]["name"] == "Gaters Restaurant" and p["period"]["label"] == "September 2026"
    # hidden sections carry nothing (MFR01); taken-but-missing sections keep their note (MFR04)
    assert p["sections"]["rewards"] == {"key": "rewards", "title": "Rewards", "included": False, "metrics": [], "tables": {}, "missing": [],
                                        "caption": None, "dataThrough": None, "sources": []}
    assert p["sections"]["sales"]["included"] and p["sections"]["sales"]["caption"] == "The sales feed is not connected yet."
    assert {m["section"] for m in p["missing"]} == {"sales", "website", "ads", "ops"}
    assert all(m["text"] for m in p["missing"])
    # headline cards: gross sales (n/s), orders (n/s), organic clicks, CTR, then one per live module
    labels = [c["label"] for c in p["headline"]]
    assert labels[:4] == ["Gross sales", "Orders", "Organic clicks", "Click-through rate"]
    assert p["headline"][0]["value"] is None and p["headline"][0]["reasonText"] == "The sales feed is not connected yet."
    assert p["headline"][2]["value"] == 1200 and p["headline"][2]["change"] == 0.2
    assert "Return on ad spend" in labels and "Blog clicks" in labels
    assert p["dataThrough"] == {"search": "2026-09-28", "blogs": "2026-09-27", "ads": "2026-09-30"}
    assert p["sources"] == ["Search Console · gaters.example", "Search Console · blog pages", "Google Ads · Gaters Restaurant"]
    assert p["recipients"] == FIX["recipients"] and p["generatedAt"] == "2026-10-03T09:00:00+00:00"
    assert whitelist.scan(p) == []
    assert p["summary"][0].startswith("Google search brought 1,200 visits in September 2026, +20% on August 2026")
    assert any(s.startswith("Google Ads spend of $800 tracked 60 orders at $13 per order, a modelled return of 2.7×") for s in p["summary"])
    assert any("Not supplied this month: Sales performance, Website, What we did and next month" in s for s in p["summary"])
    assert p["bottomLine"].startswith("September 2026 figures cover Search, Blogs, Ads.")


def test_recommendations_only_claim_what_the_data_supports():
    ctx = _ctx()
    secs = _sections(ctx)
    recs = narrative.recommendations(secs)
    actions = [r["action"] for r in recs]
    assert all(r["owner"] and r["target"] for r in recs)
    assert any(a.startswith("Add pages for cuisine and neighbourhood searches") for a in actions)  # branded share 89 %
    assert any(a.startswith("Close the 4 open site audit issues") for a in actions)
    assert any(a.startswith("Connect the sales feed") for a in actions)
    assert not any("Narrow ad targeting" in a for a in actions)  # ROAS 2.68× is fine
    # a losing month of ads
    a = FIX["ads"]
    losing = {k: calc.Totals.of({**v, "cost": v["cost"] * 10}) for k, v in a["cur"].items()}
    secs["ads"] = ads.compute([{**a["accounts"][0], "lastMetricsDate": None}], a["campaigns"], losing, _totals(a["prev"]), None)
    assert find_metric(secs["ads"], "ADS09")["value"] < 1
    assert any("Narrow ad targeting" in r["action"] for r in narrative.recommendations(secs))


def test_no_figure_is_ever_zero_when_missing():
    ctx = _ctx()
    p = compose(ctx, _sections(ctx))
    for sec in p["sections"].values():
        for m in sec["metrics"]:
            if m["reason"]:
                assert m["value"] is None and m["reasonText"]
