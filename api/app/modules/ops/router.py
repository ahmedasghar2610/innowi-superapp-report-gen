"""Ops CRM — tickets (phase 1).

Rules (Ops CRM decisions log):
- Every ticket has exactly one assignee, chosen when it is created.
- A merchant is optional; no merchant = internal work.
- Creating, editing, reassigning and deleting tickets needs `ticket.manage`,
  which no role holds — it is granted per person (today: Aima and Maheen).
- Everyone with `ticket.view` (all staff) can read tickets and comment.
- The assignee can move their own ticket through the statuses and work its
  sub-tasks; changing anything else needs `ticket.manage`.

Tickets are addressed by key: `OPS-1042`, `1042`, or the row id.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import (
    ActionItemStatus,
    CommentVisibility,
    NotificationKind,
    TicketEventKind,
    TicketSource,
    TicketPriority,
    TicketStatus,
    TicketType,
    UserStatus,
)
from app.models.ops import (
    Meeting,
    MeetingActionItem,
    Project,
    Ticket,
    TicketComment,
    TicketEvent,
    TicketSubtask,
    TicketWatcher,
    utcnow,
)
from app.models.profiling import Merchant
from app.modules.ops import alerts
from app.modules.ops import sla as sla_clock
from app.modules.ops import notifications
from app.modules.ops.notifications import notify_assigned
from app.modules.ops.taxonomy import catalog_payload, validate_category
from app.schemas.ops import (
    MeetingRefDto,
    UpdateProjectDto,
    ActivityItemDto,
    ActivityResponseDto,
    CommentDto,
    CreateCommentDto,
    CreateProjectDto,
    CreateSubtaskDto,
    CreateTicketDto,
    MerchantRefDto,
    PaginatedTicketsDto,
    PeopleResponseDto,
    PersonDto,
    PersonRefDto,
    ProjectDto,
    ProjectRefDto,
    ProjectsResponseDto,
    SubtaskDto,
    TicketCatalogDto,
    TicketCountsDto,
    TicketDetailDto,
    TicketDto,
    TicketSlaDto,
    TicketViewerDto,
    UpdateSubtaskDto,
    UpdateTicketDto,
)

async def load_sla_settings(db: AsyncSession = Depends(get_db)) -> None:
    """Keep the SLA clock in step with Settings (targets, timezone, work
    week). Cached for a few seconds inside sla.refresh_from_db."""
    await sla_clock.refresh_from_db(db)


router = APIRouter(
    prefix="/ops",
    tags=["Ops CRM — Tickets"],
    dependencies=[Depends(require_capability("ticket.view")), Depends(load_sla_settings)],
)
_manage = Depends(require_capability("ticket.manage"))

_KEY_RE = re.compile(r"^\s*(?:OPS-?)?(\d{1,9})\s*$", re.IGNORECASE)

MANAGE_ONLY_MESSAGE = (
    "Only people with ticket management access can change this. "
    "The assignee can update the status and sub-tasks of their own tickets."
)


# =============================================================== helpers ====
def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _person_name(u: User) -> str:
    full = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return full or u.email


def _person_ref(u: Optional[User]) -> Optional[PersonRefDto]:
    return PersonRefDto(id=u.id, name=_person_name(u), email=u.email) if u else None


def _today() -> dt.date:
    return dt.date.today()


async def _load_ticket(db: AsyncSession, key: str) -> Ticket:
    m = _KEY_RE.match(key)
    stmt = select(Ticket).where(Ticket.number == int(m.group(1))) if m else select(Ticket).where(Ticket.id == key)
    ticket = (await db.execute(stmt)).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


async def _users(db: AsyncSession, ids) -> dict[str, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {u.id: u for u in rows}


async def _active_user(db: AsyncSession, user_id: str) -> User:
    u = await db.get(User, user_id)
    if not u or u.status != UserStatus.ACTIVE:
        raise _bad_request("Assignee must be an active Super App user")
    return u


async def _usable_project(db: AsyncSession, project_id: str) -> Project:
    p = await db.get(Project, project_id)
    if not p or p.archived:
        raise _bad_request("Project not found")
    return p


async def _existing_merchant(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise _bad_request("Merchant not found")
    return m


def _can_work(user: AuthenticatedUser, ticket: Ticket) -> bool:
    return user.can("ticket.manage") or (ticket.assignee_id is not None and ticket.assignee_id == user.id)


def _require_work(user: AuthenticatedUser, ticket: Ticket) -> None:
    if not _can_work(user, ticket):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MANAGE_ONLY_MESSAGE)


def _event(db: AsyncSession, ticket: Ticket, user: AuthenticatedUser, kind: TicketEventKind, data: Optional[dict] = None):
    db.add(TicketEvent(ticket_id=ticket.id, actor_id=user.id, kind=kind, data=data))


def _ref_dict(u: Optional[User]) -> Optional[dict]:
    return {"id": u.id, "name": _person_name(u)} if u else None


async def _serialize(db: AsyncSession, tickets: list[Ticket]) -> list[TicketDto]:
    if not tickets:
        return []
    ids = [t.id for t in tickets]

    projects = {
        p.id: p
        for p in (await db.execute(select(Project).where(Project.id.in_({t.project_id for t in tickets})))).scalars()
    }
    merchant_ids = {t.merchant_id for t in tickets if t.merchant_id}
    merchants = (
        dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(merchant_ids)))).all())
        if merchant_ids
        else {}
    )
    users = await _users(db, [t.assignee_id for t in tickets] + [t.created_by_id for t in tickets])

    sub_counts = {
        row[0]: (row[1], row[2])
        for row in (
            await db.execute(
                select(
                    TicketSubtask.ticket_id,
                    func.count(),
                    func.count().filter(TicketSubtask.done.is_(True)),
                )
                .where(TicketSubtask.ticket_id.in_(ids))
                .group_by(TicketSubtask.ticket_id)
            )
        ).all()
    }
    comment_counts = dict(
        (
            await db.execute(
                select(TicketComment.ticket_id, func.count())
                .where(TicketComment.ticket_id.in_(ids))
                .group_by(TicketComment.ticket_id)
            )
        ).all()
    )

    today = _today()
    now = utcnow()
    out: list[TicketDto] = []
    for t in tickets:
        project = projects.get(t.project_id)
        subs = sub_counts.get(t.id, (0, 0))
        out.append(
            TicketDto(
                id=t.id,
                key=t.key,
                number=t.number,
                title=t.title,
                description=t.description,
                type=t.type,
                category=t.category,
                subCategory=t.sub_category,
                requestType=t.request_type,
                priority=t.priority,
                status=t.status,
                source=t.source,
                project=ProjectRefDto(id=t.project_id, name=project.name if project else "—"),
                merchant=MerchantRefDto(id=t.merchant_id, name=merchants.get(t.merchant_id, "—")) if t.merchant_id else None,
                assignee=_person_ref(users.get(t.assignee_id)) if t.assignee_id else None,
                createdBy=_person_ref(users.get(t.created_by_id)) if t.created_by_id else None,
                dueDate=t.due_date,
                isOverdue=bool(t.due_date and t.due_date < today and t.status != TicketStatus.DONE),
                completedAt=t.completed_at,
                sla=_sla_dto(t, now),
                subtaskCount=subs[0],
                subtasksDone=subs[1],
                commentCount=comment_counts.get(t.id, 0),
                createdAt=t.created_at,
                updatedAt=t.updated_at,
            )
        )
    return out


def _sla_dto(t: Ticket, now: dt.datetime) -> Optional[TicketSlaDto]:
    if t.response_due_at is None or t.resolution_due_at is None:
        return None
    v = sla_clock.evaluate(
        priority=t.priority,
        response_due_at=t.response_due_at,
        resolution_due_at=t.resolution_due_at,
        first_response_at=t.first_response_at,
        completed_at=t.completed_at if t.status == TicketStatus.DONE else None,
        paused_at=t.sla_paused_at,
        now=now,
    )
    return TicketSlaDto(
        state=v.state,
        responseState=v.response_state,
        responseDueAt=v.response_due_at,
        firstResponseAt=v.first_response_at,
        resolutionDueAt=v.resolution_due_at,
        remainingSeconds=v.remaining_seconds,
        targetResponseHours=v.target_response_hours,
        targetResolutionHours=v.target_resolution_hours,
    )


def _mark_response(ticket: Ticket, user: AuthenticatedUser, *, moved_status: bool = False) -> None:
    """First response = the assignee first acts on the ticket, or anyone
    moves it out of New."""
    if ticket.first_response_at is None and (moved_status or ticket.assignee_id == user.id):
        ticket.first_response_at = utcnow()


def _reset_sla_targets(ticket: Ticket) -> None:
    """Due times from created_at + the priority's targets (+ time paused)."""
    ticket.response_due_at = sla_clock.response_due(ticket.created_at, ticket.priority)
    ticket.resolution_due_at = sla_clock.resolution_due(
        ticket.created_at, ticket.priority, ticket.sla_paused_seconds or 0
    )


