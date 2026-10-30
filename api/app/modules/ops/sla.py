"""Ticket SLA clock.

Two targets per ticket, set by priority (the prototype's "first response 1
business day, resolve in 5"):

- **First response** — the assignee first acts on the ticket (comment, status
  change, sub-task), or anyone moves it out of New.
- **Resolution** — the ticket reaches Done.

Time is counted in *business time*: weekends (Saturday and Sunday, in
SLA_TIMEZONE) don't count; weekdays count in full. While a ticket is
Awaiting Merchant the resolution clock is paused, and the paused business time
is added back onto the due date when it resumes.

Kept framework-free (pure functions over datetimes) so it is unit-tested
directly — see tests/test_ops_sla.py.
"""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from app.models.enums import TicketPriority

# The team's working week. Override with OPS_SLA_TIMEZONE if the team moves.
SLA_TIMEZONE = ZoneInfo(os.getenv("OPS_SLA_TIMEZONE", "Asia/Karachi"))

DAY = 24 * 3600

# (first response, resolution) in business hours. 24 business hours = one
# working day.
SLA_TARGET_HOURS: dict[TicketPriority, tuple[int, int]] = {
    TicketPriority.URGENT: (2, 24),
    TicketPriority.HIGH: (4, 48),
    TicketPriority.MEDIUM: (24, 120),
    TicketPriority.LOW: (48, 240),
}

# Below this share of the resolution target left, the ticket is "at risk".
AT_RISK_SHARE = 0.25


# Days that don't count (Monday = 0). Settings → Workspace can change it.
WEEKEND_DAYS: frozenset[int] = frozenset({5, 6})


def _is_weekend(d: dt.date) -> bool:
    return d.weekday() in WEEKEND_DAYS


def _local(t: dt.datetime) -> dt.datetime:
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.astimezone(SLA_TIMEZONE)


def _next_midnight(t: dt.datetime) -> dt.datetime:
    nd = t.date() + dt.timedelta(days=1)
    return dt.datetime(nd.year, nd.month, nd.day, tzinfo=SLA_TIMEZONE)


def business_seconds_between(start: dt.datetime, end: dt.datetime) -> int:
    """Weekday seconds in [start, end). 0 when end <= start."""
    a, b = _local(start), _local(end)
    if b <= a:
        return 0
    total = 0.0
    cur = a
    while cur < b:
        nxt = min(_next_midnight(cur), b)
        if not _is_weekend(cur.date()):
            total += (nxt - cur).total_seconds()
        cur = nxt
    return int(total)


def add_business_seconds(start: dt.datetime, seconds: int) -> dt.datetime:
    """The moment `seconds` of weekday time after `start`."""
    cur = _local(start)
    left = float(max(0, seconds))
    while True:
        if _is_weekend(cur.date()):
            cur = _next_midnight(cur)
            continue
        boundary = _next_midnight(cur)
        room = (boundary - cur).total_seconds()
        if left <= room:
            return (cur + dt.timedelta(seconds=left)).astimezone(dt.timezone.utc)
        left -= room
        cur = boundary


def response_due(created_at: dt.datetime, priority: TicketPriority) -> dt.datetime:
    return add_business_seconds(created_at, SLA_TARGET_HOURS[priority][0] * 3600)


def resolution_due(created_at: dt.datetime, priority: TicketPriority, paused_seconds: int = 0) -> dt.datetime:
    return add_business_seconds(created_at, SLA_TARGET_HOURS[priority][1] * 3600 + paused_seconds)


ResponseState = Literal["pending", "met", "breached"]
ResolutionState = Literal["on_track", "at_risk", "breached", "paused", "met"]


@dataclass
class SlaView:
    response_state: ResponseState
    response_due_at: dt.datetime
    first_response_at: Optional[dt.datetime]
    state: ResolutionState
    resolution_due_at: dt.datetime
    # Business seconds left on the resolution clock (negative once breached;
    # frozen while paused; 0 once met).
    remaining_seconds: int
    target_response_hours: int
    target_resolution_hours: int


