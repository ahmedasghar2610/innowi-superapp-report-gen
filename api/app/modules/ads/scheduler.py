"""Daily automatic Google Ads sync inside the API process (replaces n8n's
schedule triggers on the 6th / 8th / 15th / 22nd / 28th).

Every 15 minutes the API checks: is Google Ads connected and configured, and
has no sync started since the last scheduled time (ADS_AUTO_SYNC_HOUR in
ADS_TIMEZONE, default 07:00 Asia/Karachi)? Then it starts one. Several API
instances are safe (sync.create_run takes a Postgres advisory lock).

Turn off with ADS_AUTO_SYNC=false (e.g. when a platform cron runs
`python -m scripts.ads_sync` instead).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from app.common import jobs
from app.config import get_settings
from app.models.ads import utcnow
from app.modules.gbp.scheduler import continues, is_due, last_slot, next_slot  # noqa: F401 — same slot maths

logger = logging.getLogger("Ads.scheduler")

INITIAL_DELAY_S = 120
CHECK_EVERY_S = 15 * 60


async def tick(now=None) -> Optional[str]:
    """Start the daily sync if it is due. Returns the run id it started."""
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.ads import AdsSyncRun
    from app.modules.ads import connection, sync

    s = get_settings()
    if not s.ADS_AUTO_SYNC or connection.missing_env():
        return None
    now = now or utcnow()
    async with SessionLocal() as db:
        conn = await connection.current(db)
        if not conn or conn.status != "connected":
            return None
        last_run = (await db.execute(select(AdsSyncRun).order_by(AdsSyncRun.started_at.desc()).limit(1))).scalar_one_or_none()
        last = last_run.started_at if last_run else None
        if not (continues(last_run.error if last_run else None) or is_due(now, last, s.ADS_AUTO_SYNC_HOUR, s.ADS_TIMEZONE)):
            return None
        try:
            run = await sync.create_run(db, "schedule", None)
        except sync.SyncBusy:
            return None
        run_id = run.id
    logger.info("Starting the daily Google Ads sync (%s)", run_id)
    await sync.run_in_new_session(run_id)
    return run_id


async def _loop() -> None:
    await asyncio.sleep(INITIAL_DELAY_S)
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Google Ads scheduler tick failed")
        await asyncio.sleep(CHECK_EVERY_S)


def start() -> Optional[asyncio.Task]:
    # Serverless: the scheduler is driven by POST /api/v1/jobs/{job} instead.
    if jobs.inline() or not get_settings().ADS_AUTO_SYNC:
        return None
    return asyncio.create_task(_loop(), name="ads-daily-sync")
