"""Who's on leave / busy, pushed in by Power Automate ("Super App – Availability sync").

The admin route (Graph Presence / MailboxSettings for everyone) was declined,
so a scheduled flow running under one Innowi account reads what that account
can already see, and sends it here every 15 minutes:

    GET  /api/v1/integrations/teams/people         → {"emails": [...]}  who to look up
    POST /api/v1/integrations/teams/availability   ← {"people": [{"email", "mailTips"}],
                                                      "schedule": <getSchedule response>}
    (both need the header x-superapp-key: OPS_TEAMS_FLOW_SECRET)

`mailTips` is the body of Outlook's "Get mail tips for a mailbox (V2)" (out of
office = an automatic-reply message is set); `schedule` is the body of Outlook's
"Send an HTTP request" to /me/calendar/getSchedule (busy / tentative / away
blocks for the next days, times in UTC). Either part may be missing.

The latest snapshot is kept in ops.app_setting["teams_availability"]; the
Super App reads it with GET /api/v1/ops/teams/availability (Ops Hub, and the
"on leave" hint when assigning a ticket). Live Teams presence (Available /
Away) can't come this way.
"""
from __future__ import annotations

import datetime as dt
import hmac
import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.config import get_settings
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import Role, TicketStatus, UserStatus
from app.models.ops import AppSetting, Ticket, utcnow
from app.modules.ops import teams_flow

logger = logging.getLogger("OpsAvailability")

SETTING_KEY = "teams_availability"
STALE_AFTER = dt.timedelta(hours=2)

flow_router = APIRouter(prefix="/integrations/teams", tags=["Ops CRM"], include_in_schema=False)
router = APIRouter(prefix="/ops/teams", tags=["Ops CRM"], dependencies=[Depends(require_capability("ticket.view"))])


