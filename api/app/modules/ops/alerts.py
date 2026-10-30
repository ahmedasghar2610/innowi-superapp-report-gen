"""In-app notifications (the bell) and SLA alerts.

`notify()` is the one way a notice is created. It checks each person's
choices in Settings → Notifications (auth.user.preferences): the in-app
notice is stored when "In the app" is ticked, and the e-mail / Teams ticks
are queued with notifications.queue() and sent by notifications.flush(db)
after the caller commits (Teams through the Power Automate flow, e-mail
through Resend). The person who caused the event is never notified.

Who hears what:
    assigned to you ................ ASSIGNED            → assignee         (pref "assigned")
    status changed by someone else . STATUS_CHANGED      → assignee         (pref "statusChanged")
                                                         → watchers         (pref "watching")
    new comment .................... COMMENTED           → assignee+watchers (pref "watching")
    SLA under 25% left ............. SLA_AT_RISK         → assignee+watchers (pref "slaAtRisk")
    SLA resolution missed .......... SLA_BREACHED        → assignee+watchers+ticket managers (pref "slaBreached")
    first response missed .......... RESPONSE_OVERDUE    → assignee+ticket managers (pref "slaBreached")

`scan_sla()` finds open tickets that are at risk or breached and sends each
alert once per due time (dedupe key includes the due time, so a re-targeted
ticket can alert again). It runs every few minutes inside the API
(`start()` from main.lifespan; OPS_SLA_ALERTS=false turns it off) and also,
throttled, when someone opens their notifications — so alerts appear even if
the background loop isn't running.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Iterable, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.models.auth import User
from app.models.common import cuid
from app.models.enums import NotificationKind, TicketStatus, UserStatus
from app.models.ops import Notification, Ticket, TicketWatcher, utcnow
from app.modules.ops import sla as sla_clock
from app.modules.ops import notifications

logger = logging.getLogger("OpsAlerts")

PREF_FOR = {
    NotificationKind.ASSIGNED: "assigned",
    NotificationKind.STATUS_CHANGED: "statusChanged",
    NotificationKind.COMMENTED: "watching",
    NotificationKind.SLA_AT_RISK: "slaAtRisk",
    NotificationKind.SLA_BREACHED: "slaBreached",
    NotificationKind.RESPONSE_OVERDUE: "slaBreached",
    NotificationKind.MENTIONED: "mentioned",
    NotificationKind.REQUEST_NEW: "requests",
    NotificationKind.REQUEST_UPDATED: "requests",
}

SCAN_EVERY_S = 5 * 60
_LAZY_SCAN_S = 60.0
_last_scan = 0.0


def _channels(user: User, pref: str) -> dict[str, bool]:
    from app.modules.settings.schemas import Preferences

    c = Preferences.from_stored(user.preferences).notifications.get(pref)  # type: ignore[arg-type]
    return {"inApp": c.inApp, "email": c.email, "teams": c.teams} if c else {"inApp": True, "email": False, "teams": False}


async def watcher_ids(db: AsyncSession, ticket_id: str) -> list[str]:
    return list((await db.execute(select(TicketWatcher.user_id).where(TicketWatcher.ticket_id == ticket_id))).scalars())


async def manager_ids(db: AsyncSession) -> list[str]:
    """The people who manage tickets (granted ticket.manage) — escalation."""
    rows = (
        await db.execute(
            select(User.id).where(User.granted_capabilities.any("ticket.manage"), User.status == UserStatus.ACTIVE)
        )
    ).scalars()
    return list(rows)


async def notify(
    db: AsyncSession,
    user_ids: Iterable[Optional[str]],
    kind: NotificationKind,
    ticket: Ticket,
    title: str,
    body: Optional[str] = None,
    *,
    actor_id: Optional[str] = None,
    dedupe_key: Optional[str] = None,
    pref_overrides: Optional[dict[str, str]] = None,
) -> int:
    """Create notices for each user (minus the actor). `pref_overrides` maps
    a user id to a different preference key (e.g. a watcher hearing about a
    status change uses "watching"). Returns how many in-app notices were
    stored. The caller commits."""
    ids = {u for u in user_ids if u and u != actor_id}
    if not ids:
        return 0
    users = (await db.execute(select(User).where(User.id.in_(ids), User.status == UserStatus.ACTIVE))).scalars().all()
    stored = 0
    link = f"/ops/tickets/{ticket.key}"
    for u in users:
        pref = (pref_overrides or {}).get(u.id, PREF_FOR[kind])
        ch = _channels(u, pref)
        if ch["inApp"]:
            stmt = (
                insert(Notification)
                .values(
                    id=cuid(),
                    user_id=u.id,
                    kind=kind,
                    ticket_id=ticket.id,
                    actor_id=actor_id,
                    title=title[:300],
                    body=(body or "")[:500] or None,
                    dedupe_key=dedupe_key,
                    created_at=utcnow(),
                )
                .on_conflict_do_nothing(index_elements=["user_id", "dedupe_key"])
            )
            res = await db.execute(stmt)
            if res.rowcount:
                stored += 1
            elif dedupe_key:
                continue  # already alerted: don't email again either
        notifications.queue(
            db,
            user=u,
            channels=[c for c in ("email", "teams") if ch[c]],
            title=title,
            body=body,
            link=link,
        )
    return stored


# ------------------------------------------------------------- SLA scan ----
async def scan_sla(db: AsyncSession) -> int:
    """Send at-risk / breached / response-overdue alerts for open tickets."""
    await sla_clock.refresh_from_db(db)
    now = utcnow()
    tickets = (
        await db.execute(
            select(Ticket).where(
                Ticket.status != TicketStatus.DONE,
                Ticket.resolution_due_at.is_not(None),
                or_(
                    Ticket.sla_paused_at.is_(None),
                    and_(Ticket.first_response_at.is_(None), Ticket.response_due_at < now),
                ),
            )
        )
    ).scalars().all()
    if not tickets:
        return 0
    managers: Optional[list[str]] = None
    sent = 0
    for t in tickets:
        view = sla_clock.evaluate(
            priority=t.priority,
            response_due_at=t.response_due_at,
            resolution_due_at=t.resolution_due_at,
            first_response_at=t.first_response_at,
            completed_at=None,
            paused_at=t.sla_paused_at,
            now=now,
        )
        due = t.resolution_due_at.isoformat(timespec="minutes")
        if view.response_state == "breached" and t.first_response_at is None:
            if managers is None:
                managers = await manager_ids(db)
            sent += await notify(
                db, [t.assignee_id, *managers], NotificationKind.RESPONSE_OVERDUE, t,
                f"{t.key} hasn't had a first response", t.title,
                dedupe_key=f"response:{t.id}:{t.response_due_at.isoformat(timespec='minutes')}",
            )
        if view.state == "breached":
            if managers is None:
                managers = await manager_ids(db)
            new = await notify(
                db, [t.assignee_id, *(await watcher_ids(db, t.id)), *managers], NotificationKind.SLA_BREACHED, t,
                f"{t.key} breached its SLA", t.title, dedupe_key=f"breach:{t.id}:{due}",
            )
            sent += new
            if new:  # first time this breach is reported: tell the team channel once
                notifications.queue_channel(
                    db, title=f"SLA breached: {t.key}", body=f"{t.title} ({t.priority.value.title()})",
                    link=f"/ops/tickets/{t.key}",
                )
        elif view.state == "at_risk":
            hours = max(1, round(view.remaining_seconds / 3600))
            sent += await notify(
                db, [t.assignee_id, *(await watcher_ids(db, t.id))], NotificationKind.SLA_AT_RISK, t,
                f"{t.key} is at risk — about {hours}h of working time left", t.title, dedupe_key=f"risk:{t.id}:{due}",
            )
    await db.commit()
    await notifications.flush(db)
    if sent:
        logger.info("SLA alerts: %s notices sent", sent)
    return sent


async def scan_if_due(db: AsyncSession) -> None:
    """Throttled scan, called when someone opens their notifications."""
    global _last_scan
    if not enabled() or time.monotonic() - _last_scan < _LAZY_SCAN_S:
        return
    _last_scan = time.monotonic()
    try:
        await scan_sla(db)
    except Exception:  # never break the bell over an alert
        logger.exception("SLA scan failed")
        await db.rollback()


async def _loop() -> None:
    from app.db.session import SessionLocal

    await asyncio.sleep(30)
    while True:
        try:
            async with SessionLocal() as db:
                await scan_sla(db)
            from app.modules.ops import digest

            async with SessionLocal() as db:
                await digest.tick(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("SLA alert scan failed")
        await asyncio.sleep(SCAN_EVERY_S)


def enabled() -> bool:
    return os.getenv("OPS_SLA_ALERTS", "true").lower() not in ("0", "false", "no")


def start() -> Optional[asyncio.Task]:
    # Serverless: POST /api/v1/jobs/ops-sla runs scan_sla instead (and the bell
    # still scans lazily when someone opens their notifications).
    if jobs.inline() or not enabled():
        return None
    return asyncio.create_task(_loop(), name="ops-sla-alerts")
