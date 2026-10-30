"""Blog Impact: find each site's blog posts and pull how they do in Search
Console and GA4. Runs as its own job (times set on the Blog Impact tab,
modules/seo/blog_schedule.py), separate from the daily SEO sync and from the
blog-writing workflow: posts are found on the live site only.

One run, per active site with a Search Console property:
  1. Blog discovery (first run of the day): the site's public WordPress posts
     feed (/wp-json/wp/v2/posts); if there is none, its post sitemap; if
     neither, blog-looking pages the SEO module already knows (crawled pages
     and Search Console landing pages, crawl_views.section_of == "blog").
  2. Freshness check: two tiny Search Console requests read Google's own
     "not final yet" markers (metadata.first_incomplete_date with dataState
     "all", metadata.first_incomplete_hour with "hourly_all"). When both are
     unchanged since the last run and no post is waiting for its first data,
     Google has nothing new: Search Console is skipped for the site.
  3. Otherwise only what is new is fetched:
       final days     dates before first_incomplete_date never change: each
                      is fetched once (per post: gsc_final_through)
       fresh days     after the last final day, stored with is_final=false and
                      replaced on every change until final
       hourly         posts published in the last 10 days (early signals)
       non-brand      site-wide clicks/impressions without the brand terms
                      (before vs after blogging), final days only
       search terms   per post, once a day
  4. GA4: per post landing-page sessions (organic too) and clicks to the
     Innowi ordering site, last 3 days refreshed, older days kept.
  5. URL Inspection: posts not indexed yet, or not checked for 7 days.

Every Search Console / GA4 pull runs twice: scope "all" (every country) and
scope "us" (Search Console country = usa, GA4 countryId = US), stored side by
side for the page's "All countries / US only" toggle. Each scope keeps its own
"fetched through" markers, so US history backfills on its own. In scope "us"
the site's own US totals (clicks, impressions, organic sessions) are stored
too, because seo_gsc_daily / seo_ga4_daily count every country.

Search Console dates are Pacific time (Google's reporting day). Every write
is an upsert keyed by post + day (or hour), so running more often never
double counts. A run that reaches the serverless time limit stops cleanly;
the next tick carries on with the sites not visited yet.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import re
import xml.etree.ElementTree as ET
from html import unescape
from typing import Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.config import get_settings
from app.models.seo import (
    SeoBlogGa4Daily,
    SeoBlogGscDaily,
    SeoBlogGscHourly,
    SeoBlogPost,
    SeoBlogQuery,
    SeoBlogRun,
    SeoBlogSiteDaily,
    SeoBlogState,
    SeoGscPage,
    SeoPage,
    SeoSite,
    utcnow,
)
from app.modules.seo import connection, google
from app.modules.seo.crawl import USER_AGENT, host_of
from app.modules.seo.crawl_views import section_of

logger = logging.getLogger("SEO.blogs")

GSC_TZ = ZoneInfo("America/Los_Angeles")  # Search Console's reporting day
ORDER_DOMAIN = "online-ordering.innowi.com"
HOURLY_DAYS = 10  # Search Console keeps hourly data for about 10 days
GA4_REFRESH_DAYS = 3
INSPECT_EVERY = dt.timedelta(days=7)
INSPECT_PER_SITE = 20
WP_MAX_PAGES = 10  # 100 posts per page
STALE_RUN = dt.timedelta(hours=3)
LOCK_KEY = 7244113  # pg advisory lock (the daily SEO sync uses 7244112)
TIME_LIMIT_PREFIX = "Stopped at the time limit"
SITEMAP_PATHS = ("/post-sitemap.xml", "/wp-sitemap-posts-post-1.xml", "/sitemap-posts.xml", "/blog-sitemap.xml")


SCOPES = ("all", "us")
US_GSC_COUNTRY = "usa"  # Search Console country codes are ISO 3166-1 alpha-3, lower case
US_GA4_COUNTRY = "US"  # GA4 countryId is ISO 3166-1 alpha-2


class RunBusy(RuntimeError):
    pass


def gsc_scoped(body: dict, scope: str) -> dict:
    """A Search Analytics request body, limited to US searches for scope "us"."""
    if scope != "us":
        return body
    us = {"dimension": "country", "operator": "equals", "expression": US_GSC_COUNTRY}
    groups = [dict(g) for g in body.get("dimensionFilterGroups") or []]
    if groups:  # every group here is an "and" group: the country filter joins the first one
        groups[0]["filters"] = [*groups[0].get("filters", []), us]
    else:
        groups = [{"groupType": "and", "filters": [us]}]
    return {**body, "dimensionFilterGroups": groups}


def ga4_scoped(body: dict, scope: str) -> dict:
    """A GA4 runReport body, limited to visitors from the US for scope "us"."""
    if scope != "us":
        return body
    us = {"filter": {"fieldName": "countryId", "stringFilter": {"matchType": "EXACT", "value": US_GA4_COUNTRY}}}
    cur = body.get("dimensionFilter")
    if not cur:
        flt = us
    elif "andGroup" in cur:
        flt = {"andGroup": {"expressions": [*cur["andGroup"]["expressions"], us]}}
    else:
        flt = {"andGroup": {"expressions": [cur, us]}}
    return {**body, "dimensionFilter": flt}


def gsc_through_attr(scope: str) -> str:
    return "gsc_final_through" if scope == "all" else "us_gsc_final_through"


def ga4_through_attr(scope: str) -> str:
    return "ga4_through" if scope == "all" else "us_ga4_through"


# ======================================================== pure helpers ====


def gsc_today(now: Optional[dt.datetime] = None) -> dt.date:
    return (now or utcnow()).astimezone(GSC_TZ).date()


def norm_url(url: str) -> str:
    """Compare URLs the way Search Console and GA4 report them: host without www, no query/fragment, no trailing slash."""
    u = urlparse(url.strip())
    path = (u.path or "/").rstrip("/") or "/"
    return f"{host_of(url)}{path}".lower()


def norm_path(path: str) -> str:
    path = (path or "/").split("?", 1)[0].split("#", 1)[0]
    return (path.rstrip("/") or "/").lower()


def parse_metadata(body: dict) -> tuple[Optional[dt.date], Optional[dt.datetime]]:
    """Google's "not final yet" markers from a Search Analytics response (snake or camel case)."""
    meta = body.get("metadata") or {}
    d = meta.get("first_incomplete_date") or meta.get("firstIncompleteDate")
    h = meta.get("first_incomplete_hour") or meta.get("firstIncompleteHour")
    day = hour = None
    try:
        day = dt.date.fromisoformat(d) if d else None
    except ValueError:
        day = None
    try:
        hour = dt.datetime.fromisoformat(h) if h else None
    except ValueError:
        hour = None
    return day, hour


