"""Port of merchant-profile.controller.ts: profile fields, completeness, alerts, attestation."""
from __future__ import annotations

import datetime as dt
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.enums import VerificationConfidence
from app.models.profiling import FieldVerification, Merchant
from app.modules.merchant_profiling.completeness_service import compute_alerts, compute_completeness, refresh_completion_cache
from app.modules.merchant_profiling.domain.profile_field_registry import ENTITY_TYPE_MERCHANT, PROFILE_FIELD_MAP, PROFILE_FIELDS
from app.modules.merchant_profiling.mappers import merchant_to_dto
from app.schemas.merchant_profiling import (
    AttestFieldDto,
    MerchantProfileDto,
    ProfileAlertsResponseDto,
    ProfileCompletenessDto,
    ProfileFieldDto,
    ProfileFieldsResponseDto,
    UpdateProfileFieldDto,
)

router = APIRouter(tags=["Merchant Profile"], dependencies=[Depends(require_capability("profile.view"))])


async def _get_merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    merchant = await db.get(Merchant, merchant_id)
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    return merchant


def _serialize_value(raw: Any, field_type: str) -> Any:
    if raw is None:
        return None
    if field_type == "date" and isinstance(raw, dt.datetime):
        return raw.isoformat()
    if hasattr(raw, "value"):  # enum
        return raw.value
    if field_type == "decimal":
        return str(raw)
    return raw


async def _build_field_dto(merchant: Merchant, field_def, verification: Optional[FieldVerification]) -> ProfileFieldDto:
    raw = getattr(merchant, field_def.column, None)
    confidence = verification.confidence.value if verification else VerificationConfidence.UNVERIFIED.value
    verified = bool(verification and verification.confidence != VerificationConfidence.UNVERIFIED and verification.verified_at)
    return ProfileFieldDto(
        key=field_def.key,
        label=field_def.label,
        type=field_def.type,
        value=_serialize_value(raw, field_def.type),
        options=list(field_def.options) if field_def.options else None,
        note=field_def.note,
        group=field_def.group,
        required=field_def.required,
        source=verification.source if verification else None,
        confidence=confidence,
        verifiedBy=verification.verified_by if verification else None,
        verifiedAt=verification.verified_at if verification else None,
        verified=verified,
    )


async def _all_fields(db: AsyncSession, merchant: Merchant) -> list[ProfileFieldDto]:
    verifications = (
        await db.execute(
            select(FieldVerification).where(
                FieldVerification.entity_type == ENTITY_TYPE_MERCHANT, FieldVerification.entity_id == merchant.id
            )
        )
    ).scalars().all()
    by_field = {v.field_name: v for v in verifications}
    return [await _build_field_dto(merchant, f, by_field.get(f.key)) for f in PROFILE_FIELDS]


def _completeness_dto(result) -> ProfileCompletenessDto:
    """Shape CompletenessResult exactly like Nest's ProfileCompletenessDto.fromResult()."""
    from app.modules.merchant_profiling.domain.profile_completeness_rules import PROFILE_ALERT_THRESHOLDS

    complete_at = PROFILE_ALERT_THRESHOLDS["completeAtPct"]
    return ProfileCompletenessDto(
        percent=result.percent,
        completeAtPct=complete_at,
        isComplete=result.percent >= complete_at,
        sections=[
            {
                "key": s.key, "label": s.label, "requirement": s.requirement, "weight": s.weight,
                "earned": s.earned, "available": s.available, "percent": s.percent, "applicable": s.applicable,
            }
            for s in result.sections
        ],
        missingInformation=[
            {"key": i.key, "label": i.label, "area": i.area, "severity": i.severity, "group": i.group}
            for i in result.missing_information
        ],
        missingFiles=[
            {"key": i.key, "label": i.label, "area": i.area, "severity": i.severity} for i in result.missing_files
        ],
        pendingConnections=[
            {"id": p.id, "accessItem": p.access_item, "criticality": p.criticality.value,
             "status": p.status.value, "blocking": p.blocking}
            for p in result.pending_connections
        ],
        confidence={
            "confirmed": result.confidence.confirmed, "unverified": result.confidence.unverified,
            "needsReview": result.confidence.needs_review, "outdated": result.confidence.outdated,
            "placeholder": result.confidence.placeholder, "missing": result.confidence.missing,
        },
        expiredConnections=[
            {"id": e.id, "accessItem": e.access_item, "criticality": e.criticality.value,
             "expiry": e.expiry.isoformat() if e.expiry else None, "blocking": e.blocking}
            for e in result.expired_connections
        ],
        napConflicts=[
            {"locationId": n.location_id, "label": n.label, "napStatus": n.nap_status} for n in result.nap_conflicts
        ],
        outdatedFields=[
            {"key": f.key, "label": f.label, "group": f.group, "required": f.required,
             "lastVerifiedAt": f.last_verified_at.isoformat() if f.last_verified_at else None,
             "verifiedBy": f.verified_by}
            for f in result.outdated_fields
        ],
        placeholderFields=[
            {"key": f.key, "label": f.label, "group": f.group, "required": f.required,
             "lastVerifiedAt": f.last_verified_at.isoformat() if f.last_verified_at else None,
             "verifiedBy": f.verified_by}
            for f in result.placeholder_fields
        ],
        fields=result.fields,
        requiredMissingCount=len([i for i in result.missing_information if i.severity == "REQUIRED"]),
    )


