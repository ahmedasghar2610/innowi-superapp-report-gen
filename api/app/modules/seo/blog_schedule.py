"""When the Blog Impact job runs. The times are saved in the database
(seo_blog_schedule, edited on the Blog Impact tab), not in settings.

Something calls tick() every 15 minutes: on Vercel, Supabase pg_cron through
POST /api/v1/jobs/seo-blogs (api/sql/jobs_cron.sql); on a long-running server,
the loop started from main.lifespan. tick() starts a run when one of the saved
times has passed since the last run started (several missed times → one run),
or when the last run stopped at the time limit (it carries on). Otherwise it
does nothing.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import re
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.models.seo import SeoBlogSchedule, utcnow

logger = logging.getLogger("SEO.blog_schedule")

DEFAULT_TIMES = ["06:00", "13:00", "20:00"]
DEFAULT_TZ = "Asia/Karachi"
MAX_TIMES = 8
CHECK_EVERY_S = 15 * 60
INITIAL_DELAY_S = 120
TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def clean_times(times: list[str]) -> list[str]:
    """Valid "HH:MM" values, de-duplicated and sorted. Raises ValueError on a bad one."""
    out = set()
    for t in times:
        t = (t or "").strip()
        if len(t) == 4 and t[1] == ":":
            t = "0" + t
        if not TIME_RE.match(t):
            raise ValueError(f"{t or '(empty)'} isn't a time like 06:00.")
        out.add(t)
    if len(out) > MAX_TIMES:
        raise ValueError(f"At most {MAX_TIMES} times a day.")
    return sorted(out)


def _slots_around(now: dt.datetime, times: list[str], tz: str) -> list[dt.datetime]:
    zone = ZoneInfo(tz)
    local = now.astimezone(zone)
    out = []
    for day in (local.date() - dt.timedelta(days=1), local.date(), local.date() + dt.timedelta(days=1)):
        for t in times:
            h, m = (int(x) for x in t.split(":"))
            out.append(dt.datetime.combine(day, dt.time(h, m), tzinfo=zone).astimezone(dt.timezone.utc))
    return sorted(out)


def last_slot(now: dt.datetime, times: list[str], tz: str) -> Optional[dt.datetime]:
    """The most recent saved time at or before `now` (UTC), or None without times."""
    past = [s for s in _slots_around(now, times, tz) if s <= now]
    return past[-1] if past else None


def next_slot(now: dt.datetime, times: list[str], tz: str) -> Optional[dt.datetime]:
    future = [s for s in _slots_around(now, times, tz) if s > now]
    return future[0] if future else None


def is_due(now: dt.datetime, last_started: Optional[dt.datetime], times: list[str], tz: str) -> bool:
    slot = last_slot(now, times, tz)
    if slot is None:
        return False
    return last_started is None or last_started < slot


async def get(db: AsyncSession) -> SeoBlogSchedule:
    sched = await db.get(SeoBlogSchedule, "default")
    if not sched:
        sched = SeoBlogSchedule(key="default", enabled=True, times=list(DEFAULT_TIMES), timezone=DEFAULT_TZ)
        db.add(sched)
        await db.flush()
    return sched


def dto(sched: SeoBlogSchedule, now: Optional[dt.datetime] = None) -> dict:
    now = now or utcnow()
    nxt = next_slot(now, sched.times or [], sched.timezone) if sched.enabled else None
    return {"enabled": sched.enabled, "times": list(sched.times or []), "timezone": sched.timezone,
            "nextAt": nxt.isoformat() if nxt else None, "checkEveryMinutes": CHECK_EVERY_S // 60,
            "updatedAt": sched.updated_at.isoformat() if sched.updated_at else None}


async def tick(now: Optional[dt.datetime] = None) -> Optional[str]:
    """Start a run if one is due. Returns the run id it started."""
    from app.db.session import SessionLocal
    from app.modules.gbp.scheduler import continues
    from app.modules.seo import blogs, connection

    now = now or utcnow()
    async with SessionLocal() as db:
        sched = await get(db)
        await db.commit()
        if not sched.enabled or not sched.times or connection.missing_env():
            return None
        conn = await connection.current(db)
        if not conn or conn.status != "connected":
            return None
        last = await blogs.last_run(db)
        resume = bool(last and continues(last.error))
        if not (resume or is_due(now, last.started_at if last else None, sched.times, sched.timezone)):
            return None
        try:
            run = await blogs.create_run(db, "schedule", None)
        except blogs.RunBusy:
            return None
        run_id = run.id
    logger.info("Starting the scheduled blog refresh (%s)", run_id)
    await blogs.run_in_new_session(run_id)
    return run_id


async def _loop() -> None:
    await asyncio.sleep(INITIAL_DELAY_S)
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:  # never let the loop die
            logger.exception("Blog schedule tick failed")
        await asyncio.sleep(CHECK_EVERY_S)


def start() -> Optional[asyncio.Task]:
    # Serverless: driven by POST /api/v1/jobs/seo-blogs instead.
    if jobs.inline():
        return None
    return asyncio.create_task(_loop(), name="seo-blog-schedule")