def final_through(first_incomplete: Optional[dt.date], probe_rows: list[dict], today: dt.date) -> dt.date:
    """Last day whose numbers are final. Without a marker Google says the whole range is final."""
    if first_incomplete:
        return first_incomplete - dt.timedelta(days=1)
    days = []
    for r in probe_rows:
        try:
            days.append(dt.date.fromisoformat((r.get("keys") or [""])[0]))
        except ValueError:
            pass
    return max(days) if days else today - dt.timedelta(days=3)


def unchanged(state: Optional[SeoBlogState], day: Optional[dt.date], hour: Optional[dt.datetime]) -> bool:
    """True when Google's freshness markers are the same as at the last check (nothing new to fetch)."""
    if not state or not state.checked_at:
        return False
    old_hour = state.gsc_first_incomplete_hour
    same_hour = (old_hour is None and hour is None) or (old_hour is not None and hour is not None and old_hour == hour)
    return state.gsc_first_incomplete_date == day and same_hour


def default_brand_terms(site: SeoSite) -> list[str]:
    """The restaurant's own name, as people search it: the domain's name and the site name."""
    terms: list[str] = []
    stem = (site.domain or "").split(".")[0].lower()
    if len(stem) >= 3:
        terms.append(stem)
    name = (site.name or "").lower().strip()
    if name and name != (site.domain or "").lower() and "." not in name:
        name = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", name)).strip()
        if len(name) >= 3 and name not in terms:
            terms.append(name)
    return terms[:5]


def parse_wp_posts(items: list, domain: str) -> list[dict]:
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict) or not it.get("link") or host_of(str(it["link"])) != domain:
            continue
        title = it.get("title")
        title = title.get("rendered") if isinstance(title, dict) else title
        pub = None
        try:
            pub = dt.datetime.fromisoformat(str(it.get("date"))[:19]).date() if it.get("date") else None
        except ValueError:
            pub = None
        out.append({"url": str(it["link"])[:1000], "title": _clean_title(title), "published_on": pub})
    return out


def parse_sitemap(xml_text: str, domain: str) -> list[dict]:
    out = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for el in root.iter():
        if not el.tag.endswith("url"):
            continue
        loc = lastmod = None
        for ch in el:
            if ch.tag.endswith("loc"):
                loc = (ch.text or "").strip()
            elif ch.tag.endswith("lastmod"):
                lastmod = (ch.text or "").strip()
        if not loc or host_of(loc) != domain or norm_path(urlparse(loc).path) == "/":
            continue
        pub = None
        try:
            pub = dt.date.fromisoformat(lastmod[:10]) if lastmod else None
        except ValueError:
            pub = None
        out.append({"url": loc[:1000], "title": None, "published_on": pub})
    return out


def _clean_title(t) -> Optional[str]:
    if not t:
        return None
    return unescape(re.sub(r"<[^>]+>", "", str(t))).strip()[:600] or None


def parse_inspection(body: dict) -> dict:
    r = ((body.get("inspectionResult") or {}).get("indexStatusResult")) or {}
    crawl = None
    if r.get("lastCrawlTime"):
        try:
            crawl = dt.datetime.fromisoformat(str(r["lastCrawlTime"]).replace("Z", "+00:00"))
        except ValueError:
            crawl = None
    return {
        "index_verdict": (r.get("verdict") or None) and str(r["verdict"])[:24],
        "coverage_state": (r.get("coverageState") or None) and str(r["coverageState"])[:200],
        "google_last_crawl_at": crawl,
    }


def gsc_page_rows(rows: list[dict], by_url: dict[str, str], key_kind: str) -> list[dict]:
    """Rows keyed [date|hour, page] → our posts only. key_kind: 'date' | 'hour'."""
    out = []
    for r in rows:
        keys = r.get("keys") or []
        if len(keys) < 2:
            continue
        post_id = by_url.get(norm_url(keys[1]))
        if not post_id:
            continue
        try:
            k = dt.date.fromisoformat(keys[0]) if key_kind == "date" else dt.datetime.fromisoformat(keys[0])
        except ValueError:
            continue
        out.append({"post_id": post_id, key_kind: k, "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0),
                    "position": float(r["position"]) if r.get("position") is not None else None})
    # Two URLs (e.g. with and without a trailing slash) can map to one post: add them up.
    merged: dict[tuple, dict] = {}
    for row in out:
        key = (row["post_id"], row[key_kind])
        cur = merged.get(key)
        if not cur:
            merged[key] = row
            continue
        imp = cur["impressions"] + row["impressions"]
        if cur["position"] is not None and row["position"] is not None and imp:
            cur["position"] = (cur["position"] * cur["impressions"] + row["position"] * row["impressions"]) / imp
        cur["clicks"] += row["clicks"]
        cur["impressions"] = imp
    return list(merged.values())


