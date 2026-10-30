"""The spine: organizations and deals.

* ``organizations.view`` / ``deals.view``     — everyone.
* ``organizations.manage`` / ``deals.manage`` — admin, sales manager, sales
  executive, marketing manager.

A deal always has a merchant. Creating one for a restaurant that is not a
merchant yet creates the merchant too (status PROSPECT); from then on the
merchant's status follows the deal's stage (see ``service``).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.models import quotes as qm
from app.models.auth import User
from app.models.deals import STAGE_ORDER, Deal, DealEvent, Organization, OrganizationContact, OrganizationEvent
from app.models.enums import DealEventKind, DealStage, NotificationKind, OrganizationKind, UserStatus
from app.models.ops import Notification
from app.models.profiling import Merchant
from app.models.sources import NOT_RECORDED
from app.modules.deals import partners
from app.modules.deals import service as svc
from app.modules.partner_contacts import service as card_service
from app.modules.partner_leads import service as lead_service
from app.schemas.deals import (
    AddAgentsDto,
    AddAgentsResultDto,
    AssignDto,
    AssignPersonResultDto,
    AssignResultDto,
    LinkOrganizationDto,
    OrganizationEventDto,
    OrganizationLinksDto,
    CreateDealDto,
    CreateOrganizationDto,
    DealBoardDto,
    DealDetailDto,
    DealEventDto,
    DealListDto,
    DealNoteDto,
    DealQueryDto,
    DealQuoteDto,
    DealRowDto,
    LinkQuoteDto,
    MerchantPickDto,
    OrganizationContactDto,
    OrganizationContactIn,
    OrganizationDetailDto,
    OrganizationDto,
    OrganizationListDto,
    OrganizationQueryDto,
    OrgRefDto,
    StageColumnDto,
    UpdateDealDto,
    UpdateOrganizationDto,
)
from app.schemas.ops import PersonRefDto

organizations_router = APIRouter(prefix="/organizations", tags=["Organizations"])
deals_router = APIRouter(prefix="/deals", tags=["Deals"])

_org_view = Depends(require_capability("organizations.view"))
_org_manage = Depends(require_capability("organizations.manage"))
_deal_view = Depends(require_capability("deals.view"))
_deal_manage = Depends(require_capability("deals.manage"))

_DEAL_LOAD = (
    selectinload(Deal.merchant),
    selectinload(Deal.organization),
    selectinload(Deal.contractor_organization),
)


# ============================================================== helpers =====
def _person_name(u: User) -> str:
    full = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return full or u.email


def _person(u: Optional[User]) -> Optional[PersonRefDto]:
    return PersonRefDto(id=u.id, name=_person_name(u), email=u.email) if u else None


def _org_ref(o: Optional[Organization]) -> Optional[OrgRefDto]:
    return OrgRefDto(id=o.id, name=o.name, kind=o.kind) if o else None


async def _users_by_id(db: AsyncSession, ids: set[Optional[str]]) -> dict[str, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}


async def _active_user_or_422(db: AsyncSession, user_id: str) -> User:
    u = await db.get(User, user_id)
    if not u or u.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=422, detail="Owner must be an active team member")
    return u


async def _org_or_422(db: AsyncSession, org_id: str, what: str = "Organization") -> Organization:
    o = await db.get(Organization, org_id)
    if not o:
        raise HTTPException(status_code=422, detail=f"{what} not found")
    return o


async def _quote_counts(db: AsyncSession, deal_ids: list[str]) -> dict[str, int]:
    if not deal_ids:
        return {}
    q = (select(qm.QuoteLink.deal_id, func.count()).where(qm.QuoteLink.deal_id.in_(deal_ids))
         .group_by(qm.QuoteLink.deal_id))
    return dict((await db.execute(q)).all())


def _deal_row(d: Deal, users: dict[str, User], quote_count: int = 0) -> DealRowDto:
    m: Merchant = d.merchant
    return DealRowDto(
        id=d.id, key=d.key, number=d.number, merchantId=d.merchant_id, restaurantName=m.restaurant_name,
        merchantStatus=m.status, region=m.region, organization=_org_ref(d.organization),
        owner=_person(users.get(d.owner_id or "")), stage=d.stage, stageChangedAt=d.stage_changed_at,
        source=d.source, lostReason=d.lost_reason, amountMonthly=d.amount_monthly, amountOneTime=d.amount_one_time,
        demoAt=d.demo_at, deploymentDate=d.deployment_date, deployedBy=d.deployed_by,
        contractor=_org_ref(d.contractor_organization), hiredBy=d.hired_by, goLiveDate=d.go_live_date,
        quoteCount=quote_count, createdAt=d.created_at, updatedAt=d.updated_at,
    )


async def _deal_or_404(db: AsyncSession, deal_id: str) -> Deal:
    # populate_existing: after a write in the same session the loaded
    # collections would otherwise be served stale.
    d = (await db.execute(select(Deal).options(*_DEAL_LOAD, selectinload(Deal.events)).where(Deal.id == deal_id)
                          .execution_options(populate_existing=True))).scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Deal not found")
    return d


async def _deal_quotes(db: AsyncSession, deal_id: str) -> list[DealQuoteDto]:
    links = (await db.execute(select(qm.QuoteLink).where(qm.QuoteLink.deal_id == deal_id)
                              .order_by(qm.QuoteLink.created_at.desc()))).scalars().all()
    if not links:
        return []
    reqs = (await db.execute(select(qm.QuoteRequest).where(qm.QuoteRequest.link_id.in_([l.id for l in links]))
                             .order_by(qm.QuoteRequest.created_at.desc()))).scalars().all()
    latest: dict[str, qm.QuoteRequest] = {}
    for r in reqs:
        latest.setdefault(r.link_id, r)
    out: list[DealQuoteDto] = []
    for l in links:
        r = latest.get(l.id)
        monthly = svc.quote_totals(r)[0] if r else None
        out.append(DealQuoteDto(
            linkId=l.id, mode=l.mode, linkStatus=l.status, createdAt=l.created_at,
            requestId=r.id if r else None, requestNumber=r.number if r else None, requestStatus=r.status if r else None,
            oneTimeTotal=r.one_time_total if r else None, monthlyTotal=monthly,
        ))
    return out


async def _deal_detail(db: AsyncSession, d: Deal) -> DealDetailDto:
    users = await _users_by_id(db, {d.owner_id, *(e.user_id for e in d.events)})
    quotes = await _deal_quotes(db, d.id)
    base = _deal_row(d, users, quote_count=len(quotes))
    return DealDetailDto(
        **base.model_dump(), notes=d.notes,
        events=[DealEventDto(id=e.id, kind=e.kind, fromStage=e.from_stage, toStage=e.to_stage, body=e.body,
                             actor=_person(users.get(e.user_id or "")), createdAt=e.created_at) for e in d.events],
        quotes=quotes,
    )


def _contact_dto(c: OrganizationContact) -> OrganizationContactDto:
    return OrganizationContactDto(id=c.id, name=c.name, role=c.role, email=c.email, phone=c.phone,
                                  isPrimary=c.is_primary, createdAt=c.created_at)


@dataclass
class _OrgStats:
    deals: int = 0
    live: int = 0
    last30: int = 0
    agents: int = 0
    agents_iu: int = 0
    agents_certified: int = 0
    agents_selling: int = 0


def _since() -> dt.datetime:
    return svc.utcnow() - dt.timedelta(days=partners.SELLING_WINDOW_DAYS)


async def _org_stats(db: AsyncSession, org_ids: list[str]) -> dict[str, _OrgStats]:
    """Deal counts per organization (an ISO's include its agents') and agent roll-ups."""
    out: dict[str, _OrgStats] = {i: _OrgStats() for i in org_ids}
    if not org_ids:
        return out
    since = _since()
    agents = (await db.execute(select(Organization.id, Organization.parent_id, Organization.stage,
                                      Organization.iu_enrolled_at, Organization.certified)
                               .where(Organization.parent_id.in_(org_ids)))).all()
    counted = set(org_ids) | {a.id for a in agents}
    per: dict[str, tuple[int, int, int]] = {}
    q = (select(Deal.organization_id, func.count(), func.count().filter(Deal.stage == DealStage.LIVE),
                func.count().filter(Deal.created_at >= since))
         .where(Deal.organization_id.in_(counted)).group_by(Deal.organization_id))
    for oid, n, live, recent in (await db.execute(q)).all():
        per[oid] = (int(n), int(live), int(recent))
    for oid in org_ids:
        n, live, recent = per.get(oid, (0, 0, 0))
        out[oid].deals, out[oid].live, out[oid].last30 = n, live, recent
    for a in agents:
        st = out[a.parent_id]
        n, live, recent = per.get(a.id, (0, 0, 0))
        st.deals += n
        st.live += live
        st.last30 += recent
        st.agents += 1
        st.agents_iu += 1 if (a.iu_enrolled_at is not None or partners.stage_rank(a.stage) >= partners.stage_rank("IU_ENROLLED")) else 0
        st.agents_certified += 1 if a.certified else 0
        st.agents_selling += 1 if recent > 0 else 0
    return out


async def _org_dtos(db: AsyncSession, rows: list[Organization]) -> list[OrganizationDto]:
    stats = await _org_stats(db, [o.id for o in rows])
    users = await _users_by_id(db, {o.owner_id for o in rows})
    parent_ids = {o.parent_id for o in rows if o.parent_id}
    parents = {p.id: p for p in (await db.execute(select(Organization).where(Organization.id.in_(parent_ids)))).scalars()} \
        if parent_ids else {}
    return [_org_dto(o, stats[o.id], users, parents) for o in rows]


def _org_dto(o: Organization, st: _OrgStats, users: dict[str, User], parents: dict[str, Organization]) -> OrganizationDto:
    primary = next((c for c in o.contacts if c.is_primary), None) or (o.contacts[0] if o.contacts else None)
    return OrganizationDto(
        id=o.id, name=o.name, kind=o.kind, status=o.status, website=o.website, phone=o.phone, email=o.email,
        address=o.address, city=o.city, state=o.state, zip=o.zip, notes=o.notes, certified=o.certified,
        certifiedAt=o.certified_at, partnerLeadId=o.partner_lead_id, source=o.source, sourceDetail=o.source_detail,
        stage=o.stage, stageChangedAt=o.stage_changed_at, iuEnrolledAt=o.iu_enrolled_at, cameFrom=o.came_from,
        cameFromDetail=o.came_from_detail, owner=_person(users.get(o.owner_id or "")), assignedAt=o.assigned_at,
        nextStep=o.next_step, nextStepDue=o.next_step_due, needsReview=o.needs_review,
        salesforceAccountId=o.salesforce_account_id, parent=_org_ref(parents.get(o.parent_id or "")),
        agentCount=st.agents, agentsIuEnrolled=st.agents_iu, agentsCertified=st.agents_certified,
        agentsSelling=st.agents_selling, dealCount=st.deals, liveCount=st.live, dealsLast30=st.last30,
        selling=st.last30 > 0, primaryContact=_contact_dto(primary) if primary else None,
        createdAt=o.created_at, updatedAt=o.updated_at,
    )


async def _org_or_404(db: AsyncSession, org_id: str) -> Organization:
    o = (await db.execute(select(Organization).options(selectinload(Organization.contacts)).where(Organization.id == org_id)
                          .execution_options(populate_existing=True))).scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Organization not found")
    return o


async def _org_detail(db: AsyncSession, o: Organization) -> OrganizationDetailDto:
    agent_ids = list((await db.execute(select(Organization.id).where(Organization.parent_id == o.id))).scalars())
    sponsors = [o.id, *agent_ids]
    deals = (await db.execute(select(Deal).options(*_DEAL_LOAD)
                              .where(or_(Deal.organization_id.in_(sponsors), Deal.contractor_organization_id == o.id))
                              .order_by(Deal.updated_at.desc()))).scalars().all()
    events = (await db.execute(select(OrganizationEvent).where(OrganizationEvent.organization_id == o.id)
                               .order_by(OrganizationEvent.created_at.desc(), OrganizationEvent.id.desc()))).scalars().all()
    users = await _users_by_id(db, {d.owner_id for d in deals} | {e.user_id for e in events})
    qc = await _quote_counts(db, [d.id for d in deals])
    base = (await _org_dtos(db, [o]))[0]
    return OrganizationDetailDto(
        **base.model_dump(), contacts=[_contact_dto(c) for c in o.contacts],
        deals=[_deal_row(d, users, qc.get(d.id, 0)) for d in deals],
        events=[OrganizationEventDto(id=e.id, kind=e.kind, fromValue=e.from_value, toValue=e.to_value, body=e.body,
                                     actor=_person(users.get(e.user_id or "")), createdAt=e.created_at) for e in events],
    )


def _apply_contact(c: OrganizationContact, data: OrganizationContactIn) -> None:
    c.name, c.role, c.email, c.phone, c.is_primary = data.name, data.role, data.email, data.phone, data.isPrimary


def _only_one_primary(org: Organization, keep: OrganizationContact) -> None:
    if keep.is_primary:
        for other in org.contacts:
            if other is not keep:
                other.is_primary = False


def _can_assign(user: AuthenticatedUser) -> bool:
    return user.can("organizations.assign")


async def _check_owner_change(db: AsyncSession, user: AuthenticatedUser, current: Optional[str], new: Optional[str]) -> None:
    """Assigning someone else (or taking a partner off someone) needs organizations.assign;
    anyone who manages organizations may take an unassigned one for themselves."""
    if new == current:
        return
    if not _can_assign(user) and not (new == user.id and current is None):
        raise HTTPException(status_code=403, detail="Assigning partners to other people needs the 'Assign partners' permission.")
    if new:
        await _active_user_or_422(db, new)


async def _parent_or_422(db: AsyncSession, parent_id: str, child_id: Optional[str] = None) -> Organization:
    p = await _org_or_422(db, parent_id, "Parent ISO")
    if p.parent_id:
        raise HTTPException(status_code=422, detail="An agent can't have agents of its own; pick the ISO.")
    if child_id and p.id == child_id:
        raise HTTPException(status_code=422, detail="An organization can't be its own ISO.")
    return p


def _owner_filter(stmt, owner: Optional[str], user: AuthenticatedUser):
    if not owner:
        return stmt
    if owner == "none":
        return stmt.where(Organization.owner_id.is_(None))
    return stmt.where(Organization.owner_id == (user.id if owner == "me" else owner))


# ======================================================== organizations =====
@organizations_router.get("", response_model=OrganizationListDto, dependencies=[_org_view])
async def list_organizations(query: OrganizationQueryDto = Depends(), db: AsyncSession = Depends(get_db),
                             user: AuthenticatedUser = Depends(get_current_user)):
    stmt = select(Organization)
    if query.search:
        like = f"%{query.search.strip()}%"
        in_contacts = select(OrganizationContact.organization_id).where(
            or_(OrganizationContact.name.ilike(like), OrganizationContact.email.ilike(like)))
        stmt = stmt.where(or_(Organization.name.ilike(like), Organization.city.ilike(like), Organization.email.ilike(like),
                              Organization.came_from_detail.ilike(like), Organization.id.in_(in_contacts)))
    if query.kind:
        stmt = stmt.where(Organization.kind == query.kind)
    if query.status:
        stmt = stmt.where(Organization.status == query.status)
    if query.certified is not None:
        stmt = stmt.where(Organization.certified.is_(query.certified))
    if query.source == NOT_RECORDED:
        stmt = stmt.where(Organization.source.is_(None))
    elif query.source:
        stmt = stmt.where(Organization.source == query.source)
    if query.stage:
        stmt = stmt.where(Organization.stage == query.stage)
    if query.cameFrom == "NONE":
        stmt = stmt.where(Organization.came_from.is_(None))
    elif query.cameFrom:
        stmt = stmt.where(Organization.came_from == query.cameFrom)
    stmt = _owner_filter(stmt, query.ownerId, user)
    if query.parentId:
        stmt = stmt.where(Organization.parent_id == query.parentId)
    elif query.topLevel:
        stmt = stmt.where(Organization.parent_id.is_(None))
    if query.needsReview is not None:
        stmt = stmt.where(Organization.needs_review.is_(query.needsReview))
    if query.selling is not None:
        # Selling: a deal in the window credited to it or (for an ISO) to one of its agents.
        agent = aliased(Organization)
        recent = select(Deal.organization_id).where(Deal.created_at >= _since())
        via_agent = select(agent.parent_id).where(agent.id.in_(recent), agent.parent_id.is_not(None))
        cond = or_(Organization.id.in_(recent), Organization.id.in_(via_agent))
        stmt = stmt.where(cond if query.selling else ~cond)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    desc = query.order == "desc"
    def by(col):  # noqa: E306
        return (col.desc().nulls_last() if desc else col.asc().nulls_last())
    if query.sortBy == "stage":
        rank = case({k: i for i, k in enumerate(partners.STAGE_KEYS)}, value=Organization.stage, else_=99)
        order = [by(rank)]
    elif query.sortBy == "owner":
        owner_name = (select(func.lower(func.coalesce(User.first_name, "") + " " + func.coalesce(User.last_name, "")))
                      .where(User.id == Organization.owner_id).scalar_subquery())
        order = [by(owner_name)]
    elif query.sortBy == "deals":
        order = [by(select(func.count()).where(Deal.organization_id == Organization.id).scalar_subquery())]
    elif query.sortBy == "agents":
        child = aliased(Organization)
        order = [by(select(func.count()).where(child.parent_id == Organization.id).scalar_subquery())]
    elif query.sortBy == "cameFrom":
        order = [by(Organization.came_from)]
    else:
        col = {"name": func.lower(Organization.name), "createdAt": Organization.created_at,
               "updatedAt": Organization.updated_at, "nextStepDue": Organization.next_step_due}[query.sortBy]
        order = [by(col)]
    order.append(func.lower(Organization.name).asc())
    order.append(Organization.id.asc())
    rows = (await db.execute(stmt.options(selectinload(Organization.contacts)).order_by(*order)
                             .offset(query.skip).limit(query.limit))).scalars().all()
    return OrganizationListDto(data=await _org_dtos(db, list(rows)), meta=PageMeta.build(query.page, query.limit, total))


@organizations_router.post("", response_model=OrganizationDetailDto, status_code=status.HTTP_201_CREATED, dependencies=[_org_manage])
async def create_organization(body: CreateOrganizationDto, db: AsyncSession = Depends(get_db),
                              user: AuthenticatedUser = Depends(get_current_user)):
    if body.parentId:
        await _parent_or_422(db, body.parentId)
    await _check_owner_change(db, user, None, body.ownerId)
    o = Organization(name=body.name, kind=body.kind, status=body.status, website=body.website, phone=body.phone,
                     email=body.email, address=body.address, city=body.city, state=body.state, zip=body.zip,
                     notes=body.notes, partner_lead_id=body.partnerLeadId,
                     source="PARTNER_LEAD" if body.partnerLeadId else "MANUAL", source_detail=body.partnerLeadId,
                     stage=body.stage, stage_changed_at=svc.utcnow() if body.stage != "NEW" else None,
                     came_from=body.cameFrom, came_from_detail=body.cameFromDetail, parent_id=body.parentId,
                     owner_id=body.ownerId, assigned_at=svc.utcnow() if body.ownerId else None,
                     next_step=body.nextStep, next_step_due=body.nextStepDue)
    if body.stage == "CERTIFIED":
        o.certified, o.certified_at = True, svc.utcnow()
    if partners.stage_rank(body.stage) >= partners.stage_rank("IU_ENROLLED"):
        o.iu_enrolled_at = svc.utcnow()
    seen_primary = False
    for c in body.contacts:
        contact = OrganizationContact(name=c.name, role=c.role, email=c.email, phone=c.phone,
                                      is_primary=c.isPrimary and not seen_primary)
        seen_primary = seen_primary or c.isPrimary
        o.contacts.append(contact)
    db.add(o)
    await db.flush()
    partners.record(db, o.id, "CREATED", user_id=user.id)
    if body.parentId:
        partners.record(db, body.parentId, "AGENT_ADDED", user_id=user.id, to_value=o.name[:200])
    await db.commit()
    return await _org_detail(db, await _org_or_404(db, o.id))


@organizations_router.post("/assign", response_model=AssignResultDto, dependencies=[_org_manage])
async def assign_organizations(body: AssignDto, db: AsyncSession = Depends(get_db),
                               user: AuthenticatedUser = Depends(get_current_user)):
    """Hand many partners (or an ISO's agents) to salespeople in one go. dryRun = preview."""
    if not _can_assign(user):
        raise HTTPException(status_code=403, detail="Assigning partners needs the 'Assign partners' permission.")
    if bool(body.organizationIds) == bool(body.parentId):
        raise HTTPException(status_code=422, detail="Send either organizationIds or parentId.")
    stmt = select(Organization)
    stmt = stmt.where(Organization.id.in_(body.organizationIds)) if body.organizationIds else \
        stmt.where(Organization.parent_id == body.parentId)
    pool = list((await db.execute(stmt)).scalars().all())
    owned = [o for o in pool if o.owner_id]
    if body.onlyUnassigned:
        pool = [o for o in pool if not o.owner_id]
    people_ids = [p.userId for p in body.people]
    users = await _users_by_id(db, set(people_ids))
    for pid in people_ids:
        u = users.get(pid)
        if not u or u.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=422, detail="Every person must be an active user.")
    # What each person already owns among the same kind of records (an ISO's agents, or top-level partners).
    scope = Organization.parent_id == body.parentId if body.parentId else Organization.parent_id.is_(None)
    existing = dict((await db.execute(select(Organization.owner_id, func.count())
                                      .where(Organization.owner_id.in_(people_ids), scope)
                                      .group_by(Organization.owner_id))).all())
    if body.onlyUnassigned is False:
        # Records being reassigned don't count as already owned.
        for o in pool:
            if o.owner_id in existing:
                existing[o.owner_id] -= 1
    counts = {p.userId: p.count for p in body.people if p.count is not None}
    if counts and len(counts) != len(body.people):
        raise HTTPException(status_code=422, detail="Give a count for everyone, or for nobody (to split evenly).")
    try:
        targets = partners.split_targets(len(pool), people_ids, counts or None, existing, body.balanceLoad)
    except partners.AssignmentError as e:
        raise HTTPException(status_code=422, detail=str(e))
    items = [partners.AssignItem(id=o.id, name=o.name, group=partners.territory(o, body.keepTogether)) for o in pool]
    plans = partners.plan_assignment(items, targets, keep_together=body.keepTogether != "none", existing=existing)
    by_id = {o.id: o for o in pool}
    result_people = []
    for pl in plans:
        u = users[pl.user_id]
        result_people.append(AssignPersonResultDto(
            user=_person(u), target=pl.target, count=len(pl.item_ids), existing=max(pl.existing, 0),
            groups=[f"{k} ({n})" for k, n in pl.groups.items()],
            sample=[by_id[i].name for i in pl.item_ids[:5]],
        ))
    assigned = sum(len(pl.item_ids) for pl in plans)
    if not body.dryRun:
        parent_name = None
        if body.parentId:
            parent = await db.get(Organization, body.parentId)
            parent_name = parent.name if parent else None
        prev = await _users_by_id(db, {o.owner_id for o in pool})
        for pl in plans:
            u = users[pl.user_id]
            for oid in pl.item_ids:
                o = by_id[oid]
                old = prev.get(o.owner_id or "")
                partners.set_owner(db, o, pl.user_id, user_id=user.id, owner_name=_person_name(u),
                                   previous_name=_person_name(old) if old else None, body="Bulk assignment")
            if pl.item_ids:
                what = f"{len(pl.item_ids)} agents of {parent_name}" if parent_name else f"{len(pl.item_ids)} partners"
                await _notify_assigned(db, u, what, f"/organizations/{body.parentId}" if body.parentId else "/organizations?owner=me")
        await db.commit()
    return AssignResultDto(dryRun=body.dryRun, total=len(pool), assigned=assigned, leftOver=len(pool) - assigned,
                           skippedAlreadyOwned=len(owned) if body.onlyUnassigned else 0, people=result_people)


