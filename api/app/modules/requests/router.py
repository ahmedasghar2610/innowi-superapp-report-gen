"""/requests — the team's ideas, feature asks, bugs and complaints, in one place.

Anyone signed in (requests.create) submits a request, sees everyone's
(requests.view), upvotes and comments. The requester can edit their own while
it is New or Needs info. The triage owners (requests.triage: Super Admins plus
the people it is granted to) set the status, ask for information, decline with
a reason, mark duplicates, and approve onto the roadmap — which creates (or
links) a roadmap item. When that roadmap item starts or is done, the request
follows (modules/roadmap/router.py calls `follow_roadmap_item`).

Notifications: modules/requests/notify.py. Every change is in the audit log.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request as HttpRequest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, require_capability
from app.db.session import get_db
from app.models import requests as m
from app.models import roadmap as rm
from app.models.audit import AuditLog
from app.models.auth import User
from app.models.enums import AuditAction, AuditOutcome, NotificationKind
from app.modules.requests import notify, service
from app.modules.roadmap import service as roadmap_service
from app.schemas import requests as dto

router = APIRouter(prefix="/requests", tags=["Requests"])

_view = require_capability("requests.view")
_create = require_capability("requests.create")
_triage = require_capability("requests.triage")

_FIELDS = {"type": "type", "area": "area", "urgency": "urgency", "title": "title", "details": "details", "why": "why",
           "whoAffected": "who_affected", "links": "links"}
_REQUIRED = {"type", "area", "urgency", "title", "details"}


def _snapshot(r: m.Request) -> dict:
    return {"ref": service.ref(r), "type": r.type, "area": r.area, "urgency": r.urgency, "title": r.title,
            "status": r.status, "decisionNote": r.decision_note, "roadmapItemId": r.roadmap_item_id}


async def _audit(db: AsyncSession, request: HttpRequest, user: AuthenticatedUser, action: AuditAction,
                 r: m.Request, before: Optional[dict], after: Optional[dict]) -> None:
    changed = sorted(k for k in set(before or {}) | set(after or {})
                     if (before or {}).get(k) != (after or {}).get(k)) if action == AuditAction.UPDATE else []
    db.add(AuditLog(
        actor_id=user.id, actor_email=user.email, actor_role=user.role, action=action, entity_type="Request",
        entity_id=r.id, before=before, after=after, changed_fields=changed, method=request.method,
        path=str(request.url.path), outcome=AuditOutcome.SUCCESS, status_code=200,
        ip=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"),
    ))
    await db.commit()


async def _requester_name(db: AsyncSession, r: m.Request) -> str:
    u = await db.get(User, r.requester_id) if r.requester_id else None
    return service.name(u, r.requester_email)


async def _actor_name(db: AsyncSession, user: AuthenticatedUser) -> str:
    return service.name(await db.get(User, user.id), user.email)


# ── read ──────────────────────────────────────────────────────────────────
@router.get("", response_model=dto.RequestListDto)
async def list_requests(
    status: Optional[str] = Query(None, description="open | closed | approved | all | one status"),
    type: Optional[dto.RequestType] = None,  # noqa: A002 - query parameter name
    area: Optional[dto.RequestArea] = None,
    mine: bool = False,
    q: Optional[str] = Query(None, max_length=200),
    sort: Literal["top", "new", "updated"] = "top",
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_view),
):
    if status and status not in ("open", "closed", "approved", "all") and status not in m.STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    return await service.list_requests(db, user, status=status or "open", type_=type, area=area, mine=mine, q=q,
                                       sort=sort)


@router.get("/{ref}", response_model=dto.RequestDetailDto)
async def get_request(ref: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    return await service.detail(db, user, await service.get_or_404(db, ref))


# ── submit / edit ─────────────────────────────────────────────────────────
@router.post("", response_model=dto.RequestDetailDto, status_code=201)
async def create_request(body: dto.RequestCreateDto, request: HttpRequest, db: AsyncSession = Depends(get_db),
                         user: AuthenticatedUser = Depends(_create)):
    r = m.Request(number=await service.next_number(db), type=body.type, area=body.area, urgency=body.urgency,
                  title=body.title, details=body.details, why=body.why, who_affected=body.whoAffected,
                  links=body.links, status=m.STATUS_NEW, requester_id=user.id, requester_email=user.email)
    db.add(r)
    await db.flush()
    db.add(m.RequestVote(request_id=r.id, user_id=user.id))  # you need it too
    service.add_event(db, r, m.EVENT_CREATED, user.email, to_status=m.STATUS_NEW)
    await db.commit()
    await db.refresh(r)
    await _audit(db, request, user, AuditAction.CREATE, r, None, _snapshot(r))

    who = await _requester_name(db, r)
    await notify.send(
        db, r, await notify.triager_ids(db), NotificationKind.REQUEST_NEW,
        f"New request {service.ref(r)}: {r.title}", f"{who} · {service.TYPE_LABEL[r.type]} · {service.AREA_LABEL[r.area]}",
        actor_id=user.id, facts=service.facts(r, who),
        email_text=f"{who} sent a new request.\n{r.details}" + (f"\nWhy: {r.why}" if r.why else ""),
        teams=True,
    )
    return await service.detail(db, user, r)


@router.patch("/{ref}", response_model=dto.RequestDetailDto)
async def update_request(ref: str, body: dto.RequestUpdateDto, request: HttpRequest,
                         db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    r = await service.get_or_404(db, ref)
    if not service.can_edit(user, r):
        raise HTTPException(status_code=403, detail=(
            "Only the person who sent it can edit it, and only while it's New or Needs info"
            if r.requester_id == user.id or not service.can_triage(user) else "You can't edit this request"))
    fields = set(body.model_fields_set)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to change")
    before = _snapshot(r)
    for key in fields:
        value = getattr(body, key)
        if value is None and key in _REQUIRED:
            continue
        setattr(r, _FIELDS[key], value)
    service.add_event(db, r, m.EVENT_EDITED, user.email)
    await db.commit()
    await db.refresh(r)
    await _audit(db, request, user, AuditAction.UPDATE, r, before, _snapshot(r))
    return await service.detail(db, user, r)


# ── upvotes ───────────────────────────────────────────────────────────────
@router.post("/{ref}/vote", response_model=dto.RequestDetailDto)
async def vote(ref: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    r = await service.get_or_404(db, ref)
    if not await db.get(m.RequestVote, (r.id, user.id)):
        db.add(m.RequestVote(request_id=r.id, user_id=user.id))
        await db.commit()
    return await service.detail(db, user, r)


@router.delete("/{ref}/vote", response_model=dto.RequestDetailDto)
async def unvote(ref: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    r = await service.get_or_404(db, ref)
    v = await db.get(m.RequestVote, (r.id, user.id))
    if v:
        await db.delete(v)
        await db.commit()
    return await service.detail(db, user, r)


# ── comments ──────────────────────────────────────────────────────────────
@router.post("/{ref}/comments", response_model=dto.RequestDetailDto, status_code=201)
async def add_comment(ref: str, body: dto.CommentCreateDto, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(_view)):
    r = await service.get_or_404(db, ref)
    if not body.body:
        raise HTTPException(status_code=400, detail="Write something first")
    db.add(m.RequestComment(request_id=r.id, author_id=user.id, author_email=user.email, body=body.body))
    answered = r.status == m.STATUS_NEEDS_INFO and r.requester_id == user.id
    if answered:  # the requester answered the question: back to the triage owners
        service.set_status(db, r, m.STATUS_UNDER_REVIEW, user.email, "Answered by the requester", triaged=False)
    await db.commit()
    await db.refresh(r)

    actor = await _actor_name(db, user)
    people = service.unique([*await notify.follower_ids(db, r), *await notify.triager_ids(db)])
    title = (f"{actor} answered on {service.ref(r)}: {r.title}" if answered
             else f"{actor} commented on {service.ref(r)}: {r.title}")
    await notify.send(db, r, people, NotificationKind.REQUEST_UPDATED, title, body.body[:300], actor_id=user.id,
                      facts=service.facts(r, await _requester_name(db, r)), email_text=body.body)
    return await service.detail(db, user, r)


# ── triage ────────────────────────────────────────────────────────────────
@router.post("/{ref}/status", response_model=dto.RequestDetailDto)
async def change_status(ref: str, body: dto.StatusChangeDto, request: HttpRequest,
                        db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_triage)):
    r = await service.get_or_404(db, ref)
    before = _snapshot(r)
    if body.status == m.STATUS_DUPLICATE:
        d = await service.get_or_404(db, body.duplicateOf or "")
        if d.id == r.id:
            raise HTTPException(status_code=400, detail="A request can't duplicate itself")
        r.duplicate_of_id = d.id
        # The people who wanted this one now want the original too.
        voters = set((await db.execute(select(m.RequestVote.user_id).where(m.RequestVote.request_id == r.id))).scalars())
        have = set((await db.execute(select(m.RequestVote.user_id).where(m.RequestVote.request_id == d.id))).scalars())
        for uid in voters - have:
            db.add(m.RequestVote(request_id=d.id, user_id=uid))
    elif r.duplicate_of_id:
        r.duplicate_of_id = None
    if body.note is not None or body.status in (m.STATUS_DECLINED, m.STATUS_NEEDS_INFO):
        r.decision_note = body.note
    old = service.set_status(db, r, body.status, user.email, body.note)
    if old is None and body.note is None:
        current = service.STATUS_LABEL[r.status]
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"It's already {current}")
    if old is None:  # same status, new note
        service.add_event(db, r, m.EVENT_STATUS, user.email, from_status=r.status, to_status=r.status, note=body.note)
    await db.commit()
    await db.refresh(r)
    await _audit(db, request, user, AuditAction.UPDATE, r, before, _snapshot(r))

    label = service.STATUS_LABEL[r.status]
    text = {
        m.STATUS_NEEDS_INFO: f"More information is needed: {body.note}. Reply with a comment on the request.",
        m.STATUS_DECLINED: f"Declined: {body.note}",
        m.STATUS_DUPLICATE: f"Merged into {body.duplicateOf.upper() if body.duplicateOf else ''}; "
                            "your upvote moved there." + (f" {body.note}" if body.note else ""),
    }.get(r.status, f"Now {label}." + (f" {body.note}" if body.note else ""))
    await notify.send(db, r, await notify.follower_ids(db, r), NotificationKind.REQUEST_UPDATED,
                      f"{service.ref(r)} {service.STATUS_PHRASE[r.status]}: {r.title}", text, actor_id=user.id,
                      facts=service.facts(r, await _requester_name(db, r)), email_text=text)
    return await service.detail(db, user, r)


@router.post("/{ref}/approve", response_model=dto.RequestDetailDto)
async def approve(ref: str, body: dto.ApproveDto, request: HttpRequest, db: AsyncSession = Depends(get_db),
                  user: AuthenticatedUser = Depends(_triage)):
    r = await service.get_or_404(db, ref)
    before = _snapshot(r)
    if body.itemId:
        item = await db.get(rm.Item, body.itemId)
        if not item:
            raise HTTPException(status_code=404, detail="Roadmap item not found")
        note = body.note or f"Linked to the roadmap item \"{item.title}\""
    else:
        phase = await db.get(rm.Phase, body.phaseId)
        if not phase:
            raise HTTPException(status_code=404, detail="Roadmap phase not found")
        if body.ownerId and not await roadmap_service.is_active_user(db, body.ownerId):
            raise HTTPException(status_code=400, detail="The owner must be an active Super App user")
        item = rm.Item(
            phase_id=phase.id, title=body.title or r.title, area=body.roadmapArea or service.ROADMAP_AREA[r.area],
            priority=body.priority or service.URGENCY_PRIORITY[r.urgency], owner_id=body.ownerId,
            target_date=body.targetDate, status=rm.STATUS_TODO, link=notify.link(r),
            description=f"From request {service.ref(r)} ({r.requester_email}).\n\n{r.details}"
                        + (f"\n\nWhy: {r.why}" if r.why else ""),
            created_by_email=user.email, updated_by_email=user.email,
            sort_order=await roadmap_service.next_sort(db, rm.Item, phase_id=phase.id),
        )
        db.add(item)
        await db.flush()
        note = body.note or f"Added to the roadmap in \"{phase.name}\""
    r.roadmap_item_id = item.id
    r.duplicate_of_id = None
    r.decision_note = body.note
    status = {rm.STATUS_DONE: m.STATUS_SHIPPED, rm.STATUS_IN_PROGRESS: m.STATUS_IN_PROGRESS}.get(item.status,
                                                                                               m.STATUS_APPROVED)
    service.set_status(db, r, status, user.email, note)
    service.add_event(db, r, m.EVENT_ROADMAP, user.email, note=item.title)
    await db.commit()
    await db.refresh(r)
    await _audit(db, request, user, AuditAction.UPDATE, r, before, _snapshot(r))

    text = f"Approved and added to the roadmap: {item.title}." + (f" {body.note}" if body.note else "")
    await notify.send(db, r, await notify.follower_ids(db, r), NotificationKind.REQUEST_UPDATED,
                      f"{service.ref(r)} is on the roadmap: {r.title}", text, actor_id=user.id,
                      facts=service.facts(r, await _requester_name(db, r)), email_text=text)
    return await service.detail(db, user, r)


# ── roadmap hook ──────────────────────────────────────────────────────────
async def follow_roadmap_item(db: AsyncSession, item: rm.Item, actor: AuthenticatedUser) -> None:
    """A roadmap item moved: its approved requests follow (in progress / shipped). Commits."""
    target = {rm.STATUS_IN_PROGRESS: m.STATUS_IN_PROGRESS, rm.STATUS_DONE: m.STATUS_SHIPPED}.get(item.status)
    if not target:
        return
    for r in await service.requests_for_item(db, item.id):
        if r.status not in (m.STATUS_APPROVED, m.STATUS_IN_PROGRESS) or r.status == target:
            continue
        service.set_status(db, r, target, actor.email, f"Roadmap item \"{item.title}\" is "
                           + ("done" if target == m.STATUS_SHIPPED else "in progress"), triaged=False)
        await db.commit()
        await db.refresh(r)
        text = (f"It's done: \"{item.title}\" shipped." if target == m.STATUS_SHIPPED
                else f"Work started on \"{item.title}\".")
        await notify.send(db, r, await notify.follower_ids(db, r), NotificationKind.REQUEST_UPDATED,
                          f"{service.ref(r)} {service.STATUS_PHRASE[target]}: {r.title}", text, actor_id=actor.id,
                          facts=service.facts(r, await _requester_name(db, r)), email_text=text)