def ga4_rows(body: dict) -> list[list[str]]:
    out = []
    for row in body.get("rows") or []:
        out.append([d.get("value") for d in row.get("dimensionValues") or []] + [m.get("value") for m in row.get("metricValues") or []])
    return out


def ga4_by_post(landing: dict, clicks: dict, by_path: dict[str, str]) -> dict[tuple[str, dt.date], dict]:
    """GA4 landing-page sessions (date, landingPage, channel, sessions, engaged) and order clicks
    (date, pagePath, eventCount) → per post per day."""
    out: dict[tuple[str, dt.date], dict] = {}

    def cell(post_id: str, d: dt.date) -> dict:
        return out.setdefault((post_id, d), {"sessions": 0, "organic_sessions": 0, "engaged_sessions": 0, "order_clicks": 0})

    for r in ga4_rows(landing):
        if len(r) < 5:
            continue
        post_id = by_path.get(norm_path(r[1] or ""))
        d = _ga4_date(r[0])
        if not post_id or not d:
            continue
        c = cell(post_id, d)
        sessions, engaged = int(float(r[3] or 0)), int(float(r[4] or 0))
        c["sessions"] += sessions
        c["engaged_sessions"] += engaged
        if r[2] in google.ORGANIC_CHANNELS:
            c["organic_sessions"] += sessions
    for r in ga4_rows(clicks):
        if len(r) < 3:
            continue
        post_id = by_path.get(norm_path(r[1] or ""))
        d = _ga4_date(r[0])
        if post_id and d:
            cell(post_id, d)["order_clicks"] += int(float(r[2] or 0))
    return out


def _ga4_date(v: Optional[str]) -> Optional[dt.date]:
    try:
        return dt.datetime.strptime(v or "", "%Y%m%d").date()
    except ValueError:
        return None


def ga4_bodies(start: dt.date, end: dt.date) -> tuple[dict, dict]:
    rng = [{"startDate": start.isoformat(), "endDate": end.isoformat()}]
    landing = {
        "dateRanges": rng,
        "dimensions": [{"name": "date"}, {"name": "landingPage"}, {"name": "sessionDefaultChannelGroup"}],
        "metrics": [{"name": "sessions"}, {"name": "engagedSessions"}],
        "limit": 100000,
    }
    clicks = {
        "dateRanges": rng,
        "dimensions": [{"name": "date"}, {"name": "pagePath"}],
        "metrics": [{"name": "eventCount"}],
        "dimensionFilter": {"andGroup": {"expressions": [
            {"filter": {"fieldName": "eventName", "stringFilter": {"matchType": "EXACT", "value": "click"}}},
            {"filter": {"fieldName": "linkDomain", "stringFilter": {"matchType": "CONTAINS", "value": ORDER_DOMAIN}}},
        ]}},
        "limit": 100000,
    }
    return landing, clicks


# ============================================================== runs ====


# Runs this API process is executing, and when the process started. On a long-running server a
# refresh runs inside the API process, so a run still marked "running" that began before this
# process started belongs to a process that is gone (restart / --reload / crash): it will never finish.
_live: set[str] = set()
_PROCESS_STARTED = utcnow()


def eligible_sites():
    return select(SeoSite).where(SeoSite.source != "DEMO", SeoSite.status == "active", SeoSite.gsc_property.is_not(None))


async def running(db: AsyncSession) -> Optional[SeoBlogRun]:
    run = (await db.execute(select(SeoBlogRun).where(SeoBlogRun.status == "running").order_by(SeoBlogRun.started_at.desc()).limit(1))).scalar_one_or_none()
    if not run:
        return None
    orphaned = not jobs.inline() and run.id not in _live and run.started_at < _PROCESS_STARTED
    if orphaned or utcnow() - run.started_at > jobs.stale_after(STALE_RUN):
        run.status, run.finished_at = "failed", utcnow()
        run.error = f"Stopped after {run.sites} sites because the API restarted during the run. Click Refresh now to run it again."
        await db.commit()
        return None
    return run


async def create_run(db: AsyncSession, trigger: str, user_id: Optional[str]) -> SeoBlogRun:
    await db.execute(text(f"SELECT pg_advisory_xact_lock({LOCK_KEY})"))
    if await running(db):
        raise RunBusy("Blog data is already being refreshed.")
    run = SeoBlogRun(trigger=trigger, status="running", started_by_id=user_id, started_at=utcnow(), sites=0, sites_unchanged=0, sites_failed=0, rows=0)
    db.add(run)
    await db.commit()
    return run


async def last_run(db: AsyncSession) -> Optional[SeoBlogRun]:
    return (await db.execute(select(SeoBlogRun).order_by(SeoBlogRun.started_at.desc()).limit(1))).scalar_one_or_none()


async def run_in_new_session(run_id: str, http: Optional[httpx.AsyncClient] = None) -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        await run_blogs(db, run_id, http=http)


async def start(run_id: str) -> None:
    """Inline on a serverless host (inside this request, within the time budget), else a background task."""
    await jobs.run(lambda: run_in_new_session(run_id), name=f"seo-blogs-{run_id}")


async def run_blogs(db: AsyncSession, run_id: str, http: Optional[httpx.AsyncClient] = None, now: Optional[dt.datetime] = None) -> SeoBlogRun:
    _live.add(run_id)
    try:
        return await _run_blogs(db, run_id, http, now)
    finally:
        _live.discard(run_id)