def _set_status(ticket: Ticket, new_status: TicketStatus) -> None:
    """Status change plus its effects on the SLA clock and completion time."""
    now = utcnow()
    was_paused = ticket.sla_paused_at is not None
    if new_status == TicketStatus.AWAITING_MERCHANT and not was_paused:
        ticket.sla_paused_at = now
    elif new_status != TicketStatus.AWAITING_MERCHANT and was_paused:
        ticket.sla_paused_seconds = (ticket.sla_paused_seconds or 0) + sla_clock.business_seconds_between(
            ticket.sla_paused_at, now
        )
        ticket.sla_paused_at = None
        _reset_sla_targets(ticket)
    ticket.status = new_status
    ticket.completed_at = now if new_status == TicketStatus.DONE else None


def _subtask_dto(s: TicketSubtask) -> SubtaskDto:
    return SubtaskDto(id=s.id, title=s.title, done=s.done, position=s.position, doneAt=s.done_at, createdAt=s.created_at)


async def _detail(db: AsyncSession, ticket: Ticket, user: AuthenticatedUser) -> TicketDetailDto:
    base = (await _serialize(db, [ticket]))[0]
    subtasks = (
        await db.execute(
            select(TicketSubtask)
            .where(TicketSubtask.ticket_id == ticket.id)
            .order_by(TicketSubtask.position, TicketSubtask.created_at)
        )
    ).scalars().all()
    from app.modules.ops import ticket_more
    from app.modules.ops.ticket_extras import attachment_dtos, watchers_dto

    meeting = await db.get(Meeting, ticket.meeting_id) if ticket.meeting_id else None
    watchers = await watchers_dto(db, ticket.id, user.id)
    return TicketDetailDto(
        **base.model_dump(),
        meeting=MeetingRefDto(id=meeting.id, title=meeting.title) if meeting else None,
        subtasks=[_subtask_dto(s) for s in subtasks],
        watchers=watchers.data,
        attachments=[a.model_dump(mode="json") for a in await attachment_dtos(db, ticket.id, user)],
        **(await ticket_more.detail_extras(db, ticket)),
        viewer=TicketViewerDto(canManage=user.can("ticket.manage"), canWork=_can_work(user, ticket), watching=watchers.watching),
    )


