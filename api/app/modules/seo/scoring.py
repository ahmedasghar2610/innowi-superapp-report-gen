"""Six-pillar scorecard, DRAFT method v0 (catalog.METHOD).

Every pillar is built from measured inputs only and lists them as `parts`
(label, value shown, points, max) so the page can say exactly where a score
comes from. A pillar whose data source isn't connected is `None` with a
`missing` reason — never a guess. Health is the weight-normalised average of
the pillars that have a score, and needs at least MIN_PILLARS_FOR_HEALTH.
"""
from __future__ import annotations

from typing import Optional

from app.modules.seo.catalog import CRAWL_MAX_AGE_DAYS, MIN_PILLARS_FOR_HEALTH, METHOD, PILLARS, grade
from app.modules.seo.facts import SiteFacts

BUSINESS_SCHEMA = ("Restaurant", "LocalBusiness", "FoodEstablishment", "CafeOrCoffeeShop", "Bakery", "FastFoodRestaurant")


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _part(label: str, value: str, frac: float, max_points: int) -> dict:
    return {"label": label, "value": value, "points": round(_clamp(frac) * max_points, 1), "max": max_points}


def _pillar(parts: list[dict]) -> int:
    total = sum(p["max"] for p in parts)
    return round(sum(p["points"] for p in parts) / total * 100) if total else 0


def _pct(v: float) -> str:
    return f"{round(v * 100)}%"


def content(f: SiteFacts) -> tuple[Optional[int], list[dict], Optional[str]]:
    if not f.has_gsc:
        return None, [], "Needs Search Console"
    if f.gsc_through is None:
        return None, [], "Waiting for the first Search Console data"
    parts = [
        _part("Pages earning impressions", str(f.pages_with_impr), f.pages_with_impr / 30, 60),
        _part("Search terms the site shows up for", str(f.queries), f.queries / 150, 40),
    ]
    return _pillar(parts), parts, None


def website(f: SiteFacts) -> tuple[Optional[int], list[dict], Optional[str]]:
    home = f.home
    psi = [p.psi_score for p in f.pages if p.psi_score is not None]
    cwv = [p.cwv for p in f.pages if p.cwv in ("pass", "fail")]
    if not home or not home.checked:
        return None, [], "Home page not checked yet"
    parts: list[dict] = []
    if psi:
        avg = sum(psi) / len(psi)
        parts.append(_part("Mobile PageSpeed (average)", f"{round(avg)}/100", avg / 100, 50))
    if cwv:
        ok = sum(1 for c in cwv if c == "pass") / len(cwv)
        parts.append(_part("Core Web Vitals passing", _pct(ok), ok, 20))
    has_schema = any(t in home.schema_types for t in BUSINESS_SCHEMA)
    parts.append(_part("Business schema on the home page", "Yes" if has_schema else "No", 1.0 if has_schema else 0.0, 15))
    ok_home = not home.broken and not home.noindex and not home.canonical_offsite
    parts.append(_part("Home page reachable and indexable", "Yes" if ok_home else "No", 1.0 if ok_home else 0.0, 15))
    note = None if psi else ("PageSpeed not measured yet" if f.psi_configured else "Add PAGESPEED_API_KEY for speed scores")
    return _pillar(parts), parts, note


def crawl_page_counts(c) -> dict:
    """Per-page counts from a Screaming Frog crawl (pure; also used by the risk score).

    errors   = pages listed under any "Issue"-type issue (Ahrefs-style: % of pages without errors)
    warnings = pages listed under a High/Medium "Warning" (Low warnings such as missing
               security headers hit nearly every URL of every site, so they'd say nothing)
    """
    types = {i.key: (i.issue_type, i.priority) for i in c.issues}
    pages = c.scored_pages

    def has(p, kind: str, priorities: tuple[str, ...]) -> bool:
        return any(types.get(k, ("", ""))[0] == kind and types[k][1] in priorities for k in p.issues)

    html_ok = [p for p in pages if p.is_html and p.status_code == 200]
    return {
        "pages": len(pages),
        "noErrors": sum(1 for p in pages if (p.status_code or 0) < 400 and not has(p, "Issue", ("High", "Medium", "Low"))),
        "noWarnings": sum(1 for p in pages if not has(p, "Warning", ("High", "Medium"))),
        "html200": len(html_ok),
        "indexable": sum(1 for p in html_ok if p.indexable),
        "broken": sum(1 for p in c.pages if (p.status_code or 0) >= 400),
    }