async def _run_blogs(db: AsyncSession, run_id: str, http: Optional[httpx.AsyncClient], now: Optional[dt.datetime]) -> SeoBlogRun:
    run = await db.get(SeoBlogRun, run_id)
    assert run is not None
    own_http = http is None
    http = http or httpx.AsyncClient(timeout=httpx.Timeout(30.0))
    now = now or utcnow()
    s = get_settings()
    try:
        conn = await connection.current(db)
        if not conn or conn.status != "connected" or connection.missing_env():
            raise connection.NotConfigured("Google isn't connected (SEO → Connections).")
        scopes = connection.granted(conn)
        if not scopes["searchConsole"]:
            raise connection.NotConfigured("The connected Google account hasn't granted Search Console access.")
        token = await connection.access_token(db, http, conn)
        client = google.SeoClient(http, token, google.RateLimiter(s.SEO_REQUESTS_PER_MINUTE))

        sites = (await db.execute(eligible_sites())).scalars().all()
        states = {st.site_id: st for st in (await db.execute(select(SeoBlogState))).scalars()}
        never = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
        # Least recently checked first: a run cut short by the time limit continues with the sites it didn't reach.
        order = sorted(sites, key=lambda x: ((states[x.id].checked_at or never) if x.id in states else never, x.domain))
        site_ids = [x.id for x in order]
        stopped = None
        for i, sid in enumerate(site_ids):
            if jobs.time_up():
                stopped = i
                break
            # Loaded fresh each time (awaited): after a failed site's rollback every object in the
            # session is expired, and reading an expired attribute without await fails (MissingGreenlet).
            site = await db.get(SeoSite, sid)
            state = await db.get(SeoBlogState, sid)
            if not state:
                state = SeoBlogState(site_id=sid, brand_terms=default_brand_terms(site))
                db.add(state)
            try:
                changed = await sync_site(db, http, client, scopes, site, state, now, run)
                if not changed:
                    run.sites_unchanged += 1
                state.last_error = None
            except Exception as exc:  # one site's problem never stops the run
                if isinstance(exc, google.GoogleError) and exc.auth:
                    raise
                friendly = exc.friendly if isinstance(exc, google.GoogleError) else f"{exc.__class__.__name__}: {str(exc)[:200]}"
                if not isinstance(exc, google.GoogleError):
                    logger.exception("Blog refresh failed for site %s", sid)
                await db.rollback()  # undo this site's partial writes; expires everything
                run = await db.get(SeoBlogRun, run_id)
                await db.refresh(run)
                site = await db.get(SeoSite, sid)
                state = await db.get(SeoBlogState, sid)
                if state:
                    await db.refresh(state)
                else:
                    state = SeoBlogState(site_id=sid, brand_terms=default_brand_terms(site))
                    db.add(state)
                state.last_error = friendly[:1000]
                state.checked_at = now
                run.sites_failed += 1
            run.sites += 1
            await db.commit()
        run.status = "partial" if run.sites_failed else "success"
        if stopped is not None:
            run.status = "partial"
            run.error = f"{TIME_LIMIT_PREFIX} after {stopped} of {len(site_ids)} sites; the next run carries on."
        elif not site_ids:
            run.error = "No sites with a Search Console property yet."
    except (google.GoogleError, connection.NotConfigured) as exc:
        await db.rollback()
        run = await db.get(SeoBlogRun, run_id)
        run.status = "failed"
        run.error = getattr(exc, "friendly", None) or str(exc)
        logger.warning("Blog run failed: %s", exc)
    except asyncio.CancelledError:
        await db.rollback()
        run = await db.get(SeoBlogRun, run_id)
        run.status, run.finished_at, run.error = "failed", utcnow(), "The API shut down during the run."
        await db.commit()
        raise
    except Exception as exc:
        logger.exception("Blog run crashed")
        await db.rollback()
        run = await db.get(SeoBlogRun, run_id)
        run.status = "failed"
        run.error = f"Unexpected error: {exc.__class__.__name__}: {str(exc)[:200]}"
    finally:
        if own_http:
            await http.aclose()
    run.finished_at = utcnow()
    await db.commit()
    return run


# ========================================================== per site ====


