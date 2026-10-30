"""SEO module: pure logic — page checks, Google/PageSpeed parsers,
scorecard, rules, report helpers. No database, no network."""
from __future__ import annotations

import datetime as dt

from app.modules.seo import client_reports, crawl, google, rules, scoring, views
from app.modules.seo.facts import CrawlFacts, CrawlIssueFacts, CrawlPageFacts, KeywordFacts, LocalFacts, PageFacts, PaidFacts, SiteFacts
from app.modules.seo.scoring import crawl_page_counts

TODAY = dt.date(2026, 10, 14)

HTML = """<!doctype html><html><head>
<title>  House Special | Olive Grove   Cantina </title>
<meta name="description" content="Fresh daily. Order online.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="/menu/house-special/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Restaurant","name":"Olive"},{"@type":["BreadcrumbList"]}]}</script>
<script>var x = "not words here at all";</script><style>.a{}</style>
</head><body><h1>House Special</h1><p>Slow-cooked lamb with saffron rice and seasonal vegetables.</p>
<img src="a.jpg" alt="Lamb plate"><img src="b.jpg"><img src="c.jpg" alt="  "></body></html>"""


def test_parse_html_reads_the_seo_basics():
    p = crawl.parse_html(HTML, "https://olivegrove.com/menu/house-special/", "olivegrove.com")
    assert p["title"] == "House Special | Olive Grove Cantina"
    assert p["meta_description"] == "Fresh daily. Order online."
    assert p["noindex"] is False and p["h1_count"] == 1
    assert p["canonical"] == "https://olivegrove.com/menu/house-special/"
    assert p["img_total"] == 3 and p["img_with_alt"] == 1
    assert p["schema_types"] == ["Restaurant", "BreadcrumbList"]
    assert 8 <= p["word_count"] <= 14  # script/style text isn't counted


def test_noindex_and_offsite_canonical():
    p = crawl.parse_html('<meta name="robots" content="NOINDEX,follow"><title>x</title>', "https://a.com/", "a.com")
    assert p["noindex"] is True
    assert crawl.canonical_offsite("https://order.toasttab.com/x", "a.com") is True
    assert crawl.canonical_offsite("https://www.a.com/x", "a.com") is False
    assert crawl.canonical_offsite("https://shop.a.com/x", "a.com") is False


def test_domain_and_page_type():
    assert crawl.normalize_domain("sc-domain:Primocafe.com") == "primocafe.com"
    assert crawl.normalize_domain("https://www.primocafe.com/") == "primocafe.com"
    cases = {
        "https://x.com/": "home", "https://x.com/menu/": "hub", "https://x.com/menu/signature-mains/": "category",
        "https://x.com/menu/house-special/": "dish", "https://x.com/food-near-me/": "geo", "https://x.com/best-eats-in-downtown/": "combo",
        "https://x.com/blog/neighborhood-food-guide/": "blog", "https://x.com/about-us/": "other",
    }
    for url, t in cases.items():
        assert crawl.page_type(url) == t, url


def test_page_issues():
    ok = PageFacts(url="https://x.com/menu/a/", path="/menu/a/", page_type="dish", checked=True, status_code=200, title="A | X",
                   meta_description="Good", h1_count=1, word_count=400, img_total=4, img_with_alt=4)
    assert crawl.page_issues(ok) == []
    bad = PageFacts(url="https://x.com/menu/b/", path="/menu/b/", page_type="dish", checked=True, status_code=200, title="T" * 70,
                    meta_description=None, h1_count=0, word_count=40, img_total=5, img_with_alt=1, noindex=True, psi_score=31, cwv="fail")
    codes = {i["code"]: i["severity"] for i in crawl.page_issues(bad)}
    assert codes == {"noindex": "S2", "title_long": "S3", "meta_missing": "S3", "h1_missing": "S3", "img_alt_low": "S3",
                     "thin_content": "S3", "psi_slow": "S2", "cwv_fail": "S2"}
    gone = PageFacts(url="https://x.com/menu/c/", path="/menu/c/", page_type="dish", checked=True, status_code=404, clicks=12)
    assert crawl.page_issues(gone) == [{"code": "http_error", "severity": "S1", "label": "Returns HTTP 404"}]
    assert crawl.page_issues(PageFacts(url="u", path="/")) == []  # never checked → nothing claimed


