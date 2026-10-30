"""Daily Ops CRM digest, posted to the Teams alerts channel.

    tick(db)        post today's digest once, on the first call after
                    OPS_DIGEST_HOUR (workspace / SLA time zone), on working days.
                    Called by POST /api/v1/jobs/ops-digest (Vercel: Supabase
                    pg_cron, e.g. hourly) and by the in-process SLA loop.
    post_now(db)    post it straight away (Settings → Integrations button).

The last posted day is kept in ops.app_setting under "ops_digest", so a
second call the same day does nothing.
"""
from __future__ import annotations

import datetime as dt
import logging
from collections import Counter
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import User
from app.models.enums import TicketPriority, TicketStatus
from app.models.ops import AppSetting, Ticket, utcnow
from app.modules.ops import sla as sla_clock
from app.modules.ops import teams_flow

logger = logging.getLogger("OpsDigest")

SETTING_KEY = "ops_digest"


def _name(u: Optional[User]) -> str:
    if not u:
        return "Unassigned"
    full = " ".join(p for p in (u.first_name, u.last_name) if p)
    return full or u.email.split("@")[0]


async def build(db: AsyncSession, today: dt.date) -> tuple[str, str]:
    """(title, text) for today's digest."""
    now = utcnow()
    open_q = select(Ticket).where(Ticket.status != TicketStatus.DONE)
    tickets = list((await db.execute(open_q)).scalars().all())
    users = {u.id: u for u in (await db.execute(select(User))).scalars().all()}

    overdue = [t for t in tickets if t.due_date and t.due_date < today]
    due_today = [t for t in tickets if t.due_date == today]
    urgent = [t for t in tickets if t.priority == TicketPriority.URGENT]
    breached = []
    for t in tickets:
        if not t.resolution_due_at:
            continue
        view = sla_clock.evaluate(
            priority=t.priority,
            response_due_at=t.response_due_at,
            resolution_due_at=t.resolution_due_at,
            first_response_at=t.first_response_at,
            completed_at=None,
            paused_at=t.sla_paused_at,
            now=now,
        )
        if view.state == "breached":
            breached.append(t)
    since = now - dt.timedelta(days=1)
    done_yesterday = (
        await db.execute(
            select(func.count()).select_from(Ticket).where(
                Ticket.status == TicketStatus.DONE, Ticket.completed_at >= since
            )
        )
    ).scalar_one()

    lines = [
        f"Open: {len(tickets)} · Urgent: {len(urgent)} · Overdue: {len(overdue)} · "
        f"SLA breached: {len(breached)} · Due today: {len(due_today)} · Closed in the last 24h: {done_yesterday}",
    ]

    def keys(ts: list[Ticket], n: int = 6) -> str:
        shown = ", ".join(f"{t.key} ({_name(users.get(t.assignee_id))})" for t in ts[:n])
        return shown + (f" +{len(ts) - n} more" if len(ts) > n else "")

    if urgent:
        lines.append(f"Urgent: {keys(urgent)}")
    if breached:
        lines.append(f"SLA breached: {keys(breached)}")
    if overdue:
        lines.append(f"Overdue: {keys(overdue)}")
    if due_today:
        lines.append(f"Due today: {keys(due_today)}")
    per_person = Counter(_name(users.get(t.assignee_id)) for t in tickets)
    if per_person:
        lines.append("Open per person: " + ", ".join(f"{n} {c}" for n, c in per_person.most_common(10)))
    title = f"Ops daily digest — {today.strftime('%a %d %b')}"
    return title, "\n\n".join(lines)


async def post_now(db: AsyncSession) -> Optional[bool]:
    await sla_clock.refresh_from_db(db)
    today = dt.datetime.now(sla_clock.SLA_TIMEZONE).date()
    title, text = await build(db, today)
    ok = await teams_flow.channel(title, text, "/ops/tickets")
    if ok:
        await _remember(db, today)
    return ok


async def _remember(db: AsyncSession, day: dt.date) -> None:
    value = {"lastPosted": day.isoformat()}
    await db.execute(
        insert(AppSetting)
        .values(key=SETTING_KEY, value=value, updated_at=utcnow())
        .on_conflict_do_update(index_elements=["key"], set_={"value": value, "updated_at": utcnow()})
    )
    await db.commit()


async def tick(db: AsyncSession) -> dict:
    """Post today's digest if it is due. Returns what happened."""
    if not teams_flow.configured():
        return {"ran": False, "detail": "Teams flow not configured (OPS_TEAMS_FLOW_URL / OPS_TEAMS_FLOW_SECRET)."}
    await sla_clock.refresh_from_db(db)
    local = dt.datetime.now(sla_clock.SLA_TIMEZONE)
    if local.date().weekday() in sla_clock.WEEKEND_DAYS:
        return {"ran": False, "detail": "Not a working day."}
    if local.hour < get_settings().OPS_DIGEST_HOUR:
        return {"ran": False, "detail": f"Before {get_settings().OPS_DIGEST_HOUR}:00."}
    row = await db.get(AppSetting, SETTING_KEY)
    if row and (row.value or {}).get("lastPosted") == local.date().isoformat():
        return {"ran": False, "detail": "Already posted today."}
    title, text = await build(db, local.date())
    ok = await teams_flow.channel(title, text, "/ops/tickets")
    personal = await send_personal(db, local.date())
    if ok:
        await _remember(db, local.date())
        return {"ran": True, "detail": f"Digest posted; {personal} personal digest(s) sent."}
    return {"ran": False, "detail": "Teams flow call failed (see the API log)."}


async def send_personal(db: AsyncSession, today: dt.date) -> int:
    """Each person who ticked Teams or e-mail for "Daily digest" gets their own
    open work: overdue, due today, urgent, and how many are open in total."""
    from app.models.enums import UserStatus
    from app.modules.ops import notifications
    from app.modules.ops.alerts import _channels

    users = (await db.execute(select(User).where(User.status == UserStatus.ACTIVE))).scalars().all()
    for u in users:
        ch = _channels(u, "dailyDigest")
        wanted = [c for c in ("email", "teams") if ch[c]]
        if not wanted:
            continue
        mine = list(
            (
                await db.execute(
                    select(Ticket).where(Ticket.assignee_id == u.id, Ticket.status != TicketStatus.DONE)
                )
            ).scalars().all()
        )
        if not mine:
            continue
        overdue = [t for t in mine if t.due_date and t.due_date < today]
        due_today = [t for t in mine if t.due_date == today]
        urgent = [t for t in mine if t.priority == TicketPriority.URGENT]
        parts = [f"You have {len(mine)} open ticket(s)."]
        for label, ts in (("Overdue", overdue), ("Due today", due_today), ("Urgent", urgent)):
            if ts:
                parts.append(f"{label}: " + ", ".join(f"{t.key} {t.title[:40]}" for t in ts[:5]))
        notifications.queue(
            db, user=u, channels=wanted, title=f"Your tickets today — {today.strftime('%a %d %b')}",
            body="\n".join(parts), link="/ops/my-work",
        )
    return await notifications.flush(db)