async def sync_site(db: AsyncSession, http: httpx.AsyncClient, client: google.SeoClient, scopes: dict,
                    site: SeoSite, state: SeoBlogState, now: dt.datetime, run: SeoBlogRun) -> bool:
    """Returns False when Google had nothing new for Search Console (only GA4 / inspections may have run)."""
    today = gsc_today(now)
    warnings: list[str] = []

    # ---- 1. discovery, once a day ----
    if state.discovered_on != today:
        found, source = await discover(db, http, site)
        await save_posts(db, site, found, source, now)
        state.discovered_on = today
    posts = list((await db.execute(select(SeoBlogPost).where(SeoBlogPost.site_id == site.id, SeoBlogPost.live.is_(True)))).scalars())
    by_url = {norm_url(p.url): p.id for p in posts}
    prop = site.gsc_property

    # ---- 2. freshness check ----
    probe = await client.gsc_query_body(prop, {"startDate": (today - dt.timedelta(days=5)).isoformat(), "endDate": today.isoformat(),
                                               "dimensions": ["date"], "dataState": "all", "rowLimit": 10})
    hourly_ok = True
    try:
        hprobe = await client.gsc_query_body(prop, {"startDate": (today - dt.timedelta(days=1)).isoformat(), "endDate": today.isoformat(),
                                                    "dimensions": ["hour"], "dataState": "hourly_all", "rowLimit": 10})
    except google.GoogleError as exc:  # hourly data is a bonus: without it the site still gets its daily numbers
        if exc.auth:
            raise
        hprobe, hourly_ok = {}, False
        warnings.append(f"Hourly data: {exc.friendly}")
    first_day, _ = parse_metadata(probe)
    _, first_hour = parse_metadata(hprobe)
    if not hourly_ok and state.gsc_first_incomplete_hour is not None:
        first_hour = state.gsc_first_incomplete_hour  # don't count a missing hourly answer as "changed"
    # new posts (or US numbers not fetched yet): their history is still to fetch
    waiting = [p for p in posts if p.gsc_final_through is None or p.us_gsc_final_through is None]
    gsc_changed = not unchanged(state, first_day, first_hour)
    final_day = final_through(first_day, probe.get("rows") or [], today)
    state.checked_at = now

    # ---- 3. only what is new ----
    young = [p for p in posts if p.published_on and p.published_on >= today - dt.timedelta(days=HOURLY_DAYS)]
    queries_due = bool(posts) and state.queries_on != today
    for scope in SCOPES:
        label = "" if scope == "all" else " (US)"
        if posts and (gsc_changed or waiting):
            new_here = any(getattr(p, gsc_through_attr(scope)) is None for p in waiting)  # before pull_final sets it
            run.rows += await pull_final(db, client, prop, posts, by_url, final_day, today, scope)
            if gsc_changed or new_here:
                run.rows += await pull_fresh(db, client, prop, posts, by_url, final_day, today, scope)
            if young and hourly_ok:
                try:
                    run.rows += await pull_hourly(db, client, prop, young, state, today, scope)
                except google.GoogleError as exc:
                    if exc.auth:
                        raise
                    warnings.append(f"Hourly data{label}: {exc.friendly}")
        if queries_due:
            run.rows += await pull_queries(db, client, prop, posts, by_url, today, scope)
        marker = state.nonbrand_through if scope == "all" else state.us_nonbrand_through
        if gsc_changed or marker is None:
            try:
                run.rows += await pull_nonbrand(db, client, site, state, final_day, today, scope)
            except google.GoogleError as exc:
                if exc.auth:
                    raise
                warnings.append(f"Non-brand totals{label}: {exc.friendly}")
    if queries_due:
        state.queries_on = today
    if gsc_changed or state.us_site_through is None:
        try:
            run.rows += await pull_site_us(db, client, site, state, final_day, today)
        except google.GoogleError as exc:
            if exc.auth:
                raise
            warnings.append(f"US site totals: {exc.friendly}")
    if gsc_changed:
        state.changed_at = now
        state.gsc_first_incomplete_date, state.gsc_first_incomplete_hour = first_day, first_hour
        state.gsc_final_through = final_day

    # ---- 4. GA4 ----
    if scopes.get("analytics") and site.ga4_property and posts:
        for scope in SCOPES:
            try:
                run.rows += await pull_ga4(db, client, site, posts, today, scope)
            except google.GoogleError as exc:
                if exc.auth:
                    raise
                warnings.append(f"GA4{'' if scope == 'all' else ' (US)'}: {exc.friendly}")
        try:
            run.rows += await pull_ga4_site_us(db, client, site, state, today)
        except google.GoogleError as exc:
            if exc.auth:
                raise
            warnings.append(f"GA4 US site sessions: {exc.friendly}")

    # ---- 5. URL Inspection ----
    n = 0
    for p in sorted(posts, key=lambda x: (x.index_verdict == "PASS", x.inspected_at or dt.datetime.min.replace(tzinfo=dt.timezone.utc))):
        if n >= INSPECT_PER_SITE:
            break
        if p.index_verdict == "PASS" and p.inspected_at and now - p.inspected_at < INSPECT_EVERY:
            continue
        try:
            got = parse_inspection(await client.inspect(prop, p.url))
        except google.GoogleError as exc:
            if exc.auth:
                raise
            warnings.append(f"URL Inspection: {exc.friendly}")
            break
        for k, v in got.items():
            setattr(p, k, v)
        p.inspected_at = now
        if got["index_verdict"] == "PASS" and not p.indexed_on:
            p.indexed_on = today
        n += 1

    state.last_warning = "; ".join(warnings)[:1000] if warnings else None
    return gsc_changed or bool(waiting)


# ========================================================== discovery ====


async def discover(db: AsyncSession, http: httpx.AsyncClient, site: SeoSite) -> tuple[list[dict], str]:
    """The site's posts from the first source that answers: WordPress feed → post sitemap → pages we already know."""
    base = f"{urlparse(site.home_url).scheme or 'https'}://{urlparse(site.home_url).netloc or site.domain}"
    wp = await _wordpress(http, base, site.domain)
    if wp is not None:
        return wp, "wordpress"
    sm = await _sitemap(http, base, site.domain)
    if sm:
        return sm, "sitemap"
    return await _known_pages(db, site), "crawler"


async def _get(http: httpx.AsyncClient, url: str, accept: str) -> Optional[httpx.Response]:
    try:
        return await http.get(url, headers={"User-Agent": USER_AGENT, "Accept": accept}, follow_redirects=True, timeout=20.0)
    except httpx.HTTPError:
        return None


async def _wordpress(http: httpx.AsyncClient, base: str, domain: str) -> Optional[list[dict]]:
    """None when the site has no public WordPress posts feed."""
    out: list[dict] = []
    for page in range(1, WP_MAX_PAGES + 1):
        r = await _get(http, f"{base}/wp-json/wp/v2/posts?per_page=100&page={page}&_fields=link,date,title", "application/json")
        if r is None or r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return out if page > 1 else None
        try:
            items = r.json()
        except ValueError:
            return out if page > 1 else None
        out += parse_wp_posts(items, domain)
        try:
            pages = int(r.headers.get("x-wp-totalpages") or 1)
        except ValueError:
            pages = 1
        if page >= pages or not items:
            break
    return out


