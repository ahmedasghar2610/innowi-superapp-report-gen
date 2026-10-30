"""Read side of the Sales module: what each screen shows, filtered to what the viewer may see.

Visibility (enforced here, on the server, for every endpoint):
* sales.viewAll (Sales Manager, Admin, Super Admin) - every record; may filter by owner.
* otherwise (Sales Executive) - records whose Salesforce owner is the rep's linked
  Salesforce user, plus the restaurants (accounts) those records belong to and,
  on those restaurants only, the support cases, contacts and check-ins
  (Touchpoints) - whoever in Innowi owns them. That is deliberate: it is
  context about a restaurant the rep already works with (who to call, how
  healthy it is), not another rep's pipeline. Deals and visits stay own-only
  everywhere, including on a restaurant's page. A rep with no linked
  Salesforce user sees nothing until an admin links them.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import Select, and_, false, func, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser
from app.common.pagination import PageMeta
from app.config import get_settings
from app.models import salesforce as m
from app.modules.salesforce import case_insights as ci
from app.models.auth import User
from app.modules.salesforce import stages as st
from app.modules.salesforce.client import is_configured
from app.modules.salesforce.sync import SOURCE_STATE_SEP
from app.schemas import sales as dto

STALE_AFTER = dt.timedelta(days=180)
STUCK_AFTER = dt.timedelta(days=30)
# Visit statuses that mean "nothing left to do".
DONE_VISIT_STATUSES = ("Completed", "Cancelled", "Not Qualified")


# --------------------------------------------------------------- scope ----
@dataclass(frozen=True)
class SalesScope:
    user_id: str
    role: str
    sf_user_id: Optional[str]
    sf_user_name: Optional[str]
    see_all: bool
    can_manage: bool

    def owner(self, requested: Optional[str]) -> Optional[str]:
        """The single Salesforce owner to filter on, or None for "everyone".

        A rep is always pinned to themself (any ownerId they send is ignored);
        a rep with no link gets a sentinel id that matches nothing.
        """
        if self.see_all:
            return requested or None
        return self.sf_user_id or "__unlinked__"

    def owner_clause(self, column, requested: Optional[str] = None):
        owner = self.owner(requested)
        return None if owner is None else column == owner


async def load_scope(db: AsyncSession, user: AuthenticatedUser) -> SalesScope:
    link = await db.get(m.SfUserLink, user.id)
    sf_user = await db.get(m.SfUser, link.sf_user_id) if link else None
    return SalesScope(
        user_id=user.id,
        role=user.role,
        sf_user_id=link.sf_user_id if link else None,
        sf_user_name=sf_user.name if sf_user else None,
        see_all=has_capability(user.role, "sales.viewAll"),
        can_manage=has_capability(user.role, "sales.manage"),
    )


def _where(stmt: Select, *conditions) -> Select:
    for condition in conditions:
        if condition is not None:
            stmt = stmt.where(condition)
    return stmt


def visible_account_ids(scope: SalesScope, owner: Optional[str] = None):
    """A subquery of account ids the viewer may see, or None for "all accounts"."""
    target = scope.owner(owner)
    if target is None:
        return None
    return union(
        select(m.SfAccount.id).where(m.SfAccount.owner_id == target),
        select(m.SfOpportunity.account_id).where(m.SfOpportunity.owner_id == target),
        select(m.SfVisit.account_id).where(m.SfVisit.owner_id == target),
        select(m.SfTouchpoint.account_id).where(m.SfTouchpoint.owner_id == target),
    ).subquery()


def _account_condition(column, scope: SalesScope, owner: Optional[str] = None):
    ids = visible_account_ids(scope, owner)
    return None if ids is None else column.in_(select(ids.c[0]))


def sales_today() -> dt.date:
    return dt.datetime.now(ZoneInfo(get_settings().SALES_TIMEZONE)).date()


def salesforce_web_url() -> Optional[str]:
    """Lightning base URL (https://innowi33.lightning.force.com) from the My Domain login URL."""
    login = get_settings().SALESFORCE_LOGIN_URL
    if not login:
        return None
    host = login.rstrip("/").split("://", 1)[-1]
    if host.endswith(".my.salesforce.com"):
        return f"https://{host[: -len('.my.salesforce.com')]}.lightning.force.com"
    return None


async def last_sync_at(db: AsyncSession) -> Optional[dt.datetime]:
    return (await db.execute(
        select(func.max(m.SfSyncRun.finished_at)).where(m.SfSyncRun.status.in_(("success", "partial")))
    )).scalar_one_or_none()


async def me(db: AsyncSession, scope: SalesScope) -> dto.SalesMeDto:
    return dto.SalesMeDto(
        configured=is_configured(),
        linked=scope.sf_user_id is not None,
        sfUserId=scope.sf_user_id,
        sfUserName=scope.sf_user_name,
        seeAll=scope.see_all,
        canManage=scope.can_manage,
        lastSyncAt=await last_sync_at(db),
        # Reps sign in to Salesforce through the partner portal, where these
        # internal Lightning links don't open, so only staff get them.
        salesforceUrl=salesforce_web_url() if scope.see_all else None,
    )


# --------------------------------------------------------------- deals ----
async def _stage_map(db: AsyncSession) -> dict[str, m.SfOpportunityStage]:
    return {s.label: s for s in (await db.execute(select(m.SfOpportunityStage))).scalars()}


def _age(now: dt.datetime, changed: Optional[dt.datetime]) -> Optional[int]:
    return None if changed is None else max(0, (now - changed).days)


def _deal(row, stages: dict[str, m.SfOpportunityStage], now: dt.datetime) -> dto.DealDto:
    deal: m.SfOpportunity = row.SfOpportunity
    column = st.column_for_deal(stages.get(deal.stage_name), deal.stage_name,
                                is_closed=deal.is_closed, is_won=deal.is_won)
    changed = deal.sf_last_modified_at
    is_open = not deal.is_closed
    stale = is_open and changed is not None and now - changed > STALE_AFTER
    return dto.DealDto(
        id=deal.id, name=deal.name, accountId=deal.account_id, accountName=row.account_name,
        ownerId=deal.owner_id, ownerName=row.owner_name, stageName=deal.stage_name,
        columnKey=column.key, columnLabel=column.label, isOpen=is_open, isWon=deal.is_won,
        amount=deal.amount, closeDate=deal.close_date, recordTypeName=deal.record_type_name,
        createdAt=deal.sf_created_at, lastModifiedAt=changed, daysSinceChange=_age(now, changed),
        isStale=stale, isStuck=is_open and not stale and changed is not None and now - changed > STUCK_AFTER,
    )


def _deal_select() -> Select:
    return (
        select(m.SfOpportunity, m.SfAccount.name.label("account_name"), m.SfUser.name.label("owner_name"))
        .outerjoin(m.SfAccount, m.SfAccount.id == m.SfOpportunity.account_id)
        .outerjoin(m.SfUser, m.SfUser.id == m.SfOpportunity.owner_id)
    )


def _stale_cutoff(now: dt.datetime) -> dt.datetime:
    return now - STALE_AFTER


def _not_stale(now: dt.datetime):
    """Closed deals, plus open deals changed within the last 6 months."""
    return or_(m.SfOpportunity.is_closed.is_(True), m.SfOpportunity.sf_last_modified_at >= _stale_cutoff(now))


async def _column_condition(db: AsyncSession, key: str, stages: dict[str, m.SfOpportunityStage]):
    """SQL for "deals drawn in column `key`" - by stage, or by the deal's own flags for unknown stages."""
    names = [n for n in (await db.execute(select(m.SfOpportunity.stage_name).distinct())).scalars()]
    known = [n for n in names if n in stages and st.column_for(stages[n], n).key == key]
    unknown = [n for n in names if n not in stages]
    conditions = []
    if known:
        conditions.append(m.SfOpportunity.stage_name.in_(known))
    if unknown:
        opp = m.SfOpportunity
        if key == st.WON:
            conditions.append(and_(opp.stage_name.in_(unknown), opp.is_closed.is_(True), opp.is_won.is_(True)))
        elif key == st.LOST:
            conditions.append(and_(opp.stage_name.in_(unknown), opp.is_closed.is_(True), opp.is_won.is_(False)))
        else:
            matching = [n for n in unknown if st.column_for(None, n).key == key]
            if matching:
                conditions.append(and_(opp.stage_name.in_(matching), opp.is_closed.is_(False)))
    return or_(*conditions) if conditions else false()


async def list_deals(
    db: AsyncSession, scope: SalesScope, *, page: int, limit: int, owner: Optional[str], search: Optional[str],
    column: Optional[str], state: str, include_stale: bool, quiet: Optional[str] = None,
) -> dto.PaginatedDealsDto:
    now = dt.datetime.now(dt.timezone.utc)
    stages = await _stage_map(db)
    opp = m.SfOpportunity
    conditions = [scope.owner_clause(opp.owner_id, owner)]
    # "quiet" matches the My Day counts exactly (open deals only).
    if quiet == "stuck":
        conditions += [opp.is_closed.is_(False), opp.sf_last_modified_at >= _stale_cutoff(now),
                       opp.sf_last_modified_at < now - STUCK_AFTER]
    elif quiet == "stale":
        conditions += [opp.is_closed.is_(False), opp.sf_last_modified_at < _stale_cutoff(now)]
        include_stale = True
    if state == "open":
        conditions.append(opp.is_closed.is_(False))
    elif state == "closed":
        conditions.append(opp.is_closed.is_(True))
    if not include_stale:
        conditions.append(_not_stale(now))
    if column:
        conditions.append(await _column_condition(db, column, stages))
    if search:
        like = f"%{search.strip()}%"
        conditions.append(or_(opp.name.ilike(like), m.SfAccount.name.ilike(like)))
    base = _where(_deal_select(), *conditions)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(
        base.order_by(opp.sf_last_modified_at.desc().nullslast(), opp.id).offset((page - 1) * limit).limit(limit)
    )).all()
    return dto.PaginatedDealsDto(data=[_deal(r, stages, now) for r in rows], meta=PageMeta.build(page, limit, total))


