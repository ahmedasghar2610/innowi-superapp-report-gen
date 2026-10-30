"""Background work that has to behave on two kinds of host.

* **background** — a long-running server (uvicorn, Docker, Render). Syncs run
  as asyncio tasks after the request has answered, and the daily schedulers
  loop inside the API process (started from ``main.lifespan``).
* **inline** — a serverless host (Vercel). A function is frozen as soon as it
  has answered, so a background task would never finish and an in-process
  loop would never tick. The work runs inside the request that asked for it
  (with a time budget), and the schedulers are driven from outside through
  ``POST /api/v1/jobs/{job}`` (modules/jobs), called by Supabase pg_cron.

``JOBS_MODE`` picks one; unset means inline on Vercel / AWS Lambda (detected
from their environment) and background everywhere else.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
import time
from contextvars import ContextVar
from typing import Awaitable, Callable, Optional

from app.config import get_settings

logger = logging.getLogger("Jobs")

_deadline: ContextVar[Optional[float]] = ContextVar("jobs_deadline", default=None)
_tasks: set[asyncio.Task] = set()


def inline() -> bool:
    """True when work must run inside the request (serverless host)."""
    mode = get_settings().JOBS_MODE
    if mode:
        return mode == "inline"
    # VERCEL / VERCEL_ENV are Vercel's system variables; LAMBDA_TASK_ROOT is set
    # by the function runtime itself, so this holds even if system variables
    # aren't exposed to the function.
    return any(os.getenv(k) for k in ("VERCEL", "VERCEL_ENV", "LAMBDA_TASK_ROOT"))


def time_up() -> bool:
    """True once the current inline job has used its time budget. Long loops
    (one listing / account / site at a time) check it and stop cleanly; the
    next run carries on, because every sync is incremental."""
    deadline = _deadline.get()
    return deadline is not None and time.monotonic() >= deadline


def stale_after(default: dt.timedelta) -> dt.timedelta:
    """How old a "running" sync row may be before it counts as dead. Inline, a
    run can't outlive its function, so that is much shorter than on a server."""
    if inline():
        return dt.timedelta(minutes=get_settings().JOBS_STALE_MINUTES)
    return default


async def run(work: Callable[[], Awaitable[object]], name: str, *, wait: bool = False) -> None:
    """Run `work` now (inline, within the time budget) or as a background task.
    `wait=True` always runs it now (the scheduler endpoint is itself the
    background worker). Never raises: a failed job is logged and recorded by
    the job itself."""
    if not inline() and not wait:
        task = asyncio.create_task(_guard(work, name), name=name)
        _tasks.add(task)  # keep a reference so it isn't garbage-collected mid-run
        task.add_done_callback(_tasks.discard)
        return
    # One budget per request: several jobs started by the same call (e.g. Data
    # setup → Refresh all) share it instead of each getting a fresh one.
    if inline() and _deadline.get() is None:
        _deadline.set(time.monotonic() + get_settings().JOBS_TIME_BUDGET_S)
    await _guard(work, name)


async def _guard(work: Callable[[], Awaitable[object]], name: str) -> None:
    try:
        await work()
    except Exception:  # the job records its own failure; this is the last net
        logger.exception("Job %s failed", name)