@router.get("/merchants/{id}/profile", response_model=MerchantProfileDto)
async def get_profile(id: str, db: AsyncSession = Depends(get_db)):
    merchant = await _get_merchant_or_404(db, id)
    await refresh_completion_cache(db, id)
    merchant = await _get_merchant_or_404(db, id)
    fields = await _all_fields(db, merchant)
    # `completion` was missing: Nest's MerchantProfileDto is merchant + fields +
    # completion, so the Profile tab renders the score without a second call.
    completion = _completeness_dto(await compute_completeness(db, merchant))
    # The DTO reads the account manager / subscription: load the merchant with them (lazy loads fail under asyncio).
    from app.modules.merchant_profiling.routers.merchants import _get_merchant_or_404 as _load_full

    db.expire_all()
    merchant = await _load_full(db, id)
    return MerchantProfileDto(merchant=merchant_to_dto(merchant), fields=fields, completion=completion)


@router.get("/merchants/{id}/fields", response_model=ProfileFieldsResponseDto)
async def get_fields(id: str, db: AsyncSession = Depends(get_db)):
    merchant = await _get_merchant_or_404(db, id)
    await refresh_completion_cache(db, id)
    merchant = await _get_merchant_or_404(db, id)
    fields = await _all_fields(db, merchant)
    completion = _completeness_dto(await compute_completeness(db, merchant))
    return ProfileFieldsResponseDto(data=fields, completion=completion)


def _validate_value(field_def, value: Any) -> Any:
    ftype = field_def.type
    if ftype == "string":
        if not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be a string')
        value = value.strip()
        if field_def.required and value == "":
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must not be empty')
        return value
    if ftype == "url":
        if not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be a string')
        parsed = urlparse(value)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be a valid URL with a protocol')
        return value
    if ftype == "boolean":
        if not isinstance(value, bool):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be a boolean')
        return value
    if ftype == "date":
        if not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be an ISO-8601 date string')
        try:
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be a valid date')
    if ftype == "enum":
        if value not in (field_def.options or ()):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be one of: {", ".join(field_def.options or ())}')
        return value
    if ftype == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be an integer')
        return value
    if ftype == "decimal":
        try:
            return float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f'Field "{field_def.key}": must be a number')
    return value


async def _field_audit_read(composite_id: str, db: AsyncSession):
    merchant_id, key = composite_id.split(":", 1)
    merchant = await db.get(Merchant, merchant_id)
    if not merchant or key not in PROFILE_FIELD_MAP:
        return None
    verification = (
        await db.execute(
            select(FieldVerification).where(
                FieldVerification.entity_type == ENTITY_TYPE_MERCHANT,
                FieldVerification.entity_id == merchant_id,
                FieldVerification.field_name == key,
            )
        )
    ).scalar_one_or_none()
    dto = await _build_field_dto(merchant, PROFILE_FIELD_MAP[key], verification)
    return dto.model_dump(mode="json")


@router.patch("/merchants/{id}/fields/{key}", response_model=ProfileFieldDto,
              dependencies=[Depends(require_capability("profile.edit"))])