def audits(f: SiteFacts) -> tuple[Optional[int], list[dict], Optional[str]]:
    c = f.fresh_crawl
    if c and c.scored_pages:
        n = crawl_page_counts(c)
        parts = [
            _part("Pages with no errors (Screaming Frog)", f"{n['noErrors']} of {n['pages']}", n["noErrors"] / n["pages"], 50),
            _part("Pages with no serious warnings", f"{n['noWarnings']} of {n['pages']}", n["noWarnings"] / n["pages"], 20),
        ]
        inspected = [p for p in f.pages if p.index_verdict]
        if inspected:
            idx = sum(1 for p in inspected if not p.not_indexed) / len(inspected)
            parts.append(_part("Inspected pages indexed by Google", _pct(idx), idx, 30))
        elif n["html200"]:
            parts.append(_part("Pages Google is allowed to index", f"{n['indexable']} of {n['html200']}", n["indexable"] / n["html200"], 30))
        return _pillar(parts), parts, f"Whole-site crawl of {c.crawled_on:%b %d, %Y}"

    checked = f.checked_pages
    if not checked:
        return None, [], "No pages checked yet"
    from app.modules.seo.crawl import page_issues

    clean = sum(1 for p in checked if not any(i["severity"] in ("S1", "S2") for i in page_issues(p)))
    minor = sum(1 for p in checked if not page_issues(p))
    parts = [
        _part("Pages without serious issues", f"{clean} of {len(checked)}", clean / len(checked), 60),
        _part("Pages with no issues at all", f"{minor} of {len(checked)}", minor / len(checked), 20),
    ]
    inspected = [p for p in f.pages if p.index_verdict]
    if inspected:
        idx = sum(1 for p in inspected if not p.not_indexed) / len(inspected)
        parts.append(_part("Inspected pages indexed by Google", _pct(idx), idx, 20))
    note = f"Screaming Frog crawl is older than {CRAWL_MAX_AGE_DAYS} days — scored from the app's page checks" if f.crawl else None
    return _pillar(parts), parts, note


def tracking(f: SiteFacts) -> tuple[Optional[int], list[dict], Optional[str]]:
    if not f.has_ga4 and not f.has_gsc:
        return None, [], "Needs GA4 and Search Console"
    parts: list[dict] = []
    if f.has_ga4:
        receiving = f.sessions_28 > 0 and f.ga4_zero_tail_days < 3
        parts.append(_part("GA4 receiving visits", "Yes" if receiving else "No", 1.0 if receiving else 0.0, 40))
        parts.append(_part("Key events (orders, calls…) recorded", f"{round(f.key_events_28)}", 1.0 if f.key_events_28 > 0 else 0.0, 30))
    else:
        parts.append(_part("GA4 linked", "No", 0.0, 70))
    ch = f.clicks_change
    if f.has_gsc and ch is not None:
        # −30 % → 0 points, flat → half, +30 % → full.
        parts.append(_part("Organic clicks, last 28 days vs previous", f"{ch * 100:+.0f}%", (ch + 0.3) / 0.6, 30))
    return _pillar(parts), parts, None


def local(f: SiteFacts) -> tuple[Optional[int], list[dict], Optional[str]]:
    l = f.local
    if not l:
        return None, [], "Link a Google Business Profile listing"
    is_open = l.open_status in ("OPEN", "UNKNOWN")
    parts = [
        _part("Profile completion", f"{l.profile_pct}%", l.profile_pct / 100, 50),
        _part("Verified", "Yes" if l.verification == "verified" else l.verification.capitalize(), 1.0 if l.verification == "verified" else 0.0, 20),
        _part("Open on Google", "Yes" if is_open else "No", 1.0 if is_open else 0.0, 10),
        _part("Rating 4.0 or better", f"{l.rating:.1f}" if l.rating is not None else "No reviews", 1.0 if (l.rating or 0) >= 4.0 else 0.0, 10),
        _part("Listing links to this website", "Yes" if l.website_matches else "No", 1.0 if l.website_matches else 0.0, 10),
    ]
    return _pillar(parts), parts, None


def paid(f: SiteFacts) -> tuple[Optional[int], list[dict], Optional[str]]:
    p = f.paid
    if not p:
        return None, [], "Link a Google Ads account"
    running = p.active_campaigns > 0 and p.spend_30d > 0
    parts = [
        _part("Campaigns running with spend (30 days)", f"${p.spend_30d:,.0f}", 1.0 if running else 0.0, 50),
        _part("Advertiser verification", p.verification.capitalize(), 0.0 if p.verification in ("required", "failed") else 1.0, 25),
        _part("Syncing without errors", "Yes" if not p.sync_error else "No", 0.0 if p.sync_error else 1.0, 25),
    ]
    return _pillar(parts), parts, None


FUNCS = {"cp": content, "ws": website, "au": audits, "rt": tracking, "ls": local, "pa": paid}


def score(f: SiteFacts) -> dict:
    """{"health", "grade", "method", "pillars": {key: {score, grade, parts, missing, weight, label}}}"""
    pillars: dict[str, dict] = {}
    for p in PILLARS:
        s, parts, missing = FUNCS[p["key"]](f)
        pillars[p["key"]] = {"label": p["label"], "weight": p["weight"], "score": s, "grade": grade(s), "parts": parts, "missing": missing}
    have = [(p["weight"], pillars[p["key"]]["score"]) for p in PILLARS if pillars[p["key"]]["score"] is not None]
    health = round(sum(w * s for w, s in have) / sum(w for w, _ in have)) if len(have) >= MIN_PILLARS_FOR_HEALTH else None
    return {"health": health, "grade": grade(health), "method": METHOD, "pillarsScored": len(have), "pillars": pillars}