async def _notify_assigned(db: AsyncSession, u: User, what: str, link: str) -> None:
    """Bell notice for the person who was given partners (their "Assigned to me" setting decides). Never fails."""
    try:
        from app.modules.ops import alerts
        if alerts._channels(u, "assigned")["inApp"]:
            db.add(Notification(user_id=u.id, kind=NotificationKind.ASSIGNED, title=f"You were assigned {what}"[:300],
                                link=link[:300]))
    except Exception:  # noqa: BLE001 - a notice must never break the assignment
        pass


@organizations_router.post("/from-lead/{lead_id}", response_model=OrganizationDetailDto, dependencies=[_org_manage])
async def organization_from_lead(lead_id: str, body: LinkOrganizationDto, db: AsyncSession = Depends(get_db),
                                 user: AuthenticatedUser = Depends(get_current_user)):
    """The organization for a partners.innowi.com application: link an existing one or make it."""
    lid = lead_service.parse_uuid(lead_id)
    lead = await lead_service.get_lead(db, lid) if lid else None
    if not lead:
        raise HTTPException(status_code=404, detail="Partner lead not found")
    taken = (await db.execute(select(Organization).where(Organization.partner_lead_id == lid))).scalars().first()
    if taken and taken.id != body.organizationId:
        raise HTTPException(status_code=409, detail=f"This lead is already linked to {taken.name}.")
    if body.organizationId:
        o = await _org_or_404(db, body.organizationId)
        if o.partner_lead_id and o.partner_lead_id != lid:
            raise HTTPException(status_code=409, detail=f"{o.name} is already linked to another application.")
        o.partner_lead_id = lid
        if not o.came_from:
            o.came_from = "INBOUND_PARTNER"
    else:
        name = (lead.get("company") or lead.get("full_name") or "").strip()[:200] or "Unnamed partner"
        o = Organization(name=name, kind=body.kind or _kind_from_partner_type(lead.get("partner_type")),
                         website=(lead.get("website") or None), email=(lead.get("email") or None),
                         phone=(lead.get("phone") or None), state=None, partner_lead_id=lid, source="PARTNER_LEAD",
                         source_detail=lid, came_from="INBOUND_PARTNER",
                         came_from_detail=(lead.get("heard_about") or None) and str(lead["heard_about"])[:200])
        db.add(o)
        await db.flush()
        partners.record(db, o.id, "CREATED", user_id=user.id, body="From a partners.innowi.com application")
    o = await _org_or_404(db, o.id) if body.organizationId else o
    if lead.get("full_name") and not any((c.email or "").lower() == (lead.get("email") or "").lower() and c.email
                                         for c in (o.contacts if body.organizationId else [])):
        db.add(OrganizationContact(organization_id=o.id, name=str(lead["full_name"])[:160],
                                   role=(lead.get("title") or None), email=(lead.get("email") or None),
                                   phone=(lead.get("phone") or None)[:40] if lead.get("phone") else None,
                                   is_primary=not body.organizationId))
    partners.record(db, o.id, "LINKED", user_id=user.id, to_value="Partner application",
                    body=f"{lead.get('full_name') or ''} ({lead.get('email') or 'no e-mail'})".strip())
    await db.commit()
    return await _org_detail(db, await _org_or_404(db, o.id))