async def pipeline(
    db: AsyncSession, scope: SalesScope, *, owner: Optional[str], include_stale: bool, closed_within_days: int,
    per_column: int,
) -> dto.PipelineDto:
    now = dt.datetime.now(dt.timezone.utc)
    stages = await _stage_map(db)
    opp = m.SfOpportunity
    closed_cutoff = now - dt.timedelta(days=closed_within_days)
    rows = (await db.execute(_where(
        _deal_select(),
        scope.owner_clause(opp.owner_id, owner),
        # Closed columns only show recent outcomes, or "Won" would hold four years of deals.
        # "Recent" goes by close date (falling back to the last change when it's blank),
        # so an old win that was merely edited yesterday doesn't reappear.
        or_(opp.is_closed.is_(False),
            func.coalesce(opp.close_date, func.date(opp.sf_last_modified_at)) >= closed_cutoff.date()),
    ).order_by(opp.sf_last_modified_at.desc().nullslast()))).all()

    deals = [_deal(r, stages, now) for r in rows]
    stale_hidden = sum(1 for d in deals if d.isStale)
    if not include_stale:
        deals = [d for d in deals if not d.isStale]

    # Every active stage gets a column even when empty, so the board keeps its shape.
    columns = {c.key: c for c in st.ordered_columns(
        [st.column_for(s, s.label) for s in stages.values() if s.is_active and not s.is_closed]
        + [st.column_for_deal(stages.get(d.stageName), d.stageName, is_closed=not d.isOpen, is_won=d.isWon)
           for d in deals]
    )}
    out: list[dto.PipelineColumnDto] = []
    for column in st.ordered_columns(columns.values()):
        in_column = [d for d in deals if d.columnKey == column.key]
        out.append(dto.PipelineColumnDto(
            key=column.key, label=column.label, isOpen=column.is_open, isWon=column.is_won, count=len(in_column),
            amount=sum((d.amount or Decimal(0) for d in in_column), Decimal(0)), deals=in_column[:per_column],
        ))
    open_deals = [d for d in deals if d.isOpen]
    return dto.PipelineDto(
        columns=out, openCount=len(open_deals),
        openAmount=sum((d.amount or Decimal(0) for d in open_deals), Decimal(0)), staleHidden=stale_hidden,
    )


