"""Requests: reads, DTO building and the status rules (router.py calls these)."""
from __future__ import annotations

import re
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser
from app.db.schemas import qualified
from app.models import requests as m
from app.models import roadmap as rm
from app.models.auth import User
from app.models.ops import utcnow
from app.schemas import requests as dto

TYPE_LABEL = {"FEATURE": "New feature", "IMPROVEMENT": "Improvement", "BUG": "Bug", "COMPLAINT": "Complaint",
              "DATA": "Data", "PROCESS": "Process"}
AREA_LABEL = {"SALES": "Sales", "PARTNERS": "Partners / ISOs", "SUPPORT": "Support", "OPERATIONS": "Operations",
              "MARKETING": "Marketing", "PAYMENTS": "Payments & billing", "REPORTING": "Reporting",
              "PLATFORM": "The app itself", "OTHER": "Other"}
URGENCY_LABEL = {"LOW": "Low", "NORMAL": "Normal", "HIGH": "High", "BLOCKING": "Blocking my work"}
STATUS_LABEL = {"NEW": "New", "UNDER_REVIEW": "Under review", "NEEDS_INFO": "Needs info", "APPROVED": "On the roadmap",
                "IN_PROGRESS": "In progress", "SHIPPED": "Shipped", "DECLINED": "Declined", "DUPLICATE": "Duplicate"}
# "R-1004 <phrase>: title" in notifications and e-mails.
STATUS_PHRASE = {"NEW": "is new", "UNDER_REVIEW": "is under review", "NEEDS_INFO": "needs more information",
                 "APPROVED": "is on the roadmap", "IN_PROGRESS": "is in progress", "SHIPPED": "has shipped",
                 "DECLINED": "was declined", "DUPLICATE": "was merged into another request"}
# Request area -> roadmap area, when approving without choosing one.
ROADMAP_AREA = {"SALES": "SALES", "PARTNERS": "SALES", "SUPPORT": "MERCHANTS", "OPERATIONS": "MERCHANTS",
                "MARKETING": "MARKETING", "PAYMENTS": "MERCHANTS", "REPORTING": "PLATFORM", "PLATFORM": "PLATFORM",
                "OTHER": "PLATFORM"}
URGENCY_PRIORITY = {"LOW": "LOW", "NORMAL": "NORMAL", "HIGH": "HIGH", "BLOCKING": "HIGH"}

_REF = re.compile(r"^\s*(?:r-?)?(\d{1,9})\s*$", re.I)


def parse_ref(value: str) -> Optional[int]:
    mt = _REF.match(value or "")
    return int(mt.group(1)) if mt else None


def ref(r: m.Request) -> str:
    return f"R-{r.number}"


def name(u: Optional[User], fallback_email: str = "") -> str:
    if not u:
        return fallback_email
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def can_triage(user: AuthenticatedUser) -> bool:
    return user.can("requests.triage")


async def next_number(db: AsyncSession) -> int:
    return int((await db.execute(text(f"SELECT nextval('{qualified('roadmap')}.request_number_seq')"))).scalar_one())