@audited(entity_type="ProfileField", id_from_params=["id", "key"], merchant_id_param="id", read=_field_audit_read)
async def update_field(
    id: str, key: str, dto: UpdateProfileFieldDto, request: Request, db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    merchant = await _get_merchant_or_404(db, id)
    field_def = PROFILE_FIELD_MAP.get(key)
    if not field_def:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'Unknown field "{key}"')

    value = _validate_value(field_def, dto.value)
    setattr(merchant, field_def.column, value)

    result = await db.execute(
        select(FieldVerification).where(
            FieldVerification.entity_type == ENTITY_TYPE_MERCHANT,
            FieldVerification.entity_id == id,
            FieldVerification.field_name == key,
        )
    )
    verification = result.scalar_one_or_none()

    # A changed value with no explicit confidence resets attestation to UNVERIFIED.
    new_confidence = dto.confidence if dto.confidence is not None else VerificationConfidence.UNVERIFIED
    stamp_now = bool(dto.verifiedBy) or (dto.confidence is not None and dto.confidence != VerificationConfidence.UNVERIFIED)

    if verification:
        verification.value = str(value) if value is not None else None
        if dto.source is not None:
            verification.source = dto.source
        verification.confidence = new_confidence
        if dto.verifiedBy is not None:
            verification.verified_by = dto.verifiedBy
        if stamp_now:
            verification.verified_at = dt.datetime.now(dt.timezone.utc)
    else:
        verification = FieldVerification(
            merchant_id=id, entity_type=ENTITY_TYPE_MERCHANT, entity_id=id, field_name=key,
            value=str(value) if value is not None else None, source=dto.source, confidence=new_confidence,
            verified_by=dto.verifiedBy, verified_at=dt.datetime.now(dt.timezone.utc) if stamp_now else None,
        )
        db.add(verification)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The write violates a uniqueness constraint")

    await refresh_completion_cache(db, id)
    merchant = await _get_merchant_or_404(db, id)
    return await _build_field_dto(merchant, field_def, verification)


@router.post("/merchants/{id}/fields/{key}/attest", response_model=ProfileFieldDto,
             dependencies=[Depends(require_capability("profile.edit"))])
@audited(entity_type="ProfileField", id_from_params=["id", "key"], merchant_id_param="id", read=_field_audit_read)
async def attest_field(
    id: str, key: str, dto: AttestFieldDto, request: Request, db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    merchant = await _get_merchant_or_404(db, id)
    field_def = PROFILE_FIELD_MAP.get(key)
    if not field_def:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'Unknown field "{key}"')

    raw = getattr(merchant, field_def.column, None)
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field is empty — nothing to attest to")

    result = await db.execute(
        select(FieldVerification).where(
            FieldVerification.entity_type == ENTITY_TYPE_MERCHANT,
            FieldVerification.entity_id == id,
            FieldVerification.field_name == key,
        )
    )
    verification = result.scalar_one_or_none()

    stamp_now = dto.confidence in (VerificationConfidence.CONFIRMED, VerificationConfidence.INFERRED)
    clear_stamp = dto.confidence == VerificationConfidence.UNVERIFIED

    if verification:
        verification.confidence = dto.confidence
        if dto.source is not None:
            verification.source = dto.source
        verification.verified_by = user.email
        if stamp_now:
            verification.verified_at = dt.datetime.now(dt.timezone.utc)
        elif clear_stamp:
            verification.verified_at = None
    else:
        verification = FieldVerification(
            merchant_id=id, entity_type=ENTITY_TYPE_MERCHANT, entity_id=id, field_name=key,
            value=str(raw), source=dto.source, confidence=dto.confidence, verified_by=user.email,
            verified_at=dt.datetime.now(dt.timezone.utc) if stamp_now else None,
        )
        db.add(verification)

    await db.commit()
    await refresh_completion_cache(db, id)
    return await _build_field_dto(merchant, field_def, verification)


@router.get("/merchants/{id}/completeness", response_model=ProfileCompletenessDto)
async def get_completeness(id: str, db: AsyncSession = Depends(get_db)):
    merchant = await _get_merchant_or_404(db, id)
    result = await compute_completeness(db, merchant)
    await refresh_completion_cache(db, id)
    return _completeness_dto(result)


@router.get("/merchants/{id}/alerts", response_model=ProfileAlertsResponseDto)
async def get_alerts(id: str, db: AsyncSession = Depends(get_db)):
    merchant = await _get_merchant_or_404(db, id)
    alerts = await compute_alerts(db, merchant)
    data = [
        {
            "id": a.id, "dedupKey": a.dedupKey, "merchantId": a.merchantId, "module": a.module, "type": a.type.value,
            "severity": a.severity.value, "title": a.title, "summary": a.summary,
            "evidence": [{"label": e.label, "source": e.source} for e in a.evidence],
            "impact": a.impact, "recommendation": a.recommendation, "targetTab": a.targetTab, "itemCount": a.itemCount,
        }
        for a in alerts
    ]
    return {"data": data, "total": len(data)}