async def get_deal(db: AsyncSession, scope: SalesScope, deal_id: str) -> dto.DealDetailDto:
    now = dt.datetime.now(dt.timezone.utc)
    stages = await _stage_map(db)
    row = (await db.execute(_where(
        _deal_select(), m.SfOpportunity.id == deal_id, scope.owner_clause(m.SfOpportunity.owner_id)
    ))).first()
    if row is None:
        # Same answer for "doesn't exist" and "not yours", so ids can't be probed.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found")
    base = _deal(row, stages, now)
    customer = None
    if row.SfOpportunity.account_id:
        try:
            customer = await get_customer(db, scope, row.SfOpportunity.account_id)
        except HTTPException as exc:
            # The restaurant isn't in the copy (yet) - still show the deal itself.
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise
    return dto.DealDetailDto(**base.model_dump(), probability=row.SfOpportunity.probability,
                             leadSource=row.SfOpportunity.lead_source, customer=customer)


# -------------------------------------------------------------- visits ----
def _visit(row, today: dt.date) -> dto.VisitDto:
    v: m.SfVisit = row.SfVisit
    end = v.due_date_end or v.due_date_start
    open_ = (v.status or "") not in DONE_VISIT_STATUSES
    return dto.VisitDto(
        id=v.id, name=v.name, accountId=v.account_id, accountName=row.account_name or v.account_name,
        ownerId=v.owner_id, ownerName=row.owner_name, visitType=v.visit_type, status=v.status, address=v.address,
        dueDateStart=v.due_date_start, dueDateEnd=v.due_date_end, appointmentTime=v.appointment_time,
        completedDate=v.completed_date, isOverdue=bool(open_ and end and end < today),
    )


def _visit_select() -> Select:
    return (
        select(m.SfVisit, m.SfAccount.name.label("account_name"), m.SfUser.name.label("owner_name"))
        .outerjoin(m.SfAccount, m.SfAccount.id == m.SfVisit.account_id)
        .outerjoin(m.SfUser, m.SfUser.id == m.SfVisit.owner_id)
    )


def _visit_open():
    return or_(m.SfVisit.status.is_(None), m.SfVisit.status.not_in(DONE_VISIT_STATUSES))


def _visit_when(when: str, today: dt.date):
    v = m.SfVisit
    end = func.coalesce(v.due_date_end, v.due_date_start)
    if when == "today":
        return and_(v.due_date_start <= today, end >= today)
    if when == "overdue":
        return end < today
    if when == "week":
        return and_(v.due_date_start <= today + dt.timedelta(days=7), end >= today)
    if when == "next7":
        # Exactly the My Day "next 7 days" count: starting after today, within a week.
        return and_(v.due_date_start > today, v.due_date_start <= today + dt.timedelta(days=7))
    if when == "upcoming":
        return v.due_date_start > today
    return None