async def _ticket_raw(key: str, db: AsyncSession) -> Optional[dict]:
    """Before-snapshot for the platform audit log (@audited)."""
    try:
        ticket = await _load_ticket(db, key)
    except HTTPException:
        return None
    return (await _serialize(db, [ticket]))[0].model_dump(mode="json")


def _merchant_of(entity: Optional[dict]) -> Optional[str]:
    return ((entity or {}).get("merchant") or {}).get("id")


def _parse_enum_list(raw: Optional[str], enum_cls, name: str):
    if not raw:
        return None
    values = [v.strip().upper() for v in raw.split(",") if v.strip()]
    try:
        return [enum_cls(v) for v in values]
    except ValueError:
        raise _bad_request(f"Invalid {name}. Use one or more of: {', '.join(e.value for e in enum_cls)}")


def _filters(
    *,
    user: AuthenticatedUser,
    view: str,
    statuses: Optional[list[TicketStatus]],
    priorities: Optional[list[TicketPriority]],
    project_id: Optional[str],
    assignee_id: Optional[str],
    merchant_id: Optional[str],
    search: Optional[str],
    overdue: bool,
    watching: bool = False,
    sla_breached: bool = False,
    due_from: Optional[dt.date] = None,
    due_to: Optional[dt.date] = None,
    completed_from: Optional[dt.date] = None,
    completed_to: Optional[dt.date] = None,
) -> list:
    conds: list = []
    if watching:
        conds.append(Ticket.id.in_(select(TicketWatcher.ticket_id).where(TicketWatcher.user_id == user.id)))
    if sla_breached:
        now = utcnow()
        conds.append(Ticket.status != TicketStatus.DONE)
        conds.append(
            or_(
                and_(Ticket.sla_paused_at.is_(None), Ticket.resolution_due_at < now),
                and_(Ticket.first_response_at.is_(None), Ticket.response_due_at < now),
            )
        )
    if due_from:
        conds.append(Ticket.due_date >= due_from)
    if due_to:
        conds.append(Ticket.due_date <= due_to)
    if completed_from:
        conds.append(Ticket.completed_at >= dt.datetime.combine(completed_from, dt.time.min, tzinfo=sla_clock.SLA_TIMEZONE))
    if completed_to:
        conds.append(Ticket.completed_at < dt.datetime.combine(completed_to + dt.timedelta(days=1), dt.time.min, tzinfo=sla_clock.SLA_TIMEZONE))
    if statuses:
        conds.append(Ticket.status.in_(statuses))
    elif view == "open":
        conds.append(Ticket.status != TicketStatus.DONE)
    elif view == "done":
        conds.append(Ticket.status == TicketStatus.DONE)
    if priorities:
        conds.append(Ticket.priority.in_(priorities))
    if project_id:
        conds.append(Ticket.project_id == project_id)
    if assignee_id:
        if assignee_id == "me":
            conds.append(Ticket.assignee_id == user.id)
        elif assignee_id == "none":
            conds.append(Ticket.assignee_id.is_(None))
        else:
            conds.append(Ticket.assignee_id == assignee_id)
    if merchant_id:
        conds.append(Ticket.merchant_id.is_(None) if merchant_id == "none" else Ticket.merchant_id == merchant_id)
    if overdue:
        conds.append(and_(Ticket.due_date < _today(), Ticket.status != TicketStatus.DONE))
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        options = [
            Ticket.title.ilike(like),
            Ticket.merchant_id.in_(select(Merchant.id).where(Merchant.restaurant_name.ilike(like))),
        ]
        m = _KEY_RE.match(term)
        if m:
            options.append(Ticket.number == int(m.group(1)))
        conds.append(or_(*options))
    return conds


