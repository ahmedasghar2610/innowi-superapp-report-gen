"""
Port of brand-profile.controller.ts, catering-profile.controller.ts,
account-manager.controller.ts, subscription.controller.ts, data-quality.controller.ts.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.catalog import Package
from app.models.enums import MerchantStatus, AccessStatus
from app.models.profiling import AccessItem, AccountManager, BrandProfile, CateringProfile, FieldVerification, Merchant, Subscription
from app.modules.merchant_profiling.completeness_service import compute_completeness, refresh_completion_cache
from app.modules.merchant_profiling.domain.profile_completeness_rules import (
    BLOCKING_CRITICALITIES,
    CONNECTED_STATUSES,
    NOT_APPLICABLE_STATUSES,
    PROFILE_ALERT_THRESHOLDS,
)
from app.modules.merchant_profiling.domain.profile_field_registry import PROFILE_FIELDS
from app.modules.merchant_profiling.mappers import (
    account_manager_to_dto,
    brand_profile_to_dto,
    catering_profile_to_dto,
    subscription_to_response_dto,
)
from app.schemas.merchant_profiling import (
    AccountManagerResponseDto,
    AccountManagersResponseDto,
    DataQualityResponseDto,
    BrandProfileResponseDto,
    CateringProfileResponseDto,
    CreateAccountManagerDto,
    SubscriptionResponseDto,
    UpdateAccountManagerDto,
    UpsertBrandProfileDto,
    UpsertCateringProfileDto,
    UpsertSubscriptionDto,
)

router = APIRouter(tags=["Merchant Reference Data"])
_view = Depends(require_capability("profile.view"))
_edit = Depends(require_capability("profile.edit"))
_manager_write = Depends(require_capability("accountManager.manage"))
_sub_write = Depends(require_capability("subscription.write"))


async def _merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return m


# ---- Brand profile ------------------------------------------------------------
async def _brand_raw(merchant_id: str, db: AsyncSession):
    b = await db.get(BrandProfile, merchant_id)
    return brand_profile_to_dto(merchant_id, b).model_dump(mode="json")


@router.get("/merchants/{merchant_id}/brand-profile", response_model=BrandProfileResponseDto, dependencies=[_view])
async def get_brand_profile(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    b = await db.get(BrandProfile, merchant_id)
    return brand_profile_to_dto(merchant_id, b)


@router.patch("/merchants/{merchant_id}/brand-profile", response_model=BrandProfileResponseDto, dependencies=[_edit])
@audited(entity_type="BrandProfile", merchant_id_param="merchant_id", read=_brand_raw)
async def upsert_brand_profile(merchant_id: str, dto: UpsertBrandProfileDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    b = await db.get(BrandProfile, merchant_id)
    field_map = {
        "brandColors": "brand_colors", "brandFonts": "brand_fonts", "logoVector": "logo_vector",
        "photoLibraryStatus": "photo_library_status", "menuFormat": "menu_format", "signatureDishes": "signature_dishes",
        "toneOfVoice": "tone_of_voice", "doNotSay": "do_not_say", "contentRestrictions": "content_restrictions",
    }
    data = {field_map[k]: v for k, v in dto.model_dump(exclude_unset=True).items()}
    if not b:
        b = BrandProfile(merchant_id=merchant_id, **data)
        db.add(b)
    else:
        for k, v in data.items():
            setattr(b, k, v)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return brand_profile_to_dto(merchant_id, b)


# ---- Catering profile ----------------------------------------------------------
async def _catering_raw(merchant_id: str, db: AsyncSession):
    c = await db.get(CateringProfile, merchant_id)
    return catering_profile_to_dto(merchant_id, c).model_dump(mode="json")


@router.get("/merchants/{merchant_id}/catering-profile", response_model=CateringProfileResponseDto, dependencies=[_view])
async def get_catering_profile(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    c = await db.get(CateringProfile, merchant_id)
    return catering_profile_to_dto(merchant_id, c)


@router.patch("/merchants/{merchant_id}/catering-profile", response_model=CateringProfileResponseDto, dependencies=[_edit])
@audited(entity_type="CateringProfile", merchant_id_param="merchant_id", read=_catering_raw)
async def upsert_catering_profile(merchant_id: str, dto: UpsertCateringProfileDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    c = await db.get(CateringProfile, merchant_id)
    field_map = {"offered": "offered", "contact": "contact", "leadFlow": "lead_flow", "minOrder": "min_order", "notes": "notes"}
    data = {field_map[k]: v for k, v in dto.model_dump(exclude_unset=True).items()}
    if not c:
        c = CateringProfile(merchant_id=merchant_id, **data)
        db.add(c)
    else:
        for k, v in data.items():
            setattr(c, k, v)
    await db.commit()
    return catering_profile_to_dto(merchant_id, c)


# ---- Account managers -----------------------------------------------------------
async def _account_manager_raw(id: str, db: AsyncSession):
    a = await db.get(AccountManager, id)
    if not a:
        return None
    count = (await db.execute(select(func.count()).select_from(Merchant).where(Merchant.account_manager_id == id))).scalar_one()
    return account_manager_to_dto(a, count).model_dump(mode="json")


@router.get("/account-managers", response_model=AccountManagersResponseDto, dependencies=[_view])
async def list_account_managers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(AccountManager))).scalars().all()
    out = []
    for a in rows:
        count = (await db.execute(select(func.count()).select_from(Merchant).where(Merchant.account_manager_id == a.id))).scalar_one()
        out.append(account_manager_to_dto(a, count))
    return {"data": out}


@router.get("/account-managers/{id}", response_model=AccountManagerResponseDto, dependencies=[_view])
async def get_account_manager(id: str, db: AsyncSession = Depends(get_db)):
    a = await db.get(AccountManager, id)
    if not a:
        raise HTTPException(status_code=404, detail="Account manager not found")
    count = (await db.execute(select(func.count()).select_from(Merchant).where(Merchant.account_manager_id == id))).scalar_one()
    return account_manager_to_dto(a, count)


@router.post("/account-managers", response_model=AccountManagerResponseDto, status_code=201, dependencies=[_manager_write])
@audited(entity_type="AccountManager")
async def create_account_manager(dto: CreateAccountManagerDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    if dto.email:
        existing = (await db.execute(select(AccountManager).where(AccountManager.email == dto.email))).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="An account manager with this email already exists")
    a = AccountManager(name=dto.name, team=dto.team, email=dto.email)
    db.add(a)
    await db.commit()
    return account_manager_to_dto(a, 0)


@router.patch("/account-managers/{id}", response_model=AccountManagerResponseDto, dependencies=[_manager_write])
@audited(entity_type="AccountManager", id_param="id", read=_account_manager_raw)
async def update_account_manager(id: str, dto: UpdateAccountManagerDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    a = await db.get(AccountManager, id)
    if not a:
        raise HTTPException(status_code=404, detail="Account manager not found")
    if dto.email and dto.email != a.email:
        existing = (await db.execute(select(AccountManager).where(AccountManager.email == dto.email))).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="An account manager with this email already exists")
    for k, v in dto.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    await db.commit()
    count = (await db.execute(select(func.count()).select_from(Merchant).where(Merchant.account_manager_id == id))).scalar_one()
    return account_manager_to_dto(a, count)


# ---- Subscription -----------------------------------------------------------------
async def _subscription_raw(merchant_id: str, db: AsyncSession):
    stmt = select(Subscription).where(Subscription.merchant_id == merchant_id).options(selectinload(Subscription.package))
    s = (await db.execute(stmt)).scalar_one_or_none()
    return subscription_to_response_dto(merchant_id, s).model_dump(mode="json") if s else None


@router.get("/merchants/{merchant_id}/subscription", response_model=SubscriptionResponseDto, dependencies=[_view])
async def get_subscription(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    stmt = select(Subscription).where(Subscription.merchant_id == merchant_id).options(selectinload(Subscription.package))
    s = (await db.execute(stmt)).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="This merchant has no subscription yet")
    return subscription_to_response_dto(merchant_id, s)


@router.patch("/merchants/{merchant_id}/subscription", response_model=SubscriptionResponseDto, dependencies=[_sub_write])
@audited(entity_type="Subscription", merchant_id_param="merchant_id", read=_subscription_raw)
async def upsert_subscription(merchant_id: str, dto: UpsertSubscriptionDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    stmt = select(Subscription).where(Subscription.merchant_id == merchant_id).options(selectinload(Subscription.package))
    s = (await db.execute(stmt)).scalar_one_or_none()

    if not s:
        if not dto.packageCode or not dto.status:
            raise HTTPException(status_code=400, detail="packageCode and status are required to create a subscription")
        if not await db.get(Package, dto.packageCode):
            raise HTTPException(status_code=400, detail="Unknown packageCode")
        s = Subscription(
            merchant_id=merchant_id, package_code=dto.packageCode, status=dto.status,
            start_date=dto.startDate, renewal_date=dto.renewalDate, mrr=dto.mrr,
        )
        db.add(s)
    else:
        data = dto.model_dump(exclude_unset=True)
        if "packageCode" in data:
            if data["packageCode"] and not await db.get(Package, data["packageCode"]):
                raise HTTPException(status_code=400, detail="Unknown packageCode")
            s.package_code = data["packageCode"]
        if "status" in data:
            s.status = data["status"]
        if "startDate" in data:
            s.start_date = data["startDate"]
        if "renewalDate" in data:
            s.renewal_date = data["renewalDate"]
        if "mrr" in data:
            s.mrr = data["mrr"]

    await db.commit()
    stmt = select(Subscription).where(Subscription.merchant_id == merchant_id).options(selectinload(Subscription.package))
    s = (await db.execute(stmt)).scalar_one()
    return subscription_to_response_dto(merchant_id, s)


# ---- Data quality --------------------------------------------------------------
@router.get("/profiling/data-quality", response_model=DataQualityResponseDto, dependencies=[_view])
async def data_quality(db: AsyncSession = Depends(get_db)):
    """Port of DataQualityService.getPortfolio() / PrismaDataQualityRepository.loadPortfolio()."""
    # Churned accounts aren't profiles to complete: they live on /churn.
    merchants = (
        await db.execute(select(Merchant).where(Merchant.status != MerchantStatus.CHURNED)
                         .options(selectinload(Merchant.account_manager), selectinload(Merchant.subscription)))
    ).scalars().all()

    complete_pct = PROFILE_ALERT_THRESHOLDS["completeAtPct"]
    critical_pct = PROFILE_ALERT_THRESHOLDS["criticalBelowPct"]

    def band(pct: Optional[int]) -> str:
        if pct is None:
            return "UNSCORED"
        if pct >= complete_pct:
            return "COMPLETE"
        if pct < critical_pct:
            return "CRITICAL"
        return "PARTIAL"

    # -- pending / blocking access items (connections) --
    excluded_statuses = list(CONNECTED_STATUSES) + list(NOT_APPLICABLE_STATUSES)
    pending_connections = (
        await db.execute(
            select(func.count()).select_from(AccessItem).where(AccessItem.status.notin_(excluded_statuses))
        )
    ).scalar_one()

    blocking_rows = (
        await db.execute(
            select(AccessItem.merchant_id, func.count().label("cnt"))
            .where(AccessItem.status.notin_(excluded_statuses))
            .where(AccessItem.criticality.in_(list(BLOCKING_CRITICALITIES)))
            .group_by(AccessItem.merchant_id)
        )
    ).all()
    blocking_by_merchant: dict[str, int] = {row.merchant_id: row.cnt for row in blocking_rows}
    blocking_connections = sum(blocking_by_merchant.values())

    # -- field verification confidence counts (portfolio-wide, merchants only) --
    confidence_rows = (
        await db.execute(
            select(FieldVerification.confidence, func.count().label("cnt"))
            .where(FieldVerification.entity_type == "Merchant")
            .group_by(FieldVerification.confidence)
        )
    ).all()
    confidence_counts: dict[str, int] = {row.confidence.value: row.cnt for row in confidence_rows}
    confirmed = confidence_counts.get("CONFIRMED", 0)
    needs_review = confidence_counts.get("INFERRED", 0)
    unverified = confidence_counts.get("UNVERIFIED", 0)
    outdated = confidence_counts.get("OUTDATED", 0)
    placeholder = confidence_counts.get("PLACEHOLDER", 0)
    field_slots = len(merchants) * len(PROFILE_FIELDS)
    no_attestation = max(0, field_slots - confirmed - needs_review - unverified - outdated - placeholder)

    # -- per-merchant rows + bands --
    scored_pcts = sorted(m.profile_completion_pct for m in merchants if m.profile_completion_pct is not None)
    bands = {"complete": 0, "partial": 0, "critical": 0, "unscored": 0}

    merchant_rows = []
    for m in merchants:
        b = band(m.profile_completion_pct)
        bands[b.lower()] += 1
        merchant_rows.append(
            {
                "id": m.id,
                "merchantCode": m.merchant_code,
                "restaurantName": m.restaurant_name,
                "accountHealth": m.account_health.value if m.account_health else None,
                "accountManagerName": m.account_manager.name if m.account_manager else None,
                "subscriptionStatus": m.subscription.status.value if m.subscription else None,
                "profileCompletionPct": m.profile_completion_pct,
                "band": b,
                "blockingConnections": blocking_by_merchant.get(m.id, 0),
                "updatedAt": m.updated_at.isoformat() if m.updated_at else None,
            }
        )
    band_order = {"UNSCORED": 0, "CRITICAL": 1, "PARTIAL": 2, "COMPLETE": 3}
    merchant_rows.sort(key=lambda r: (band_order[r["band"]], r["profileCompletionPct"] if r["profileCompletionPct"] is not None else -1))

    avg = round(sum(scored_pcts) / len(scored_pcts)) if scored_pcts else None
    median = None
    if scored_pcts:
        mid = len(scored_pcts) // 2
        median = scored_pcts[mid] if len(scored_pcts) % 2 else round((scored_pcts[mid - 1] + scored_pcts[mid]) / 2)

    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "thresholds": {"completeAtPct": complete_pct, "criticalBelowPct": critical_pct},
        "totals": {
            "merchants": len(merchants),
            "scored": len(scored_pcts),
            "averagePercent": avg,
            "medianPercent": median,
        },
        "bands": bands,
        "confidence": {
            "confirmed": confirmed,
            "needsReview": needs_review,
            "unverified": unverified,
            "outdated": outdated,
            "placeholder": placeholder,
            "noAttestation": no_attestation,
            "fieldSlots": field_slots,
        },
        "connections": {
            "pending": pending_connections,
            "blocking": blocking_connections,
            "merchantsWithBlockers": len(blocking_by_merchant),
        },
        "merchants": merchant_rows,
    }