def evaluate(
    *,
    priority: TicketPriority,
    response_due_at: dt.datetime,
    resolution_due_at: dt.datetime,
    first_response_at: Optional[dt.datetime],
    completed_at: Optional[dt.datetime],
    paused_at: Optional[dt.datetime],
    now: dt.datetime,
) -> SlaView:
    resp_h, res_h = SLA_TARGET_HOURS[priority]

    if first_response_at is not None:
        response_state: ResponseState = "met" if first_response_at <= response_due_at else "breached"
    else:
        response_state = "breached" if now > response_due_at else "pending"

    if completed_at is not None:
        state: ResolutionState = "met" if completed_at <= resolution_due_at else "breached"
        remaining = 0 if state == "met" else -business_seconds_between(resolution_due_at, completed_at)
    elif paused_at is not None:
        state = "paused"
        remaining = business_seconds_between(paused_at, resolution_due_at) - business_seconds_between(
            resolution_due_at, paused_at
        )
    elif now >= resolution_due_at:
        state = "breached"
        remaining = -business_seconds_between(resolution_due_at, now)
    else:
        remaining = business_seconds_between(now, resolution_due_at)
        state = "at_risk" if remaining < AT_RISK_SHARE * res_h * 3600 else "on_track"

    return SlaView(
        response_state=response_state,
        response_due_at=response_due_at,
        first_response_at=first_response_at,
        state=state,
        resolution_due_at=resolution_due_at,
        remaining_seconds=remaining,
        target_response_hours=resp_h,
        target_resolution_hours=res_h,
    )


def policy_payload() -> list[dict]:
    return [
        {"priority": p.value, "responseHours": r, "resolutionHours": s}
        for p, (r, s) in SLA_TARGET_HOURS.items()
    ]


# ------------------------------------------------------------ settings ----
# The values above are the built-in defaults. Settings → Ops CRM (SLA
# targets) and Settings → Workspace (timezone, work week) override them; the
# overrides live in ops.app_setting and are loaded into these module globals
# by refresh_from_db(), which the ops routers call per request (cached for a
# few seconds, so every API worker picks up a change quickly).
DEFAULT_TARGET_HOURS: dict[TicketPriority, tuple[int, int]] = dict(SLA_TARGET_HOURS)
DEFAULT_TIMEZONE_NAME: str = os.getenv("OPS_SLA_TIMEZONE", "Asia/Karachi")
DEFAULT_WEEKEND_DAYS: frozenset[int] = frozenset({5, 6})
WORK_DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

_loaded_at: float = 0.0
_CACHE_SECONDS = 15.0


def apply_settings(targets: Optional[dict], workspace: Optional[dict]) -> None:
    """Point the SLA clock at saved settings. None / bad values fall back to
    the defaults, so a broken row can never stop tickets from working."""
    global SLA_TIMEZONE, WEEKEND_DAYS

    hours = dict(DEFAULT_TARGET_HOURS)
    for p in TicketPriority:
        row = (targets or {}).get(p.value)
        try:
            r, s = int(row["responseHours"]), int(row["resolutionHours"])
            if 0 < r <= s:
                hours[p] = (r, s)
        except (TypeError, KeyError, ValueError):
            pass
    SLA_TARGET_HOURS.clear()
    SLA_TARGET_HOURS.update(hours)

    tz_name = (workspace or {}).get("timezone") or DEFAULT_TIMEZONE_NAME
    try:
        SLA_TIMEZONE = ZoneInfo(tz_name)
    except Exception:  # unknown zone name
        SLA_TIMEZONE = ZoneInfo(DEFAULT_TIMEZONE_NAME)

    work_days = (workspace or {}).get("workDays")
    if isinstance(work_days, list) and work_days and all(isinstance(d, int) and 0 <= d <= 6 for d in work_days):
        WEEKEND_DAYS = frozenset(set(range(7)) - set(work_days))
    else:
        WEEKEND_DAYS = DEFAULT_WEEKEND_DAYS


async def refresh_from_db(db, force: bool = False) -> None:
    """Load SLA targets and the work week from ops.app_setting."""
    global _loaded_at
    import time

    from sqlalchemy import select

    from app.models.ops import AppSetting

    now = time.monotonic()
    if not force and now - _loaded_at < _CACHE_SECONDS:
        return
    rows = (await db.execute(select(AppSetting).where(AppSetting.key.in_(("sla_targets", "workspace"))))).scalars().all()
    by_key = {r.key: r.value for r in rows}
    apply_settings(by_key.get("sla_targets"), by_key.get("workspace"))
    _loaded_at = now


def reset_cache() -> None:
    global _loaded_at
    _loaded_at = 0.0