@organizations_router.post("/from-card/{contact_id}", response_model=OrganizationDetailDto, dependencies=[_org_manage])
async def organization_from_card(contact_id: str, body: LinkOrganizationDto, db: AsyncSession = Depends(get_db),
                                 user: AuthenticatedUser = Depends(get_current_user)):
    """The organization for a scanned business card (Network): add the person to an existing one, or make it."""
    cid = card_service.parse_uuid(contact_id)
    card = await card_service.get_contact(db, cid) if cid else None
    if not card:
        raise HTTPException(status_code=404, detail="Contact not found")
    already = (await db.execute(select(OrganizationContact).where(OrganizationContact.partner_contact_id == cid))).scalars().first()
    if already:
        raise HTTPException(status_code=409, detail="This card is already linked to an organization.")
    met = " · ".join(str(x) for x in (card.get("met_at"), card.get("met_on")) if x)[:200] or None
    if body.organizationId:
        o = await _org_or_404(db, body.organizationId)
        if not o.came_from:
            o.came_from, o.came_from_detail = "CONFERENCE", met
    else:
        name = (card.get("company") or card.get("full_name") or "").strip()[:200] or "Unnamed partner"
        o = Organization(name=name, kind=body.kind or _kind_from_partner_type(card.get("partner_type")),
                         website=card.get("website") or None, source="BUSINESS_CARD", source_detail=cid,
                         came_from="CONFERENCE", came_from_detail=met)
        db.add(o)
        await db.flush()
        partners.record(db, o.id, "CREATED", user_id=user.id, body="From a business card")
    db.add(OrganizationContact(organization_id=o.id, name=str(card.get("full_name") or "Unknown")[:160],
                               role=(card.get("title") or None) and str(card["title"])[:120],
                               email=card.get("email") or None, phone=(card.get("phone") or None) and str(card["phone"])[:40],
                               partner_contact_id=cid, is_primary=not body.organizationId))
    partners.record(db, o.id, "LINKED", user_id=user.id, to_value="Business card", body=str(card.get("full_name") or ""))
    await db.commit()
    return await _org_detail(db, await _org_or_404(db, o.id))