# ============================================================ reference ====
@router.get("/catalog", response_model=TicketCatalogDto)
async def get_catalog():
    """Ticket types → categories → sub-categories (the New ticket form)."""
    return catalog_payload()


@router.get("/people", response_model=PeopleResponseDto)
async def list_people(db: AsyncSession = Depends(get_db)):
    """Active Super App users — the assignee picker. (GET /users is admin-only.)"""
    rows = (
        await db.execute(
            select(User).where(User.status == UserStatus.ACTIVE).order_by(User.first_name, User.last_name, User.email)
        )
    ).scalars().all()
    from app.common.capabilities import has_capability

    return {
        "data": [
            PersonDto(
                id=u.id,
                name=_person_name(u),
                email=u.email,
                role=u.role.value,
                canManageTickets=has_capability(u.role.value, "ticket.manage", u.granted_capabilities or ()),
            )
            for u in rows
        ]
    }


@router.get("/projects", response_model=ProjectsResponseDto)
async def list_projects(includeArchived: bool = False, db: AsyncSession = Depends(get_db)):
    stmt = select(Project).order_by(Project.position, Project.name)
    if not includeArchived:
        stmt = stmt.where(Project.archived.is_(False))
    rows = (await db.execute(stmt)).scalars().all()
    return {"data": [ProjectDto(id=p.id, name=p.name, archived=p.archived, position=p.position) for p in rows]}


@router.post("/projects", response_model=ProjectDto, status_code=201, dependencies=[_manage])
async def create_project(dto: CreateProjectDto, db: AsyncSession = Depends(get_db)):
    max_pos = (await db.execute(select(func.max(Project.position)))).scalar() or 0
    p = Project(name=dto.name, position=max_pos + 1)
    db.add(p)
    await db.commit()  # duplicate name → 409 via the IntegrityError handler
    return ProjectDto(id=p.id, name=p.name, archived=p.archived, position=p.position)