async def list_visits(
    db: AsyncSession, scope: SalesScope, *, page: int, limit: int, owner: Optional[str], state: str,
    when: str, visit_type: Optional[str], search: Optional[str],
) -> dto.PaginatedVisitsDto:
    today = sales_today()
    v = m.SfVisit
    conditions = [scope.owner_clause(v.owner_id, owner), _visit_when(when, today)]
    if state == "open":
        conditions.append(_visit_open())
    elif state == "done":
        conditions.append(v.status.in_(DONE_VISIT_STATUSES))
    if visit_type:
        conditions.append(v.visit_type == visit_type)
    if search:
        like = f"%{search.strip()}%"
        conditions.append(or_(v.account_name.ilike(like), m.SfAccount.name.ilike(like), v.name.ilike(like)))
    base = _where(_visit_select(), *conditions)
    order = (v.due_date_start.asc().nullslast(),) if state == "open" else (v.due_date_start.desc().nullslast(),)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(base.order_by(*order, v.id).offset((page - 1) * limit).limit(limit))).all()
    return dto.PaginatedVisitsDto(data=[_visit(r, today) for r in rows], meta=PageMeta.build(page, limit, total))


async def visit_types(db: AsyncSession, scope: SalesScope) -> list[str]:
    """Visit types on the visits this person can see (a rep: their own)."""
    v = m.SfVisit
    return [t for t in (await db.execute(_where(
        select(v.visit_type).distinct(), v.visit_type.is_not(None), scope.owner_clause(v.owner_id),
    ).order_by(v.visit_type))).scalars()]


# --------------------------------------------------------------- cases ----
def _case(row) -> dto.CaseDto:
    c: m.SfCase = row.SfCase
    return dto.CaseDto(
        id=c.id, caseNumber=c.case_number, subject=c.subject, status=c.status, origin=c.origin,
        priority=c.priority, accountId=c.account_id, accountName=row.account_name,
        ownerName=row.owner_name or ("Support queue" if (c.owner_id or "").startswith("00G") else None),
        isClosed=c.is_closed, createdAt=c.sf_created_at, closedAt=c.sf_closed_at,
        issueCategory=c.issue_category, department=row.department, departmentSource=row.department_source,
        details=c.details, resolutionType=c.resolution_type,
    )


def _case_select() -> Select:
    return (
        select(m.SfCase, m.SfAccount.name.label("account_name"), m.SfUser.name.label("owner_name"),
               ci.department_expr().label("department"), ci.source_expr().label("department_source"))
        .outerjoin(m.SfAccount, m.SfAccount.id == m.SfCase.account_id)
        .outerjoin(m.SfUser, m.SfUser.id == m.SfCase.owner_id)
    )


async def list_cases(
    db: AsyncSession, scope: SalesScope, *, page: int, limit: int, owner: Optional[str], state: str,
    search: Optional[str], filters: Optional[ci.CaseFilters] = None,
) -> dto.PaginatedCasesDto:
    """The case list. `filters` are the insights screen's (department, category ...) so a click on
    a chart lists exactly the cases it counted."""
    c = m.SfCase
    f = filters or ci.CaseFilters()
    f.state, f.search = state, search
    conditions = [_account_condition(c.account_id, scope, owner),
                  *ci.conditions(f, get_settings().SALES_TIMEZONE)]
    base = _where(_case_select(), *conditions)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(
        base.order_by(c.sf_created_at.desc().nullslast(), c.id).offset((page - 1) * limit).limit(limit))).all()
    return dto.PaginatedCasesDto(data=[_case(r) for r in rows], meta=PageMeta.build(page, limit, total))


async def case_insights(db: AsyncSession, scope: SalesScope, *, owner: Optional[str], filters: ci.CaseFilters) -> dict:
    """Breakdowns of the cases this person can see (the same visibility as the case list)."""
    tz = get_settings().SALES_TIMEZONE
    base = ci.base_select(tz)
    visible = _account_condition(m.SfCase.account_id, scope, owner)
    return await ci.insights(db, base, [visible, *ci.conditions(filters, tz)])


# ----------------------------------------------------------- customers ----
def _latest_touchpoint(column):
    tp = m.SfTouchpoint
    return (
        select(column).where(tp.account_id == m.SfAccount.id)
        .order_by(tp.latest_touchpoint_date.desc().nullslast(), tp.sf_system_modstamp.desc().nullslast())
        .limit(1).scalar_subquery()
    )


def _count_where(model, *conditions):
    return select(func.count()).select_from(model).where(model.account_id == m.SfAccount.id, *conditions) \
        .scalar_subquery()


@dataclass(frozen=True)
class _CustomerColumns:
    health: object
    last_touchpoint: object
    open_deals: object
    won_deals: object
    open_cases: object


