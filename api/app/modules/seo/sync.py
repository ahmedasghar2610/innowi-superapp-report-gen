"""Pull SEO data into our tables.

One run:
  1. Search Console → every property the connected account can read becomes a
     seo_site (one per domain; Domain properties win). Real sites replace the
     DEMO sample data. Sites added by hand are kept and checked too.
  2. GA4 → the account's properties and their web-stream hosts; a site with no
     GA4 property picked gets the one whose stream host matches its domain.
  3. Per active site:
       Search Console daily clicks/impressions/position (first run
       SEO_HISTORY_DAYS back, then from the last stored day − 3)
       search terms + landing pages for this month and the two before
       GA4 daily sessions/users/key events (all + Organic Search)
       page checks: home + top pages by clicks (SEO_PAGES_PER_SITE)
       URL Inspection for the top pages (SEO_INSPECT_PER_SITE, weekly)
       PageSpeed (PAGESPEED_API_KEY, SEO_PSI_PAGES_PER_SITE, every SEO_PSI_REFRESH_DAYS)
       tracked keywords: their Search Console figures (fetched by filter when a keyword isn't among the top terms)
     then the scorecard and findings are recomputed (data.recompute).
  4. Due client reports are assembled (client_reports.auto_assemble).
A failing site records `sync_error` and the run carries on ("partial"). An
expired/revoked Google token stops the run and marks the connection "error".
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Callable, Optional

import httpx
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.config import get_settings
from app.models.seo import SeoGa4Daily, SeoGscDaily, SeoGscPage, SeoGscQuery, SeoGscSplit, SeoKeyword, SeoPage, SeoSite, SeoSyncRun, utcnow
from app.modules.seo import connection, crawl, data, google, pagespeed

logger = logging.getLogger("SEO.sync")

OVERLAP_DAYS = 3
MONTHS_REFRESHED = 3
QUERY_ROWS = 1000  # enough to count every search a restaurant site shows up for
SPLIT_COUNTRIES = 25  # countries kept per month (the report shows home country vs the rest)
KEYWORD_LOOKUPS = 30  # tracked keywords outside the top terms, fetched one by one per month
PAGE_ROWS = 500
INSPECT_EVERY = dt.timedelta(days=7)
STALE_RUN = dt.timedelta(hours=3)
GA4_ZERO = {"sessions": 0, "users": 0, "engaged_sessions": 0, "key_events": 0.0, "organic_sessions": 0, "organic_key_events": 0.0}

_tasks: set[asyncio.Task] = set()
# Runs this API process is executing right now, and when the process started. A refresh runs
# inside the API process, so a run still marked "running" that began before this process
# started belongs to a process that is gone (restart / --reload / crash): it will never finish.
_live: set[str] = set()
_PROCESS_STARTED = utcnow()


class SyncBusy(RuntimeError):
    pass


async def running(db: AsyncSession) -> Optional[SeoSyncRun]:
    run = (await db.execute(select(SeoSyncRun).where(SeoSyncRun.status == "running").order_by(SeoSyncRun.started_at.desc()).limit(1))).scalar_one_or_none()
    if not run:
        return None
    # Started before this API process and not running in it: the process that ran it is gone
    # (restart / --reload / crash), so it will never finish — close it instead of spinning forever.
    # (Serverless: every request is a new process, so only the age check applies there.)
    orphaned = not jobs.inline() and run.id not in _live and run.started_at < _PROCESS_STARTED
    if orphaned or utcnow() - run.started_at > jobs.stale_after(STALE_RUN):
        run.status, run.finished_at = "failed", utcnow()
        run.error = (f"it stopped after {run.sites or 0} sites because the API restarted during the refresh. "
                     "Click Refresh data to run it again.")
        await db.commit()
        return None
    return run


async def create_run(db: AsyncSession, trigger: str, user_id: Optional[str]) -> SeoSyncRun:
    await db.execute(text("SELECT pg_advisory_xact_lock(7244112)"))
    if await running(db):
        raise SyncBusy("A sync is already running.")
    run = SeoSyncRun(trigger=trigger, status="running", started_by_id=user_id, started_at=utcnow())
    db.add(run)
    await db.commit()
    return run


async def start_background(run_id: str) -> None:
    """Run the sync: inline on a serverless host (inside this request, within
    the time budget), else as a background task (app/common/jobs.py)."""
    await jobs.run(lambda: run_in_new_session(run_id), name=f"seo-sync-{run_id}")


async def run_in_new_session(run_id: str, http: Optional[httpx.AsyncClient] = None) -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        await run_sync(db, run_id, http=http)


async def last_runs(db: AsyncSession, limit: int = 5) -> list[SeoSyncRun]:
    return list((await db.execute(select(SeoSyncRun).order_by(SeoSyncRun.started_at.desc()).limit(limit))).scalars().all())


async def counts(db: AsyncSession) -> dict[str, int]:
    rows = (await db.execute(select(SeoSite.source, func.count()).group_by(SeoSite.source))).all()
    return {src: n for src, n in rows}


def _months(today: dt.date, n: int = MONTHS_REFRESHED) -> list[dt.date]:
    out, m = [], data.month_start(today)
    for _ in range(n):
        out.append(m)
        m = data.prev_month(m)
    return out


async def run_sync(db: AsyncSession, run_id: str, http: Optional[httpx.AsyncClient] = None, today: Optional[dt.date] = None,
                   progress: Optional[Callable[[str], None]] = None) -> SeoSyncRun:
    _live.add(run_id)
    try:
        return await _run_sync(db, run_id, http, today, progress)
    except asyncio.CancelledError:
        # The API is shutting down mid-refresh: record it instead of leaving the run "running".
        try:
            await db.rollback()
            run = await db.get(SeoSyncRun, run_id)
            if run and run.status == "running":
                run.status, run.finished_at = "failed", utcnow()
                run.error = f"it stopped after {run.sites} sites because the API shut down. Click Refresh data to run it again."
                await db.commit()
        except Exception:
            pass
        raise
    finally:
        _live.discard(run_id)


async def _run_sync(db: AsyncSession, run_id: str, http: Optional[httpx.AsyncClient], today: Optional[dt.date],
                    progress: Optional[Callable[[str], None]]) -> SeoSyncRun:
    run = await db.get(SeoSyncRun, run_id)
    assert run is not None
    own_http = http is None
    http = http or httpx.AsyncClient(timeout=httpx.Timeout(30.0))
    today = today or dt.date.today()
    s = get_settings()
    try:
        conn = await connection.current(db)
        client: Optional[google.SeoClient] = None
        if conn and not connection.missing_env():
            token = await connection.access_token(db, http, conn)
            client = google.SeoClient(http, token, google.RateLimiter(s.SEO_REQUESTS_PER_MINUTE))
        scopes = connection.granted(conn)

        # ---- 1. Search Console properties → sites ----
        if client and scopes["searchConsole"]:
            props = google.parse_gsc_sites(await client.gsc_sites())
            if props:
                await db.execute(delete(SeoSite).where(SeoSite.source == "DEMO"))
                await db.commit()
            for p in props:
                site = (await db.execute(select(SeoSite).where(SeoSite.domain == p["domain"]))).scalar_one_or_none()
                if not site:
                    site = SeoSite(source="GOOGLE", name=p["domain"], domain=p["domain"], home_url=google.home_url_for(p["property"], p["domain"]))
                    db.add(site)
                site.gsc_property, site.gsc_permission = p["property"], p["permission"]
            await db.commit()

        # ---- 2. GA4 properties ----
        if client and scopes["analytics"]:
            try:
                ga4 = google.parse_ga4_properties(await client.ga4_account_summaries())
                for g in ga4:
                    try:
                        g["hosts"] = google.parse_stream_hosts(await client.ga4_streams(g["property"]))
                    except google.GoogleError as exc:
                        if exc.auth:
                            raise
                conn.ga4_properties = ga4
                await db.commit()
            except google.GoogleError as exc:
                if exc.auth:
                    raise
                logger.warning("GA4 property list failed: %s", exc)

        sites = (await db.execute(select(SeoSite).where(SeoSite.source != "DEMO", SeoSite.status == "active").order_by(SeoSite.domain))).scalars().all()
        ga4_by_host = {h: g for g in (conn.ga4_properties if conn else []) for h in g.get("hosts") or []}
        time_limited: int | None = None  # items finished when the time budget ran out
        for i, site in enumerate(sites, 1):
            if jobs.time_up():
                time_limited = i - 1
                break
            if progress:
                progress(f"[{i}/{len(sites)}] {site.domain}")
            if not site.ga4_property and site.domain in ga4_by_host:
                site.ga4_property = ga4_by_host[site.domain]["property"]
                site.ga4_name = ga4_by_host[site.domain]["name"]
            await data.link_by_domain(db, site)
            try:
                await sync_site(db, http, client, scopes, site, today, run)
            except google.GoogleError as exc:
                # Nothing to undo: a Google error happens between writes.
                if exc.auth:
                    raise
                site.sync_error = exc.friendly
                site.last_synced_at = utcnow()
                run.sites_failed += 1
            try:
                await data.recompute(db, site, today, psi_configured=bool(s.PAGESPEED_API_KEY))
            except Exception:  # scoring must never break the run
                logger.exception("SEO recompute failed for %s", site.domain)
            run.sites += 1
            await db.commit()

        try:
            from app.modules.seo import client_reports

            await client_reports.auto_assemble(db, today)
        except Exception:
            logger.exception("SEO report auto-assembly failed")
            await db.rollback()
        if conn:
            conn.last_sync_at = utcnow()
            conn.status, conn.last_error = "connected", None
        run.status = "partial" if run.sites_failed else "success"
        if time_limited is not None:
            run.status = "partial"
            run.error = f"Stopped at the time limit after {time_limited} of {len(sites)} sites; the next sync carries on."
        if not sites:
            run.error = "No sites yet: the connected account has no Search Console properties, and none were added by hand."
    except (google.GoogleError, connection.NotConfigured) as exc:
        await db.rollback()
        run = await db.get(SeoSyncRun, run_id)
        run.status = "failed"
        run.error = getattr(exc, "friendly", None) or str(exc)
        logger.warning("SEO sync failed: %s", exc)
    except Exception as exc:
        logger.exception("SEO sync crashed")
        await db.rollback()
        run = await db.get(SeoSyncRun, run_id)
        run.status = "failed"
        run.error = f"Unexpected error: {exc.__class__.__name__}: {str(exc)[:200]}"
    finally:
        if own_http:
            await http.aclose()
    run.finished_at = utcnow()
    await db.commit()
    return run


async def _upsert(db: AsyncSession, model, rows: list[dict], keys: list[str], cols: tuple[str, ...]) -> None:
    for c in range(0, len(rows), 500):
        stmt = pg_insert(model).values(rows[c : c + 500])
        await db.execute(stmt.on_conflict_do_update(index_elements=keys, set_={k: stmt.excluded[k] for k in cols}))


async def sync_site(db: AsyncSession, http: httpx.AsyncClient, client: Optional[google.SeoClient], scopes: dict,
                    site: SeoSite, today: dt.date, run: SeoSyncRun) -> None:
    s = get_settings()
    problems: list[str] = []
    gsc_error: Optional[str] = None
    yesterday = today - dt.timedelta(days=1)

    # ---- Search Console ----
    if client and scopes["searchConsole"] and site.gsc_property:
        try:
            start = (site.last_gsc_date - dt.timedelta(days=OVERLAP_DAYS)) if site.last_gsc_date else today - dt.timedelta(days=s.SEO_HISTORY_DAYS)
            days = google.parse_gsc_daily(await client.gsc_daily(site.gsc_property, start, yesterday))
            if days:
                await _upsert(db, SeoGscDaily, [{"site_id": site.id, "date": d, **v} for d, v in days.items()], ["site_id", "date"], ("clicks", "impressions", "position"))
                site.last_gsc_date = max(days)
                run.gsc_days += len(days)
            have_q = set((await db.execute(select(SeoGscQuery.month).where(SeoGscQuery.site_id == site.id).distinct())).scalars())
            have_split = set((await db.execute(select(SeoGscSplit.month).where(SeoGscSplit.site_id == site.id).distinct())).scalars())
            await seed_keywords(db, site)
            tracked = [k.lower() for k in (await db.execute(select(SeoKeyword.keyword).where(SeoKeyword.site_id == site.id, SeoKeyword.active.is_(True)))).scalars()]
            for i, m in enumerate(_months(today)):
                end = min(data.month_end(m), yesterday)
                if end < m:
                    continue
                if not (i >= 2 and m in have_split):
                    # Device and country split for the client report (small: ~3 devices, top countries).
                    await db.execute(delete(SeoGscSplit).where(SeoGscSplit.site_id == site.id, SeoGscSplit.month == m))
                    rows = []
                    for dim, limit in (("device", 10), ("country", SPLIT_COUNTRIES)):
                        for it in google.parse_gsc_dimension(await client.gsc_dimension(site.gsc_property, dim, m, end, limit), 60):
                            rows.append({"site_id": site.id, "month": m, "dimension": dim, "key": it["key"].upper(), "clicks": it["clicks"],
                                         "impressions": it["impressions"], "position": it["position"]})
                    if rows:
                        await db.execute(pg_insert(SeoGscSplit).values(rows).on_conflict_do_nothing())
                if i >= 2 and m in have_q:
                    continue  # complete older months don't change
                for model, dim, limit, col in ((SeoGscQuery, "query", QUERY_ROWS, "query"), (SeoGscPage, "page", PAGE_ROWS, "page")):
                    items = google.parse_gsc_dimension(await client.gsc_dimension(site.gsc_property, dim, m, end, limit), 400 if dim == "query" else 1000)
                    await db.execute(delete(model).where(model.site_id == site.id, model.month == m))
                    if dim == "query":
                        # Tracked keywords outside the top terms: ask Search Console for each one.
                        seen = {it["key"].lower() for it in items}
                        for kw in [k for k in tracked if k not in seen][:KEYWORD_LOOKUPS]:
                            items += google.parse_gsc_dimension(await client.gsc_exact_query(site.gsc_property, kw, m, end), 400)
                    if items:
                        await db.execute(pg_insert(model).values([
                            {"site_id": site.id, "month": m, col: it["key"], "clicks": it["clicks"], "impressions": it["impressions"], "position": it["position"]}
                            for it in items
                        ]).on_conflict_do_nothing())
            await seed_keywords(db, site)  # first sync: start tracking the top terms just stored
        except google.GoogleError as exc:
            if exc.auth:
                raise
            gsc_error = exc.friendly

    # ---- GA4 ----
    if client and scopes["analytics"] and site.ga4_property:
        try:
            start = (site.last_ga4_date - dt.timedelta(days=OVERLAP_DAYS)) if site.last_ga4_date else today - dt.timedelta(days=s.SEO_HISTORY_DAYS)
            days = google.parse_ga4_daily(await client.ga4_daily(site.ga4_property, start, yesterday))
            # GA4 leaves out days without visits: store those as zero, so a
            # tracking gap shows up (and overwrites what an earlier sync read).
            d = (min(days) if days and not site.last_ga4_date else start)
            while d <= yesterday:
                days.setdefault(d, dict(GA4_ZERO))
                d += dt.timedelta(days=1)
            if days:
                await _upsert(db, SeoGa4Daily, [{"site_id": site.id, "date": d, **v} for d, v in sorted(days.items())], ["site_id", "date"], tuple(GA4_ZERO))
            site.last_ga4_date = yesterday
        except google.GoogleError as exc:
            if exc.auth:
                raise
            problems.append(f"GA4: {exc.friendly}")

    # ---- pages to check: home + top pages by clicks ----
    urls = [site.home_url]
    page_clicks = await data.page_month_clicks(db, site)
    for u, _ in sorted(page_clicks.items(), key=lambda kv: (-kv[1][0], -kv[1][1])):
        if len(urls) >= s.SEO_PAGES_PER_SITE:
            break
        if crawl.host_of(u) == site.domain and u not in urls and "#" not in u:
            urls.append(u)
    pages: dict[str, SeoPage] = {p.url: p for p in (await db.execute(select(SeoPage).where(SeoPage.site_id == site.id))).scalars()}
    now = utcnow()
    for u in urls:
        vals = crawl.facts_from_fetch(u, site.domain, await crawl.fetch(http, u))
        p = pages.get(u)
        if not p:
            p = SeoPage(site_id=site.id, url=u, page_type="home" if u == site.home_url else crawl.page_type(u))
            db.add(p)
            pages[u] = p
        for k, v in vals.items():
            setattr(p, k, v)
        p.last_crawl_at = now
        run.pages_checked += 1
    site.last_crawl_at = now

    # ---- URL Inspection ----
    if client and scopes["searchConsole"] and site.gsc_property and s.SEO_INSPECT_PER_SITE:
        n = 0
        for u in urls:
            p = pages[u]
            if n >= s.SEO_INSPECT_PER_SITE or (p.inspected_at and now - p.inspected_at < INSPECT_EVERY) or p.crawl_error:
                continue
            try:
                for k, v in google.parse_inspection(await client.inspect(site.gsc_property, u)).items():
                    setattr(p, k, v)
                p.inspected_at = now
                n += 1
            except google.GoogleError as exc:
                if exc.auth:
                    raise
                problems.append(f"URL Inspection: {exc.friendly}")
                break

    # ---- PageSpeed ----
    if pagespeed.configured():
        res = await pagespeed.run_site(db, site, http, urls, pages=pages)
        problems += [f"PageSpeed: {e}" for e in res["errors"][:1]]

    # ---- issues per page (stored for the Pages view) ----
    await db.flush()
    for p in pages.values():
        c, i = page_clicks.get(p.url, (0, 0))
        p.issues = crawl.page_issues(data.page_facts(p, site.domain, c, i))

    site.sync_error = gsc_error
    site.sync_warning = "; ".join(problems)[:1000] if problems else None
    site.last_synced_at = utcnow()


async def seed_keywords(db: AsyncSession, site: SeoSite) -> int:
    """First time only: track the site's top Search Console terms by impressions (their positions
    then come from Search Console itself)."""
    s = get_settings()
    have = int((await db.execute(select(func.count()).where(SeoKeyword.site_id == site.id))).scalar_one())
    if have or not site.last_gsc_date:
        return 0
    m = await data.latest_month(db, SeoGscQuery, site.id, data.month_start(site.last_gsc_date))
    if not m:
        return 0
    top = (await db.execute(select(SeoGscQuery.query).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == m).order_by(SeoGscQuery.impressions.desc()).limit(s.SEO_KEYWORDS_PER_SITE))).scalars().all()
    for q in top:
        db.add(SeoKeyword(site_id=site.id, keyword=q[:300], source="gsc"))
    await db.flush()
    return len(top)