async def _sitemap(http: httpx.AsyncClient, base: str, domain: str) -> list[dict]:
    for path in SITEMAP_PATHS:
        r = await _get(http, base + path, "application/xml,text/xml")
        if r is not None and r.status_code == 200 and "<urlset" in r.text[:2000]:
            got = parse_sitemap(r.text, domain)
            if got:
                return got
    return []


async def _known_pages(db: AsyncSession, site: SeoSite) -> list[dict]:
    urls = set((await db.execute(select(SeoPage.url).where(SeoPage.site_id == site.id))).scalars())
    urls |= set((await db.execute(select(SeoGscPage.page).where(SeoGscPage.site_id == site.id).distinct())).scalars())
    return [{"url": u, "title": None, "published_on": None} for u in sorted(urls)
            if host_of(u) == site.domain and "#" not in u and section_of(u) == "blog"]


async def save_posts(db: AsyncSession, site: SeoSite, found: list[dict], source: str, now: dt.datetime) -> None:
    existing = {norm_url(p.url): p for p in (await db.execute(select(SeoBlogPost).where(SeoBlogPost.site_id == site.id))).scalars()}
    seen = set()
    for f in found:
        key = norm_url(f["url"])
        if key in seen:
            continue
        seen.add(key)
        p = existing.get(key)
        if not p:
            p = SeoBlogPost(site_id=site.id, url=f["url"], source=source, first_seen_at=now)
            db.add(p)
        p.live, p.last_seen_at, p.source = True, now, source
        if f.get("title"):
            p.title = f["title"]
        if f.get("published_on") and (source == "wordpress" or not p.published_on):
            p.published_on = f["published_on"]
    # A post the source no longer lists is kept (its history stays) but no longer pulled.
    if found:
        for key, p in existing.items():
            if key not in seen:
                p.live = False
    await db.flush()


# ============================================================== pulls ====


async def _upsert(db: AsyncSession, model, rows: list[dict], keys: list[str], cols: tuple[str, ...]) -> int:
    for c in range(0, len(rows), 500):
        stmt = pg_insert(model).values(rows[c: c + 500])
        await db.execute(stmt.on_conflict_do_update(index_elements=keys, set_={k: stmt.excluded[k] for k in cols}))
    return len(rows)


def _start_for(p: SeoBlogPost, today: dt.date, scope: str = "all") -> dt.date:
    history = today - dt.timedelta(days=get_settings().SEO_HISTORY_DAYS)
    through = getattr(p, gsc_through_attr(scope))
    if through:
        return through + dt.timedelta(days=1)
    first = p.published_on or p.first_seen_at.date() - dt.timedelta(days=60)
    return max(history, first - dt.timedelta(days=1))


async def pull_final(db: AsyncSession, client: google.SeoClient, prop: str, posts: list[SeoBlogPost], by_url: dict[str, str],
                     final_day: dt.date, today: dt.date, scope: str = "all") -> int:
    """Final days not stored yet (each final day is fetched once per post and scope)."""
    due = [p for p in posts if _start_for(p, today, scope) <= final_day]
    if not due:
        return 0
    start = min(_start_for(p, today, scope) for p in due)
    body = gsc_scoped({"startDate": start.isoformat(), "endDate": final_day.isoformat(), "dimensions": ["date", "page"]}, scope)
    rows = gsc_page_rows(await client.gsc_rows_paged(prop, body), by_url, "date")
    starts = {p.id: _start_for(p, today, scope) for p in due}
    rows = [{**r, "is_final": True, "scope": scope} for r in rows if r["post_id"] in starts and r["date"] >= starts[r["post_id"]]]
    n = await _upsert(db, SeoBlogGscDaily, rows, ["post_id", "date", "scope"], ("clicks", "impressions", "position", "is_final"))
    first_seen: dict[str, dt.date] = {}
    for r in rows:
        if r["impressions"] and (r["post_id"] not in first_seen or r["date"] < first_seen[r["post_id"]]):
            first_seen[r["post_id"]] = r["date"]
    for p in due:
        setattr(p, gsc_through_attr(scope), final_day)
        if scope != "all":
            continue  # "first impression = indexed" uses every country
        if p.id in first_seen and (not p.indexed_on or first_seen[p.id] < p.indexed_on):
            p.indexed_on = first_seen[p.id]  # first impression = it was in Google's index that day
    return n


async def pull_fresh(db: AsyncSession, client: google.SeoClient, prop: str, posts: list[SeoBlogPost], by_url: dict[str, str],
                     final_day: dt.date, today: dt.date, scope: str = "all") -> int:
    """Days after the last final one: Google's fresh numbers, replaced until final."""
    start = final_day + dt.timedelta(days=1)
    ids = [p.id for p in posts]
    # Provisional rows from days that are final now (all of them were just replaced by pull_final) or that
    # Google no longer reports are cleared, so only current fresh numbers remain.
    await db.execute(delete(SeoBlogGscDaily).where(SeoBlogGscDaily.post_id.in_(ids), SeoBlogGscDaily.is_final.is_(False),
                                                   SeoBlogGscDaily.scope == scope))
    if start > today:
        return 0
    body = gsc_scoped({"startDate": start.isoformat(), "endDate": today.isoformat(), "dimensions": ["date", "page"], "dataState": "all"}, scope)
    rows = gsc_page_rows(await client.gsc_rows_paged(prop, body), by_url, "date")
    return await _upsert(db, SeoBlogGscDaily, [{**r, "is_final": False, "scope": scope} for r in rows], ["post_id", "date", "scope"],
                         ("clicks", "impressions", "position", "is_final"))