def _customer_columns(scope: SalesScope, owner: Optional[str] = None) -> _CustomerColumns:
    opp = m.SfOpportunity
    own = scope.owner(owner)
    deal_owner = [] if own is None else [opp.owner_id == own]
    return _CustomerColumns(
        health=_latest_touchpoint(m.SfTouchpoint.health_status),
        last_touchpoint=_latest_touchpoint(m.SfTouchpoint.latest_touchpoint_date),
        open_deals=_count_where(opp, opp.is_closed.is_(False), *deal_owner),
        won_deals=_count_where(opp, opp.is_won.is_(True), *deal_owner),
        open_cases=_count_where(m.SfCase, m.SfCase.is_closed.is_(False)),
    )


def _customer_select(scope: SalesScope, owner: Optional[str] = None,
                     cols: Optional[_CustomerColumns] = None) -> Select:
    cols = cols or _customer_columns(scope, owner)
    return _where(
        select(
            m.SfAccount,
            m.SfUser.name.label("owner_name"),
            cols.health.label("health"),
            cols.last_touchpoint.label("last_touchpoint"),
            cols.open_deals.label("open_deals"),
            cols.won_deals.label("won_deals"),
            cols.open_cases.label("open_cases"),
        ).outerjoin(m.SfUser, m.SfUser.id == m.SfAccount.owner_id),
        _account_condition(m.SfAccount.id, scope, owner),
    )


def _customer(row) -> dto.CustomerDto:
    a: m.SfAccount = row.SfAccount
    return dto.CustomerDto(
        id=a.id, name=a.name, city=a.billing_city, state=a.billing_state, phone=a.phone, ownerName=row.owner_name,
        health=row.health, lastTouchpointDate=row.last_touchpoint, openDeals=row.open_deals,
        wonDeals=row.won_deals, openCases=row.open_cases,
    )


async def list_customers(
    db: AsyncSession, scope: SalesScope, *, page: int, limit: int, owner: Optional[str], search: Optional[str],
    health: Optional[str], only_customers: bool,
) -> dto.PaginatedCustomersDto:
    cols = _customer_columns(scope, owner)
    base = _customer_select(scope, owner, cols)
    if search:
        base = base.where(m.SfAccount.name.ilike(f"%{search.strip()}%"))
    if health:
        base = base.where(cols.health == health)
    if only_customers:
        base = base.where(cols.won_deals > 0)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(
        base.order_by(m.SfAccount.name, m.SfAccount.id).offset((page - 1) * limit).limit(limit)
    )).all()
    return dto.PaginatedCustomersDto(data=[_customer(r) for r in rows], meta=PageMeta.build(page, limit, total))


async def get_customer(db: AsyncSession, scope: SalesScope, account_id: str) -> dto.CustomerDetailDto:
    row = (await db.execute(_customer_select(scope).where(m.SfAccount.id == account_id))).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    now = dt.datetime.now(dt.timezone.utc)
    today = sales_today()
    stages = await _stage_map(db)
    a: m.SfAccount = row.SfAccount
    deals = (await db.execute(_where(
        _deal_select(), m.SfOpportunity.account_id == a.id, scope.owner_clause(m.SfOpportunity.owner_id)
    ).order_by(m.SfOpportunity.sf_last_modified_at.desc().nullslast()))).all()
    visits = (await db.execute(_where(
        _visit_select(), m.SfVisit.account_id == a.id, scope.owner_clause(m.SfVisit.owner_id)
    ).order_by(m.SfVisit.due_date_start.desc().nullslast()).limit(50))).all()
    cases = (await db.execute(
        _case_select().where(m.SfCase.account_id == a.id).order_by(m.SfCase.sf_created_at.desc().nullslast())
        .limit(50))).all()
    contacts = (await db.execute(
        select(m.SfContact).where(m.SfContact.account_id == a.id).order_by(m.SfContact.name))).scalars().all()
    touchpoints = (await db.execute(
        select(m.SfTouchpoint, m.SfUser.name.label("owner_name"))
        .outerjoin(m.SfUser, m.SfUser.id == m.SfTouchpoint.owner_id)
        .where(m.SfTouchpoint.account_id == a.id)
        .order_by(m.SfTouchpoint.latest_touchpoint_date.desc().nullslast()).limit(20))).all()
    return dto.CustomerDetailDto(
        **_customer(row).model_dump(), website=a.website, street=a.billing_street, postalCode=a.billing_postal_code,
        contacts=[dto.ContactDto(id=c.id, name=c.name, title=c.title, email=c.email, phone=c.phone,
                                 mobilePhone=c.mobile_phone) for c in contacts],
        deals=[_deal(r, stages, now) for r in deals],
        visits=[_visit(r, today) for r in visits],
        cases=[_case(r) for r in cases],
        touchpoints=[dto.TouchpointDto(id=t.SfTouchpoint.id, healthStatus=t.SfTouchpoint.health_status,
                                       latestStatus=t.SfTouchpoint.latest_status,
                                       latestTouchpointDate=t.SfTouchpoint.latest_touchpoint_date,
                                       ownerName=t.owner_name) for t in touchpoints],
    )


