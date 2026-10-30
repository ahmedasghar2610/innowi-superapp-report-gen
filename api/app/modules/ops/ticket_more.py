"""Ticket page extras (merchant info, Library links), saved views, and the
"While you were out" catch-up + handover note.

    POST   /ops/tickets/{key}/library            {pageId} — the assignee or a ticket manager
    DELETE /ops/tickets/{key}/library/{pageId}

    GET    /ops/views                            my saved Tickets-list views
    POST   /ops/views                            {name, filters}
    DELETE /ops/views/{id}

    GET    /ops/catch-up                         what changed since I last dismissed it
    POST   /ops/catch-up/dismiss
    GET    /ops/handover                         ?since=ISO — a plain-text handover note
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import ActionItemStatus, MerchantServiceStatus, NotificationKind, TicketEventKind, TicketPriority, TicketStatus
from app.models.ops import (
    AppSetting,
    LibraryPage,
    Meeting,
    MeetingActionItem,
    Notification,
    SavedView,
    Ticket,
    TicketComment,
    TicketEvent,
    TicketLibraryLink,
    TicketWatcher,
    utcnow,
)
from app.models.profiling import Contact, Merchant, MerchantService, Subscription
from app.modules.ops import sla as sla_clock

router = APIRouter(prefix="/ops", tags=["Ops CRM — Tickets"], dependencies=[Depends(require_capability("ticket.view"))])

STATUS_TEXT = {
    "NEW": "New",
    "IN_PROGRESS": "In Progress",
    "AWAITING_MERCHANT": "Awaiting Merchant",
    "IN_REVIEW": "In Review",
    "DONE": "Done",
}
MAX_VIEWS = 20


def _name(u: Optional[User]) -> str:
    if not u:
        return "Someone"
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


# ------------------------------------------------------- ticket details ----
async def detail_extras(db: AsyncSession, ticket: Ticket) -> dict[str, Any]:
    """Merchant contact / plan / services and Library links for the ticket page."""
    out: dict[str, Any] = {"merchantInfo": None, "libraryLinks": [], "librarySuggestions": []}
    if ticket.merchant_id:
        contacts = (await db.execute(select(Contact).where(Contact.merchant_id == ticket.merchant_id))).scalars().all()
        order = {"OWNER": 0, "MARKETING": 1, "CONTENT_APPROVER": 2}
        contact = sorted(contacts, key=lambda c: (order.get(c.role.value, 9), not c.email))[0] if contacts else None
        sub = (
            await db.execute(select(Subscription).where(Subscription.merchant_id == ticket.merchant_id, Subscription.is_current.is_(True)))
        ).scalars().first()
        plan = None
        if sub:
            from app.models.catalog import Package

            pkg = await db.get(Package, sub.package_code)
            plan = {"name": pkg.name if pkg else sub.package_code, "status": sub.status.value}
        from app.models.catalog import Service

        services = (
            await db.execute(
                select(Service.name)
                .join(MerchantService, MerchantService.service_id == Service.id)
                .where(MerchantService.merchant_id == ticket.merchant_id, MerchantService.status == MerchantServiceStatus.ACTIVE)
                .order_by(Service.name)
            )
        ).scalars().all()
        out["merchantInfo"] = {
            "contact": {"name": contact.name, "email": contact.email, "phone": contact.phone, "role": contact.role.value} if contact else None,
            "plan": plan,
            "services": list(services),
        }

    linked = (
        await db.execute(
            select(LibraryPage)
            .join(TicketLibraryLink, TicketLibraryLink.page_id == LibraryPage.id)
            .where(TicketLibraryLink.ticket_id == ticket.id)
            .order_by(TicketLibraryLink.created_at)
        )
    ).scalars().all()
    linked_ids = {p.id for p in linked}
    names = {}
    mids = {p.merchant_id for p in linked if p.merchant_id} | ({ticket.merchant_id} if ticket.merchant_id else set())
    if mids:
        names = dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(mids)))).all())

    def page(p: LibraryPage) -> dict:
        return {"id": p.id, "title": p.title, "section": p.section.value, "merchant": names.get(p.merchant_id) if p.merchant_id else None}

    out["libraryLinks"] = [page(p) for p in linked]
    if ticket.merchant_id:
        sugg = (
            await db.execute(select(LibraryPage).where(LibraryPage.merchant_id == ticket.merchant_id).order_by(LibraryPage.position, LibraryPage.title))
        ).scalars().all()
        out["librarySuggestions"] = [page(p) for p in sugg if p.id not in linked_ids]
    return out


async def linked_tickets_for_page(db: AsyncSession, page_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(Ticket)
            .join(TicketLibraryLink, TicketLibraryLink.ticket_id == Ticket.id)
            .where(TicketLibraryLink.page_id == page_id)
            .order_by(Ticket.number.desc())
        )
    ).scalars().all()
    return [{"key": t.key, "title": t.title, "status": t.status.value} for t in rows]


class LinkPageDto(BaseModel):
    pageId: str

    model_config = {"extra": "forbid"}


async def _ticket_for_work(db: AsyncSession, key: str, user: AuthenticatedUser) -> Ticket:
    from app.modules.ops.router import _load_ticket

    t = await _load_ticket(db, key)
    if not (user.can("ticket.manage") or t.assignee_id == user.id):
        raise HTTPException(status_code=403, detail="Only the assignee or a ticket manager can link Library pages")
    return t


@router.post("/tickets/{key}/library", status_code=204)
async def link_page(key: str, dto: LinkPageDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    from sqlalchemy.dialects.postgresql import insert

    t = await _ticket_for_work(db, key, user)
    if not await db.get(LibraryPage, dto.pageId):
        raise HTTPException(status_code=400, detail="Library page not found")
    await db.execute(insert(TicketLibraryLink).values(ticket_id=t.id, page_id=dto.pageId, added_by_id=user.id, created_at=utcnow()).on_conflict_do_nothing())
    await db.commit()
    return Response(status_code=204)


@router.delete("/tickets/{key}/library/{page_id}", status_code=204)
async def unlink_page(key: str, page_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    t = await _ticket_for_work(db, key, user)
    link = await db.get(TicketLibraryLink, (t.id, page_id))
    if link:
        await db.delete(link)
        await db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------ saved views ----
_ALLOWED_FILTERS = {"view", "status", "priority", "projectId", "assigneeId", "search", "overdue", "slaBreached", "watching", "type"}


class SavedViewIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    filters: dict[str, Any]

    model_config = {"extra": "forbid"}


class SavedViewDto(BaseModel):
    id: str
    name: str
    filters: dict[str, Any]
    createdAt: dt.datetime


@router.get("/views", response_model=list[SavedViewDto])
async def my_views(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    rows = (await db.execute(select(SavedView).where(SavedView.user_id == user.id).order_by(SavedView.name))).scalars().all()
    return [SavedViewDto(id=v.id, name=v.name, filters=v.filters, createdAt=v.created_at) for v in rows]


@router.post("/views", response_model=SavedViewDto, status_code=201)
async def save_view(dto: SavedViewIn, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    filters = {k: v for k, v in dto.filters.items() if k in _ALLOWED_FILTERS and v not in (None, "", False)}
    if any(not isinstance(v, (str, bool, int)) or (isinstance(v, str) and len(v) > 200) for v in filters.values()):
        raise HTTPException(status_code=400, detail="Filters must be simple values")
    count = (await db.execute(select(func.count()).select_from(SavedView).where(SavedView.user_id == user.id))).scalar_one()
    existing = (await db.execute(select(SavedView).where(SavedView.user_id == user.id, func.lower(SavedView.name) == dto.name.strip().lower()))).scalar_one_or_none()
    if existing:
        existing.filters = filters  # same name → update it
        v = existing
    else:
        if count >= MAX_VIEWS:
            raise HTTPException(status_code=400, detail=f"You can save up to {MAX_VIEWS} views — delete one first")
        v = SavedView(user_id=user.id, name=dto.name.strip(), filters=filters)
        db.add(v)
    await db.commit()
    await db.refresh(v)
    return SavedViewDto(id=v.id, name=v.name, filters=v.filters, createdAt=v.created_at)


@router.delete("/views/{view_id}", status_code=204)
async def delete_view(view_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    v = await db.get(SavedView, view_id)
    if not v or v.user_id != user.id:
        raise HTTPException(status_code=404, detail="View not found")
    await db.delete(v)
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- catch-up ----
def describe(kind: TicketEventKind, data: Optional[dict]) -> str:
    d = data or {}
    if kind == TicketEventKind.STATUS_CHANGED:
        return f"moved to {STATUS_TEXT.get(d.get('to'), d.get('to'))}"
    if kind == TicketEventKind.ASSIGNED:
        return f"reassigned to {(d.get('to') or {}).get('name', 'someone')}"
    if kind == TicketEventKind.CREATED:
        return f"created, assigned to {(d.get('assignee') or {}).get('name', 'someone')}"
    if kind == TicketEventKind.PRIORITY_CHANGED:
        return f"priority → {str(d.get('to', '')).title()}"
    if kind == TicketEventKind.DUE_DATE_CHANGED:
        return f"due date → {d.get('to') or 'none'}"
    if kind == TicketEventKind.ATTACHMENT_ADDED:
        return f"file attached: {d.get('name')}"
    if kind in (TicketEventKind.SUBTASK_COMPLETED,):
        return f"sub-task done: {d.get('title')}"
    if kind == TicketEventKind.SUBTASK_ADDED:
        return f"sub-task added: {d.get('title')}"
    return "updated"


async def _since(db: AsyncSession, user_id: str) -> dt.datetime:
    row = await db.get(AppSetting, f"catchup:{user_id}")
    now = utcnow()
    floor = now - dt.timedelta(days=7)
    if row and row.value.get("seenAt"):
        try:
            seen = dt.datetime.fromisoformat(row.value["seenAt"])
            return max(seen, floor)
        except ValueError:
            pass
    return now - dt.timedelta(hours=24)


async def _my_ticket_ids(db: AsyncSession, user_id: str) -> set[str]:
    owned = (await db.execute(select(Ticket.id).where(Ticket.assignee_id == user_id))).scalars().all()
    watched = (await db.execute(select(TicketWatcher.ticket_id).where(TicketWatcher.user_id == user_id))).scalars().all()
    return set(owned) | set(watched)


async def _gather(db: AsyncSession, user: AuthenticatedUser, since: dt.datetime) -> dict:
    mine = await _my_ticket_ids(db, user.id)
    tickets: dict[str, Ticket] = {}

    async def load(ids):
        need = [i for i in ids if i not in tickets]
        if need:
            for t in (await db.execute(select(Ticket).where(Ticket.id.in_(need)))).scalars():
                tickets[t.id] = t

    events = (
        await db.execute(
            select(TicketEvent)
            .where(TicketEvent.created_at > since, or_(TicketEvent.actor_id != user.id, TicketEvent.actor_id.is_(None)))
            .order_by(TicketEvent.created_at.desc())
        )
    ).scalars().all()
    comments = (
        await db.execute(
            select(TicketComment)
            .where(TicketComment.created_at > since, TicketComment.ticket_id.in_(mine or {""}), or_(TicketComment.author_id != user.id, TicketComment.author_id.is_(None)))
            .order_by(TicketComment.created_at.desc())
        )
    ).scalars().all()
    urgent_new = (
        await db.execute(
            select(Ticket).where(Ticket.created_at > since, Ticket.priority == TicketPriority.URGENT, or_(Ticket.created_by_id != user.id, Ticket.created_by_id.is_(None)))
        )
    ).scalars().all()
    for t in urgent_new:
        tickets[t.id] = t
    actor_ids = {e.actor_id for e in events} | {c.author_id for c in comments}
    actors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(actor_ids or {""})))).scalars()}

    assigned: list[str] = []
    changed: dict[str, dict] = {}
    for e in events:
        to_me = (e.kind == TicketEventKind.ASSIGNED and ((e.data or {}).get("to") or {}).get("id") == user.id) or (
            e.kind == TicketEventKind.CREATED and ((e.data or {}).get("assignee") or {}).get("id") == user.id
        )
        if to_me and e.ticket_id not in assigned:
            assigned.append(e.ticket_id)
        if e.ticket_id in mine and e.ticket_id not in changed:
            changed[e.ticket_id] = {"at": e.created_at, "text": describe(e.kind, e.data), "by": _name(actors.get(e.actor_id))}
    comment_counts: dict[str, int] = {}
    for c in comments:
        comment_counts[c.ticket_id] = comment_counts.get(c.ticket_id, 0) + 1
        if c.ticket_id not in changed:
            changed[c.ticket_id] = {"at": c.created_at, "text": f"new comment: “{c.body[:80]}”", "by": _name(actors.get(c.author_id))}
    await load(set(changed) | set(assigned))

    mentions = (
        await db.execute(
            select(Notification).where(Notification.user_id == user.id, Notification.kind == NotificationKind.MENTIONED, Notification.created_at > since)
        )
    ).scalars().all()
    await load({n.ticket_id for n in mentions if n.ticket_id})

    meetings = (
        await db.execute(
            select(Meeting)
            .where(
                Meeting.started_at > since,
                or_(Meeting.attendees.contains([{"userId": user.id}]), func.lower(Meeting.recorded_by_email) == user.email.lower()),
            )
            .order_by(Meeting.started_at.desc())
        )
    ).scalars().all()
    my_actions = (
        await db.execute(
            select(MeetingActionItem).where(MeetingActionItem.assignee_user_id == user.id, MeetingActionItem.status == ActionItemStatus.OPEN)
        )
    ).scalars().all()
    return {
        "mine": mine,
        "tickets": tickets,
        "assigned": assigned,
        "changed": changed,
        "comment_counts": comment_counts,
        "urgent": urgent_new,
        "mentions": mentions,
        "meetings": meetings,
        "my_actions": my_actions,
    }


class CatchUpItem(BaseModel):
    kind: str  # assigned | urgent | mention | changed | meeting
    title: str
    text: str
    href: str
    at: dt.datetime
    by: Optional[str] = None


class CatchUpDto(BaseModel):
    since: dt.datetime
    counts: dict[str, int]
    items: list[CatchUpItem]


@router.get("/catch-up", response_model=CatchUpDto)
async def catch_up(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    since = await _since(db, user.id)
    g = await _gather(db, user, since)
    T = g["tickets"]
    items: list[CatchUpItem] = []
    for tid in g["assigned"]:
        if tid in T:
            t = T[tid]
            items.append(CatchUpItem(kind="assigned", title=f"{t.key} assigned to you", text=t.title, href=f"/ops/tickets/{t.key}", at=t.updated_at))
    for t in g["urgent"]:
        if t.id not in g["assigned"]:
            items.append(CatchUpItem(kind="urgent", title=f"{t.key} · Urgent", text=t.title, href=f"/ops/tickets/{t.key}", at=t.created_at))
    for n in g["mentions"]:
        t = T.get(n.ticket_id)
        if t:
            items.append(CatchUpItem(kind="mention", title=n.title, text=n.body or t.title, href=f"/ops/tickets/{t.key}", at=n.created_at))
    for tid, c in g["changed"].items():
        if tid in T and tid not in g["assigned"]:
            t = T[tid]
            more = g["comment_counts"].get(tid, 0)
            items.append(
                CatchUpItem(
                    kind="changed",
                    title=f"{t.key} · {t.title}",
                    text=c["text"] + (f" · {more} new comment{'s' if more != 1 else ''}" if more > 1 else ""),
                    href=f"/ops/tickets/{t.key}",
                    at=c["at"],
                    by=c["by"],
                )
            )
    for m in g["meetings"]:
        mine_here = [a for a in g["my_actions"] if a.meeting_id == m.id]
        items.append(
            CatchUpItem(
                kind="meeting",
                title=m.title,
                text=("Notes ready" if m.summary else "Notes on the way") + (f" · {len(mine_here)} action item{'s' if len(mine_here) != 1 else ''} for you" if mine_here else ""),
                href=f"/ops/meetings/{m.id}",
                at=m.started_at or m.created_at,
            )
        )
    order = {"assigned": 0, "urgent": 1, "mention": 2, "changed": 3, "meeting": 4}
    items.sort(key=lambda i: (order[i.kind], -i.at.timestamp()))
    counts = {
        "assigned": len(g["assigned"]),
        "urgent": len(g["urgent"]),
        "mentions": len(g["mentions"]),
        "changed": len([t for t in g["changed"] if t not in g["assigned"]]),
        "meetings": len(g["meetings"]),
        "actionItems": len(g["my_actions"]),
    }
    return CatchUpDto(since=since, counts=counts, items=items[:40])


@router.post("/catch-up/dismiss", status_code=204)
async def dismiss_catch_up(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    key = f"catchup:{user.id}"
    row = await db.get(AppSetting, key)
    value = {"seenAt": utcnow().isoformat()}
    if row:
        row.value = value
        row.updated_at = utcnow()
    else:
        db.add(AppSetting(key=key, value=value, updated_by_id=user.id))
    await db.commit()
    return Response(status_code=204)


class HandoverDto(BaseModel):
    since: dt.datetime
    text: str


def _local(t: dt.datetime) -> dt.datetime:
    return t.astimezone(sla_clock.SLA_TIMEZONE)


@router.get("/handover", response_model=HandoverDto)
async def handover(
    since: Optional[dt.datetime] = Query(None, description="Default: the start of today (workspace timezone)"),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """A plain-text handover note: urgent tickets, my open work, what changed
    on my tickets since `since`, and today's meetings. Copy it into Teams or an
    email (posting it directly comes with Microsoft 365)."""
    await sla_clock.refresh_from_db(db)
    now = utcnow()
    if since is None:
        local_now = _local(now)
        since = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    if since.tzinfo is None:
        since = since.replace(tzinfo=dt.timezone.utc)
    me = await db.get(User, user.id)
    g = await _gather(db, user, since)
    T = g["tickets"]
    lines: list[str] = []
    lines.append(f"HANDOVER – {_local(now):%a %d %b}, {_local(since):%H:%M}–{_local(now):%H:%M} ({_name(me)})")

    open_urgent = (
        await db.execute(select(Ticket).where(Ticket.status != TicketStatus.DONE, Ticket.priority == TicketPriority.URGENT).order_by(Ticket.number))
    ).scalars().all()
    people = {
        u.id: u
        for u in (await db.execute(select(User).where(User.id.in_({t.assignee_id for t in open_urgent if t.assignee_id} or {""})))).scalars()
    }
    mids = {t.merchant_id for t in open_urgent if t.merchant_id}
    mine_open = (
        await db.execute(select(Ticket).where(Ticket.assignee_id == user.id, Ticket.status != TicketStatus.DONE).order_by(Ticket.priority, Ticket.due_date.nulls_last()))
    ).scalars().all()
    mids |= {t.merchant_id for t in mine_open if t.merchant_id}
    mnames = dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(mids or {""})))).all())

    def tline(t: Ticket, owner: bool = False) -> str:
        bits = [f"{t.key} {t.title}"]
        if t.merchant_id:
            bits.append(mnames.get(t.merchant_id, ""))
        bits.append(STATUS_TEXT[t.status.value])
        if owner:
            bits.append(_name(people.get(t.assignee_id)) if t.assignee_id else "Unassigned")
        if t.due_date:
            bits.append(f"due {t.due_date:%d %b}")
        return "• " + " – ".join(b for b in bits if b)

    lines += ["", "URGENT (open)"]
    lines += [tline(t, owner=True) for t in open_urgent] or ["• None"]

    lines += ["", "MY OPEN TICKETS"]
    lines += [tline(t) for t in mine_open] or ["• None"]

    lines += ["", f"CHANGED SINCE {_local(since):%H:%M} (tickets I own or watch)"]
    ch = [f"• {T[tid].key} {T[tid].title} – {c['text']} ({c['by']})" for tid, c in g["changed"].items() if tid in T]
    lines += ch or ["• Nothing changed"]

    lines += ["", "MEETINGS"]
    if g["meetings"]:
        for m in g["meetings"]:
            first = ""
            if m.summary:
                text = re.sub(r"[#*_>`\[\]]", "", m.summary)
                parts = [p.strip() for p in text.splitlines() if p.strip() and p.strip().lower() != "summary"]
                first = parts[0][:160] if parts else ""
            mine_here = [a for a in g["my_actions"] if a.meeting_id == m.id]
            when = f"{_local(m.started_at):%H:%M}" if m.started_at else ""
            lines.append(f"• {m.title} ({when}){' – ' + first if first else ''}")
            for a in mine_here:
                lines.append(f"    – Action for me: {a.description}")
    else:
        lines.append("• No meetings")
    return HandoverDto(since=since, text="\n".join(lines))
