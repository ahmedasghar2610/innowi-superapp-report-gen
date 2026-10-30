"""Daily automatic GBP sync, inside the API process — no cron or command needed
once the app is deployed.

Every 15 minutes the API checks: is Google connected, and has no sync started
since the last scheduled time (GBP_AUTO_SYNC_HOUR in GBP_TIMEZONE, default
06:00 Asia/Karachi)? Then it starts one. If the API was down at 06:00, the run
happens as soon as it is back. Several API instances are safe: starting a run
takes a Postgres advisory lock and refuses while another run is going
(sync.create_run). "Refresh data" on the page still works any time.

Turn off with GBP_AUTO_SYNC=false (e.g. when a platform cron runs
`python -m scripts.gbp_sync` instead).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Optional
from zoneinfo import ZoneInfo

from app.common import jobs
from app.config import get_settings
from app.models.gbp import utcnow

logger = logging.getLogger("GBP.scheduler")

INITIAL_DELAY_S = 90
CHECK_EVERY_S = 15 * 60


def last_slot(now: dt.datetime, hour: int, tz: str) -> dt.datetime:
    """The most recent scheduled time at or before `now` (aware, UTC)."""
    local = now.astimezone(ZoneInfo(tz))
    slot = local.replace(hour=hour, minute=0, second=0, microsecond=0)
    if slot > local:
        slot -= dt.timedelta(days=1)
    return slot.astimezone(dt.timezone.utc)


def next_slot(now: dt.datetime, hour: int, tz: str) -> dt.datetime:
    return last_slot(now, hour, tz) + dt.timedelta(days=1)


TIME_LIMIT_PREFIX = "Stopped at the time limit"


def continues(error: Optional[str]) -> bool:
    """True when the last run stopped at the serverless time limit: the next
    tick picks up where it left off instead of waiting for tomorrow's slot."""
    return bool(error and error.startswith(TIME_LIMIT_PREFIX))


def is_due(now: dt.datetime, last_run_started: Optional[dt.datetime], hour: int, tz: str) -> bool:
    return last_run_started is None or last_run_started < last_slot(now, hour, tz)


async def tick(now: Optional[dt.datetime] = None) -> Optional[str]:
    """Start the daily sync if it is due. Returns the run id it started."""
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.gbp import GbpSyncRun
    from app.modules.gbp import connection, sync

    s = get_settings()
    if not s.GBP_AUTO_SYNC or connection.missing_env():
        return None
    now = now or utcnow()
    async with SessionLocal() as db:
        conn = await connection.current(db)
        if not conn or conn.status != "connected":
            return None
        last_run = (await db.execute(select(GbpSyncRun).order_by(GbpSyncRun.started_at.desc()).limit(1))).scalar_one_or_none()
        last = last_run.started_at if last_run else None
        if not (continues(last_run.error if last_run else None) or is_due(now, last, s.GBP_AUTO_SYNC_HOUR, s.GBP_TIMEZONE)):
            return None
        try:
            run = await sync.create_run(db, "schedule", None)
        except sync.SyncBusy:
            return None
        run_id = run.id
    logger.info("Starting the daily GBP sync (%s)", run_id)
    await sync.run_in_new_session(run_id)
    return run_id


async def _loop() -> None:
    await asyncio.sleep(INITIAL_DELAY_S)
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:  # never let the loop die
            logger.exception("GBP scheduler tick failed")
        await asyncio.sleep(CHECK_EVERY_S)


def start() -> Optional[asyncio.Task]:
    # Serverless: the scheduler is driven by POST /api/v1/jobs/{job} instead.
    if jobs.inline() or not get_settings().GBP_AUTO_SYNC:
        return None
    return asyncio.create_task(_loop(), name="gbp-daily-sync")