@organizations_router.get("/links", response_model=OrganizationLinksDto, dependencies=[_org_view])
async def organization_links(leadIds: str = "", contactIds: str = "", db: AsyncSession = Depends(get_db)):
    """Which organization each partner lead / business card belongs to (for the Leads and Network lists)."""
    lead_ids = [x for x in leadIds.split(",") if x][:500]
    card_ids = [x for x in contactIds.split(",") if x][:500]
    leads: dict[str, OrgRefDto] = {}
    cards: dict[str, OrgRefDto] = {}
    if lead_ids:
        for o in (await db.execute(select(Organization).where(Organization.partner_lead_id.in_(lead_ids)))).scalars():
            leads[o.partner_lead_id] = _org_ref(o)
    if card_ids:
        rows = (await db.execute(select(OrganizationContact.partner_contact_id, Organization)
                                 .join(Organization, Organization.id == OrganizationContact.organization_id)
                                 .where(OrganizationContact.partner_contact_id.in_(card_ids)))).all()
        for pc, o in rows:
            cards[pc] = _org_ref(o)
    return OrganizationLinksDto(leads=leads, cards=cards)


def _kind_from_partner_type(pt: Optional[str]) -> OrganizationKind:
    t = (pt or "").lower()
    if "independent" in t or "agent" == t:
        return OrganizationKind.PARTNER_AGENT
    if "dealer" in t or "reseller" in t or "consultant" in t:
        return OrganizationKind.PARTNER_RESELLER
    if "iso" in t or "processor" in t or "gateway" in t:
        return OrganizationKind.PARTNER_ISO
    return OrganizationKind.OTHER if t else OrganizationKind.PARTNER_ISO