async def pull_hourly(db: AsyncSession, client: google.SeoClient, prop: str, young: list[SeoBlogPost], state: SeoBlogState,
                      today: dt.date, scope: str = "all") -> int:
    """Hourly numbers for posts from the last 10 days, from the first hour that wasn't final at the last check."""
    oldest = today - dt.timedelta(days=HOURLY_DAYS - 1)
    have = set((await db.execute(select(SeoBlogGscHourly.post_id).where(SeoBlogGscHourly.post_id.in_([p.id for p in young]),
                                                                        SeoBlogGscHourly.scope == scope).distinct())).scalars())
    start = oldest
    if state.gsc_first_incomplete_hour and all(p.id in have for p in young):
        start = max(oldest, state.gsc_first_incomplete_hour.astimezone(GSC_TZ).date())
    by_url = {norm_url(p.url): p.id for p in young}
    body = gsc_scoped({"startDate": start.isoformat(), "endDate": today.isoformat(), "dimensions": ["hour", "page"], "dataState": "hourly_all"}, scope)
    rows = [{**r, "scope": scope} for r in gsc_page_rows(await client.gsc_rows_paged(prop, body), by_url, "hour")]
    n = await _upsert(db, SeoBlogGscHourly, rows, ["post_id", "hour", "scope"], ("clicks", "impressions", "position"))
    cutoff = dt.datetime.combine(today - dt.timedelta(days=HOURLY_DAYS + 4), dt.time(), tzinfo=GSC_TZ)
    await db.execute(delete(SeoBlogGscHourly).where(SeoBlogGscHourly.hour < cutoff))
    return n


async def pull_queries(db: AsyncSession, client: google.SeoClient, prop: str, posts: list[SeoBlogPost], by_url: dict[str, str],
                       today: dt.date, scope: str = "all") -> int:
    """Search terms per post for this month (and last month during its first 3 days, while it settles)."""
    months = [today.replace(day=1)]
    if today.day <= 3:
        months.append((today.replace(day=1) - dt.timedelta(days=1)).replace(day=1))
    ids = [p.id for p in posts]
    n = 0
    for m in months:
        end = min(today, (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1))
        raw = await client.gsc_rows_paged(prop, gsc_scoped({"startDate": m.isoformat(), "endDate": end.isoformat(), "dimensions": ["page", "query"],
                                                            "dataState": "all"}, scope), max_pages=4)
        merged: dict[tuple[str, str], dict] = {}
        for r in raw:
            keys = r.get("keys") or []
            if len(keys) < 2 or not keys[1]:
                continue
            post_id = by_url.get(norm_url(keys[0]))
            if not post_id:
                continue
            q = str(keys[1])[:400]
            cur = merged.setdefault((post_id, q), {"post_id": post_id, "month": m, "query": q, "scope": scope, "clicks": 0, "impressions": 0,
                                                   "position": None})
            imp = cur["impressions"] + int(r.get("impressions") or 0)
            if r.get("position") is not None:
                pos = float(r["position"])
                cur["position"] = pos if cur["position"] is None or not imp else (cur["position"] * cur["impressions"] + pos * int(r.get("impressions") or 0)) / imp
            cur["clicks"] += int(r.get("clicks") or 0)
            cur["impressions"] = imp
        await db.execute(delete(SeoBlogQuery).where(SeoBlogQuery.post_id.in_(ids), SeoBlogQuery.month == m, SeoBlogQuery.scope == scope))
        n += await _upsert(db, SeoBlogQuery, list(merged.values()), ["post_id", "month", "query", "scope"], ("clicks", "impressions", "position"))
    return n


def _day_rows(rows: list[dict]) -> list[tuple[dt.date, dict]]:
    out = []
    for r in rows:
        try:
            out.append((dt.date.fromisoformat((r.get("keys") or [""])[0]), r))
        except ValueError:
            continue
    return out


async def pull_nonbrand(db: AsyncSession, client: google.SeoClient, site: SeoSite, state: SeoBlogState, final_day: dt.date,
                        today: dt.date, scope: str = "all") -> int:
    """Site-wide clicks/impressions from searches without the restaurant's own name, final days only."""
    terms = [t.strip().lower() for t in (state.brand_terms or []) if t and t.strip()]
    if not terms:
        return 0
    marker = "nonbrand_through" if scope == "all" else "us_nonbrand_through"
    through = getattr(state, marker)
    start = through + dt.timedelta(days=1) if through else today - dt.timedelta(days=get_settings().SEO_HISTORY_DAYS)
    if start > final_day:
        return 0
    rows = await client.gsc_rows_paged(site.gsc_property, gsc_scoped({
        "startDate": start.isoformat(), "endDate": final_day.isoformat(), "dimensions": ["date"],
        "dimensionFilterGroups": [{"groupType": "and", "filters": [{"dimension": "query", "operator": "notContains", "expression": t} for t in terms[:5]]}],
    }, scope), max_pages=1)
    out = [{"site_id": site.id, "date": d, "scope": scope, "nonbrand_clicks": int(r.get("clicks") or 0),
            "nonbrand_impressions": int(r.get("impressions") or 0)} for d, r in _day_rows(rows)]
    n = await _upsert(db, SeoBlogSiteDaily, out, ["site_id", "date", "scope"], ("nonbrand_clicks", "nonbrand_impressions"))
    setattr(state, marker, final_day)
    return n