async def _settings_or_ticket_manager(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not (user.can("settings.manage") or user.can("ticket.manage")):
        raise HTTPException(status_code=403, detail="This action requires a different role or capability")
    return user


@router.patch("/projects/{project_id}", response_model=ProjectDto, dependencies=[Depends(_settings_or_ticket_manager)])
async def update_project(project_id: str, dto: UpdateProjectDto, db: AsyncSession = Depends(get_db)):
    """Rename, archive/restore or reorder a project (Settings → Ops CRM).
    Archived projects keep their tickets but aren't offered for new ones."""
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if dto.name is not None:
        p.name = dto.name
    if dto.archived is not None:
        p.archived = dto.archived
    if dto.position is not None:
        p.position = dto.position
    await db.commit()  # duplicate name → 409 via the IntegrityError handler
    return ProjectDto(id=p.id, name=p.name, archived=p.archived, position=p.position)


# =============================================================== tickets ====
_SORTS = {
    "priority": lambda: (Ticket.priority.asc(), Ticket.due_date.asc().nulls_last(), Ticket.number.desc()),
    "due": lambda: (Ticket.due_date.asc().nulls_last(), Ticket.priority.asc(), Ticket.number.desc()),
    "updated": lambda: (Ticket.updated_at.desc(), Ticket.number.desc()),
    "created": lambda: (Ticket.number.desc(),),
}


@router.get("/tickets", response_model=PaginatedTicketsDto)
async def list_tickets(
    view: Literal["open", "done", "all"] = Query("open", description="Ignored when `status` is given"),
    status_: Optional[str] = Query(None, alias="status", description="Comma-separated, e.g. NEW,IN_PROGRESS"),
    type_: Optional[TicketType] = Query(None, alias="type"),
    priority: Optional[str] = Query(None, description="Comma-separated, e.g. URGENT,HIGH"),
    projectId: Optional[str] = None,
    assigneeId: Optional[str] = Query(None, description="A user id, `me`, or `none` (unassigned)"),
    merchantId: Optional[str] = Query(None, description="A merchant id, or `none` (internal tickets)"),
    search: Optional[str] = Query(None, max_length=200),
    overdue: bool = False,
    watching: bool = Query(False, description="Only tickets I watch"),
    slaBreached: bool = Query(False, description="Open tickets past their SLA (resolution or first response)"),
    dueFrom: Optional[dt.date] = None,
    dueTo: Optional[dt.date] = None,
    completedFrom: Optional[dt.date] = Query(None, description="Done on or after this day (workspace timezone)"),
    completedTo: Optional[dt.date] = None,
    sort: Literal["priority", "due", "updated", "created"] = "priority",
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    conds = _filters(
        user=user,
        view=view,
        statuses=_parse_enum_list(status_, TicketStatus, "status"),
        priorities=_parse_enum_list(priority, TicketPriority, "priority"),
        project_id=projectId,
        assignee_id=assigneeId,
        merchant_id=merchantId,
        search=search,
        overdue=overdue,
        watching=watching,
        sla_breached=slaBreached,
        due_from=dueFrom,
        due_to=dueTo,
        completed_from=completedFrom,
        completed_to=completedTo,
    )
    if type_:
        conds.append(Ticket.type == type_)

    total = (await db.execute(select(func.count()).select_from(Ticket).where(*conds))).scalar_one()
    rows = (
        await db.execute(
            select(Ticket).where(*conds).order_by(*_SORTS[sort]()).offset((page - 1) * limit).limit(limit)
        )
    ).scalars().all()
    return {"data": await _serialize(db, list(rows)), "meta": PageMeta.build(page, limit, total)}


@router.get("/tickets/counts", response_model=TicketCountsDto)
async def ticket_counts(
    view: Literal["open", "done", "all"] = "open",
    status_: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    projectId: Optional[str] = None,
    assigneeId: Optional[str] = None,
    merchantId: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=200),
    overdue: bool = False,
    watching: bool = False,
    slaBreached: bool = False,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Counts per type for the list's team tabs — same filters as GET /tickets, minus `type`."""
    conds = _filters(
        user=user,
        view=view,
        statuses=_parse_enum_list(status_, TicketStatus, "status"),
        priorities=_parse_enum_list(priority, TicketPriority, "priority"),
        project_id=projectId,
        assignee_id=assigneeId,
        merchant_id=merchantId,
        search=search,
        overdue=overdue,
        watching=watching,
        sla_breached=slaBreached,
    )
    rows = (await db.execute(select(Ticket.type, func.count()).where(*conds).group_by(Ticket.type))).all()
    by_type = {t.value: 0 for t in TicketType}
    for t, n in rows:
        by_type[t.value] = n
    return {"total": sum(by_type.values()), "byType": by_type}


@router.post("/tickets", response_model=TicketDetailDto, status_code=201, dependencies=[_manage])
@audited(entity_type="Ticket", resolve_merchant_id=_merchant_of)
async def create_ticket(
    dto: CreateTicketDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    err = validate_category(dto.type, dto.category, dto.subCategory)
    if err:
        raise _bad_request(err)
    await _usable_project(db, dto.projectId)
    if dto.merchantId:
        await _existing_merchant(db, dto.merchantId)
    assignee = await _active_user(db, dto.assigneeId)
    action = None
    if dto.actionItemId:
        action = await db.get(MeetingActionItem, dto.actionItemId)
        if not action:
            raise _bad_request("Action item not found")
        if action.status != ActionItemStatus.OPEN:
            raise HTTPException(status_code=409, detail="This action item already has a ticket or was dismissed")

    now = utcnow()
    ticket = Ticket(
        created_at=now,
        updated_at=now,
        title=dto.title,
        description=dto.description,
        type=dto.type,
        category=dto.category,
        sub_category=dto.subCategory,
        request_type=dto.requestType,
        priority=dto.priority,
        status=TicketStatus.NEW,
        project_id=dto.projectId,
        merchant_id=dto.merchantId,
        assignee_id=assignee.id,
        created_by_id=user.id,
        due_date=dto.dueDate,
        source=TicketSource.MEETING if action else TicketSource.MANUAL,
        meeting_id=action.meeting_id if action else None,
    )
    _reset_sla_targets(ticket)
    db.add(ticket)
    await db.flush()  # assigns ticket.number from the sequence
    if action:
        action.status = ActionItemStatus.TICKET
        action.ticket_id = ticket.id
        action.decided_by_id = user.id
        action.decided_at = now
    for i, title in enumerate(dto.subtasks):
        db.add(TicketSubtask(ticket_id=ticket.id, title=title, position=i))
    _event(db, ticket, user, TicketEventKind.CREATED, {"assignee": _ref_dict(assignee)})
    from app.modules.ops.ticket_extras import add_watcher

    await add_watcher(db, ticket.id, user.id, user.id)  # the creator follows the ticket
    await alerts.notify(
        db, [assignee.id], NotificationKind.ASSIGNED, ticket, f"{ticket.key} was assigned to you", ticket.title, actor_id=user.id
    )
    if ticket.priority == TicketPriority.URGENT:
        notifications.queue_channel(
            db, title=f"Urgent ticket: {ticket.key}",
            body=f"{ticket.title} · assigned to {_person_name(assignee)}", link=f"/ops/tickets/{ticket.key}",
        )
    await db.commit()
    await notifications.flush(db)

    await notify_assigned(
        ticket_key=ticket.key,
        ticket_title=ticket.title,
        assignee_email=assignee.email,
        actor_email=user.email,
        reassigned=False,
    )
    return await _detail(db, ticket, user)


@router.get("/tickets/{key}", response_model=TicketDetailDto)
async def get_ticket(key: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    return await _detail(db, await _load_ticket(db, key), user)


_REQUIRED_ON_UPDATE = ("title", "type", "category", "requestType", "priority", "status", "projectId", "assigneeId")
_FIELD_LABELS = {
    "title": "title",
    "description": "description",
    "type": "type",
    "category": "category",
    "subCategory": "sub-category",
    "requestType": "request type",
    "projectId": "project",
    "merchantId": "merchant",
}


@router.patch("/tickets/{key}", response_model=TicketDetailDto)
@audited(entity_type="Ticket", id_param="key", read=_ticket_raw, resolve_merchant_id=_merchant_of)
async def update_ticket(
    key: str,
    dto: UpdateTicketDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    ticket = await _load_ticket(db, key)
    changes = dto.model_dump(exclude_unset=True)
    if not changes:
        return await _detail(db, ticket, user)

    if not user.can("ticket.manage"):
        if ticket.assignee_id != user.id or set(changes) - {"status"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MANAGE_ONLY_MESSAGE)

    for field in _REQUIRED_ON_UPDATE:
        if field in changes and changes[field] is None:
            raise _bad_request(f"{field} cannot be empty")

    updated_fields: list[str] = []
    new_assignee: Optional[User] = None

    # -- type / category / sub-category, validated together
    if {"type", "category", "subCategory"} & changes.keys():
        new_type = changes.get("type", ticket.type)
        new_cat = changes.get("category", ticket.category)
        new_sub = changes["subCategory"] if "subCategory" in changes else ticket.sub_category
        if "subCategory" not in changes and new_sub and validate_category(new_type, new_cat, new_sub):
            new_sub = None  # the old sub-category doesn't belong to the new category
        err = validate_category(new_type, new_cat, new_sub)
        if err:
            raise _bad_request(err)
        for field, attr, value in (("type", "type", new_type), ("category", "category", new_cat), ("subCategory", "sub_category", new_sub)):
            if getattr(ticket, attr) != value:
                setattr(ticket, attr, value)
                updated_fields.append(_FIELD_LABELS[field])

    if "title" in changes and changes["title"] != ticket.title:
        ticket.title = changes["title"]
        updated_fields.append("title")
    if "description" in changes and changes["description"] != ticket.description:
        ticket.description = changes["description"]
        updated_fields.append("description")
    if "requestType" in changes and changes["requestType"] != ticket.request_type:
        ticket.request_type = changes["requestType"]
        updated_fields.append("request type")
    if "projectId" in changes and changes["projectId"] != ticket.project_id:
        await _usable_project(db, changes["projectId"])
        ticket.project_id = changes["projectId"]
        updated_fields.append("project")
    if "merchantId" in changes and changes["merchantId"] != ticket.merchant_id:
        if changes["merchantId"]:
            await _existing_merchant(db, changes["merchantId"])
        ticket.merchant_id = changes["merchantId"]
        updated_fields.append("merchant")

    if "priority" in changes and changes["priority"] != ticket.priority:
        _event(db, ticket, user, TicketEventKind.PRIORITY_CHANGED, {"from": ticket.priority.value, "to": changes["priority"].value})
        ticket.priority = changes["priority"]
        _reset_sla_targets(ticket)  # new priority, new targets
        if ticket.priority == TicketPriority.URGENT and ticket.status != TicketStatus.DONE:
            notifications.queue_channel(
                db, title=f"Ticket made urgent: {ticket.key}", body=ticket.title, link=f"/ops/tickets/{ticket.key}",
            )

    if "dueDate" in changes and changes["dueDate"] != ticket.due_date:
        _event(
            db, ticket, user, TicketEventKind.DUE_DATE_CHANGED,
            {
                "from": ticket.due_date.isoformat() if ticket.due_date else None,
                "to": changes["dueDate"].isoformat() if changes["dueDate"] else None,
            },
        )
        ticket.due_date = changes["dueDate"]

    if "assigneeId" in changes and changes["assigneeId"] != ticket.assignee_id:
        new_assignee = await _active_user(db, changes["assigneeId"])
        old = (await _users(db, [ticket.assignee_id])).get(ticket.assignee_id) if ticket.assignee_id else None
        _event(db, ticket, user, TicketEventKind.ASSIGNED, {"from": _ref_dict(old), "to": _ref_dict(new_assignee)})
        ticket.assignee_id = new_assignee.id

    status_changed_to: Optional[TicketStatus] = None
    if "status" in changes and changes["status"] != ticket.status:
        new_status: TicketStatus = changes["status"]
        status_changed_to = new_status
        _event(db, ticket, user, TicketEventKind.STATUS_CHANGED, {"from": ticket.status.value, "to": new_status.value})
        _mark_response(ticket, user, moved_status=ticket.status == TicketStatus.NEW)
        _set_status(ticket, new_status)

    if updated_fields:
        _event(db, ticket, user, TicketEventKind.UPDATED, {"fields": updated_fields})

    ticket.updated_at = utcnow()
    if new_assignee is not None:
        await alerts.notify(
            db, [new_assignee.id], NotificationKind.ASSIGNED, ticket, f"{ticket.key} was assigned to you", ticket.title, actor_id=user.id
        )
    if status_changed_to is not None:
        watchers = await alerts.watcher_ids(db, ticket.id)
        await alerts.notify(
            db, [ticket.assignee_id, *watchers], NotificationKind.STATUS_CHANGED, ticket,
            f"{ticket.key} moved to {status_changed_to.value.replace('_', ' ').title()}", ticket.title, actor_id=user.id,
            pref_overrides={w: "watching" for w in watchers if w != ticket.assignee_id},
        )
    await db.commit()
    await notifications.flush(db)

    if new_assignee is not None:
        await notify_assigned(
            ticket_key=ticket.key,
            ticket_title=ticket.title,
            assignee_email=new_assignee.email,
            actor_email=user.email,
            reassigned=True,
        )
    return await _detail(db, ticket, user)


@router.delete("/tickets/{key}", status_code=204, dependencies=[_manage])
@audited(entity_type="Ticket", id_param="key", read=_ticket_raw, resolve_merchant_id=_merchant_of)
async def delete_ticket(
    key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    ticket = await _load_ticket(db, key)
    await db.delete(ticket)  # sub-tasks, comments and events cascade in Postgres
    await db.commit()
    return Response(status_code=204)


# ============================================================= sub-tasks ====
@router.post("/tickets/{key}/subtasks", response_model=SubtaskDto, status_code=201)
async def add_subtask(
    key: str,
    dto: CreateSubtaskDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    ticket = await _load_ticket(db, key)
    _require_work(user, ticket)
    max_pos = (
        await db.execute(select(func.max(TicketSubtask.position)).where(TicketSubtask.ticket_id == ticket.id))
    ).scalar()
    sub = TicketSubtask(ticket_id=ticket.id, title=dto.title, position=(max_pos + 1) if max_pos is not None else 0)
    db.add(sub)
    _event(db, ticket, user, TicketEventKind.SUBTASK_ADDED, {"title": dto.title})
    _mark_response(ticket, user)
    ticket.updated_at = utcnow()
    await db.commit()
    return _subtask_dto(sub)


async def _subtask_and_ticket(db: AsyncSession, subtask_id: str) -> tuple[TicketSubtask, Ticket]:
    sub = await db.get(TicketSubtask, subtask_id)
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sub-task not found")
    ticket = await db.get(Ticket, sub.ticket_id)
    return sub, ticket


@router.patch("/subtasks/{subtask_id}", response_model=SubtaskDto)
async def update_subtask(
    subtask_id: str,
    dto: UpdateSubtaskDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    sub, ticket = await _subtask_and_ticket(db, subtask_id)
    _require_work(user, ticket)
    changes = dto.model_dump(exclude_unset=True)
    if changes.get("title") is not None:
        sub.title = changes["title"]
    if changes.get("done") is not None and changes["done"] != sub.done:
        sub.done = changes["done"]
        sub.done_at = utcnow() if sub.done else None
        _event(
            db, ticket, user,
            TicketEventKind.SUBTASK_COMPLETED if sub.done else TicketEventKind.SUBTASK_REOPENED,
            {"title": sub.title},
        )
    _mark_response(ticket, user)
    ticket.updated_at = utcnow()
    await db.commit()
    return _subtask_dto(sub)


@router.delete("/subtasks/{subtask_id}", status_code=204)
async def delete_subtask(
    subtask_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    sub, ticket = await _subtask_and_ticket(db, subtask_id)
    _require_work(user, ticket)
    _event(db, ticket, user, TicketEventKind.SUBTASK_REMOVED, {"title": sub.title})
    await db.delete(sub)
    ticket.updated_at = utcnow()
    await db.commit()
    return Response(status_code=204)


# ============================================================ activity ====
@router.get("/tickets/{key}/activity", response_model=ActivityResponseDto)
async def ticket_activity(key: str, db: AsyncSession = Depends(get_db)):
    """Comments and change events, oldest first."""
    ticket = await _load_ticket(db, key)
    comments = (
        await db.execute(select(TicketComment).where(TicketComment.ticket_id == ticket.id))
    ).scalars().all()
    events = (await db.execute(select(TicketEvent).where(TicketEvent.ticket_id == ticket.id))).scalars().all()
    users = await _users(
        db, [c.author_id for c in comments] + [e.actor_id for e in events] + [m for c in comments for m in (c.mentions or [])]
    )

    items = [
        ActivityItemDto(
            kind="comment",
            id=c.id,
            createdAt=c.created_at,
            actor=_person_ref(users.get(c.author_id)),
            body=c.body,
            visibility=c.visibility,
            mentions=[_person_ref(users[m]) for m in (c.mentions or []) if m in users],
        )
        for c in comments
    ] + [
        ActivityItemDto(
            kind="event", id=e.id, createdAt=e.created_at, actor=_person_ref(users.get(e.actor_id)), event=e.kind, data=e.data
        )
        for e in events
    ]
    items.sort(key=lambda i: i.createdAt)
    return {"data": items}


@router.post("/tickets/{key}/comments", response_model=CommentDto, status_code=201)
async def add_comment(
    key: str,
    dto: CreateCommentDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Anyone who can see tickets can comment. INTERNAL comments are for the
    team; MERCHANT ones record what the merchant was told. @mentioned people
    get a MENTIONED notice instead of the general comment notice."""
    ticket = await _load_ticket(db, key)
    if dto.visibility == CommentVisibility.MERCHANT and not ticket.merchant_id:
        raise _bad_request("This ticket has no merchant, so a comment can't be shared with one")
    mentioned: list[User] = []
    if dto.mentions:
        ids = list(dict.fromkeys(dto.mentions))
        mentioned = list(
            (await db.execute(select(User).where(User.id.in_(ids), User.status == UserStatus.ACTIVE))).scalars().all()
        )
        if len(mentioned) != len(ids):
            raise _bad_request("Someone you mentioned isn't an active user")
    comment = TicketComment(
        ticket_id=ticket.id, author_id=user.id, body=dto.body, visibility=dto.visibility, mentions=[u.id for u in mentioned]
    )
    db.add(comment)
    _mark_response(ticket, user)
    ticket.updated_at = utcnow()
    author = await db.get(User, user.id)
    who = _person_name(author) if author else "Someone"
    mention_ids = {u.id for u in mentioned}
    if mention_ids:
        await alerts.notify(
            db, mention_ids, NotificationKind.MENTIONED, ticket, f"{who} mentioned you on {ticket.key}", dto.body[:200], actor_id=user.id
        )
    others = [i for i in [ticket.assignee_id, *(await alerts.watcher_ids(db, ticket.id))] if i not in mention_ids]
    await alerts.notify(
        db, others, NotificationKind.COMMENTED, ticket, f"{who} commented on {ticket.key}", dto.body[:200], actor_id=user.id,
    )
    await db.commit()
    await notifications.flush(db)
    return CommentDto(
        id=comment.id,
        body=comment.body,
        author=_person_ref(author),
        visibility=comment.visibility,
        mentions=[_person_ref(u) for u in mentioned],
        createdAt=comment.created_at,
    )