@organizations_router.get("/{org_id}", response_model=OrganizationDetailDto, dependencies=[_org_view])
async def get_organization(org_id: str, db: AsyncSession = Depends(get_db)):
    return await _org_detail(db, await _org_or_404(db, org_id))


@organizations_router.patch("/{org_id}", response_model=OrganizationDetailDto, dependencies=[_org_manage])
async def update_organization(org_id: str, body: UpdateOrganizationDto, db: AsyncSession = Depends(get_db),
                              user: AuthenticatedUser = Depends(get_current_user)):
    o = await _org_or_404(db, org_id)
    fields = body.model_dump(exclude_unset=True)
    simple = {"name": "name", "kind": "kind", "status": "status", "website": "website", "phone": "phone", "email": "email",
              "address": "address", "city": "city", "state": "state", "zip": "zip", "notes": "notes",
              "partnerLeadId": "partner_lead_id"}
    for k, attr in simple.items():
        if k in fields:
            setattr(o, attr, fields[k])
    reviewed = False
    if fields.get("stage"):
        partners.set_stage(db, o, fields["stage"], user_id=user.id)
        reviewed = True
    if "certified" in fields and fields["certified"] is not None and fields["certified"] != o.certified:
        o.certified = fields["certified"]
        o.certified_at = svc.utcnow() if o.certified else None
        if o.certified:
            partners.set_stage(db, o, "CERTIFIED", user_id=user.id)
    if body.clearCameFrom or fields.get("cameFrom") or "cameFromDetail" in fields:
        before = o.came_from
        if body.clearCameFrom:
            o.came_from, o.came_from_detail = None, None
        else:
            if fields.get("cameFrom"):
                o.came_from = fields["cameFrom"]
            if "cameFromDetail" in fields:
                o.came_from_detail = fields["cameFromDetail"] or None
        if before != o.came_from:
            partners.record(db, o.id, "CAME_FROM_CHANGED", user_id=user.id,
                            from_value=partners.CAME_FROM.get(before or ""), to_value=partners.CAME_FROM.get(o.came_from or ""))
        reviewed = True
    if body.clearParent:
        o.parent_id = None
    elif fields.get("parentId"):
        await _parent_or_422(db, fields["parentId"], o.id)
        if (await db.execute(select(func.count()).where(Organization.parent_id == o.id))).scalar_one():
            raise HTTPException(status_code=422, detail="This organization has agents of its own, so it can't sit under an ISO.")
        o.parent_id = fields["parentId"]
    if body.clearOwner or fields.get("ownerId"):
        new_owner = None if body.clearOwner else fields["ownerId"]
        await _check_owner_change(db, user, o.owner_id, new_owner)
        people = await _users_by_id(db, {o.owner_id, new_owner})
        prev, nxt = people.get(o.owner_id or ""), people.get(new_owner or "")
        partners.set_owner(db, o, new_owner, user_id=user.id, owner_name=_person_name(nxt) if nxt else None,
                           previous_name=_person_name(prev) if prev else None)
        if nxt and nxt.id != user.id:
            await _notify_assigned(db, nxt, o.name, f"/organizations/{o.id}")
    if body.clearNextStep:
        o.next_step, o.next_step_due = None, None
    else:
        if "nextStep" in fields:
            o.next_step = fields["nextStep"] or None
        if "nextStepDue" in fields:
            o.next_step_due = fields["nextStepDue"]
    if body.clearSalesforce:
        o.salesforce_account_id = None
    elif fields.get("salesforceAccountId"):
        o.salesforce_account_id = fields["salesforceAccountId"]
    if reviewed:
        o.needs_review = False
    await db.commit()
    return await _org_detail(db, await _org_or_404(db, org_id))