# ------------------------------------------------------------- summary ----
async def summary(db: AsyncSession, scope: SalesScope, *, owner: Optional[str]) -> dto.SummaryDto:
    now = dt.datetime.now(dt.timezone.utc)
    today = sales_today()
    stages = await _stage_map(db)
    opp, v, c = m.SfOpportunity, m.SfVisit, m.SfCase
    own_deal = scope.owner_clause(opp.owner_id, owner)
    own_visit = scope.owner_clause(v.owner_id, owner)
    case_scope = _account_condition(c.account_id, scope, owner)
    stale_cutoff, stuck_cutoff = now - STALE_AFTER, now - STUCK_AFTER

    async def count(model, *conditions) -> int:
        return (await db.execute(_where(select(func.count()).select_from(model), *conditions))).scalar_one()

    open_deal = opp.is_closed.is_(False)
    counts = dto.SummaryCountsDto(
        openDeals=await count(opp, own_deal, open_deal, opp.sf_last_modified_at >= stale_cutoff),
        stuckDeals=await count(opp, own_deal, open_deal, opp.sf_last_modified_at >= stale_cutoff,
                               opp.sf_last_modified_at < stuck_cutoff),
        staleDeals=await count(opp, own_deal, open_deal, opp.sf_last_modified_at < stale_cutoff),
        visitsDueToday=await count(v, own_visit, _visit_open(), _visit_when("today", today)),
        visitsOverdue=await count(v, own_visit, _visit_open(), _visit_when("overdue", today)),
        visitsNext7Days=await count(v, own_visit, _visit_open(), _visit_when("next7", today)),
        openCases=await count(c, case_scope, c.is_closed.is_(False)),
    )
    stuck_rows = (await db.execute(_where(
        _deal_select(), own_deal, open_deal, opp.sf_last_modified_at >= stale_cutoff,
        opp.sf_last_modified_at < stuck_cutoff,
    ).order_by(opp.sf_last_modified_at.asc()).limit(10))).all()
    visit_rows = (await db.execute(_where(
        _visit_select(), own_visit, _visit_open(), v.due_date_start <= today + dt.timedelta(days=7),
        func.coalesce(v.due_date_end, v.due_date_start) >= today - dt.timedelta(days=30),
    ).order_by(v.due_date_start.asc().nullslast()).limit(20))).all()
    case_rows = (await db.execute(_where(_case_select(), case_scope, c.is_closed.is_(False))
                                  .order_by(c.sf_created_at.desc().nullslast()).limit(10))).all()
    return dto.SummaryDto(
        today=today, counts=counts, stuckDeals=[_deal(r, stages, now) for r in stuck_rows],
        visitsDue=[_visit(r, today) for r in visit_rows], openCases=[_case(r) for r in case_rows],
        lastSyncAt=await last_sync_at(db),
    )


# ---------------------------------------------------------------- team ----
async def owners(db: AsyncSession) -> list[dto.OwnerDto]:
    ids = union(select(m.SfOpportunity.owner_id), select(m.SfVisit.owner_id)).subquery()
    rows = (await db.execute(
        select(m.SfUser.id, m.SfUser.name).where(m.SfUser.id.in_(select(ids.c[0]))).order_by(m.SfUser.name)
    )).all()
    return [dto.OwnerDto(id=r.id, name=r.name) for r in rows]


async def _grouped(db: AsyncSession, column, *conditions) -> dict[str, int]:
    stmt = _where(select(column, func.count()).group_by(column), *conditions)
    return {k: n for k, n in (await db.execute(stmt)).all() if k}


async def team(db: AsyncSession) -> list[dto.TeamMemberDto]:
    now = dt.datetime.now(dt.timezone.utc)
    opp, v, c = m.SfOpportunity, m.SfVisit, m.SfCase
    stale_cutoff = now - STALE_AFTER
    month_ago = now - dt.timedelta(days=30)
    open_deals = await _grouped(db, opp.owner_id, opp.is_closed.is_(False), opp.sf_last_modified_at >= stale_cutoff)
    stale = await _grouped(db, opp.owner_id, opp.is_closed.is_(False), opp.sf_last_modified_at < stale_cutoff)
    created = await _grouped(db, opp.owner_id, opp.sf_created_at >= month_ago)
    won = await _grouped(db, opp.owner_id, opp.is_won.is_(True))
    pending = await _grouped(db, v.owner_id, _visit_open())
    completed = await _grouped(db, v.owner_id, v.completed_date >= month_ago.date())
    cases = await _grouped(db, c.owner_id, c.is_closed.is_(False))
    ids = set(open_deals) | set(stale) | set(created) | set(won) | set(pending) | set(completed) | set(cases)
    if not ids:
        return []
    users = (await db.execute(
        select(m.SfUser, User.email.label("superapp_email"))
        .outerjoin(m.SfUserLink, m.SfUserLink.sf_user_id == m.SfUser.id)
        .outerjoin(User, User.id == m.SfUserLink.user_id)
        .where(m.SfUser.id.in_(ids)).order_by(m.SfUser.name)
    )).all()
    return [
        dto.TeamMemberDto(
            sfUserId=u.SfUser.id, name=u.SfUser.name, email=u.SfUser.email, isActive=u.SfUser.is_active,
            lastSalesforceLogin=u.SfUser.last_login_at, openDeals=open_deals.get(u.SfUser.id, 0),
            staleDeals=stale.get(u.SfUser.id, 0), dealsCreated30d=created.get(u.SfUser.id, 0),
            wonDeals=won.get(u.SfUser.id, 0), visitsPending=pending.get(u.SfUser.id, 0),
            visitsCompleted30d=completed.get(u.SfUser.id, 0), openCases=cases.get(u.SfUser.id, 0),
            superappUserEmail=u.superapp_email,
        )
        for u in users
    ]


