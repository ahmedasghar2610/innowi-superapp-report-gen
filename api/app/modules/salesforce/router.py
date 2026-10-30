"""Sales module routes: /api/v1/sales/*.

Read-only views of Salesforce data (copied by sync.py), plus the admin tools to
run the sync and to give salespeople a SuperApp login tied to their Salesforce
user. Nothing here writes to Salesforce.
"""
from __future__ import annotations

import datetime as dt
import hmac
import secrets
from typing import Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import _write_log as _write_audit_log
from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.security.password import hash_password
from app.config import get_settings
from app.db.session import SessionLocal, get_db
from app.models import salesforce as m
from app.models.auth import User
from app.models.enums import AuditAction, AuditOutcome, Role
from app.modules.salesforce import case_insights as ci
from app.modules.salesforce import service as svc
from app.modules.salesforce.sync import run_sync
from app.schemas import sales as dto
from app.schemas.auth import RegisterDto

router = APIRouter(prefix="/sales", tags=["Sales"])


async def sales_scope(
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(require_capability("sales.view")),
) -> svc.SalesScope:
    return await svc.load_scope(db, user)


Page = Query(1, ge=1)
Limit = Query(25, ge=1, le=100)
OwnerId = Query(None, alias="ownerId", max_length=18, description="Managers only: one salesperson's records")


# ------------------------------------------------------------- viewing ----
@router.get("/me", response_model=dto.SalesMeDto)
async def get_me(db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope)):
    return await svc.me(db, scope)


@router.get("/summary", response_model=dto.SummaryDto, summary="My Day")
async def get_summary(owner_id: Optional[str] = OwnerId, db: AsyncSession = Depends(get_db),
                      scope: svc.SalesScope = Depends(sales_scope)):
    return await svc.summary(db, scope, owner=owner_id)


@router.get("/insights", response_model=dto.InsightsDto, summary="Overview charts on My Day")
async def get_insights(owner_id: Optional[str] = OwnerId, db: AsyncSession = Depends(get_db),
                       scope: svc.SalesScope = Depends(sales_scope)):
    return await svc.insights(db, scope, owner=owner_id)


@router.get("/pipeline", response_model=dto.PipelineDto)
async def get_pipeline(
    owner_id: Optional[str] = OwnerId,
    include_stale: bool = Query(False, alias="includeStale"),
    closed_within_days: int = Query(90, alias="closedWithinDays", ge=1, le=3650),
    per_column: int = Query(50, alias="perColumn", ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    scope: svc.SalesScope = Depends(sales_scope),
):
    return await svc.pipeline(db, scope, owner=owner_id, include_stale=include_stale,
                              closed_within_days=closed_within_days, per_column=per_column)


@router.get("/deals", response_model=dto.PaginatedDealsDto)
async def get_deals(
    page: int = Page, limit: int = Limit, owner_id: Optional[str] = OwnerId,
    search: Optional[str] = Query(None, max_length=100),
    column: Optional[str] = Query(None, max_length=120, description="A pipeline column key"),
    state: Literal["open", "closed", "all"] = Query("open"),
    include_stale: bool = Query(False, alias="includeStale"),
    quiet: Optional[Literal["stuck", "stale"]] = Query(
        None, description="Open deals with no change for 30+ days but under 6 months (stuck), or 6+ months (stale)"),
    db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope),
):
    return await svc.list_deals(db, scope, page=page, limit=limit, owner=owner_id, search=search, column=column,
                                state=state, include_stale=include_stale, quiet=quiet)


@router.get("/deals/{deal_id}", response_model=dto.DealDetailDto)
async def get_deal(deal_id: str, db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope)):
    return await svc.get_deal(db, scope, deal_id)


@router.get("/customers", response_model=dto.PaginatedCustomersDto)
async def get_customers(
    page: int = Page, limit: int = Limit, owner_id: Optional[str] = OwnerId,
    search: Optional[str] = Query(None, max_length=100),
    health: Optional[str] = Query(None, max_length=40),
    only_customers: bool = Query(False, alias="onlyCustomers", description="Only restaurants with a won deal"),
    db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope),
):
    return await svc.list_customers(db, scope, page=page, limit=limit, owner=owner_id, search=search,
                                    health=health, only_customers=only_customers)


@router.get("/customers/{account_id}", response_model=dto.CustomerDetailDto)
async def get_customer(account_id: str, db: AsyncSession = Depends(get_db),
                       scope: svc.SalesScope = Depends(sales_scope)):
    return await svc.get_customer(db, scope, account_id)


