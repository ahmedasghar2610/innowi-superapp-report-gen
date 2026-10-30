"""Findings: plain rules over a site's synced numbers (no AI, no estimates).

Each rule returns one finding with what happened, the evidence, why it
matters, the recommended fix and who usually fixes it. `fkey` identifies a
finding across syncs, so the same problem is updated rather than duplicated
and its workflow (task created, in progress…) carries over.

Severity scale (SLA in catalog.SLA_HOURS):
  S1  revenue or visibility is being lost now   → same business day
  S2  will cost visibility if left               → within 48 h
  S3  hygiene / best practice                    → within a week
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from app.modules.seo.crawl import META_MAX, TITLE_MAX, page_issues
from app.modules.seo.facts import SiteFacts
from app.modules.seo.scoring import BUSINESS_SCHEMA

ORGANIC_DROP = 0.30  # clicks down ≥ 30 % …
ORGANIC_DROP_MIN = 50  # … from at least 50 clicks
TRACKING_GAP_DAYS = 3
RANK_DROP = 5

# ---- Screaming Frog crawl → findings -------------------------------------------
# Broken pages on the site itself: visitors and Google hit an error now.
SF_S1 = {"responsecodesinternalclienterror4xx", "responsecodesinternalservererror5xx", "responsecodesinternalnoresponse"}
# The app's own page checks that a whole-site crawl replaces (same problem, every page instead of ~10).
# SF code → (app check code, severity the app gives it). SF files some of these as "Opportunity",
# which on its own wouldn't raise a finding — this keeps them, at the app's severity.
SF_REPLACES = {
    "pagetitlesmissing": ("title_missing", "S2"),
    "pagetitlesover60characters": ("title_long", "S3"),
    "metadescriptionmissing": ("meta_missing", "S3"),
    "metadescriptionover155characters": ("meta_long", "S3"),
    "h1missing": ("h1_missing", "S3"),
    "contentlowcontentpages": ("thin_content", "S3"),
    "imagesmissingalttext": ("img_alt_low", "S3"),
}
SF_WEB_DEV = ("Response Codes", "Security", "Canonicals", "Directives", "Sitemaps", "JavaScript", "Validation",
              "Pagination", "Hreflang", "AMP", "Structured Data", "Mobile")


def sf_severity(issue_type: str, priority: str, key: str) -> Optional[str]:
    """S1 broken pages · S2 other errors and high warnings · S3 minor errors and medium warnings.
    Low warnings and opportunities stay on the crawl page (no finding)."""
    if key in SF_S1:
        return "S1"
    if key in SF_REPLACES:
        return SF_REPLACES[key][1]
    if issue_type == "Issue":
        return "S2" if priority in ("High", "Medium") else "S3"
    if issue_type == "Warning":
        return {"High": "S2", "Medium": "S3"}.get(priority)
    return None


def sf_findings(f: SiteFacts) -> list[dict]:
    c = f.fresh_crawl
    if not c:
        return []
    out = []
    total = c.totals.get("html") or len(c.scored_pages) or 1
    for i in c.issues:
        sev = sf_severity(i.issue_type, i.priority, i.key) if i.urls > 0 else None
        if not sev:
            continue
        area = i.name.split(":", 1)[0].strip()
        n = i.urls
        examples = ", ".join(_path(u) for u in i.sample[:4]) + ("…" if n > 4 else "")
        out.append(_f(
            f"sf:{i.key}", "sf_issue", sev, "Web Development" if area in SF_WEB_DEV else "SEO", f"Crawl: {i.name}",
            f"Screaming Frog found this on {_n(n)} URL{'s' if n != 1 else ''} in the crawl of {c.crawled_on:%b %d, %Y}"
            + (f" ({examples})." if examples else ".") + (f" {i.description}" if i.description else ""),
            i.how_to_fix or "Open the site's crawl page in SEO for the affected URLs, fix them, then re-crawl to verify.",
            impact="High" if sev == "S1" else ("Medium" if sev == "S2" else "Low"), effort="Medium",
            evidence={"source": "screaming_frog", "crawlId": c.crawl_id, "issue": i.key, "type": i.issue_type,
                      "priority": i.priority, "urls": n, "ofPages": total, "sample": i.sample[:10]},
        ))
    return out


def _f(fkey, code, severity, team, title, detail, recommendation, *, confidence="High", impact="Medium", effort="Medium",
       page_url: Optional[str] = None, evidence: Optional[dict] = None) -> dict:
    return {
        "fkey": fkey, "code": code, "severity": severity, "team": team, "title": title, "detail": detail,
        "recommendation": recommendation, "confidence": confidence, "impact": impact, "effort": effort,
        "page_url": page_url, "evidence": evidence or {},
    }


def _path(url: str) -> str:
    return urlparse(url).path or "/"


def _n(v: float) -> str:
    return f"{round(v):,}"


def nap_findings(f: SiteFacts) -> list[dict]:
    """The website's phone / address / opening hours (Screaming Frog custom extraction) against the
    linked Google Business Profile listing. Only when the crawl had custom extraction set up."""
    from app.modules.seo import sf_extras

    c = f.fresh_crawl
    nap = (c.totals or {}).get("nap") if c else None
    if not (nap and f.local):
        return []
    chk = sf_extras.compare_nap(nap, f.local.phone, f.local.street, f.local.regular_hours) or {}
    kinds = {sf_extras._kind(n) for n in nap.get("extractors", [])}
    out = []
    p, a, h = chk.get("phone", {}), chk.get("address", {}), chk.get("hours", {})
    if p.get("state") == "different":
        out.append(_f(
            "nap_phone", "nap_mismatch", "S2", "Web Development", "Website phone number differs from Google",
            f"The website shows {p['site']} but the Google Business Profile listing says {p['google']}.",
            "Use one phone number everywhere: correct the website (header, footer, contact page, schema) or the listing, "
            "whichever is wrong. Callers from Google and from the website should reach the same line.",
            impact="High", effort="Low", evidence={"check": p},
        ))
    elif p.get("state") == "not_found" and "phone" in kinds:
        out.append(_f(
            "nap_phone_missing", "nap_missing", "S3", "Web Development", "No phone number found on the website",
            f"Screaming Frog checked {nap.get('pages', 0)} pages and found no click-to-call phone number; Google lists {p['google']}.",
            "Add the restaurant's phone number as a tap-to-call link (tel:) in the header or footer and on the contact page.",
            impact="Medium", effort="Low", evidence={"check": p},
        ))
    if a.get("state") == "different":
        out.append(_f(
            "nap_address", "nap_mismatch", "S2", "SEO", "Website address differs from Google",
            f"The website shows “{a['site']}” but the Google listing's street address is “{a['google']}”.",
            "Make the street address identical on the website, in its Restaurant schema and on the Google listing.",
            impact="Medium", effort="Low", evidence={"check": a},
        ))
    if h.get("state") == "different":
        out.append(_f(
            "nap_hours", "nap_mismatch", "S3", "SEO", "Opening hours on the website differ from Google",
            f"Google lists {h['google']}; the website shows {h['site']}"
            + (f" (not on the website: {h['missing']})." if h.get("missing") else "."),
            "Update whichever is out of date so customers don't arrive to a closed door; keep holiday hours on the listing too.",
            confidence="Medium", impact="Medium", effort="Low", evidence={"check": h},
        ))
    return out


def evaluate(f: SiteFacts) -> list[dict]:
    out: list[dict] = []

    # ---------------------------------------------------------- S1 ----
    ch = f.clicks_change
    if f.has_gsc and ch is not None and ch <= -ORGANIC_DROP and f.clicks_prev_28 >= ORGANIC_DROP_MIN:
        out.append(_f(
            "organic_drop", "organic_drop", "S1", "SEO", "Organic visibility dropped",
            f"Search clicks fell {abs(ch) * 100:.0f}% — {_n(f.clicks_prev_28)} → {_n(f.clicks_28)} in the last 28 days compared with the 28 before"
            f" (impressions {_n(f.impr_prev_28)} → {_n(f.impr_28)}).",
            "Open Search Console → Performance for this site and compare the two periods by page and query to see what lost "
            "clicks. Check Manual actions and Security issues, and whether a recent site change removed or renamed pages.",
            impact="High", effort="Medium",
            evidence={"clicks": f.clicks_28, "clicksPrev": f.clicks_prev_28, "impressions": f.impr_28, "impressionsPrev": f.impr_prev_28},
        ))

    if f.has_ga4 and f.ga4_zero_tail_days >= TRACKING_GAP_DAYS and (f.sessions_prev_28 > 0 or f.clicks_during_zero_tail > 0):
        out.append(_f(
            "tracking_broken", "tracking_broken", "S1", "Web Development", "Conversion tracking broken",
            f"GA4 has recorded no visits for the last {f.ga4_zero_tail_days} days"
            + (f" while Google Search still sent {_n(f.clicks_during_zero_tail)} clicks." if f.clicks_during_zero_tail else "."),
            "Check that the GA4 tag (Google Tag Manager or gtag.js) is still on every page of the live site and that its "
            "measurement ID matches this GA4 property. Use GA4 → Admin → Data streams → 'Test tag' to confirm.",
            impact="High", effort="Low",
            evidence={"zeroDays": f.ga4_zero_tail_days, "clicksMeanwhile": f.clicks_during_zero_tail},
        ))

    for p in f.checked_pages:
        if p.broken and (p.clicks > 0 or p.page_type == "home"):
            what = "Website unreachable" if p.page_type == "home" else "Money page returning an error"
            status = p.crawl_error or f"HTTP {p.status_code}"
            out.append(_f(
                f"page_error:{p.url}", "page_error", "S1", "Web Development", what,
                f"{_path(p.url)} answers with {status}" + (f" but earned {_n(p.clicks)} Google clicks last month." if p.clicks else "."),
                "Restore the page, or add a 301 redirect to the closest live page so visitors and Google stop landing on an error.",
                impact="High", effort="Low", page_url=p.url, evidence={"status": p.status_code, "error": p.crawl_error, "clicks": p.clicks},
            ))
        elif not p.broken and p.not_indexed and p.clicks > 0:
            out.append(_f(
                f"not_indexed:{p.url}", "top_page_not_indexed", "S1", "SEO", "Top page dropped out of Google's index",
                f"{_path(p.url)} earned {_n(p.clicks)} clicks last month but URL Inspection now says: {p.coverage_state or 'not indexed'}.",
                "Open URL Inspection in Search Console for this page, fix the reason shown (noindex, redirect, canonical, "
                "crawl error), then click 'Request indexing'.",
                impact="High", effort="Medium", page_url=p.url, evidence={"coverage": p.coverage_state, "clicks": p.clicks},
            ))

    # ---------------------------------------------------------- S2 ----
    if f.gsc_error:
        out.append(_f(
            "gsc_access", "gsc_access", "S2", "SEO", "Search Console data not refreshing",
            f"The last sync couldn't read Search Console for this site: {f.gsc_error}",
            "Check that the connected Google account still has access to this property in Search Console → Settings → Users and permissions.",
            impact="Medium", effort="Low",
        ))

    for p in f.checked_pages:
        if p.broken:
            continue
        if p.noindex and (p.impressions > 0 or p.page_type in ("home", "hub", "category")):
            out.append(_f(
                f"noindex:{p.url}", "noindex_page", "S2", "Web Development", "Page set to noindex",
                f"{_path(p.url)} tells search engines not to index it (robots noindex)"
                + (f", yet Google showed it {_n(p.impressions)} times last month." if p.impressions else "."),
                "Remove the noindex robots meta tag / X-Robots-Tag header unless the page should really stay out of Google.",
                impact="High", effort="Low", page_url=p.url,
            ))
        if p.canonical_offsite:
            out.append(_f(
                f"canonical:{p.url}", "canonical_offsite", "S2", "Web Development", "Canonical points off-domain",
                f"{_path(p.url)} names {p.canonical} as its canonical, so Google credits that site instead.",
                "Point the canonical tag at this page's own URL on this domain.",
                impact="High", effort="Low", page_url=p.url, evidence={"canonical": p.canonical},
            ))

    home = f.home
    if home and home.checked and not home.broken and home.psi_score is not None and home.psi_score < 50:
        out.append(_f(
            "slow_mobile", "slow_mobile", "S2", "Web Development", "Home page slow on mobile",
            f"Mobile PageSpeed score is {home.psi_score}/100 (under 50 is 'poor').",
            "Open PageSpeed Insights for the home page and work through the top 'Opportunities' — usually oversized images, "
            "render-blocking scripts and third-party widgets.",
            impact="Medium", effort="Medium", page_url=home.url, evidence={"psi": home.psi_score},
        ))
    cwv_fail = [p for p in f.checked_pages if p.cwv == "fail"]
    if cwv_fail:
        out.append(_f(
            "cwv_fail", "cwv_fail", "S2", "Web Development", "Core Web Vitals failing",
            f"Real Chrome visitors get a poor experience on {len(cwv_fail)} checked page{'s' if len(cwv_fail) != 1 else ''} "
            f"({', '.join(_path(p.url) for p in cwv_fail[:3])}{'…' if len(cwv_fail) > 3 else ''}).",
            "Fix loading speed (LCP), responsiveness (INP) and layout shift (CLS) on these pages; PageSpeed Insights lists the causes.",
            impact="Medium", effort="High", evidence={"pages": [p.url for p in cwv_fail]},
        ))

    for k in f.keywords:
        if not k.has_previous:
            continue
        dropped_out = k.previous is not None and k.previous <= 20 and k.position is None
        fell = k.previous is not None and k.position is not None and k.position - k.previous >= RANK_DROP
        if dropped_out or fell:
            now = "no longer showing on Google" if k.position is None else f"average position {k.position}"
            out.append(_f(
                f"rank:{k.keyword.lower()}", "ranking_drop", "S2", "SEO", f"Ranking drop: “{k.keyword}”",
                f"Went from average position {k.previous} to {now} in Search Console (last full month vs the month before).",
                "Check which page ranked before and whether it changed, was redirected or lost internal links; compare with the "
                "competitors now above it.",
                confidence="Medium", impact="Medium", effort="Medium",
                evidence={"keyword": k.keyword, "position": k.position, "previous": k.previous},
            ))

    # ---------------------------------------------------------- crawl ----
    # A recent Screaming Frog crawl covers every page, so its findings replace the
    # app's ~10-page checks for the same problems (agg() below skips those codes).
    out.extend(sf_findings(f))
    replaced = {code for code, _ in SF_REPLACES.values()} if f.fresh_crawl else set()

    # ---------------------------------------------------------- S3 ----
    checked = [p for p in f.checked_pages if not p.broken]
    groups: dict[str, list] = {}
    for p in checked:
        for i in page_issues(p):
            groups.setdefault(i["code"], []).append(p)

    def agg(code: str, sev: str, team: str, title: str, detail: str, rec: str, effort: str = "Low"):
        pages = groups.get(code) or []
        if pages and code not in replaced:
            n = len(pages)
            plural = "s" if n != 1 else ""
            listed = ", ".join(_path(p.url) for p in pages[:4]) + ("…" if n > 4 else "")
            out.append(_f(
                code, code, sev, team, title.format(n=n, s=plural), detail.format(n=n, s=plural, pages=listed), rec,
                impact="Low" if sev == "S3" else "Medium", effort=effort, evidence={"pages": [p.url for p in pages]},
            ))

    agg("title_missing", "S2", "SEO", "Title tag missing on {n} page{s}", "No <title> on {pages}.", "Add a unique title (under 60 characters) with the dish/area and the restaurant name.")
    agg("title_long", "S3", "SEO", "Title over 60 characters", "{n} page{s} exceed the limit; Google may cut the title off ({pages}).", f"Shorten titles to {TITLE_MAX} characters or less, keeping the main keyword first.")
    agg("meta_missing", "S3", "SEO", "Meta description missing on {n} page{s}", "No meta description on {pages}; Google will pick text itself.", "Write a 120–155 character description with a reason to click (dish, area, ordering).")
    agg("meta_long", "S3", "SEO", "Meta description too long on {n} page{s}", f"Over {META_MAX} characters on {{pages}}.", "Trim to about 155 characters.")
    agg("h1_missing", "S3", "SEO", "Missing H1 on {n} page{s}", "No main heading on {pages}.", "Give every page one H1 that says what the page is about.")
    agg("img_alt_low", "S3", "SEO", "Image alt text missing", "Most images on {n} page{s} have no alt text ({pages}).", "Describe each dish photo in its alt text (accessibility and image search).")
    agg("thin_content", "S3", "SEO", "Thin content on {n} page{s}", "Under 150 words of text on {pages}.", "Add useful copy: ingredients, portion, spice level, pairing, ordering options.", effort="Medium")

    if home and home.checked and not home.broken and not any(t in home.schema_types for t in BUSINESS_SCHEMA):
        out.append(_f(
            "schema_missing", "schema_missing", "S3", "SEO", "No restaurant schema on the home page",
            "The home page has no Restaurant / LocalBusiness structured data"
            + (f" (found: {', '.join(home.schema_types)})." if home.schema_types else "."),
            "Add Restaurant JSON-LD with name, address, phone, hours, menu URL and ordering URL, matching the Google Business Profile.",
            impact="Low", effort="Low", page_url=home.url,
        ))

    if not f.has_ga4:
        out.append(_f(
            "ga4_not_linked", "ga4_not_linked", "S3", "Analytics", "GA4 not linked",
            "No Google Analytics 4 property is linked to this site, so traffic, orders and the ROI & Tracking pillar can't be measured.",
            "Give the connected Google account Viewer access to the site's GA4 property, then pick it in SEO → Connections.",
            impact="Medium", effort="Low",
        ))
    if not f.has_gsc:
        out.append(_f(
            "gsc_not_linked", "gsc_not_linked", "S3", "SEO", "Search Console not linked",
            "This site isn't in the connected Search Console account, so clicks, search terms and indexing can't be measured.",
            "Add the connected Google account as a user on the site's Search Console property (or verify the domain), then refresh.",
            impact="Medium", effort="Low",
        ))
    out.extend(nap_findings(f))
    if f.local and not f.local.website_matches:
        out.append(_f(
            "gbp_website_mismatch", "gbp_website_mismatch", "S3", "SEO", "Business Profile links elsewhere",
            f"The linked Google Business Profile listing points to {f.local.website_url or 'no website'} instead of {f.domain}.",
            "Set the listing's website to this site's home page (or ordering page on this domain).",
            impact="Medium", effort="Low",
        ))
    return out