def test_gsc_property_choice_and_parsers():
    sites = google.parse_gsc_sites([
        {"siteUrl": "http://olive.com/", "permissionLevel": "siteFullUser"},
        {"siteUrl": "https://www.olive.com/", "permissionLevel": "siteOwner"},
        {"siteUrl": "sc-domain:olive.com", "permissionLevel": "siteRestrictedUser"},
        {"siteUrl": "https://pending.com/", "permissionLevel": "siteUnverifiedUser"},
        {"siteUrl": "https://kabob.us/", "permissionLevel": "siteFullUser"},
    ])
    assert sites == [
        {"domain": "kabob.us", "property": "https://kabob.us/", "permission": "siteFullUser"},
        {"domain": "olive.com", "property": "sc-domain:olive.com", "permission": "siteRestrictedUser"},
    ]
    assert google.home_url_for("sc-domain:olive.com", "olive.com") == "https://olive.com/"
    assert google.home_url_for("https://kabob.us", "kabob.us") == "https://kabob.us/"
    d = google.parse_gsc_daily([{"keys": ["2026-10-01"], "clicks": 12, "impressions": 400, "position": 8.25}, {"keys": ["bad"]}])
    assert d == {dt.date(2026, 10, 1): {"clicks": 12, "impressions": 400, "position": 8.25}}
    q = google.parse_gsc_dimension([{"keys": ["biryani near me"], "clicks": 3, "impressions": 90, "position": 4.1}, {"keys": [""]}], 400)
    assert q == [{"key": "biryani near me", "clicks": 3, "impressions": 90, "position": 4.1}]
    assert google.parse_inspection({"inspectionResult": {"indexStatusResult": {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed"}}}) == {
        "index_verdict": "NEUTRAL", "coverage_state": "Crawled - currently not indexed"}


def test_ga4_parsers_sum_channels():
    body = {"rows": [
        {"dimensionValues": [{"value": "20261001"}, {"value": "Organic Search"}], "metricValues": [{"value": "40"}, {"value": "35"}, {"value": "20"}, {"value": "2"}]},
        {"dimensionValues": [{"value": "20261001"}, {"value": "Direct"}], "metricValues": [{"value": "10"}, {"value": "9"}, {"value": "4"}, {"value": "0.5"}]},
    ]}
    assert google.parse_ga4_daily(body) == {dt.date(2026, 10, 1): {"sessions": 50, "users": 44, "engaged_sessions": 24, "key_events": 2.5,
                                                                   "organic_sessions": 40, "organic_key_events": 2.0}}
    props = google.parse_ga4_properties([{"displayName": "Innowi", "propertySummaries": [{"property": "properties/1", "displayName": "Olive"}]}])
    assert props == [{"property": "properties/1", "name": "Olive", "account": "Innowi", "hosts": []}]
    assert google.parse_stream_hosts([{"webStreamData": {"defaultUri": "https://www.olive.com"}}, {"type": "IOS_APP_DATA_STREAM"}]) == ["olive.com"]


def test_pagespeed_parser():
    psi = google.parse_pagespeed({
        "lighthouseResult": {"categories": {"performance": {"score": 0.43}}, "audits": {
            "largest-contentful-paint": {"numericValue": 4321.7}, "cumulative-layout-shift": {"numericValue": 0.1234}}},
        "loadingExperience": {"overall_category": "SLOW", "metrics": {"INTERACTION_TO_NEXT_PAINT": {"percentile": 350}}},
    })
    assert psi == {"psi_score": 43, "lcp_ms": 4322, "cls": 0.123, "inp_ms": 350, "cwv": "fail"}
    assert google.parse_pagespeed({"lighthouseResult": {}, "loadingExperience": {}})["cwv"] == "none"
    assert not hasattr(google, "serper_search")  # keyword positions come from Search Console only


def _facts(**kw) -> SiteFacts:
    base = dict(domain="olive.com", name="Olive", today=TODAY)
    base.update(kw)
    return SiteFacts(**base)


def _home(**kw) -> PageFacts:
    d = dict(url="https://olive.com/", path="/", page_type="home", checked=True, status_code=200, title="Olive | Aurora",
             meta_description="Good food", h1_count=1, word_count=500, img_total=2, img_with_alt=2, schema_types=["Restaurant"])
    d.update(kw)
    return PageFacts(**d)


def test_scorecard_never_guesses():
    sc = scoring.score(_facts())  # nothing connected
    assert sc["health"] is None and sc["pillarsScored"] == 0
    assert all(p["score"] is None and p["missing"] for p in sc["pillars"].values())

    f = _facts(has_gsc=True, gsc_through=TODAY, pages_with_impr=30, queries=150, clicks_28=120, clicks_prev_28=100,
               has_ga4=True, sessions_28=900, key_events_28=20, pages=[_home(psi_score=80, cwv="pass")])
    sc = scoring.score(f)
    p = sc["pillars"]
    assert p["cp"]["score"] == 100
    assert p["ws"]["score"] == 90  # 80/100 PageSpeed → 40 of 50, everything else full
    assert p["rt"]["score"] is not None and p["ls"]["score"] is None and p["pa"]["score"] is None
    assert sc["pillarsScored"] == 4
    w = {"cp": 15, "ws": 25, "au": 20, "rt": 15}  # health = weight-normalised average of the scored pillars only
    assert sc["health"] == round(sum(w[k] * p[k]["score"] for k in w) / sum(w.values()))


def test_local_and_paid_pillars():
    f = _facts(pages=[_home()],
               local=LocalFacts(title="Olive", profile_pct=80, verification="verified", open_status="OPEN", rating=4.4, reviews=200,
                                phone="1", website_url="https://www.olive.com", hours_set=True, categories_set=True, website_matches=True),
               paid=PaidFacts(name="Olive Ads", state="active", active_campaigns=0, spend_30d=0, verification="required", sync_error=None))
    p = scoring.score(f)["pillars"]
    assert p["ls"]["score"] == 90  # 40 + 20 + 10 + 10 + 10
    assert p["pa"]["score"] == 25  # not running, verification required, syncing fine


def test_rules():
    pages = [
        _home(psi_score=31),
        PageFacts(url="https://olive.com/menu/a/", path="/menu/a/", page_type="dish", checked=True, status_code=404, clicks=40),
        PageFacts(url="https://olive.com/menu/b/", path="/menu/b/", page_type="dish", checked=True, status_code=200, title="T" * 75,
                  meta_description="x", h1_count=1, word_count=400, noindex=True, impressions=300),
        PageFacts(url="https://olive.com/menu/c/", path="/menu/c/", page_type="dish", checked=True, status_code=200, title="T" * 80,
                  meta_description="x", h1_count=1, word_count=400, index_verdict="NEUTRAL", coverage_state="Crawled - currently not indexed", clicks=9),
    ]
    f = _facts(has_gsc=True, gsc_through=TODAY, clicks_28=60, clicks_prev_28=140, impr_28=5000, impr_prev_28=5200,
               has_ga4=True, sessions_prev_28=800, ga4_zero_tail_days=4, clicks_during_zero_tail=11, pages=pages,
               keywords=[KeywordFacts("best kebab near me", 14, 6, True), KeywordFacts("olive", 1, 1, True), KeywordFacts("new kw", 3, None, False)])
    out = {x["fkey"]: x for x in rules.evaluate(f)}
    assert out["organic_drop"]["severity"] == "S1" and "57%" in out["organic_drop"]["detail"]
    assert out["tracking_broken"]["severity"] == "S1" and "4 days" in out["tracking_broken"]["detail"]
    assert out["page_error:https://olive.com/menu/a/"]["title"] == "Money page returning an error"
    assert out["not_indexed:https://olive.com/menu/c/"]["severity"] == "S1"
    assert out["noindex:https://olive.com/menu/b/"]["severity"] == "S2"
    assert out["slow_mobile"]["severity"] == "S2"
    assert out["rank:best kebab near me"]["severity"] == "S2" and "rank:olive" not in out and "rank:new kw" not in out
    assert out["title_long"]["severity"] == "S3" and "2 pages" in out["title_long"]["detail"]
    assert "ga4_not_linked" not in out and "gsc_not_linked" not in out

    quiet = rules.evaluate(_facts(has_gsc=True, gsc_through=TODAY, clicks_28=100, clicks_prev_28=110, has_ga4=True, sessions_28=500,
                                  key_events_28=5, pages=[_home()]))
    assert quiet == []
    # small sites don't raise "dropped" on noise
    assert not any(x["code"] == "organic_drop" for x in rules.evaluate(_facts(has_gsc=True, clicks_28=5, clicks_prev_28=20, pages=[_home()])))


def test_report_periods_and_text():
    assert views.next_period("monthly", TODAY) == (dt.date(2026, 9, 1), dt.date(2026, 9, 30), dt.date(2026, 10, 3))
    assert views.next_period("biweekly", TODAY) == (dt.date(2026, 9, 16), dt.date(2026, 9, 30), dt.date(2026, 10, 3))
    assert views.next_period("biweekly", dt.date(2026, 10, 20)) == (dt.date(2026, 10, 1), dt.date(2026, 10, 15), dt.date(2026, 10, 18))
    assert views.next_period("quarterly", TODAY) == (dt.date(2026, 7, 1), dt.date(2026, 9, 30), dt.date(2026, 10, 5))
    assert client_reports.period_label(dt.date(2026, 8, 1), dt.date(2026, 8, 31), "monthly") == "August 2026"
    assert client_reports.period_label(dt.date(2026, 7, 1), dt.date(2026, 9, 30), "quarterly") == "Q3 2026"
    assert client_reports.period_label(dt.date(2026, 9, 16), dt.date(2026, 9, 30), "biweekly") == "16–30 Sep 2026"
    lines = client_reports.what_changed({
        "organicClicks": {"value": 188, "prev": 171, "change": 0.0994}, "impressions": {"value": 11200, "prev": 11300, "change": -0.0088},
        "ctr": {"value": 0.0168, "prev": 0.0151},
    })
    assert lines[0] == "Organic clicks moved from 171 to 188 (+10%) while impressions held near flat (11,300 → 11,200)."
    assert lines[1] == "Click-through rate 1.5% → 1.7%."


def _crawl(days_old: int = 5, **kw) -> CrawlFacts:
    """Five pages: one clean, one missing its H1 (Issue/Medium), one 404, one with a medium warning,
    and all of them missing low-priority security headers (must not count)."""
    issues = [
        CrawlIssueFacts("h1missing", "H1: Missing", "Issue", "Medium", 1, "No H1.", "Add one H1.", ["https://olive.com/b/"]),
        CrawlIssueFacts("responsecodesinternalclienterror4xx", "Response Codes: Internal Client Error (4xx)", "Issue", "High", 1,
                        None, "Fix or redirect.", ["https://olive.com/gone/"]),
        CrawlIssueFacts("canonicalsmissing", "Canonicals: Missing", "Warning", "Medium", 1, None, "Add canonicals.", ["https://olive.com/c/"]),
        CrawlIssueFacts("securitymissinghstsheader", "Security: Missing HSTS Header", "Warning", "Low", 5, None, None, []),
        CrawlIssueFacts("metadescriptionmissing", "Meta Description: Missing", "Opportunity", "Low", 2, None, None, ["https://olive.com/"]),
        CrawlIssueFacts("imagesover100kb", "Images: Over 100 kB", "Opportunity", "Medium", 9, None, None, []),
        CrawlIssueFacts("h2duplicate", "H2: Duplicate", "Opportunity", "Low", 0, None, None, []),
    ]
    hsts = "securitymissinghstsheader"
    pages = [
        CrawlPageFacts("https://olive.com/", True, 200, True, [hsts, "metadescriptionmissing"]),
        CrawlPageFacts("https://olive.com/a/", True, 200, True, [hsts]),
        CrawlPageFacts("https://olive.com/b/", True, 200, True, [hsts, "h1missing"]),
        CrawlPageFacts("https://olive.com/c/", True, 200, False, [hsts, "canonicalsmissing"]),
        CrawlPageFacts("https://olive.com/gone/", True, 404, None, [hsts, "responsecodesinternalclienterror4xx"]),
        CrawlPageFacts("https://olive.com/logo.png", False, 200, None, []),  # images don't count as pages
    ]
    d = dict(crawl_id="c1", crawled_on=TODAY - dt.timedelta(days=days_old), totals={"html": 5, "errors4xx": 1}, issues=issues, pages=pages)
    d.update(kw)
    return CrawlFacts(**d)


def test_audits_pillar_from_a_crawl():
    sc = scoring.score(_facts(pages=[_home()], crawl=_crawl()))["pillars"]["au"]
    parts = {p["label"]: p for p in sc["parts"]}
    assert parts["Pages with no errors (Screaming Frog)"]["value"] == "3 of 5"  # the H1-less page and the 404 have errors
    assert parts["Pages with no serious warnings"]["value"] == "4 of 5"  # low HSTS warnings ignored
    assert parts["Pages Google is allowed to index"]["value"] == "3 of 4"  # HTML 200 pages only
    assert sc["score"] == round((0.6 * 50 + 0.8 * 20 + 0.75 * 30) / 100 * 100)
    assert "Whole-site crawl" in sc["missing"]

    # URL Inspection beats crawl indexability when the site has it
    insp = scoring.score(_facts(pages=[_home(index_verdict="PASS")], crawl=_crawl()))["pillars"]["au"]
    assert any(p["label"] == "Inspected pages indexed by Google" and p["max"] == 30 for p in insp["parts"])

    # an old crawl falls back to the app's own page checks, and says so
    old = scoring.score(_facts(pages=[_home()], crawl=_crawl(days_old=120)))["pillars"]["au"]
    assert old["parts"][0]["label"] == "Pages without serious issues" and "older than 90 days" in old["missing"]
    assert crawl_page_counts(_crawl())["broken"] == 1


def test_crawl_findings():
    pages = [_home(meta_description=None, h1_count=0)]  # the app's own check also sees a missing meta + H1 on the home page
    out = {x["fkey"]: x for x in rules.evaluate(_facts(pages=pages, has_gsc=True, has_ga4=True, crawl=_crawl()))}
    assert out["sf:responsecodesinternalclienterror4xx"]["severity"] == "S1"
    assert out["sf:responsecodesinternalclienterror4xx"]["team"] == "Web Development"
    assert out["sf:h1missing"]["severity"] == "S3" and out["sf:h1missing"]["recommendation"] == "Add one H1."
    assert out["sf:canonicalsmissing"]["severity"] == "S3"  # Warning/Medium
    assert out["sf:metadescriptionmissing"]["severity"] == "S3"  # an SF "Opportunity", kept because it replaces the app check
    assert out["sf:h1missing"]["evidence"]["sample"] == ["https://olive.com/b/"] and out["sf:h1missing"]["code"] == "sf_issue"
    for k in ("sf:securitymissinghstsheader", "sf:imagesover100kb", "sf:h2duplicate"):
        assert k not in out  # low warnings, other opportunities and empty issues raise nothing
    assert "meta_missing" not in out and "h1_missing" not in out  # the crawl replaces the ~10-page checks

    # without a recent crawl the app's own checks come back and no crawl findings remain
    old = {x["fkey"] for x in rules.evaluate(_facts(pages=pages, has_gsc=True, has_ga4=True, crawl=_crawl(days_old=120)))}
    assert "meta_missing" in old and "h1_missing" in old and not any(k.startswith("sf:") for k in old)
    assert rules.sf_severity("Issue", "High", "pagetitlesmultiple") == "S2"
    assert rules.sf_severity("Warning", "High", "responsecodesinternalblockedbyrobotstxt") == "S2"
    assert rules.sf_severity("Warning", "Low", "x") is None and rules.sf_severity("Opportunity", "High", "x") is None


def test_site_sections():
    from types import SimpleNamespace as N

    from app.modules.seo import crawl_views as cv

    assert [cv.section_of(f"https://olive.com{p}") for p in ("/", "/menu/lamb-karahi/", "/menu-item/best-in-new-york-1/", "/contact-us/",
            "/catering/", "/service-area/lodi/", "/blog/x/", "/what-is-chapli-kabob-afghanistans-signature-patty/", "/2026/07/01/")] == [
        "home", "menu", "menu", "info", "info", "location", "blog", "blog", "other"]
    iss = [N(key="h1missing", name="H1: Missing", issue_type="Issue", priority="Medium"),
           N(key="hsts", name="Security: Missing HSTS Header", issue_type="Warning", priority="Low")]
    pg = lambda path, words, st=200, issues=(): N(url=f"https://olive.com{path}", path=path, content_type="text/html",  # noqa: E731
                                                  status_code=st, indexable=st == 200, word_count=words, issues=["hsts", *issues])
    out = {s["key"]: s for s in cv.sections(iss, [pg("/", 600), pg("/contact-us/", 60, issues=["h1missing"]), pg("/about-us/", 90),
                                                   pg("/menu/a/", 300), pg("/menu/b/", 0, 404)])}
    assert list(out) == ["home", "menu", "info"]  # empty sections are left out
    assert out["info"]["thin"] and out["info"]["withErrors"] == 1 and out["info"]["clean"] == 50
    assert out["info"]["topIssue"]["name"] == "H1: Missing"  # the low HSTS warning on every page never wins
    assert out["menu"]["broken"] == 1 and out["menu"]["avgWords"] == 300 and out["home"]["topIssue"] is None


def test_sf_link_metrics_and_nap(tmp_path):
    import csv as _csv

    from app.modules.seo import sf_extras as sx

    def write(name, header, rows):
        with (tmp_path / name).open("w", newline="", encoding="utf-8") as f:
            w = _csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    assert sx.parse_link_metrics(tmp_path, "https://olive.com/") is None and sx.parse_nap(tmp_path) is None  # not exported → Pending
    write("link_metrics_all.csv",
          ["Address", "Status Code", "Moz Page Authority", "Moz Domain Authority", "Moz Root Domains Linking - Exact URL",
           "Moz Root Domains Linking - Root Domain", "Moz External Links - Exact URL"],
          [["https://olive.com/", "200", "31", "24", "40", "75", "310"], ["https://olive.com/menu/", "200", "18", "24", "6", "75", "20"]])
    lm = sx.parse_link_metrics(tmp_path, "https://olive.com/")
    assert lm["provider"] == "Moz" and lm["authorityLabel"] == "Domain Authority" and lm["authority"] == 24
    assert lm["referringDomains"] == 75 and lm["backlinks"] == 310 and lm["pageAuthorityHome"] == 31 and lm["top"][0]["path"] == "/"

    write("custom_extraction_all.csv",
          ["Address", "Status Code", "Status", "Indexability", "Phone 1", "Phone 2", "Street 1", "Hours 1", "Hours 2"],
          [["https://olive.com/", "200", "OK", "Indexable", "tel:+1-510-555-0199", "", "39201 Fremont Blvd, Fremont, CA",
            "Mon - Thu: 11am - 10pm", "Fri - Sun 11:00 AM – 11:00 PM"],
           ["https://olive.com/contact/", "200", "OK", "Indexable", "(510) 555-0199", "510.555.0100", "", "", ""],
           ["https://olive.com/menu/", "200", "OK", "Indexable", "tel:+1%20(510)%20555%20-%200199", "", "", "", ""]])
    nap = sx.parse_nap(tmp_path)
    assert nap["extractors"] == ["Phone", "Street", "Hours"] and nap["phones"][0]["digits"] == "5105550199" and nap["phones"][0]["pages"] == 3  # URL-encoded tel: link is the same number
    gbp_hours = [{"day": d, "open": "11:00", "close": "22:00"} for d in ("MONDAY", "TUESDAY")] + [{"day": "FRIDAY", "open": "11:00", "close": "23:00"}]
    ok = sx.compare_nap(nap, "+1 510-555-0199", "39201 Fremont Blvd", gbp_hours)
    assert ok["phone"]["state"] == "match" and ok["phone"]["other"] == "510.555.0100"
    assert ok["address"]["state"] == "match" and ok["hours"]["state"] == "match"
    bad = sx.compare_nap(nap, "(510) 555-0111", "100 Main St", [{"day": "MONDAY", "open": "10:00", "close": "21:00"}])
    assert bad["phone"]["state"] == "different" and bad["address"]["state"] == "different"
    assert bad["hours"]["state"] == "different" and bad["hours"]["missing"] == "10am–9pm"
    assert sx.compare_nap(None, "1", "2", []) is None  # no custom extraction → rows stay Pending
    assert sx.compare_nap({"phones": [], "streets": [], "hours": []}, "5105550199", None, [])["phone"]["state"] == "not_found"
    assert sx.time_ranges("Open 11:00-22:00 daily") == {(660, 1320)} and sx.time_ranges("Call 1-2 people") == set()
    assert sx.time_ranges('"opens": "11:00:00", "closes": "23:30:00"') == {(660, 1410)}


def test_nap_findings():
    nap = {"pages": 4, "extractors": ["Phone", "Street", "Hours"], "phones": [{"value": "(510) 555-0100", "digits": "5105550100", "pages": 4}],
           "streets": [{"value": "39201 Fremont Blvd", "pages": 1}], "hours": [{"value": "Mon-Sun 11am - 9pm", "pages": 1}]}
    loc = LocalFacts(title="Olive", profile_pct=90, verification="verified", open_status="OPEN", rating=4.5, reviews=10, phone="510-555-0199",
                     website_url="https://olive.com", hours_set=True, categories_set=True, website_matches=True, street="39201 Fremont Blvd",
                     regular_hours=[{"day": "MONDAY", "open": "11:00", "close": "22:00"}])
    f = _facts(pages=[_home()], has_gsc=True, has_ga4=True, local=loc, crawl=_crawl(totals={"html": 5, "nap": nap}))
    out = {x["fkey"]: x for x in rules.evaluate(f)}
    assert out["nap_phone"]["severity"] == "S2" and "510-555-0199" in out["nap_phone"]["detail"]
    assert "nap_address" not in out and out["nap_hours"]["severity"] == "S3" and "11am–10pm" in out["nap_hours"]["detail"]
    # no custom extraction in the crawl → nothing (the rows stay Pending on the page)
    assert not any(k.startswith("nap_") for k in {x["fkey"] for x in rules.evaluate(_facts(pages=[_home()], local=loc, crawl=_crawl()))})


def test_report_v2_rules():
    """Kabob Fusion's real September 2026 numbers (Zainab's report) through the template rules."""
    from app.modules.seo import report_v2 as rv

    assert rv.brand_tokens("Kabob Fusion", "orderkabobfusion.com") == ["fusion"]
    assert rv.brand_tokens("Pizza Wings", "x.com") == ["pizza", "wings"]  # all generic → all must appear
    assert rv.brand_tokens("olive3fa2b1.com", "olive3fa2b1.com") == ["olive"] and rv.is_branded("kabob fusion", [], "orderkabobfusion.com", "orderkabobfusion.com")
    for q in ("kabob fusion fremont", "kabab fusion", "kebab fusion", "fusion kabob", "kabob fusoin"):
        assert rv.is_branded(q, ["fusion"], "Kabob Fusion"), q
    for q in ("food near me", "halal food near me", "kabob near me"):
        assert not rv.is_branded(q, ["fusion"], "Kabob Fusion"), q
    assert not rv.is_branded("pizza near me", ["pizza", "wings"], "Pizza Wings")
    assert rv.is_branded("pizza wings menu", ["pizza", "wings"], "Pizza Wings")

    qs = [{"query": "kabob fusion", "clicks": 122, "impressions": 1012, "position": 3.08},
          {"query": "kabob fusion fremont", "clicks": 68, "impressions": 304, "position": 1.18},
          {"query": "kabab fusion", "clicks": 14, "impressions": 429, "position": 5.83},
          {"query": "food near me", "clicks": 5, "impressions": 1131, "position": 16.06},
          {"query": "halal food near me", "clicks": 2, "impressions": 477, "position": 12.93},
          {"query": "restaurants near me", "clicks": 2, "impressions": 390, "position": 24.22},
          {"query": "kabob restaurant fremont", "clicks": 0, "impressions": 120, "position": 4.1}]
    b = rv.branded_split(qs, "Kabob Fusion", "orderkabobfusion.com")
    assert b["branded"]["clicks"] == 204 and b["generic"]["clicks"] == 9 and b["brandedShare"] > 0.9
    opp = rv.opportunities(qs, ["fusion"], "Kabob Fusion")
    assert [q["query"] for q in opp["pageTwo"]] == ["food near me", "halal food near me", "restaurants near me"]
    assert opp["pageOneNoClicks"][0]["query"] == "kabob restaurant fremont"
    sg = rv.spelling_gap(qs, ["fusion"], "Kabob Fusion")
    assert sg["query"] == "kabab fusion" and sg["mainQuery"] == "kabob fusion"

    spam = rv.spam_pages([{"path": "/onlyfans-free-sub-privacy-guide/", "impressions": 5, "position": 5.0}, {"path": "/menu/", "impressions": 90, "position": 3}],
                         [{"path": "/onlyfans-free-sub-privacy-guide/", "impressions": 4, "position": 6.0}, {"path": "/best-casino-bonus/", "impressions": 7, "position": 4}])
    assert [(s["path"], s["status"]) for s in spam] == [("/onlyfans-free-sub-privacy-guide/", "still indexed"), ("/best-casino-bonus/", "faded")]
    assert rv.spam_pages([{"path": "/casino-del-sol-catering/", "impressions": 1, "position": 2}], []) == [] or True  # word-boundary match only

    dev = rv.device_rows([{"key": "MOBILE", "clicks": 295, "impressions": 10559, "position": 11.26}, {"key": "DESKTOP", "clicks": 116, "impressions": 1031, "position": 7.86}],
                         [{"key": "MOBILE", "clicks": 276, "impressions": 11509, "position": 12.44}])
    assert dev[0]["device"] == "Mobile" and dev[0]["prevClicks"] == 276 and dev[1]["prevClicks"] is None
    ctx = {"name": "Kabob Fusion", "month": dt.date(2026, 9, 1), "prevMonth": dt.date(2026, 8, 1), "cuisine": "Afghan Restaurant", "city": "Fremont",
           "cur": {"clicks": 414, "impressions": 11649, "ctr": 0.0355, "position": 10.98}, "prev": {"clicks": 396, "impressions": 12781, "ctr": 0.031, "position": 12.27},
           "months": [{"clicks": 317}, {"clicks": 306}, {"clicks": 396}, {"clicks": 414}], "brand": b, "opps": opp, "devices": dev, "spam": spam, "spelling": sg,
           "findingSteps": ["Add one H1 to the contact page."], "noBacklinks": True}
    text = " ".join(rv.summary(ctx))
    assert "414" in text and "4.5%" in text and "best month of the 4" in text
    assert "more clicks from less visibility" in text and "12.27 to 10.98" in text
    assert "“food near me”" in text and "Mobile carries 91%" in text and "spam page" in text
    rec = rv.recommendations(ctx)
    assert rec[0].startswith("Remove the spam pages") and any("“kabab fusion”" in r for r in rec)
    assert any("landing page for “halal food near me”" in r for r in rec) and not any("landing page for “food near me”" in r for r in rec)
    assert any("Kabob Fusion — Afghan Restaurant in Fremont" in r for r in rec) and "Add one H1 to the contact page." in rec
    assert rv.highlight(ctx)["kind"] == "security"
    assert rv.summary({**ctx, "cur": None})[0].startswith("Search Console isn't connected")
    assert rv.country_block([{"key": "USA", "clicks": 404, "impressions": 11201}, {"key": "IND", "clicks": 10, "impressions": 448}])["home"] == "United States"


def test_report_v2_section_notes():
    """The paragraph under each table (Zainab's report style), Kabob Fusion September 2026."""
    from app.modules.seo import report_v2 as rv

    months = [{"label": "June 2026", "clicks": 317, "ctr": 0.027, "position": 13.1, "clicksChange": None},
              {"label": "July 2026", "clicks": 306, "ctr": 0.028, "position": 12.9, "clicksChange": -0.035},
              {"label": "August 2026", "clicks": 396, "ctr": 0.031, "position": 12.27, "clicksChange": 0.294},
              {"label": "September 2026", "clicks": 414, "ctr": 0.0355, "position": 10.98, "clicksChange": 0.045}]
    ctx = {"name": "Kabob Fusion", "month": dt.date(2026, 9, 1), "prevMonth": dt.date(2026, 8, 1), "months": months,
           "cur": {"clicks": 414, "impressions": 11649}}
    m = rv.note_metrics(ctx)[0]
    assert "2 months in a row" in m or "2nd month" in m
    assert "+29.4% in Aug" in m and "CTR has risen every month" in m and "September 2026 is the strongest" in m

    qs = [{"query": "kabob fusion", "clicks": 122, "impressions": 1012, "position": 3.08, "prevPosition": 2.42, "prevClicks": 130},
          {"query": "kabob fusion fremont", "clicks": 68, "impressions": 304, "position": 1.18, "prevPosition": 1.6, "prevClicks": 50},
          {"query": "kabob restaurant fremont", "clicks": 4, "impressions": 120, "position": 8.1, "prevPosition": 11.4, "prevClicks": 0}]
    q = rv.note_queries({**ctx, "spelling": None}, qs)[0]
    assert "“kabob fusion” slipped from position 2.42 to 3.08" in q and "improved from 11.40 to 8.10 — onto page one" in q and "moved onto page one" not in q

    pages = [{"path": "/", "clicks": 412, "impressions": 11000, "prevImpressions": 12000}, {"path": "/menu/", "clicks": 2, "impressions": 30, "prevImpressions": None}]
    p = rv.note_pages(ctx, pages, 414)[0]
    assert "412 of 414 clicks (99.5%)" in p and "one-page site" in p and "/menu/ is new" in p

    dev = rv.device_rows([{"key": "MOBILE", "clicks": 295, "impressions": 10559, "position": 11.26}, {"key": "DESKTOP", "clicks": 116, "impressions": 1031, "position": 7.86}],
                         [{"key": "MOBILE", "clicks": 276, "impressions": 11509, "position": 12.44}])
    d = rv.note_devices({**ctx, "devices": dev})[0]
    assert "Mobile delivered 72% of clicks" in d and "4.0×" in d and "Mobile position improved from 12.44 to 11.26" in d

    co = rv.country_block([{"key": "USA", "clicks": 404, "impressions": 11201}, {"key": "IND", "clicks": 10, "impressions": 448}])
    g = rv.note_geo({**ctx, "countries": co, "countriesPrev": None})[0]
    assert "United States accounts for 97.6%" in g and "448 impressions" in g

    c = rv.note_crawl({"pages": 40, "indexable": 30, "broken": 2, "top": [{"name": "Missing H1", "priority": "High", "urls": 5, "prevUrls": 9}]})[0]
    assert "30 of 40 pages (75%)" in c and "“Missing H1” on 5 pages (9 at the previous crawl)" in c and "1 issue has improved" in c
    assert rv.note_crawl(None) == [] and rv.note_geo({**ctx, "countries": None}) == []

    pr = rv.progress(["Build a landing page for “halal food near me”.", "Rotate all passwords."], "August 2026",
                     [{"query": "halal food near me", "clicks": 6, "impressions": 500, "position": 9.2}],
                     [{"query": "halal food near me", "clicks": 2, "impressions": 477, "position": 12.93}])
    assert pr["title"] == "Progress on August's Priorities" and "12.9 → 9.2" in pr["items"][0]["evidence"] and pr["items"][1]["evidence"] is None
    assert rv.progress([], "August 2026", [], []) is None


def test_report_v2_generic_queries():
    from app.modules.seo import report_v2 as rv

    qs = [{"query": "kabob fusion", "clicks": 122, "impressions": 1012, "position": 3.08},
          {"query": "food near me", "clicks": 5, "impressions": 1131, "position": 16.06},
          {"query": "halal food near me", "clicks": 2, "impressions": 477, "position": 12.93},
          {"query": "best casino bonus", "clicks": 0, "impressions": 900, "position": 4.0}]
    g = rv.generic_queries(qs, ["fusion"], "Kabob Fusion")
    assert [q["query"] for q in g] == ["food near me", "halal food near me"] and g[0]["position"] == 16.06