@router.get("/visits", response_model=dto.PaginatedVisitsDto)
async def get_visits(
    page: int = Page, limit: int = Limit, owner_id: Optional[str] = OwnerId,
    state: Literal["open", "done", "all"] = Query("open"),
    when: Literal["all", "today", "week", "next7", "overdue", "upcoming"] = Query(
        "all", description="week = due today or in the next 7 days; next7 = starting in the next 7 days, not today"),
    visit_type: Optional[str] = Query(None, alias="type", max_length=80),
    search: Optional[str] = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope),
):
    return await svc.list_visits(db, scope, page=page, limit=limit, owner=owner_id, state=state, when=when,
                                 visit_type=visit_type, search=search)


@router.get("/visit-types", response_model=list[str])
async def get_visit_types(db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope)):
    return await svc.visit_types(db, scope)


def _case_filters(
    from_: Optional[dt.date] = Query(None, alias="from"), to: Optional[dt.date] = Query(None),
    department: Optional[str] = Query(None, max_length=60), category: Optional[str] = Query(None, max_length=60),
    source: Optional[Literal["recorded", "estimated", "unclassified"]] = Query(None),
    priority: Optional[str] = Query(None, max_length=40), origin: Optional[str] = Query(None, max_length=40),
    handled_by: Optional[str] = Query(None, alias="handledBy", max_length=18),
) -> ci.CaseFilters:
    """The insights screen's filters; the case list takes the same ones, so a click on a chart
    lists exactly what it counted."""
    return ci.CaseFilters(from_=from_, to=to, department=department, category=category, source=source,
                          priority=priority, origin=origin, handled_by=handled_by)


@router.get("/cases", response_model=dto.PaginatedCasesDto)
async def get_cases(
    page: int = Page, limit: int = Limit, owner_id: Optional[str] = OwnerId,
    state: Literal["open", "closed", "all"] = Query("open"),
    search: Optional[str] = Query(None, max_length=100),
    filters: ci.CaseFilters = Depends(_case_filters),
    db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope),
):
    return await svc.list_cases(db, scope, page=page, limit=limit, owner=owner_id, state=state, search=search,
                                filters=filters)


@router.get("/cases/insights")
async def get_case_insights(
    owner_id: Optional[str] = OwnerId,
    state: Literal["open", "closed", "all"] = Query("all"),
    search: Optional[str] = Query(None, max_length=100),
    filters: ci.CaseFilters = Depends(_case_filters),
    db: AsyncSession = Depends(get_db), scope: svc.SalesScope = Depends(sales_scope),
):
    """Which teams the support cases are for, what they're about, and how fast they close, for the
    cases this person can see. Department = the recorded team, else an estimate from the issue
    category (see salesforce/case_insights.py); every breakdown says how much is estimated."""
    filters.state, filters.search = state, search
    return await svc.case_insights(db, scope, owner=owner_id, filters=filters)


@router.get("/owners", response_model=list[dto.OwnerDto],
            dependencies=[Depends(require_capability("sales.viewAll"))])
async def get_owners(db: AsyncSession = Depends(get_db)):
    return await svc.owners(db)


@router.get("/team", response_model=list[dto.TeamMemberDto],
            dependencies=[Depends(require_capability("sales.viewAll"))])
async def get_team(db: AsyncSession = Depends(get_db)):
    return await svc.team(db)


# --------------------------------------------------- people and logins ----
async def _person_or_404(db: AsyncSession, sf_user_id: str) -> dto.PersonDto:
    found = await svc.people(db, [sf_user_id])
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salesforce user not found")
    return found[0]


async def _person_audit_read(sf_user_id: str, db: AsyncSession):
    found = await svc.people(db, [sf_user_id])
    return found[0].model_dump(mode="json") if found else None


@router.get("/people", response_model=list[dto.PersonDto],
            dependencies=[Depends(require_capability("sales.manage"))])
async def get_people(db: AsyncSession = Depends(get_db)):
    return await svc.people(db)