async def get_or_404(db: AsyncSession, value: str) -> m.Request:
    n = parse_ref(value)
    r = None
    if n is not None:
        r = (await db.execute(select(m.Request).where(m.Request.number == n))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    return r


def add_event(db: AsyncSession, r: m.Request, kind: str, actor_email: Optional[str], *,
              from_status: Optional[str] = None, to_status: Optional[str] = None, note: Optional[str] = None) -> None:
    db.add(m.RequestEvent(request_id=r.id, kind=kind, from_status=from_status, to_status=to_status, note=note,
                          actor_email=actor_email))


def set_status(db: AsyncSession, r: m.Request, status: str, actor_email: Optional[str], note: Optional[str] = None,
               *, triaged: bool = True) -> Optional[str]:
    """Move the request, record the change; returns the old status (None when unchanged)."""
    if r.status == status:
        return None
    old = r.status
    r.status = status
    r.status_changed_at = utcnow()
    if triaged:
        r.triaged_by_email = actor_email
    add_event(db, r, m.EVENT_STATUS, actor_email, from_status=old, to_status=status, note=note)
    return old


async def _counts_for(db: AsyncSession, ids: list[str], model, col) -> dict[str, int]:
    if not ids:
        return {}
    rows = await db.execute(select(col, func.count()).where(col.in_(ids)).group_by(col))
    return {k: v for k, v in rows.all()}


async def rows(db: AsyncSession, me: AuthenticatedUser, reqs: list[m.Request]) -> list[dto.RequestRowDto]:
    ids = [r.id for r in reqs]
    votes = await _counts_for(db, ids, m.RequestVote, m.RequestVote.request_id)
    comments = await _counts_for(db, ids, m.RequestComment, m.RequestComment.request_id)
    mine_votes = set((await db.execute(select(m.RequestVote.request_id).where(
        m.RequestVote.request_id.in_(ids or [""]), m.RequestVote.user_id == me.id))).scalars())
    users = {u.id: u for u in (await db.execute(select(User).where(
        User.id.in_({r.requester_id for r in reqs if r.requester_id} or {""})))).scalars()}
    out = []
    for r in reqs:
        u = users.get(r.requester_id) if r.requester_id else None
        out.append(dto.RequestRowDto(
            id=r.id, number=r.number, ref=ref(r), type=r.type, area=r.area, urgency=r.urgency, title=r.title,
            status=r.status, requester=dto.PersonDto(id=r.requester_id, name=name(u, r.requester_email),
                                                     email=u.email if u else r.requester_email),
            votes=votes.get(r.id, 0), votedByMe=r.id in mine_votes, comments=comments.get(r.id, 0),
            mine=r.requester_id == me.id, roadmapItemId=r.roadmap_item_id, createdAt=r.created_at,
            statusChangedAt=r.status_changed_at,
        ))
    return out


async def counts(db: AsyncSession, me: AuthenticatedUser) -> dto.RequestCountsDto:
    by = dict((await db.execute(select(m.Request.status, func.count()).group_by(m.Request.status))).all())
    mine = (await db.execute(select(func.count()).select_from(m.Request).where(m.Request.requester_id == me.id))
            ).scalar_one()
    return dto.RequestCountsDto(
        open=sum(by.get(s, 0) for s in m.OPEN_STATUSES), closed=sum(by.get(s, 0) for s in m.CLOSED_STATUSES),
        new=by.get(m.STATUS_NEW, 0), needsInfo=by.get(m.STATUS_NEEDS_INFO, 0),
        approved=by.get(m.STATUS_APPROVED, 0) + by.get(m.STATUS_IN_PROGRESS, 0),
        shipped=by.get(m.STATUS_SHIPPED, 0), mine=mine,
    )


async def list_requests(db: AsyncSession, me: AuthenticatedUser, *, status: Optional[str], type_: Optional[str],
                        area: Optional[str], mine: bool, q: Optional[str], sort: str) -> dto.RequestListDto:
    conds = []
    if status == "open":
        conds.append(m.Request.status.in_(m.OPEN_STATUSES))
    elif status == "closed":
        conds.append(m.Request.status.in_(m.CLOSED_STATUSES))
    elif status == "approved":
        conds.append(m.Request.status.in_((m.STATUS_APPROVED, m.STATUS_IN_PROGRESS)))
    elif status and status != "all":
        conds.append(m.Request.status == status)
    if type_:
        conds.append(m.Request.type == type_)
    if area:
        conds.append(m.Request.area == area)
    if mine:
        conds.append(m.Request.requester_id == me.id)
    if q:
        like = f"%{q.strip()}%"
        n = parse_ref(q)
        conds.append(or_(m.Request.title.ilike(like), m.Request.details.ilike(like),
                         *( [m.Request.number == n] if n is not None else [])))
    stmt = select(m.Request).where(*conds)
    if sort == "top":
        votes = (select(func.count()).select_from(m.RequestVote)
                 .where(m.RequestVote.request_id == m.Request.id).correlate(m.Request).scalar_subquery())
        stmt = stmt.order_by(votes.desc(), m.Request.created_at.desc())
    elif sort == "updated":
        stmt = stmt.order_by(m.Request.status_changed_at.desc())
    else:
        stmt = stmt.order_by(m.Request.created_at.desc())
    reqs = list((await db.execute(stmt.limit(500))).scalars())
    return dto.RequestListDto(data=await rows(db, me, reqs), counts=await counts(db, me), canTriage=can_triage(me))


def can_edit(me: AuthenticatedUser, r: m.Request) -> bool:
    if can_triage(me):
        return True
    return r.requester_id == me.id and r.status in (m.STATUS_NEW, m.STATUS_NEEDS_INFO)


async def detail(db: AsyncSession, me: AuthenticatedUser, r: m.Request) -> dto.RequestDetailDto:
    (row,) = await rows(db, me, [r])
    comments = list((await db.execute(select(m.RequestComment).where(m.RequestComment.request_id == r.id)
                                      .order_by(m.RequestComment.created_at))).scalars())
    events = list((await db.execute(select(m.RequestEvent).where(m.RequestEvent.request_id == r.id)
                                    .order_by(m.RequestEvent.created_at))).scalars())
    voter_ids = list((await db.execute(select(m.RequestVote.user_id).where(m.RequestVote.request_id == r.id)
                                       .order_by(m.RequestVote.created_at))).scalars())
    people = {u.id: u for u in (await db.execute(select(User).where(
        User.id.in_(set(voter_ids) | {c.author_id for c in comments if c.author_id} or {""})))).scalars()}
    actor_emails = {e.actor_email for e in events if e.actor_email}
    by_email = {u.email.lower(): u for u in (await db.execute(select(User).where(
        func.lower(User.email).in_({x.lower() for x in actor_emails} or {""})))).scalars()}
    item = None
    if r.roadmap_item_id:
        i = await db.get(rm.Item, r.roadmap_item_id)
        if i:
            p = await db.get(rm.Phase, i.phase_id)
            item = dto.RoadmapLinkDto(id=i.id, title=i.title, status=i.status, phaseName=p.name if p else "",
                                      targetDate=i.target_date)
    dup = None
    if r.duplicate_of_id:
        d = await db.get(m.Request, r.duplicate_of_id)
        dup = ref(d) if d else None
    return dto.RequestDetailDto(
        **row.model_dump(), details=r.details, why=r.why, whoAffected=r.who_affected, links=r.links,
        decisionNote=r.decision_note, duplicateOf=dup, roadmapItem=item, triagedByEmail=r.triaged_by_email,
        voters=[name(people.get(v)) for v in voter_ids if v in people],
        commentList=[dto.CommentDto(id=c.id, author=dto.PersonDto(
            id=c.author_id, name=name(people.get(c.author_id), c.author_email) if c.author_id else c.author_email,
            email=c.author_email), body=c.body, createdAt=c.created_at) for c in comments],
        events=[dto.EventDto(id=e.id, kind=e.kind, fromStatus=e.from_status, toStatus=e.to_status, note=e.note,
                             actor=name(by_email.get((e.actor_email or "").lower()), e.actor_email or "") or None,
                             createdAt=e.created_at) for e in events],
        canEdit=can_edit(me, r), canTriage=can_triage(me), updatedAt=r.updated_at,
    )


def facts(r: m.Request, requester_name: str) -> list[tuple[str, str]]:
    return [("Request", ref(r)), ("Type", TYPE_LABEL.get(r.type, r.type)), ("Area", AREA_LABEL.get(r.area, r.area)),
            ("Urgency", URGENCY_LABEL.get(r.urgency, r.urgency)), ("From", requester_name),
            ("Status", STATUS_LABEL.get(r.status, r.status))]


async def requests_for_item(db: AsyncSession, item_id: str) -> list[m.Request]:
    return list((await db.execute(select(m.Request).where(m.Request.roadmap_item_id == item_id))).scalars())


def unique(values: Iterable[Optional[str]]) -> list[str]:
    return list(dict.fromkeys(v for v in values if v))