async def pull_site_us(db: AsyncSession, client: google.SeoClient, site: SeoSite, state: SeoBlogState, final_day: dt.date,
                       today: dt.date) -> int:
    """The whole site's US clicks / impressions per final day (the "rest of the site" and share figures in US mode)."""
    through = state.us_site_through
    start = through + dt.timedelta(days=1) if through else today - dt.timedelta(days=get_settings().SEO_HISTORY_DAYS)
    if start > final_day:
        return 0
    rows = await client.gsc_rows_paged(site.gsc_property, gsc_scoped(
        {"startDate": start.isoformat(), "endDate": final_day.isoformat(), "dimensions": ["date"]}, "us"), max_pages=1)
    out = [{"site_id": site.id, "date": d, "scope": "us", "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0)}
           for d, r in _day_rows(rows)]
    n = await _upsert(db, SeoBlogSiteDaily, out, ["site_id", "date", "scope"], ("clicks", "impressions"))
    state.us_site_through = final_day
    return n


async def pull_ga4_site_us(db: AsyncSession, client: google.SeoClient, site: SeoSite, state: SeoBlogState, today: dt.date) -> int:
    """The whole site's US organic sessions per day (before vs after blogging in US mode). Last 3 days refreshed."""
    yesterday = today - dt.timedelta(days=1)
    through = state.us_ga4_site_through
    start = through - dt.timedelta(days=GA4_REFRESH_DAYS - 1) if through else today - dt.timedelta(days=get_settings().SEO_HISTORY_DAYS)
    if start > yesterday:
        return 0
    body = ga4_scoped({
        "dateRanges": [{"startDate": start.isoformat(), "endDate": yesterday.isoformat()}],
        "dimensions": [{"name": "date"}],
        "metrics": [{"name": "sessions"}],
        "dimensionFilter": {"filter": {"fieldName": "sessionDefaultChannelGroup",
                                       "inListFilter": {"values": sorted(google.ORGANIC_CHANNELS)}}},
        "limit": 100000,
    }, "us")
    by_day: dict[dt.date, int] = {}
    for r in ga4_rows(await client.ga4_report(site.ga4_property, body)):
        d = _ga4_date(r[0] if r else None)
        if d and len(r) >= 2:
            by_day[d] = by_day.get(d, 0) + int(float(r[1] or 0))
    out = []
    for k in range((yesterday - start).days + 1):  # a day GA4 doesn't list had no organic US sessions
        d = start + dt.timedelta(days=k)
        out.append({"site_id": site.id, "date": d, "scope": "us", "organic_sessions": by_day.get(d, 0)})
    n = await _upsert(db, SeoBlogSiteDaily, out, ["site_id", "date", "scope"], ("organic_sessions",))
    state.us_ga4_site_through = yesterday
    return n


async def reset_nonbrand(db: AsyncSession, site_id: str) -> None:
    """Brand terms changed: the non-brand history is fetched again on the next run."""
    await db.execute(delete(SeoBlogSiteDaily).where(SeoBlogSiteDaily.site_id == site_id, SeoBlogSiteDaily.scope == "all"))
    # US rows also hold the site's US totals: only their non-brand part is cleared.
    await db.execute(update(SeoBlogSiteDaily).where(SeoBlogSiteDaily.site_id == site_id, SeoBlogSiteDaily.scope == "us")
                     .values(nonbrand_clicks=0, nonbrand_impressions=0))
    state = await db.get(SeoBlogState, site_id)
    if state:
        state.nonbrand_through = state.us_nonbrand_through = None


async def pull_ga4(db: AsyncSession, client: google.SeoClient, site: SeoSite, posts: list[SeoBlogPost], today: dt.date,
                   scope: str = "all") -> int:
    """Last 3 days refreshed; older days were stored by earlier runs and are kept."""
    yesterday = today - dt.timedelta(days=1)
    history = today - dt.timedelta(days=get_settings().SEO_HISTORY_DAYS)
    attr = ga4_through_attr(scope)

    def start_of(p: SeoBlogPost) -> dt.date:
        through = getattr(p, attr)
        if through:
            return max(history, through - dt.timedelta(days=GA4_REFRESH_DAYS - 1))
        return max(history, (p.published_on or p.first_seen_at.date() - dt.timedelta(days=60)) - dt.timedelta(days=1))

    starts = {p.id: start_of(p) for p in posts}
    start = min(starts.values())
    if start > today:
        return 0
    landing_body, clicks_body = ga4_bodies(start, today)
    landing = await client.ga4_report(site.ga4_property, ga4_scoped(landing_body, scope))
    clicks = await client.ga4_report(site.ga4_property, ga4_scoped(clicks_body, scope))
    by_path: dict[str, str] = {}
    for p in posts:
        by_path[norm_path(urlparse(p.url).path)] = p.id
    cells = ga4_by_post(landing, clicks, by_path)
    rows = [{"post_id": pid, "date": d, "scope": scope, **v} for (pid, d), v in cells.items() if d >= starts[pid]]
    # The refreshed window is replaced as a whole, so a day that lost its visits doesn't keep old numbers.
    await db.execute(delete(SeoBlogGa4Daily).where(SeoBlogGa4Daily.post_id.in_(list(starts)), SeoBlogGa4Daily.scope == scope,
                                                   SeoBlogGa4Daily.date >= today - dt.timedelta(days=GA4_REFRESH_DAYS)))
    n = await _upsert(db, SeoBlogGa4Daily, rows, ["post_id", "date", "scope"], ("sessions", "organic_sessions", "engaged_sessions", "order_clicks"))
    for p in posts:
        setattr(p, attr, yesterday)
    return n
