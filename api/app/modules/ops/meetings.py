"""Ops CRM → Meetings: calls recorded by Fathom, their notes and action items.

    GET    /ops/meetings                       list (merchant, search, mine, open actions)
    GET    /ops/meetings/status                Fathom connection status for the page
    POST   /ops/meetings/sync                  pull new meetings from Fathom now
    GET    /ops/meetings/{id}                  summary, attendees, action items, transcript
    PATCH  /ops/meetings/{id}                  merchant / project / summary (ticket managers)
    DELETE /ops/meetings/{id}                  remove a meeting (Admin)
    POST   /ops/meetings/{id}/actions/{aid}/dismiss | reopen

    POST   /integrations/fathom/webhook        Fathom → us, signature-verified, no login

An action item becomes a ticket through the normal POST /ops/tickets with
`actionItemId` — same form, same rules (only `ticket.manage` creates).
Everyone on staff can read meetings; changing them is for ticket managers.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.pagination import PageMeta
from app.config import get_settings
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import ActionItemStatus
from app.models.ops import Meeting, MeetingActionItem, Project, Ticket, utcnow
from app.models.profiling import Merchant
from app.modules.ops import fathom
from app.schemas.meetings import (
    ActionCountsDto,
    ActionItemDto,
    AttendeeDto,
    FathomStatusDto,
    MeetingDetailDto,
    MeetingSummaryDto,
    PaginatedMeetingsDto,
    SyncResultDto,
    TicketMiniDto,
    TranscriptLineDto,
    UpdateMeetingDto,
)
from app.schemas.ops import MerchantRefDto, PersonRefDto, ProjectRefDto

logger = logging.getLogger("Meetings")

router = APIRouter(prefix="/ops/meetings", tags=["Ops CRM — Meetings"], dependencies=[Depends(require_capability("meetings.view"))])
webhook_router = APIRouter(prefix="/integrations/fathom", tags=["Integrations"])

WEBHOOK_PATH = "/api/v1/integrations/fathom/webhook"
MAX_WEBHOOK_BYTES = 10 * 1024 * 1024


def _name(u: User) -> str:
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


async def _can_manage(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not (user.can("ticket.manage") or user.can("settings.manage")):
        raise HTTPException(status_code=403, detail="Only the people who manage tickets can change meetings")
    return user


async def _get(db: AsyncSession, meeting_id: str) -> Meeting:
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return m


async def _summaries(db: AsyncSession, meetings: list[Meeting]) -> list[MeetingSummaryDto]:
    if not meetings:
        return []
    ids = [m.id for m in meetings]
    counts: dict[str, dict[str, int]] = {i: {} for i in ids}
    for mid, st, n in (
        await db.execute(
            select(MeetingActionItem.meeting_id, MeetingActionItem.status, func.count())
            .where(MeetingActionItem.meeting_id.in_(ids))
            .group_by(MeetingActionItem.meeting_id, MeetingActionItem.status)
        )
    ).all():
        counts[mid][st.value] = n
    merchant_ids = {m.merchant_id for m in meetings if m.merchant_id}
    merchants = dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(merchant_ids)))).all()) if merchant_ids else {}
    project_ids = {m.project_id for m in meetings if m.project_id}
    projects = dict((await db.execute(select(Project.id, Project.name).where(Project.id.in_(project_ids)))).all()) if project_ids else {}
    out = []
    for m in meetings:
        c = counts[m.id]
        dur = int((m.ended_at - m.started_at).total_seconds() // 60) if m.started_at and m.ended_at else None
        out.append(
            MeetingSummaryDto(
                id=m.id,
                title=m.title,
                source=m.source,
                startedAt=m.started_at,
                endedAt=m.ended_at,
                durationMinutes=dur,
                merchant=MerchantRefDto(id=m.merchant_id, name=merchants.get(m.merchant_id, "—")) if m.merchant_id else None,
                project=ProjectRefDto(id=m.project_id, name=projects.get(m.project_id, "—")) if m.project_id else None,
                recordedBy=m.recorded_by_name or m.recorded_by_email,
                attendees=[AttendeeDto(**a) for a in (m.attendees or [])],
                hasSummary=bool(m.summary),
                actions=ActionCountsDto(
                    open=c.get("OPEN", 0), ticket=c.get("TICKET", 0), dismissed=c.get("DISMISSED", 0)
                ),
                fathomUrl=m.fathom_url,
            )
        )
    return out


@router.get("", response_model=PaginatedMeetingsDto)
async def list_meetings(
    merchantId: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=200),
    mine: bool = False,
    openActions: bool = False,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    conds = []
    if merchantId:
        conds.append(Meeting.merchant_id == (None if merchantId == "none" else merchantId))
    if search:
        like = f"%{search.strip()}%"
        conds.append(or_(Meeting.title.ilike(like), Meeting.summary.ilike(like)))
    if mine:
        conds.append(or_(Meeting.attendees.contains([{"userId": user.id}]), func.lower(Meeting.recorded_by_email) == user.email.lower()))
    if openActions:
        conds.append(
            exists().where(and_(MeetingActionItem.meeting_id == Meeting.id, MeetingActionItem.status == ActionItemStatus.OPEN))
        )
    total = (await db.execute(select(func.count()).select_from(Meeting).where(*conds))).scalar_one()
    rows = (
        await db.execute(
            select(Meeting)
            .where(*conds)
            .order_by(Meeting.started_at.desc().nulls_last(), Meeting.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).scalars().all()
    return {"data": await _summaries(db, list(rows)), "meta": PageMeta.build(page, limit, total)}


@router.get("/status", response_model=FathomStatusDto)
async def fathom_status(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    s = get_settings()
    state = await fathom.get_state(db)
    meetings = (await db.execute(select(func.count()).select_from(Meeting))).scalar_one()
    open_actions = (
        await db.execute(select(func.count()).select_from(MeetingActionItem).where(MeetingActionItem.status == ActionItemStatus.OPEN))
    ).scalar_one()
    return FathomStatusDto(
        apiKeySet=bool(s.FATHOM_API_KEY),
        webhookSecretSet=bool(s.FATHOM_WEBHOOK_SECRET),
        webhookPath=WEBHOOK_PATH,
        lastSyncAt=fathom._ts(state.get("lastSyncAt")),
        lastWebhookAt=fathom._ts(state.get("lastWebhookAt")),
        lastError=state.get("lastError"),
        meetings=meetings,
        openActions=open_actions,
        canSync=user.can("ticket.manage") or user.can("settings.manage"),
    )


@router.post("/sync", response_model=SyncResultDto, dependencies=[Depends(_can_manage)])
async def sync(db: AsyncSession = Depends(get_db)):
    try:
        return await fathom.sync_meetings(db)
    except fathom.FathomNotConfigured as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except fathom.FathomError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/{meeting_id}", response_model=MeetingDetailDto)
async def get_meeting(meeting_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    m = await _get(db, meeting_id)
    return await _detail(db, m, user)


async def _detail(db: AsyncSession, m: Meeting, user: AuthenticatedUser) -> MeetingDetailDto:
    base = (await _summaries(db, [m]))[0]
    items = (
        await db.execute(
            select(MeetingActionItem).where(MeetingActionItem.meeting_id == m.id).order_by(MeetingActionItem.position, MeetingActionItem.created_at)
        )
    ).scalars().all()
    ticket_ids = {a.ticket_id for a in items if a.ticket_id}
    linked = (
        await db.execute(select(Ticket).where(or_(Ticket.meeting_id == m.id, Ticket.id.in_(ticket_ids or {""}))).order_by(Ticket.number))
    ).scalars().all()
    by_id = {t.id: t for t in linked}
    user_ids = {a.assignee_user_id for a in items if a.assignee_user_id} | {a.decided_by_id for a in items if a.decided_by_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids or {""})))).scalars()}

    def mini(t: Ticket) -> TicketMiniDto:
        return TicketMiniDto(key=t.key, title=t.title, status=t.status)

    return MeetingDetailDto(
        **base.model_dump(),
        summary=m.summary,
        transcript=[TranscriptLineDto(**t) for t in (m.transcript or [])],
        actionItems=[
            ActionItemDto(
                id=a.id,
                description=a.description,
                assigneeName=a.assignee_name,
                assigneeEmail=a.assignee_email,
                assignee=PersonRefDto(id=users[a.assignee_user_id].id, name=_name(users[a.assignee_user_id]), email=users[a.assignee_user_id].email)
                if a.assignee_user_id in users
                else None,
                recordingTimestamp=a.recording_timestamp,
                playbackUrl=a.playback_url,
                status=a.status,
                ticket=mini(by_id[a.ticket_id]) if a.ticket_id in by_id else None,
                decidedBy=_name(users[a.decided_by_id]) if a.decided_by_id in users else None,
                decidedAt=a.decided_at,
            )
            for a in items
        ],
        linkedTickets=[mini(t) for t in linked],
        shareUrl=m.share_url,
        callUrl=m.call_url,
        merchantMatch=m.merchant_match,
        canManage=user.can("ticket.manage") or user.can("settings.manage"),
    )


@router.patch("/{meeting_id}", response_model=MeetingDetailDto, dependencies=[Depends(_can_manage)])
async def update_meeting(
    meeting_id: str, dto: UpdateMeetingDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    m = await _get(db, meeting_id)
    sent = dto.model_fields_set
    if "merchantId" in sent:
        if dto.merchantId and not await db.get(Merchant, dto.merchantId):
            raise HTTPException(status_code=400, detail="Merchant not found")
        m.merchant_id = dto.merchantId or None
        m.merchant_match = "manual"
    if "projectId" in sent:
        if dto.projectId and not await db.get(Project, dto.projectId):
            raise HTTPException(status_code=400, detail="Project not found")
        m.project_id = dto.projectId or None
    if "summary" in sent:
        m.summary = (dto.summary or "").strip() or None
    m.updated_at = utcnow()
    await db.commit()
    return await _detail(db, m, user)


@router.delete("/{meeting_id}", status_code=204, dependencies=[Depends(require_capability("settings.manage"))])
async def delete_meeting(meeting_id: str, db: AsyncSession = Depends(get_db)):
    m = await _get(db, meeting_id)
    await db.delete(m)  # action items cascade; tickets keep existing (meeting_id set NULL)
    await db.commit()
    return Response(status_code=204)


async def _decide(db: AsyncSession, meeting_id: str, action_id: str, user: AuthenticatedUser, to: ActionItemStatus) -> MeetingActionItem:
    a = await db.get(MeetingActionItem, action_id)
    if not a or a.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="Action item not found")
    if a.status == ActionItemStatus.TICKET:
        raise HTTPException(status_code=409, detail="This action item already has a ticket")
    a.status = to
    a.decided_by_id = user.id if to == ActionItemStatus.DISMISSED else None
    a.decided_at = utcnow() if to == ActionItemStatus.DISMISSED else None
    await db.commit()
    return a


@router.post("/{meeting_id}/actions/{action_id}/dismiss", response_model=MeetingDetailDto, dependencies=[Depends(_can_manage)])
async def dismiss_action(meeting_id: str, action_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _decide(db, meeting_id, action_id, user, ActionItemStatus.DISMISSED)
    return await _detail(db, await _get(db, meeting_id), user)


@router.post("/{meeting_id}/actions/{action_id}/reopen", response_model=MeetingDetailDto, dependencies=[Depends(_can_manage)])
async def reopen_action(meeting_id: str, action_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _decide(db, meeting_id, action_id, user, ActionItemStatus.OPEN)
    return await _detail(db, await _get(db, meeting_id), user)


# ------------------------------------------------------------ webhook ----
@webhook_router.post("/webhook")
async def fathom_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Fathom → "new meeting content ready". No login: the signature is the
    authentication, so an unset secret refuses everything."""
    secret = get_settings().FATHOM_WEBHOOK_SECRET
    if not secret:
        raise HTTPException(status_code=503, detail="Fathom webhook isn't set up: FATHOM_WEBHOOK_SECRET is missing")
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")
    if not fathom.verify_webhook(secret, dict(request.headers), raw):
        logger.warning("Fathom webhook rejected: bad or missing signature")
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Expected a meeting object")
    meeting, created = await fathom.ingest_meeting(db, payload)
    await fathom.update_state(db, lastWebhookAt=utcnow())
    await db.commit()
    return {"ok": True, "meetingId": meeting.id, "created": created}