@router.post("/people/{sf_user_id}/login", response_model=dto.CreatedLoginDto, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_capability("sales.manage"))])
async def create_login(
    sf_user_id: str, body: dto.CreateLoginDto, request: Request,
    db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user),
):
    """Create a SuperApp login for a Salesforce user and link the two. Returns a one-time password."""
    sf_user = await db.get(m.SfUser, sf_user_id)
    if sf_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salesforce user not found")
    if await db.scalar(select(m.SfUserLink).where(m.SfUserLink.sf_user_id == sf_user_id)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This Salesforce user already has a login")
    email = (body.email or sf_user.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This Salesforce user has no email; enter one for the login")
    if await db.scalar(select(func.count()).select_from(User).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="A login with this email already exists; link it instead")
    first, _, last = sf_user.name.partition(" ")
    password = secrets.token_urlsafe(12)
    try:
        # The same rules as any other new login (valid email, name lengths).
        reg = RegisterDto(email=email, password=password, firstName=first or None, lastName=last or None,
                          role=Role(body.role))
    except ValidationError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"'{email}' isn't a valid email address; enter one for the login")
    # The login and its link are saved in ONE commit (not via UserService.create,
    # which commits on its own), so a failure can't leave an unlinked login behind.
    created = User(email=str(reg.email).lower(), password_hash=hash_password(password), first_name=reg.firstName,
                   last_name=reg.lastName, role=reg.role, password_changed_at=dt.datetime.now(dt.timezone.utc))
    db.add(created)
    try:
        await db.flush()
        db.add(m.SfUserLink(user_id=created.id, sf_user_id=sf_user_id, linked_by=user.id))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This Salesforce user or this email already has a login")
    person = await _person_or_404(db, sf_user_id)
    # Logged by hand rather than with @audited, which would store the whole
    # response - including the one-time password - in the audit log.
    await _write_audit_log(
        db, actor_id=user.id, actor_email=user.email, actor_role=user.role, action=AuditAction.CREATE,
        entity_type="SalesLogin", entity_id=sf_user_id, merchant_id=None, before=None,
        after=person.model_dump(mode="json"), changed_fields=[], method=request.method, path=str(request.url.path),
        outcome=AuditOutcome.SUCCESS, status_code=status.HTTP_201_CREATED, error_message=None,
        ip=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"),
    )
    return dto.CreatedLoginDto(person=person, temporaryPassword=password)


@router.put("/people/{sf_user_id}/link", response_model=dto.PersonDto,
            dependencies=[Depends(require_capability("sales.manage"))])
@audited(entity_type="SalesLogin", id_param="sf_user_id", read=_person_audit_read)
async def link_login(
    sf_user_id: str, body: dto.LinkUserDto, request: Request,
    db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user),
):
    """Tie an existing SuperApp login to a Salesforce user (replacing any earlier link of either)."""
    if await db.get(m.SfUser, sf_user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salesforce user not found")
    target = await db.get(User, body.userId)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login not found")
    for existing in (await db.execute(select(m.SfUserLink).where(
            (m.SfUserLink.sf_user_id == sf_user_id) | (m.SfUserLink.user_id == target.id)))).scalars():
        await db.delete(existing)
    await db.flush()
    db.add(m.SfUserLink(user_id=target.id, sf_user_id=sf_user_id, linked_by=user.id))
    await db.commit()
    return await _person_or_404(db, sf_user_id)


@router.delete("/people/{sf_user_id}/link", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_capability("sales.manage"))])
@audited(entity_type="SalesLogin", id_param="sf_user_id", read=_person_audit_read)
async def unlink_login(
    sf_user_id: str, request: Request,
    db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user),
):
    """Remove the link only; the login itself stays (deactivate it under Users)."""
    for existing in (await db.execute(select(m.SfUserLink).where(m.SfUserLink.sf_user_id == sf_user_id))).scalars():
        await db.delete(existing)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- sync ----
@router.get("/sync", response_model=dto.SyncStatusDto, dependencies=[Depends(require_capability("sales.manage"))])
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    return await svc.sync_status(db)


async def _run_dto(result) -> dto.SyncRunDto:
    async with SessionLocal() as db:
        run = await db.get(m.SfSyncRun, result.run_id) if result.run_id else None
    if run is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sync run was not recorded")
    return dto.SyncRunDto(id=run.id, trigger=run.trigger, status=run.status, startedAt=run.started_at,
                          finishedAt=run.finished_at, apiCalls=run.api_calls, upserted=run.upserted,
                          deleted=run.deleted, error=run.error)


@router.post("/sync/run", response_model=dto.SyncRunDto, dependencies=[Depends(require_capability("sales.manage"))])
async def run_sync_now(body: dto.RunSyncDto = dto.RunSyncDto(), user: AuthenticatedUser = Depends(get_current_user)):
    """Start a sync now and wait for it (stops at the time budget; the next run continues)."""
    result = await run_sync(SessionLocal, trigger="full" if body.full else "manual", started_by=user.id, full=body.full)
    return await _run_dto(result)


@router.post("/sync/cron", response_model=dto.SyncRunDto, include_in_schema=False)
async def run_sync_scheduled(x_sync_token: Optional[str] = Header(None, alias="X-Sync-Token")):
    """For the scheduler (Supabase pg_cron + pg_net, or any HTTP cron). Needs SALESFORCE_SYNC_TOKEN."""
    expected = get_settings().SALESFORCE_SYNC_TOKEN
    if not expected:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not x_sync_token or not hmac.compare_digest(x_sync_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    result = await run_sync(SessionLocal, trigger="schedule")
    return await _run_dto(result)