# -------------------------------------------------------------- people ----
def _linked(user: Optional[User]) -> Optional[dto.LinkedUserDto]:
    if user is None:
        return None
    return dto.LinkedUserDto(id=user.id, email=user.email, role=user.role, status=user.status)


async def people(db: AsyncSession, sf_user_ids: Optional[Iterable[str]] = None) -> list[dto.PersonDto]:
    deals = await _grouped(db, m.SfOpportunity.owner_id)
    visits = await _grouped(db, m.SfVisit.owner_id)
    stmt = select(m.SfUser).order_by(m.SfUser.is_active.desc(), m.SfUser.name)
    if sf_user_ids is not None:
        stmt = stmt.where(m.SfUser.id.in_(list(sf_user_ids)))
    sf_users = (await db.execute(stmt)).scalars().all()
    links = {l.sf_user_id: l.user_id for l in (await db.execute(select(m.SfUserLink))).scalars()}
    linked_user_ids = set(links.values())
    users = {u.id: u for u in (await db.execute(select(User))).scalars()}
    by_email = {u.email.lower(): u for u in users.values()}
    out = []
    for s in sf_users:
        linked = users.get(links.get(s.id, ""))
        suggested = None
        if linked is None and s.email:
            match = by_email.get(s.email.lower())
            if match is not None and match.id not in linked_user_ids:
                suggested = match
        out.append(dto.PersonDto(
            sfUserId=s.id, name=s.name, email=s.email, profileName=s.profile_name, isActive=s.is_active,
            lastSalesforceLogin=s.last_login_at, ownsDeals=deals.get(s.id, 0), ownsVisits=visits.get(s.id, 0),
            linkedUser=_linked(linked), suggestedUser=_linked(suggested),
        ))
    return out


# ---------------------------------------------------------------- sync ----
async def sync_status(db: AsyncSession) -> dto.SyncStatusDto:
    day_ago = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    # Per-source position rows ("Account|Opportunity") are sync bookkeeping, not objects.
    states = (await db.execute(
        select(m.SfSyncState).where(~m.SfSyncState.object_name.contains(SOURCE_STATE_SEP))
        .order_by(m.SfSyncState.object_name)
    )).scalars().all()
    runs = (await db.execute(select(m.SfSyncRun).order_by(m.SfSyncRun.started_at.desc()).limit(20))).scalars().all()
    calls = (await db.execute(
        select(func.coalesce(func.sum(m.SfSyncRun.api_calls), 0)).where(m.SfSyncRun.started_at >= day_ago)
    )).scalar_one()
    return dto.SyncStatusDto(
        configured=is_configured(), lastSuccessAt=await last_sync_at(db), apiCallsLast24h=int(calls),
        objects=[dto.SyncObjectDto(objectName=s.object_name, recordCount=s.record_count,
                                   lastSuccessAt=s.last_success_at, lastModstamp=s.last_modstamp,
                                   lastError=s.last_error) for s in states],
        runs=[dto.SyncRunDto(id=r.id, trigger=r.trigger, status=r.status, startedAt=r.started_at,
                             finishedAt=r.finished_at, apiCalls=r.api_calls, upserted=r.upserted,
                             deleted=r.deleted, error=r.error) for r in runs],
    )


# ------------------------------------------------------------ insights ----
NO_CHECKIN = "No check-in"
LEADERBOARD_SIZE = 8


def _month_keys(today: dt.date, months: int = 12) -> list[str]:
    """["2025-11", ..., "2026-10"]: the last `months` calendar months, ending with today's."""
    y, mth = today.year, today.month
    keys = []
    for _ in range(months):
        keys.append(f"{y:04d}-{mth:02d}")
        mth -= 1
        if mth == 0:
            y, mth = y - 1, 12
    return list(reversed(keys))


