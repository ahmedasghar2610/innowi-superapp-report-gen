"""Port of merchant.controller.ts."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.audit import audited
from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.models.enums import MerchantStatus
from app.models.profiling import AccountManager, Merchant, Subscription
from app.models.sources import NOT_RECORDED
from app.modules.audit.router import find_by_merchant as audit_find_by_merchant
from app.modules.merchant_profiling import menu_jobs
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.merchant_profiling.mappers import merchant_to_dto
from app.schemas.audit import PaginatedAuditLogsDto
from app.schemas.merchant_profiling import (
    CreateMerchantDto,
    MerchantResponseDto,
    PaginatedMerchantsDto,
    QueryMerchantDto,
    UpdateMerchantDto,
)

router = APIRouter(tags=["Merchants"])

_LOAD_OPTS = (selectinload(Merchant.account_manager), selectinload(Merchant.subscription).selectinload(Subscription.package))


async def _get_merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    stmt = select(Merchant).where(Merchant.id == merchant_id).options(*_LOAD_OPTS)
    merchant = (await db.execute(stmt)).scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    return merchant


async def _validate_account_manager(db: AsyncSession, account_manager_id: Optional[str]) -> None:
    if account_manager_id is None:
        return
    if not await db.get(AccountManager, account_manager_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown accountManagerId")


async def _find_one_raw(id: str, db: AsyncSession):
    try:
        merchant = await _get_merchant_or_404(db, id)
    except HTTPException:
        return None
    return merchant_to_dto(merchant).model_dump(mode="json")


@router.post("/merchants", response_model=MerchantResponseDto, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_capability("merchant.create"))])
@audited(entity_type="Merchant", resolve_merchant_id=lambda e: e.get("id") if e else None)
async def create_merchant(
    dto: CreateMerchantDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    await _validate_account_manager(db, dto.accountManagerId)
    data = dto.model_dump(exclude_unset=True)
    field_map = {
        "restaurantName": "restaurant_name", "merchantCode": "merchant_code", "legalName": "legal_name",
        "cuisineCategory": "cuisine_category", "websiteUrl": "website_url", "websitePlatform": "website_platform",
        "onlineOrdering": "online_ordering", "posSystem": "pos_system", "customerListSource": "customer_list_source",
        "googleAdsBudget": "google_ads_budget", "metaAdsBudget": "meta_ads_budget", "businessGoals": "business_goals",
        "targetAudience": "target_audience", "slowDayparts": "slow_dayparts", "seasonalPeaks": "seasonal_peaks",
        "alcoholLicense": "alcohol_license", "dietaryCerts": "dietary_certs",
        "locationCount": "location_count", "reportFrequency": "report_frequency", "reportRecipients": "report_recipients",
        "accountHealth": "account_health", "nextAction": "next_action", "openBlockers": "open_blockers",
        "notes": "notes", "onboardingDate": "onboarding_date", "goLiveDate": "go_live_date",
        "accountManagerId": "account_manager_id",
        "status": "status", "region": "region", "innowiSolution": "innowi_solution", "accountTier": "account_tier",
    }
    merchant = Merchant(**{field_map[k]: v for k, v in data.items() if k in field_map})
    merchant.source = "MANUAL"
    db.add(merchant)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A merchant with this merchantCode already exists")
    merchant = await _get_merchant_or_404(db, merchant.id)
    # An Innowi ordering link → load the menu (items + photos) in the background.
    await menu_jobs.start_if_innowi_link(merchant.id, merchant.online_ordering, user.email)
    # The connector: link its SEO site / Ads account when they clearly match (Settings → Data setup → Connector).
    from app.modules.linking import connector
    if (await connector.connect_quietly(db, [merchant.id], user.id)).get("summary"):
        merchant = await _get_merchant_or_404(db, merchant.id)
    return merchant_to_dto(merchant)


@router.get("/merchants", response_model=PaginatedMerchantsDto,
            dependencies=[Depends(require_capability("profile.view"))])
async def list_merchants(query: QueryMerchantDto = Depends(), db: AsyncSession = Depends(get_db)):
    stmt = select(Merchant).options(*_LOAD_OPTS)
    count_stmt = select(func.count()).select_from(Merchant)

    conditions = []
    if query.search:
        like = f"%{query.search}%"
        conditions.append(or_(Merchant.restaurant_name.ilike(like), Merchant.merchant_code.ilike(like)))
    if query.accountHealth:
        conditions.append(Merchant.account_health == query.accountHealth)
    if query.accountManagerId:
        conditions.append(Merchant.account_manager_id == query.accountManagerId)
    if query.status == "ALL":
        pass
    elif query.status:
        conditions.append(Merchant.status == MerchantStatus(query.status))
    else:
        conditions.append(Merchant.status != MerchantStatus.CHURNED)
    if query.region:
        conditions.append(Merchant.region.ilike(query.region))
    if query.source == NOT_RECORDED:
        conditions.append(Merchant.source.is_(None))
    elif query.source:
        conditions.append(Merchant.source == query.source)
    if query.cuisineCategory:
        conditions.append(Merchant.cuisine_category.ilike(f"%{query.cuisineCategory}%"))
    if query.subscriptionStatus or query.packageCode:
        stmt = stmt.join(Subscription, Subscription.merchant_id == Merchant.id)
        count_stmt = count_stmt.join(Subscription, Subscription.merchant_id == Merchant.id)
        if query.subscriptionStatus:
            conditions.append(Subscription.status == query.subscriptionStatus)
        if query.packageCode:
            conditions.append(Subscription.package_code == query.packageCode)

    for c in conditions:
        stmt = stmt.where(c)
        count_stmt = count_stmt.where(c)

    sort_col_map = {
        "createdAt": Merchant.created_at,
        "updatedAt": Merchant.updated_at,
        "restaurantName": Merchant.restaurant_name,
        "profileCompletionPct": Merchant.profile_completion_pct,
    }
    sort_col = sort_col_map[query.sortBy]
    if query.sortBy == "profileCompletionPct":
        # Never-scored merchants sort last in both directions, then by name.
        nulls = sort_col.is_(None)
        order = [nulls, sort_col.desc() if query.order == "desc" else sort_col.asc(), Merchant.restaurant_name.asc()]
    else:
        order = [sort_col.desc() if query.order == "desc" else sort_col.asc()]

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.order_by(*order).offset(query.skip).limit(query.limit))).scalars().unique().all()

    return {"data": [merchant_to_dto(m) for m in rows], "meta": PageMeta.build(query.page, query.limit, total)}


@router.get("/merchants/{id}", response_model=MerchantResponseDto, dependencies=[Depends(require_capability("profile.view"))])
async def get_merchant(id: str, db: AsyncSession = Depends(get_db)):
    return merchant_to_dto(await _get_merchant_or_404(db, id))


@router.patch("/merchants/{id}", response_model=MerchantResponseDto, dependencies=[Depends(require_capability("profile.edit"))])
@audited(entity_type="Merchant", id_param="id", resolve_merchant_id=lambda e: e.get("id") if e else None,
         read=_find_one_raw)
async def update_merchant(
    id: str, dto: UpdateMerchantDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    merchant = await _get_merchant_or_404(db, id)

    if dto.accountManagerId is not None and not has_capability(user.role, "accountManager.assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Assigning an account manager requires Marketing Manager or above")
    await _validate_account_manager(db, dto.accountManagerId)

    field_map = {
        "restaurantName": "restaurant_name", "merchantCode": "merchant_code", "legalName": "legal_name",
        "cuisineCategory": "cuisine_category", "websiteUrl": "website_url", "websitePlatform": "website_platform",
        "onlineOrdering": "online_ordering", "posSystem": "pos_system", "customerListSource": "customer_list_source",
        "googleAdsBudget": "google_ads_budget", "metaAdsBudget": "meta_ads_budget", "businessGoals": "business_goals",
        "targetAudience": "target_audience", "slowDayparts": "slow_dayparts", "seasonalPeaks": "seasonal_peaks",
        "alcoholLicense": "alcohol_license", "dietaryCerts": "dietary_certs",
        "locationCount": "location_count", "reportFrequency": "report_frequency", "reportRecipients": "report_recipients",
        "accountHealth": "account_health", "nextAction": "next_action", "openBlockers": "open_blockers",
        "notes": "notes", "onboardingDate": "onboarding_date", "goLiveDate": "go_live_date",
        "accountManagerId": "account_manager_id",
        "status": "status", "region": "region", "innowiSolution": "innowi_solution", "accountTier": "account_tier",
    }
    previous_ordering = (merchant.online_ordering or "").strip()
    for key, value in dto.model_dump(exclude_unset=True).items():
        setattr(merchant, field_map[key], value)
    new_ordering = (merchant.online_ordering or "").strip()

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A merchant with this merchantCode already exists")

    merchant = await _get_merchant_or_404(db, id)
    await refresh_completion_cache(db, id)
    merchant = await _get_merchant_or_404(db, id)
    # Ordering link set or pointed at another branch → reload the menu.
    if new_ordering and new_ordering != previous_ordering and _branch(new_ordering) != _branch(previous_ordering):
        await menu_jobs.start_if_innowi_link(id, new_ordering, user.email)
    return merchant_to_dto(merchant)


def _branch(link: str) -> str | None:
    from app.modules.merchant_profiling.menu_extractor import MenuExtractionError, extract_sub_url

    try:
        return extract_sub_url(link).lower() if link else None
    except MenuExtractionError:
        return None


@router.delete("/merchants/{id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_capability("merchant.delete"))])
@audited(entity_type="Merchant", id_param="id", resolve_merchant_id=lambda e: e.get("id") if e else None, read=_find_one_raw)
async def delete_merchant(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    merchant = await db.get(Merchant, id)
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    await db.delete(merchant)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/merchants/{id}/history", response_model=PaginatedAuditLogsDto, dependencies=[Depends(require_capability("profile.view"))])
async def merchant_history(id: str, page: int = 1, limit: int = 25, db: AsyncSession = Depends(get_db)):
    await _get_merchant_or_404(db, id)
    return await audit_find_by_merchant(db, id, page, limit)