def _check_key(key: Optional[str]) -> None:
    secret = get_settings().OPS_TEAMS_FLOW_SECRET
    if not secret:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not key or not hmac.compare_digest(key.encode(), secret.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


async def _team(db: AsyncSession) -> list[User]:
    # The Super Admin login is a system account, not a team member with a mailbox.
    q = select(User).where(User.status == UserStatus.ACTIVE, User.role != Role.SUPER_ADMIN).order_by(User.first_name)
    return list((await db.execute(q)).scalars().all())


# ------------------------------------------------------------ parsing ----
def _parse_time(v: Any) -> Optional[dt.datetime]:
    """Graph times: {"dateTime": "2026-10-27T10:00:00.0000000", "timeZone": "UTC"} or an ISO string."""
    if isinstance(v, dict):
        raw, tz = v.get("dateTime"), (v.get("timeZone") or "UTC")
    else:
        raw, tz = v, "UTC"
    if not isinstance(raw, str) or not raw:
        return None
    raw = re.sub(r"(\.\d{6})\d+", r"\1", raw.strip()).replace("Z", "+00:00")
    try:
        t = dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if t.tzinfo is None:
        try:
            from zoneinfo import ZoneInfo

            t = t.replace(tzinfo=dt.timezone.utc if tz.upper() in ("UTC", "Z") else ZoneInfo(tz))
        except Exception:  # noqa: BLE001 - Windows zone names etc.: treat as UTC
            t = t.replace(tzinfo=dt.timezone.utc)
    return t.astimezone(dt.timezone.utc)


def _find_auto_replies(node: Any) -> list[dict]:
    """Every {"automaticReplies": …, "emailAddress": …} object inside a mail-tips body, however wrapped."""
    out: list[dict] = []
    if isinstance(node, dict):
        if "automaticReplies" in node:
            out.append(node)
        for v in node.values():
            if isinstance(v, (dict, list)):
                out += _find_auto_replies(v)
    elif isinstance(node, list):
        for v in node:
            out += _find_auto_replies(v)
    return out


def _addr(node: Any) -> Optional[str]:
    if isinstance(node, dict):
        ea = node.get("emailAddress")
        if isinstance(ea, dict) and ea.get("address"):
            return str(ea["address"]).lower()
        if isinstance(ea, str):
            return ea.lower()
    return None


def parse(payload: dict) -> dict[str, dict]:
    """{email: {"onLeave", "leaveMessage", "leaveFrom", "leaveUntil", "busy": [...]}}"""
    people: dict[str, dict] = {}

    def person(email: str) -> dict:
        return people.setdefault(email.lower().strip(), {"onLeave": False, "leaveMessage": None,
                                                         "leaveFrom": None, "leaveUntil": None, "busy": [],
                                                         "hasCalendar": False, "hasMailTips": False})

    for item in payload.get("people") or []:
        if not isinstance(item, dict):
            continue
        email = (item.get("email") or "").strip()
        tips = _find_auto_replies(item.get("mailTips"))
        if not tips and email:
            person(email)
        for tip in tips:
            who = _addr(tip) or email
            if not who:
                continue
            p = person(who)
            p["hasMailTips"] = not tip.get("error")
            ar = tip.get("automaticReplies") or {}
            msg = ar.get("message") if isinstance(ar, dict) else None
            if isinstance(msg, str) and re.sub(r"<[^>]+>", "", msg).strip():
                p["onLeave"] = True
                text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", msg)).strip()
                p["leaveMessage"] = text[:300]
                start = _parse_time(ar.get("scheduledStartTime"))
                end = _parse_time(ar.get("scheduledEndTime"))
                p["leaveFrom"] = start.isoformat() if start else None
                p["leaveUntil"] = end.isoformat() if end else None

    sched = payload.get("schedule")
    rows = sched.get("value") if isinstance(sched, dict) else sched
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("scheduleId"):
            continue
        p = person(str(row["scheduleId"]))
        if row.get("error"):  # Graph couldn't read this mailbox's calendar
            continue
        p["hasCalendar"] = True
        for it in row.get("scheduleItems") or []:
            if not isinstance(it, dict):
                continue
            st = str(it.get("status") or "busy").lower()
            if st == "free":
                continue
            start, end = _parse_time(it.get("start")), _parse_time(it.get("end"))
            if start and end:
                blk = {"start": start.isoformat(), "end": end.isoformat(), "status": st}
                # Graph only sends subject / location when this account may see them
                # (own calendar, or a colleague who shares details); private items never.
                if not it.get("isPrivate"):
                    for k in ("subject", "location"):
                        v = it.get(k)
                        if isinstance(v, str) and v.strip():
                            blk[k] = v.strip()[:200]
                p["busy"].append(blk)
        p["busy"].sort(key=lambda b: b["start"])
        p["busy"] = p["busy"][:200]
    return people


HISTORY_DAYS = 62  # how far back the Calendar keeps Outlook meetings / leave days


def _keep_history(people: dict[str, dict], previous: dict) -> None:
    """Each sync only covers today onwards; carry earlier meetings and leave
    days over from the last snapshot so the Calendar keeps showing the past."""
    now = utcnow()
    cutoff = now - dt.timedelta(days=HISTORY_DAYS)
    from app.modules.ops import sla as sla_clock

    tz = sla_clock.SLA_TIMEZONE
    today = now.astimezone(tz).date()
    for email, old in (previous.get("people") or {}).items():
        p = people.get(email)
        if p is None:
            continue
        if p.get("hasCalendar"):
            first_new = min((b["start"] for b in p["busy"]), default=None)
            keep = [
                b for b in old.get("busy") or []
                if (e := _parse_time(b.get("end"))) and e > cutoff and e <= now
                and (first_new is None or b.get("start", "") < first_new)
            ]
            seen = {(b["start"], b["end"]) for b in p["busy"]}
            p["busy"] = sorted([b for b in keep if (b["start"], b["end"]) not in seen] + p["busy"], key=lambda b: b["start"])[-400:]
        # Past leave days stay; today and later always follow the latest automatic reply.
        days = {d for d in old.get("leaveDays") or []
                if (today - dt.timedelta(days=HISTORY_DAYS)).isoformat() <= d < today.isoformat()}
        p["leaveDays"] = sorted(days)
    for p in people.values():
        days = set(p.get("leaveDays") or [])
        if p.get("onLeave"):
            start = _parse_time(p.get("leaveFrom")) if p.get("leaveFrom") else None
            end = _parse_time(p.get("leaveUntil")) if p.get("leaveUntil") else None
            d0 = max(start.astimezone(tz).date(), today) if start else today
            # An automatic reply with an end date: mark every day up to it (max 31).
            d1 = (end - dt.timedelta(seconds=1)).astimezone(tz).date() if end else today
            d = d0
            while d <= d1 and d <= today + dt.timedelta(days=31):
                days.add(d.isoformat())
                d += dt.timedelta(days=1)
        p["leaveDays"] = sorted(days)


# ---------------------------------------------------------- flow side ----
@flow_router.get("/people")
async def flow_people(
    db: AsyncSession = Depends(get_db), x_superapp_key: Optional[str] = Header(None, alias="x-superapp-key")
):
    _check_key(x_superapp_key)
    emails = list(dict.fromkeys(teams_flow.microsoft_email(u).lower() for u in await _team(db)))
    return {"emails": emails, "count": len(emails)}


@flow_router.post("/availability")
async def flow_availability(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    x_superapp_key: Optional[str] = Header(None, alias="x-superapp-key"),
):
    _check_key(x_superapp_key)
    people = parse(payload)
    _keep_history(people, await snapshot(db))
    value = {"updatedAt": utcnow().isoformat(), "people": people,
             "hasSchedule": bool(payload.get("schedule"))}
    await db.execute(
        insert(AppSetting)
        .values(key=SETTING_KEY, value=value, updated_at=utcnow())
        .on_conflict_do_update(index_elements=["key"], set_={"value": value, "updated_at": utcnow()})
    )
    await db.commit()
    on_leave = sum(1 for p in people.values() if p["onLeave"])
    logger.info("Availability from Teams flow: %s people, %s on leave", len(people), on_leave)
    return {"ok": True, "people": len(people), "onLeave": on_leave}


# ------------------------------------------------------------ app side ----
class BusyBlock(BaseModel):
    start: dt.datetime
    end: dt.datetime
    status: str


class PersonAvailability(BaseModel):
    id: str
    name: str
    email: str
    role: str
    onLeave: bool
    leaveMessage: Optional[str] = None
    leaveUntil: Optional[dt.datetime] = None
    busyNow: bool
    busyUntil: Optional[dt.datetime] = None
    nextBusy: list[BusyBlock]
    today: list[BusyBlock]  # every busy block that touches today (workspace time zone), past ones too
    openTickets: int
    overdue: int
    urgent: int
    known: bool  # the flow sent something about this person
    hasCalendar: bool  # busy times were readable for this person


class AvailabilityDto(BaseModel):
    configured: bool
    timezone: str
    updatedAt: Optional[dt.datetime] = None
    stale: bool
    hasSchedule: bool
    people: list[PersonAvailability]


def _name(u: User) -> str:
    return " ".join(p for p in (u.first_name, u.last_name) if p) or u.email.split("@")[0]


async def snapshot(db: AsyncSession) -> dict:
    row = await db.get(AppSetting, SETTING_KEY)
    return (row.value or {}) if row else {}


async def on_leave_emails(db: AsyncSession) -> set[str]:
    snap = await snapshot(db)
    return {e for e, p in (snap.get("people") or {}).items() if p.get("onLeave")}


@router.get("/availability", response_model=AvailabilityDto)
async def availability(db: AsyncSession = Depends(get_db)):
    snap = await snapshot(db)
    people_raw: dict = snap.get("people") or {}
    updated = _parse_time(snap.get("updatedAt")) if snap.get("updatedAt") else None
    from app.models.enums import TicketPriority
    from app.modules.ops import sla as sla_clock

    await sla_clock.refresh_from_db(db)
    tz = sla_clock.SLA_TIMEZONE
    now = utcnow()
    local_now = now.astimezone(tz)
    today = local_now.date()
    day_start = dt.datetime(today.year, today.month, today.day, tzinfo=tz).astimezone(dt.timezone.utc)
    day_end = day_start + dt.timedelta(days=1)
    urgent = dict(
        (await db.execute(
            select(Ticket.assignee_id, func.count())
            .where(Ticket.status != TicketStatus.DONE, Ticket.priority == TicketPriority.URGENT)
            .group_by(Ticket.assignee_id)
        )).all()
    )
    counts = dict(
        (await db.execute(
            select(Ticket.assignee_id, func.count()).where(Ticket.status != TicketStatus.DONE).group_by(Ticket.assignee_id)
        )).all()
    )
    overdue = dict(
        (await db.execute(
            select(Ticket.assignee_id, func.count())
            .where(Ticket.status != TicketStatus.DONE, Ticket.due_date < today)
            .group_by(Ticket.assignee_id)
        )).all()
    )
    out: list[PersonAvailability] = []
    for u in await _team(db):
        email = teams_flow.microsoft_email(u).lower()
        p = people_raw.get(email) or people_raw.get(u.email.lower())
        busy, todays = [], []
        for b in (p or {}).get("busy") or []:
            s, e = _parse_time(b.get("start")), _parse_time(b.get("end"))
            if not (s and e):
                continue
            blk = BusyBlock(start=s, end=e, status=b.get("status") or "busy")
            if e > now:
                busy.append(blk)
            if s < day_end and e > day_start:
                todays.append(blk)
        current = next((b for b in busy if b.start <= now < b.end), None)
        leave_until = _parse_time(p.get("leaveUntil")) if p and p.get("leaveUntil") else None
        on_leave = bool(p and p.get("onLeave")) and not (leave_until and leave_until < now)
        if current and current.status == "oof":
            on_leave = True
        out.append(
            PersonAvailability(
                id=u.id,
                name=_name(u),
                email=email,
                role=u.role.value,
                onLeave=on_leave,
                leaveMessage=(p or {}).get("leaveMessage") if on_leave else None,
                leaveUntil=leave_until if on_leave else None,
                busyNow=current is not None,
                busyUntil=current.end if current else None,
                nextBusy=busy[:6],
                today=todays[:20],
                openTickets=int(counts.get(u.id, 0)),
                overdue=int(overdue.get(u.id, 0)),
                urgent=int(urgent.get(u.id, 0)),
                known=p is not None,
                hasCalendar=bool(p and p.get("hasCalendar")),
            )
        )
    out.sort(key=lambda x: (not x.onLeave, x.name.lower()))
    return AvailabilityDto(
        configured=bool(get_settings().OPS_TEAMS_FLOW_SECRET),
        timezone=str(tz),
        updatedAt=updated,
        stale=bool(updated is None or now - updated > STALE_AFTER),
        hasSchedule=bool(snap.get("hasSchedule")),
        people=out,
    )



# ------------------------------------------------------------ calendar ----
MEETINGS_KEY = "teams_meetings"  # Teams meetings booked from a ticket (Ticket → Teams meeting)


async def record_booked_meeting(
    db: AsyncSession, *, subject: str, start: dt.datetime, end: dt.datetime, organizer: User,
    attendees: list[str], ticket: Optional[Ticket], text: Optional[str],
) -> None:
    """Remember a meeting booked through the flow, so the Calendar can show it
    (no commit: the caller commits)."""
    row = await db.get(AppSetting, MEETINGS_KEY)
    items = list((row.value or {}).get("items") or []) if row else []
    cutoff = (utcnow() - dt.timedelta(days=120)).isoformat()
    items = [i for i in items if i.get("end", "") >= cutoff][-299:]
    items.append({
        "id": f"tm-{int(utcnow().timestamp() * 1000)}",
        "subject": subject[:250],
        "start": start.astimezone(dt.timezone.utc).isoformat(),
        "end": end.astimezone(dt.timezone.utc).isoformat(),
        "organizerId": organizer.id,
        "organizer": teams_flow.microsoft_email(organizer).lower(),
        "attendees": [a.lower() for a in attendees],
        "ticketKey": ticket.key if ticket is not None else None,
        "ticketTitle": ticket.title[:200] if ticket is not None else None,
        "text": (text or "")[:500] or None,
    })
    value = {"items": items}
    if row:
        row.value = value
        row.updated_at = utcnow()
    else:
        db.add(AppSetting(key=MEETINGS_KEY, value=value))


class CalendarPerson(BaseModel):
    name: str
    email: str


class CalendarEvent(BaseModel):
    id: str
    kind: str  # "meeting" (booked from a ticket) | "busy" (Outlook) | "leave" | "recording" (Fathom)
    title: str
    start: Optional[dt.datetime] = None
    end: Optional[dt.datetime] = None
    day: Optional[dt.date] = None  # all-day items (leave)
    people: list[CalendarPerson]
    ticketKey: Optional[str] = None
    ticketTitle: Optional[str] = None
    location: Optional[str] = None
    note: Optional[str] = None
    link: Optional[str] = None  # in-app link (meeting record)


class CalendarDto(BaseModel):
    timezone: str
    updatedAt: Optional[dt.datetime] = None
    hasSchedule: bool
    events: list[CalendarEvent]


_BUSY_TITLE = {"tentative": "Tentative", "oof": "Out of office", "workingelsewhere": "Working elsewhere"}


@router.get("/calendar", response_model=CalendarDto)
async def calendar(
    start: dt.date, end: dt.date, mine: bool = False,
    db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user),
):
    """Meetings and leave for the Ops Calendar, between two dates (inclusive):
    Teams meetings booked from tickets, Outlook busy blocks + automatic-reply
    leave (from the Availability sync flow) and Fathom meeting records."""
    from app.models.ops import Meeting
    from app.modules.ops import sla as sla_clock

    if end < start or (end - start).days > 62:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick a range of up to 62 days")
    await sla_clock.refresh_from_db(db)
    tz = sla_clock.SLA_TIMEZONE
    lo = dt.datetime(start.year, start.month, start.day, tzinfo=tz).astimezone(dt.timezone.utc)
    hi = dt.datetime(end.year, end.month, end.day, tzinfo=tz).astimezone(dt.timezone.utc) + dt.timedelta(days=1)

    team = await _team(db)
    me = next((u for u in team if u.id == user.id), None) or await db.get(User, user.id)
    my_email = teams_flow.microsoft_email(me).lower() if me else ""
    names = {teams_flow.microsoft_email(u).lower(): _name(u) for u in team}
    person = lambda e: CalendarPerson(name=names.get(e, e.split("@")[0]), email=e)  # noqa: E731
    events: list[CalendarEvent] = []

    # 1) Teams meetings booked from a ticket
    row = await db.get(AppSetting, MEETINGS_KEY)
    booked = list((row.value or {}).get("items") or []) if row else []
    booked_slots: set[tuple[str, str, str]] = set()
    for m in booked:
        s, e = _parse_time(m.get("start")), _parse_time(m.get("end"))
        if not (s and e) or e <= lo or s >= hi:
            continue
        who = list(dict.fromkeys([m.get("organizer") or "", *(m.get("attendees") or [])]))
        who = [w for w in who if w]
        for w in who:
            booked_slots.add((w, s.isoformat(), e.isoformat()))
        if mine and my_email not in who:
            continue
        events.append(CalendarEvent(
            id=m.get("id") or f"tm-{s.isoformat()}", kind="meeting", title=m.get("subject") or "Teams meeting",
            start=s, end=e, people=[person(w) for w in who], ticketKey=m.get("ticketKey"),
            ticketTitle=m.get("ticketTitle"), note=m.get("text"),
        ))

    # 2) Outlook busy blocks and leave (Availability sync flow)
    snap = await snapshot(db)
    grouped: dict[tuple, CalendarEvent] = {}
    for email, p in (snap.get("people") or {}).items():
        if email not in names or (mine and email != my_email):
            continue
        for b in p.get("busy") or []:
            s, e = _parse_time(b.get("start")), _parse_time(b.get("end"))
            if not (s and e) or e <= lo or s >= hi:
                continue
            if (email, s.isoformat(), e.isoformat()) in booked_slots:
                continue  # already shown as the booked Teams meeting
            st = (b.get("status") or "busy").lower()
            title = b.get("subject") or _BUSY_TITLE.get(st, "Busy")
            key = (s, e, title, b.get("location"))
            ev = grouped.get(key)
            if ev is None:
                ev = grouped[key] = CalendarEvent(
                    id=f"ol-{s.isoformat()}-{len(grouped)}", kind="leave" if st == "oof" else "busy", title=title,
                    start=s, end=e, people=[], location=b.get("location"),
                    note=None if b.get("subject") or st == "oof" else "From Outlook free/busy — the subject isn't shared.",
                )
            ev.people.append(person(email))
        for d in p.get("leaveDays") or []:
            try:
                day = dt.date.fromisoformat(d)
            except ValueError:
                continue
            if start <= day <= end:
                events.append(CalendarEvent(
                    id=f"lv-{email}-{d}", kind="leave", title=f"{names[email].split(' ')[0]} on leave", day=day,
                    people=[person(email)], note=p.get("leaveMessage"),
                ))
    events.extend(grouped.values())

    # 3) Fathom meeting records
    when = func.coalesce(Meeting.started_at, Meeting.scheduled_start_at)
    for m in (await db.execute(select(Meeting).where(when >= lo, when < hi).order_by(when))).scalars().all():
        emails = [str(a.get("email") or "").lower() for a in (m.attendees or []) if isinstance(a, dict)]
        if mine and my_email not in emails:
            continue
        s = m.started_at or m.scheduled_start_at
        e = m.ended_at or m.scheduled_end_at
        events.append(CalendarEvent(
            id=f"fm-{m.id}", kind="recording", title=m.title, start=s, end=e,
            people=[CalendarPerson(name=str(a.get("name") or a.get("email") or "?"), email=str(a.get("email") or ""))
                    for a in (m.attendees or []) if isinstance(a, dict)][:20],
            link=f"/ops/meetings/{m.id}", note="Recorded with Fathom",
        ))

    events.sort(key=lambda x: (x.day.isoformat() if x.day else (x.start or lo).astimezone(tz).date().isoformat(),
                               x.day is None, x.start or lo))
    updated = _parse_time(snap.get("updatedAt")) if snap.get("updatedAt") else None
    return CalendarDto(timezone=str(tz), updatedAt=updated, hasSchedule=bool(snap.get("hasSchedule")), events=events)