async def insights(db: AsyncSession, scope: SalesScope, *, owner: Optional[str]) -> dto.InsightsDto:
    now = dt.datetime.now(dt.timezone.utc)
    today = sales_today()
    tz = ZoneInfo(get_settings().SALES_TIMEZONE)
    stages = await _stage_map(db)
    opp = m.SfOpportunity
    months = _month_keys(today)
    window_start = dt.date(int(months[0][:4]), int(months[0][5:]), 1)
    stale_cutoff = now - STALE_AFTER
    ninety_days_ago = today - dt.timedelta(days=90)

    rows = (await db.execute(_where(
        select(opp.owner_id, opp.stage_name, opp.is_closed, opp.is_won, opp.amount, opp.close_date,
               opp.sf_created_at, opp.sf_last_modified_at, m.SfUser.name.label("owner_name"))
        .outerjoin(m.SfUser, m.SfUser.id == opp.owner_id),
        scope.owner_clause(opp.owner_id, owner),
    ))).all()

    zero = Decimal(0)
    won_by: dict[str, list] = {k: [0, zero] for k in months}
    new_by: dict[str, list] = {k: [0, zero] for k in months}
    by_column: dict[str, list] = {}
    columns: dict[str, st.Column] = {}
    open_count, open_amount, no_amount = 0, zero, 0
    won12, won12_amount, lost12 = 0, zero, 0
    leaders: dict[str, dict] = {}

    for r in rows:
        amount = r.amount or zero
        column = st.column_for_deal(stages.get(r.stage_name), r.stage_name, is_closed=r.is_closed, is_won=r.is_won)
        if r.sf_created_at is not None:
            key = r.sf_created_at.astimezone(tz).strftime("%Y-%m")
            if key in new_by:
                new_by[key][0] += 1
                new_by[key][1] += amount
        if r.is_won and r.close_date is not None and r.close_date >= window_start:
            key = r.close_date.strftime("%Y-%m")
            if key in won_by:
                won_by[key][0] += 1
                won_by[key][1] += amount
                won12 += 1
                won12_amount += amount
        if r.is_closed and not r.is_won and column.key == st.LOST and r.close_date is not None \
                and window_start <= r.close_date <= today:
            lost12 += 1
        stale = not r.is_closed and r.sf_last_modified_at is not None and r.sf_last_modified_at < stale_cutoff
        if not r.is_closed and not stale:
            open_count += 1
            open_amount += amount
            no_amount += r.amount is None
            columns[column.key] = column
            bucket = by_column.setdefault(column.key, [0, zero])
            bucket[0] += 1
            bucket[1] += amount
        if r.owner_id:
            lead = leaders.setdefault(r.owner_id, {"name": r.owner_name or "Unknown", "won": 0, "amount": zero,
                                                   "open": 0})
            if not r.is_closed and not stale:
                lead["open"] += 1
            if r.is_won and r.close_date is not None and ninety_days_ago <= r.close_date <= today:
                lead["won"] += 1
                lead["amount"] += amount

    # Active open stages always show (empty ones too) so the bar chart keeps Salesforce's order.
    for s in stages.values():
        if s.is_active and not s.is_closed:
            c = st.column_for(s, s.label)
            columns.setdefault(c.key, c)
    pipeline_bars = [
        dto.StageBarDto(key=c.key, label=c.label, count=by_column.get(c.key, [0, zero])[0],
                        amount=by_column.get(c.key, [0, zero])[1])
        for c in st.ordered_columns(columns.values()) if c.is_open
    ]

    health_rows = (await db.execute(_where(
        # select_from: without an owner filter nothing else names the account table.
        select(_latest_touchpoint(m.SfTouchpoint.health_status).label("health")).select_from(m.SfAccount),
        _account_condition(m.SfAccount.id, scope, owner),
    ))).scalars().all()
    health_counts: dict[str, int] = {}
    for h in health_rows:
        label = (h or "").strip() or NO_CHECKIN
        health_counts[label] = health_counts.get(label, 0) + 1
    order = ["Green", "Yellow", "Orange", "Red", "Newly Deployed", "Not Live", "N/A", NO_CHECKIN]
    health = sorted(
        (dto.HealthSliceDto(status=k, count=v) for k, v in health_counts.items()),
        key=lambda s: (order.index(s.status) if s.status in order else len(order) - 1, s.status),
    )

    leaderboard: list[dto.LeaderDto] = []
    if scope.see_all and not owner:
        ranked = sorted(leaders.items(), key=lambda kv: (-kv[1]["won"], -kv[1]["amount"], -kv[1]["open"], kv[1]["name"]))
        leaderboard = [
            dto.LeaderDto(ownerId=k, name=v["name"], wonCount=v["won"], wonAmount=v["amount"], openDeals=v["open"])
            for k, v in ranked if v["won"] or v["open"]
        ][:LEADERBOARD_SIZE]

    this_month = months[-1]
    decided = won12 + lost12
    return dto.InsightsDto(
        today=today,
        totals=dto.InsightTotalsDto(
            openDeals=open_count, openAmount=open_amount,
            wonThisMonth=won_by[this_month][0], wonThisMonthAmount=won_by[this_month][1],
            wonLast12Months=won12, wonLast12MonthsAmount=won12_amount, lostLast12Months=lost12,
            winRate=(won12 / decided) if decided else None, dealsWithoutAmount=no_amount,
        ),
        wonByMonth=[dto.MonthPointDto(month=k, count=v[0], amount=v[1]) for k, v in won_by.items()],
        newByMonth=[dto.MonthPointDto(month=k, count=v[0], amount=v[1]) for k, v in new_by.items()],
        pipelineByStage=pipeline_bars,
        health=health,
        leaderboard=leaderboard,
    )
