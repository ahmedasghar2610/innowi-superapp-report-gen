"""Pull the connected account's Business Profile data into our tables.

One run = every listing the account can see, one after another, at most
GBP_REQUESTS_PER_MINUTE calls (≈ 8 calls per listing → ~5 minutes for 150).
Started by "Sync now" (POST /gbp/sync), right after connecting, or on a
schedule with `python -m scripts.gbp_sync`.

Per listing:
  details + attributes + photos + verification  → gbp_location
  daily metrics: first run GBP_HISTORY_DAYS back, then from the last stored
  day minus 5 (Google back-fills late data)      → gbp_daily_metric
  reviews: newest first until already-synced ones → gbp_review
  posts                                           → gbp_post
  search keywords for the last 3 complete months not stored yet → gbp_search_keyword

A failing listing records `sync_error` and the run carries on (status
"partial"). An expired/revoked token stops the run and marks the connection
"error" so the page asks for a reconnect. The first run that finds real
listings deletes the DEMO sample data.
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
from app.models.gbp import (
    GbpDailyMetric,
    GbpLocation,
    GbpPost,
    GbpReview,
    GbpSearchKeyword,
    GbpSyncRun,
    utcnow,
)
from app.modules.gbp import connection, google, profile

logger = logging.getLogger("GBP.sync")

KEYWORD_MONTHS = 3
METRIC_OVERLAP_DAYS = 5
MAX_REVIEW_PAGES = 40  # 2,000 reviews per listing per run
STALE_RUN = dt.timedelta(hours=2)

_tasks: set[asyncio.Task] = set()
_PROCESS_STARTED = utcnow()  # runs started before this are from a process that's gone


class SyncBusy(RuntimeError):
    pass


def _month_start(d: dt.date) -> dt.date:
    return d.replace(day=1)


def _prev_month(d: dt.date) -> dt.date:
    return (d.replace(day=1) - dt.timedelta(days=1)).replace(day=1)


def complete_months(today: dt.date, n: int = KEYWORD_MONTHS) -> list[dt.date]:
    out, m = [], _prev_month(today)
    for _ in range(n):
        out.append(m)
        m = _prev_month(m)
    return out


async def running(db: AsyncSession) -> Optional[GbpSyncRun]:
    run = (
        await db.execute(select(GbpSyncRun).where(GbpSyncRun.status == "running").order_by(GbpSyncRun.started_at.desc()).limit(1))
    ).scalar_one_or_none()
    if not run:
        return None
    # A run that began before this API process started can't be running in it — the process that
    # ran it is gone (restart / --reload / crash). Serverless: only the age check applies.
    orphaned = not jobs.inline() and run.started_at < _PROCESS_STARTED
    if orphaned or utcnow() - run.started_at > jobs.stale_after(STALE_RUN):
        run.status, run.finished_at, run.error = "failed", utcnow(), "Stopped (the API restarted during the sync). Click Refresh to run it again."
        await db.commit()
        return None
    return run


async def create_run(db: AsyncSession, trigger: str, user_id: Optional[str]) -> GbpSyncRun:
    # Serialise "is one running? → start one" across API instances; the lock
    # is released by the commit below.
    await db.execute(text("SELECT pg_advisory_xact_lock(7244110)"))
    if await running(db):
        raise SyncBusy("A sync is already running.")
    run = GbpSyncRun(trigger=trigger, status="running", started_by_id=user_id, started_at=utcnow())
    db.add(run)
    await db.commit()
    return run


async def start_background(run_id: str) -> None:
    """Run the sync: inline on a serverless host (inside this request, within
    the time budget), else as a background task (app/common/jobs.py)."""
    await jobs.run(lambda: run_in_new_session(run_id), name=f"gbp-sync-{run_id}")


async def run_in_new_session(run_id: str, http: Optional[httpx.AsyncClient] = None) -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        await run_sync(db, run_id, http=http)


async def run_sync(
    db: AsyncSession,
    run_id: str,
    http: Optional[httpx.AsyncClient] = None,
    today: Optional[dt.date] = None,
    progress: Optional[Callable[[str], None]] = None,
) -> GbpSyncRun:
    run = await db.get(GbpSyncRun, run_id)
    assert run is not None
    own_http = http is None
    http = http or httpx.AsyncClient(timeout=httpx.Timeout(30.0))
    today = today or dt.date.today()
    s = get_settings()
    try:
        conn = await connection.current(db)
        if not conn:
            raise connection.NotConfigured("Google Business Profile isn't connected.")
        token = await connection.access_token(db, http, conn)
        client = google.GbpClient(http, token, google.RateLimiter(s.GBP_REQUESTS_PER_MINUTE))

        found: list[tuple[str, dict]] = []
        for acc in await client.accounts():
            name = acc.get("name")
            if not name:
                continue
            for raw in await client.locations(name):
                if raw.get("name"):
                    found.append((name, raw))
        if found:
            await db.execute(delete(GbpLocation).where(GbpLocation.source == "DEMO"))
            await db.commit()

        seen: set[str] = set()
        time_limited: int | None = None  # items finished when the time budget ran out
        for i, (account, raw) in enumerate(found, 1):
            if jobs.time_up():
                time_limited = i - 1
                break
            fields = google.parse_location(raw, account)
            seen.add(fields["google_location_id"])
            loc = (
                await db.execute(select(GbpLocation).where(GbpLocation.google_location_id == fields["google_location_id"]))
            ).scalar_one_or_none()
            if not loc:
                loc = GbpLocation(source="GOOGLE", first_seen_at=utcnow(), **fields)
                db.add(loc)
                await db.flush()
            else:
                for k, v in fields.items():
                    setattr(loc, k, v)
            if progress:
                progress(f"[{i}/{len(found)}] {loc.title}")
            try:
                days, reviews = await sync_location(db, client, loc, today, s.GBP_HISTORY_DAYS)
                run.metric_days += days
                run.reviews += reviews
            except google.GoogleError as exc:
                if exc.auth:
                    raise
                # Raised before any metric/review rows were written, so the
                # listing's details (and its earlier history) are still good.
                loc.sync_error = exc.friendly
                loc.last_synced_at = utcnow()
                run.locations_failed += 1
            run.locations += 1
            await db.commit()

        # Listings that disappeared from the account keep their history.
        if seen and time_limited is None:  # a time-limited run did not see every listing
            gone = (
                await db.execute(
                    select(GbpLocation).where(GbpLocation.source == "GOOGLE", GbpLocation.google_location_id.notin_(seen))
                )
            ).scalars().all()
            for g in gone:
                g.sync_error = "No longer in the connected Google account."

        conn.last_sync_at = utcnow()
        conn.status, conn.last_error = "connected", None
        run.status = "partial" if run.locations_failed else "success"
        if time_limited is not None:
            run.status = "partial"
            run.error = f"Stopped at the time limit after {time_limited} of {len(found)} listings; the next sync carries on."
        if not found:
            run.error = "The connected account has no Business Profile listings it can manage."
    except (google.GoogleError, connection.NotConfigured) as exc:
        await db.rollback()
        run = await db.get(GbpSyncRun, run_id)
        run.status = "failed"
        run.error = getattr(exc, "friendly", None) or str(exc)
        logger.warning("GBP sync failed: %s", exc)
    except Exception as exc:  # never leave a run stuck in "running"
        logger.exception("GBP sync crashed")
        await db.rollback()
        run = await db.get(GbpSyncRun, run_id)
        run.status = "failed"
        run.error = f"Unexpected error: {exc.__class__.__name__}: {str(exc)[:200]}"
    finally:
        if own_http:
            await http.aclose()
    run.finished_at = utcnow()
    await db.commit()
    return run


async def sync_location(
    db: AsyncSession, client: google.GbpClient, loc: GbpLocation, today: dt.date, history_days: int
) -> tuple[int, int]:
    """Refresh one listing. Raises GoogleError only for failures that make the
    listing's report wrong (metrics); optional parts just leave old values."""
    problems: list[str] = []
    name, account = loc.google_location_id, loc.google_account_id or ""

    async def optional(coro, label: str):
        try:
            return await coro
        except google.GoogleError as exc:
            if exc.auth:
                raise
            problems.append(f"{label}: {exc.friendly}")
            return None

    vom = await optional(client.voice_of_merchant(name), "Verification")
    if vom is not None:
        loc.verification = google.parse_verification(vom)
    attrs = await optional(client.attributes(name), "Attributes")
    if attrs is not None:
        for k, v in google.parse_attributes(attrs).items():
            setattr(loc, k, v)
    media = await optional(client.media(account, name), "Photos")
    if media is not None:
        for k, v in google.parse_media(media).items():
            setattr(loc, k, v)

    # ---- daily metrics (required) ----
    start = (loc.last_metrics_date - dt.timedelta(days=METRIC_OVERLAP_DAYS)) if loc.last_metrics_date else today - dt.timedelta(days=history_days)
    days = google.parse_daily_metrics(await client.daily_metrics(name, start, today))
    if days:
        rows = [{"location_id": loc.id, "date": d, **vals} for d, vals in days.items()]
        for chunk in range(0, len(rows), 500):
            part = rows[chunk : chunk + 500]
            stmt = pg_insert(GbpDailyMetric).values(part)
            stmt = stmt.on_conflict_do_update(
                index_elements=["location_id", "date"],
                set_={c: stmt.excluded[c] for c in google.DAILY_METRICS.values()},
            )
            await db.execute(stmt)
        loc.last_metrics_date = max(days)

    # ---- reviews ----
    review_count = 0
    cutoff = (loc.last_review_sync_at - dt.timedelta(days=1)) if loc.last_review_sync_at else None
    token: Optional[str] = None
    for page in range(MAX_REVIEW_PAGES):
        body = await optional(client.reviews_page(account, name, token), "Reviews")
        if body is None:
            break
        if page == 0:
            if body.get("averageRating") is not None:
                loc.rating_average = float(body["averageRating"])
            if body.get("totalReviewCount") is not None:
                loc.review_count = int(body["totalReviewCount"])
        parsed = [p for p in (google.parse_review(r) for r in body.get("reviews") or []) if p]
        if parsed:
            stmt = pg_insert(GbpReview).values([{"id": _cuid(), "location_id": loc.id, **p} for p in parsed])
            stmt = stmt.on_conflict_do_update(
                index_elements=["google_review_id"],
                set_={c: stmt.excluded[c] for c in ("star_rating", "comment", "reviewer_name", "update_time", "has_reply", "reply_time")},
            )
            await db.execute(stmt)
            review_count += len(parsed)
        token = body.get("nextPageToken")
        oldest = min((p["update_time"] or p["create_time"] for p in parsed), default=None)
        if not token or (cutoff and oldest and oldest < cutoff):
            break
    if not problems or not any(p.startswith("Reviews") for p in problems):
        loc.last_review_sync_at = utcnow()

    # ---- posts ----
    posts = await optional(client.posts(account, name), "Posts")
    if posts:
        parsed_posts = [p for p in (google.parse_post(r) for r in posts) if p]
        if parsed_posts:
            stmt = pg_insert(GbpPost).values([{"id": _cuid(), "location_id": loc.id, **p} for p in parsed_posts])
            stmt = stmt.on_conflict_do_update(
                index_elements=["google_post_id"],
                set_={c: stmt.excluded[c] for c in ("topic_type", "title", "summary", "state", "start_date", "end_date", "coupon_code", "search_url")},
            )
            await db.execute(stmt)

    # ---- search keywords (monthly) ----
    have = set(
        (
            await db.execute(select(GbpSearchKeyword.month).where(GbpSearchKeyword.location_id == loc.id).distinct())
        ).scalars().all()
    )
    for month in complete_months(today):
        if month in have:
            continue
        rows = await optional(client.search_keywords(name, month), "Search keywords")
        if rows is None:
            break
        kws = google.parse_keywords(rows)
        if kws:
            stmt = pg_insert(GbpSearchKeyword).values([{"location_id": loc.id, "month": month, **k} for k in kws])
            stmt = stmt.on_conflict_do_nothing()
            await db.execute(stmt)

    loc.profile_fields = profile.compute(loc)
    loc.last_synced_at = utcnow()
    loc.sync_error = None
    loc.sync_warning = "; ".join(problems)[:1000] if problems else None
    return len(days), review_count


def _cuid() -> str:
    from app.models.common import cuid

    return cuid()


async def last_runs(db: AsyncSession, limit: int = 5) -> list[GbpSyncRun]:
    return list((await db.execute(select(GbpSyncRun).order_by(GbpSyncRun.started_at.desc()).limit(limit))).scalars().all())


async def counts(db: AsyncSession) -> dict[str, int]:
    rows = (await db.execute(select(GbpLocation.source, func.count()).group_by(GbpLocation.source))).all()
    return {src: n for src, n in rows}