@organizations_router.post("/{org_id}/notes", response_model=OrganizationDetailDto, dependencies=[_org_manage])
async def add_organization_note(org_id: str, body: DealNoteDto, db: AsyncSession = Depends(get_db),
                                user: AuthenticatedUser = Depends(get_current_user)):
    o = await _org_or_404(db, org_id)
    partners.record(db, o.id, "NOTE", user_id=user.id, body=body.body)
    o.updated_at = svc.utcnow()
    await db.commit()
    return await _org_detail(db, await _org_or_404(db, org_id))


@organizations_router.post("/{org_id}/agents", response_model=AddAgentsResultDto, dependencies=[_org_manage])
async def add_agents(org_id: str, body: AddAgentsDto, db: AsyncSession = Depends(get_db),
                     user: AuthenticatedUser = Depends(get_current_user)):
    """Add an ISO's agents in one go (pasted from their agent list). Duplicates are skipped."""
    iso = await _org_or_404(db, org_id)
    if iso.parent_id:
        raise HTTPException(status_code=422, detail="Agents go under the ISO, not under another agent.")
    existing = (await db.execute(select(Organization).options(selectinload(Organization.contacts))
                                 .where(Organization.parent_id == iso.id))).scalars().all()
    names = {o.name.strip().lower() for o in existing}
    emails = {(c.email or "").lower() for o in existing for c in o.contacts if c.email} | \
             {(o.email or "").lower() for o in existing if o.email}
    created, skipped = 0, []
    for i, a in enumerate(body.agents, start=1):
        key, mail = a.name.strip().lower(), (a.email or "").lower()
        if key in names or (mail and mail in emails):
            skipped.append({"row": i, "name": a.name, "reason": "already under this ISO"})
            continue
        names.add(key)
        if mail:
            emails.add(mail)
        created += 1
        if body.dryRun:
            continue
        o = Organization(name=a.name, kind=OrganizationKind.PARTNER_AGENT, parent_id=iso.id, email=a.email,
                         phone=a.phone, city=a.city, state=a.state, came_from=iso.came_from,
                         came_from_detail=iso.came_from_detail or iso.name[:200], source="AGENT_LIST",
                         source_detail=f"Agent list for {iso.name}"[:300])
        if a.contactName or a.email or a.phone:
            o.contacts.append(OrganizationContact(name=a.contactName or a.name, email=a.email, phone=a.phone,
                                                  is_primary=True))
        db.add(o)
        await db.flush()
        partners.record(db, o.id, "CREATED", user_id=user.id, body=f"Added to {iso.name}'s agent list")
    if created and not body.dryRun:
        partners.record(db, iso.id, "AGENT_ADDED", user_id=user.id, to_value=f"{created} agents")
        await db.commit()
    return AddAgentsResultDto(created=created, skipped=skipped, dryRun=body.dryRun)


@organizations_router.post("/{org_id}/contacts", response_model=OrganizationContactDto, status_code=status.HTTP_201_CREATED,
                           dependencies=[_org_manage])
async def add_organization_contact(org_id: str, body: OrganizationContactIn, db: AsyncSession = Depends(get_db)):
    o = await _org_or_404(db, org_id)
    c = OrganizationContact(organization_id=o.id)
    _apply_contact(c, body)
    o.contacts.append(c)
    _only_one_primary(o, c)
    await db.commit()
    await db.refresh(c)
    return _contact_dto(c)


@organizations_router.patch("/{org_id}/contacts/{contact_id}", response_model=OrganizationContactDto, dependencies=[_org_manage])
async def update_organization_contact(org_id: str, contact_id: str, body: OrganizationContactIn,
                                      db: AsyncSession = Depends(get_db)):
    o = await _org_or_404(db, org_id)
    c = next((x for x in o.contacts if x.id == contact_id), None)
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    _apply_contact(c, body)
    _only_one_primary(o, c)
    await db.commit()
    await db.refresh(c)
    return _contact_dto(c)


@organizations_router.delete("/{org_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_org_manage])
async def delete_organization_contact(org_id: str, contact_id: str, db: AsyncSession = Depends(get_db)):
    o = await _org_or_404(db, org_id)
    c = next((x for x in o.contacts if x.id == contact_id), None)
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    o.contacts.remove(c)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ================================================================ deals =====
def _deal_filters(stmt, query: DealQueryDto, user: AuthenticatedUser):
    stmt = stmt.join(Merchant, Merchant.id == Deal.merchant_id)
    if query.search:
        like = f"%{query.search.strip()}%"
        conds = [Merchant.restaurant_name.ilike(like), Merchant.merchant_code.ilike(like), Deal.source.ilike(like)]
        digits = query.search.strip().upper().removeprefix("D-")
        if digits.isdigit():
            conds.append(Deal.number == int(digits))
        stmt = stmt.where(or_(*conds))
    if query.stage:
        stmt = stmt.where(Deal.stage == query.stage)
    if query.bucket == "OPEN":
        stmt = stmt.where(Deal.stage.not_in([DealStage.LIVE, DealStage.LOST]))
    elif query.bucket == "WON":
        stmt = stmt.where(Deal.stage == DealStage.LIVE)
    elif query.bucket == "LOST":
        stmt = stmt.where(Deal.stage == DealStage.LOST)
    if query.ownerId:
        stmt = stmt.where(Deal.owner_id == query.ownerId)
    if query.mine:
        stmt = stmt.where(Deal.owner_id == user.id)
    if query.organizationId:
        stmt = stmt.where(or_(Deal.organization_id == query.organizationId,
                              Deal.contractor_organization_id == query.organizationId))
    if query.merchantId:
        stmt = stmt.where(Deal.merchant_id == query.merchantId)
    return stmt


@deals_router.get("", response_model=DealListDto, dependencies=[_deal_view])
async def list_deals(query: DealQueryDto = Depends(), db: AsyncSession = Depends(get_db),
                     user: AuthenticatedUser = Depends(get_current_user)):
    stmt = _deal_filters(select(Deal), query, user)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    sort_map = {
        "updatedAt": Deal.updated_at, "createdAt": Deal.created_at, "stageChangedAt": Deal.stage_changed_at,
        "restaurantName": Merchant.restaurant_name, "amountMonthly": Deal.amount_monthly, "number": Deal.number,
    }
    col = sort_map[query.sortBy]
    order = [col.desc().nulls_last() if query.order == "desc" else col.asc().nulls_last(), Deal.number.desc()]
    rows = (await db.execute(stmt.options(*_DEAL_LOAD).order_by(*order).offset(query.skip).limit(query.limit))).scalars().all()
    users = await _users_by_id(db, {d.owner_id for d in rows})
    qc = await _quote_counts(db, [d.id for d in rows])
    return DealListDto(data=[_deal_row(d, users, qc.get(d.id, 0)) for d in rows],
                       meta=PageMeta.build(query.page, query.limit, total))


@deals_router.get("/board", response_model=DealBoardDto, dependencies=[_deal_view])
async def deal_board(query: DealQueryDto = Depends(), db: AsyncSession = Depends(get_db),
                     user: AuthenticatedUser = Depends(get_current_user)):
    """Every open deal grouped by stage (LIVE and LOST are counted, not listed). Pagination is ignored."""
    stmt = _deal_filters(select(Deal), query, user)
    rows = (await db.execute(stmt.options(*_DEAL_LOAD).order_by(Deal.stage_changed_at.desc()))).scalars().all()
    users = await _users_by_id(db, {d.owner_id for d in rows})
    qc = await _quote_counts(db, [d.id for d in rows])
    by_stage: dict[DealStage, list[Deal]] = {s: [] for s in STAGE_ORDER}
    lost = 0
    for d in rows:
        if d.stage == DealStage.LOST:
            lost += 1
        else:
            by_stage[d.stage].append(d)
    columns = [
        StageColumnDto(stage=s, count=len(ds), monthly=sum((d.amount_monthly or Decimal("0") for d in ds), Decimal("0")),
                       deals=[_deal_row(d, users, qc.get(d.id, 0)) for d in ds])
        for s, ds in by_stage.items()
    ]
    owners = (await db.execute(select(User).where(User.status == UserStatus.ACTIVE).order_by(User.first_name, User.email))).scalars().all()
    orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
    return DealBoardDto(columns=columns, total=len(rows), lost=lost, live=len(by_stage[DealStage.LIVE]),
                        owners=[_person(u) for u in owners][:200], organizations=[_org_ref(o) for o in orgs][:500])


@deals_router.get("/merchant-search", response_model=list[MerchantPickDto], dependencies=[_deal_view])
async def merchant_search(q: str = "", limit: int = 10, db: AsyncSession = Depends(get_db)):
    """Pick an existing merchant for a new deal. Name or merchant code, 10 best matches."""
    term = q.strip()
    if len(term) < 2:
        return []
    like = f"%{term}%"
    stmt = (select(Merchant).where(or_(Merchant.restaurant_name.ilike(like), Merchant.merchant_code.ilike(like)))
            .order_by(Merchant.restaurant_name.asc()).limit(max(1, min(limit, 25))))
    rows = (await db.execute(stmt)).scalars().all()
    open_counts: dict[str, int] = {}
    if rows:
        oq = (select(Deal.merchant_id, func.count()).where(Deal.merchant_id.in_([m.id for m in rows]),
                                                             Deal.stage.not_in([DealStage.LIVE, DealStage.LOST]))
              .group_by(Deal.merchant_id))
        open_counts = dict((await db.execute(oq)).all())
    return [MerchantPickDto(id=m.id, restaurantName=m.restaurant_name, merchantCode=m.merchant_code, region=m.region,
                            status=m.status, openDeals=open_counts.get(m.id, 0)) for m in rows]


@deals_router.post("", response_model=DealDetailDto, status_code=status.HTTP_201_CREATED, dependencies=[_deal_manage])
async def create_deal(body: CreateDealDto, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(get_current_user)):
    if bool(body.merchantId) == bool(body.newMerchant):
        raise HTTPException(status_code=422,
                            detail="Pick an existing merchant or describe the new restaurant, not both")
    if body.stage == DealStage.LOST:
        raise HTTPException(status_code=422, detail="A new deal cannot start as lost")
    if body.merchantId:
        merchant = await db.get(Merchant, body.merchantId)
        if not merchant:
            raise HTTPException(status_code=422, detail="Merchant not found")
    else:
        merchant = svc.new_prospect_merchant(body.newMerchant)
        db.add(merchant)
        await db.flush()
    if body.organizationId:
        await _org_or_422(db, body.organizationId)
    owner_id = body.ownerId if body.ownerId else user.id
    await _active_user_or_422(db, owner_id)

    deal = Deal(merchant_id=merchant.id, organization_id=body.organizationId, owner_id=owner_id, stage=DealStage.NEW,
                source=body.source, demo_at=body.demoAt, notes=body.notes)
    db.add(deal)
    await db.flush()
    if body.newMerchant:
        # The merchant's source detail names the deal it was created with (D-1001).
        await db.refresh(deal, attribute_names=["number"])
        merchant.source_detail = f"D-{deal.number}"
    svc.record_event(db, deal, DealEventKind.CREATED, user_id=user.id,
                     body="New restaurant added as a prospect" if body.newMerchant else None)
    if body.stage != DealStage.NEW:
        svc.change_stage(db, deal, merchant, body.stage, user_id=user.id)
    await db.commit()
    return await _deal_detail(db, await _deal_or_404(db, deal.id))


@deals_router.get("/{deal_id}", response_model=DealDetailDto, dependencies=[_deal_view])
async def get_deal(deal_id: str, db: AsyncSession = Depends(get_db)):
    return await _deal_detail(db, await _deal_or_404(db, deal_id))


@deals_router.patch("/{deal_id}", response_model=DealDetailDto, dependencies=[_deal_manage])
async def update_deal(deal_id: str, body: UpdateDealDto, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(get_current_user)):
    d = await _deal_or_404(db, deal_id)
    merchant: Merchant = d.merchant
    f = body.model_dump(exclude_unset=True)

    if body.clearOwner:
        if d.owner_id is not None:
            svc.record_event(db, d, DealEventKind.OWNER_CHANGED, user_id=user.id, body="Owner cleared")
        d.owner_id = None
    elif "ownerId" in f and f["ownerId"] and f["ownerId"] != d.owner_id:
        owner = await _active_user_or_422(db, f["ownerId"])
        svc.record_event(db, d, DealEventKind.OWNER_CHANGED, user_id=user.id, body=f"Owner → {_person_name(owner)}")
        d.owner_id = owner.id

    if body.clearOrganization:
        d.organization_id = None
    elif "organizationId" in f and f["organizationId"]:
        await _org_or_422(db, f["organizationId"])
        d.organization_id = f["organizationId"]

    if body.clearContractor:
        d.contractor_organization_id = None
    elif "contractorOrganizationId" in f and f["contractorOrganizationId"]:
        await _org_or_422(db, f["contractorOrganizationId"], "Contractor")
        d.contractor_organization_id = f["contractorOrganizationId"]

    for k, attr in (("source", "source"), ("amountMonthly", "amount_monthly"), ("amountOneTime", "amount_one_time"),
                    ("deployedBy", "deployed_by"), ("hiredBy", "hired_by"), ("notes", "notes"), ("goLiveDate", "go_live_date")):
        if k in f:
            setattr(d, attr, f[k])
    if body.clearDemoAt:
        d.demo_at = None
    elif "demoAt" in f:
        d.demo_at = f["demoAt"]
    if body.clearDeploymentDate:
        d.deployment_date = None
    elif "deploymentDate" in f:
        d.deployment_date = f["deploymentDate"]
    if "lostReason" in f and body.stage is None:
        d.lost_reason = f["lostReason"]

    if body.stage is not None:
        svc.change_stage(db, d, merchant, body.stage, user_id=user.id, lost_reason=body.lostReason, go_live=body.goLiveDate)

    await db.commit()
    return await _deal_detail(db, await _deal_or_404(db, deal_id))


@deals_router.post("/{deal_id}/notes", response_model=DealDetailDto, status_code=status.HTTP_201_CREATED, dependencies=[_deal_manage])
async def add_deal_note(deal_id: str, body: DealNoteDto, db: AsyncSession = Depends(get_db),
                        user: AuthenticatedUser = Depends(get_current_user)):
    d = await _deal_or_404(db, deal_id)
    svc.record_event(db, d, DealEventKind.NOTE, user_id=user.id, body=body.body.strip())
    await db.commit()
    return await _deal_detail(db, await _deal_or_404(db, deal_id))


@deals_router.post("/{deal_id}/link-quote", response_model=DealDetailDto, dependencies=[_deal_manage])
async def link_quote_to_deal(deal_id: str, body: LinkQuoteDto, db: AsyncSession = Depends(get_db),
                             user: AuthenticatedUser = Depends(get_current_user)):
    d = await _deal_or_404(db, deal_id)
    link = await db.get(qm.QuoteLink, body.linkId)
    if not link:
        raise HTTPException(status_code=422, detail="Quote link not found")
    await svc.attach_quote_link(db, d, link, user_id=user.id)
    await db.commit()
    return await _deal_detail(db, await _deal_or_404(db, deal_id))
