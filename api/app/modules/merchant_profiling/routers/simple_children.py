"""
Port of contact.controller.ts, location.controller.ts, keyword.controller.ts,
competitor.controller.ts, connection.controller.ts, merchant-service.controller.ts.
These share the same shape: nested collection route under the merchant, flat
item routes, 404 on unknown merchant/item, refresh the completeness cache
after any write that could change the score.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import asc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.audit import audited
from app.common.case import to_snake_dict
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.boundary import Promotion
from app.models.catalog import Service
from app.models.profiling import AccessItem, Competitor, Contact, Keyword, Location, Merchant, MerchantService
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.merchant_profiling.mappers import (
    competitor_to_dto,
    connection_to_dto,
    contact_to_dto,
    keyword_to_dto,
    location_to_dto,
    merchant_service_to_dto,
    promotion_to_dto,
)
from app.schemas.merchant_profiling import (
    CompetitorResponseDto,
    CompetitorsResponseDto,
    ConnectionsResponseDto,
    ContactsResponseDto,
    KeywordsResponseDto,
    LocationsResponseDto,
    MerchantServicesResponseDto,
    PromotionsResponseDto,
    ConnectionResponseDto,
    ContactResponseDto,
    CreateCompetitorDto,
    CreateConnectionDto,
    CreateContactDto,
    CreateKeywordDto,
    CreateLocationDto,
    CreateMerchantServiceDto,
    CreatePromotionDto,
    KeywordResponseDto,
    LocationResponseDto,
    MerchantServiceResponseDto,
    PromotionResponseDto,
    UpdateCompetitorDto,
    UpdateConnectionDto,
    UpdateContactDto,
    UpdateKeywordDto,
    UpdateLocationDto,
    UpdateMerchantServiceDto,
    UpdatePromotionDto,
)

router = APIRouter(tags=["Merchant Children"], dependencies=[Depends(require_capability("profile.view"))])
_edit = Depends(require_capability("profile.edit"))


async def _merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    return m


# ============================================================== Contacts ====
async def _contact_raw(id: str, db: AsyncSession):
    c = await db.get(Contact, id)
    return contact_to_dto(c).model_dump(mode="json") if c else None


@router.get("/merchants/{merchant_id}/contacts", response_model=ContactsResponseDto)
async def list_contacts(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (
        await db.execute(select(Contact).where(Contact.merchant_id == merchant_id).order_by(asc(Contact.role), asc(Contact.created_at)))
    ).scalars().all()
    return {"data": [contact_to_dto(c) for c in rows]}


@router.post("/merchants/{merchant_id}/contacts", response_model=ContactResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Contact", merchant_id_param="merchant_id")
async def create_contact(merchant_id: str, dto: CreateContactDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    contact = Contact(merchant_id=merchant_id, **to_snake_dict(dto.model_dump()))
    db.add(contact)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return contact_to_dto(contact)


@router.patch("/contacts/{id}", response_model=ContactResponseDto, dependencies=[_edit])
@audited(entity_type="Contact", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_contact_raw)
async def update_contact(id: str, dto: UpdateContactDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    contact = await db.get(Contact, id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for k, v in to_snake_dict(dto.model_dump(exclude_unset=True)).items():
        setattr(contact, k, v)
    await db.commit()
    await refresh_completion_cache(db, contact.merchant_id)
    return contact_to_dto(contact)


@router.delete("/contacts/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Contact", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_contact_raw)
async def delete_contact(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    contact = await db.get(Contact, id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    merchant_id = contact.merchant_id
    await db.delete(contact)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return Response(status_code=204)


# ============================================================== Locations ===
async def _location_raw(id: str, db: AsyncSession):
    l = await db.get(Location, id)
    return location_to_dto(l).model_dump(mode="json") if l else None


@router.get("/merchants/{merchant_id}/locations", response_model=LocationsResponseDto)
async def list_locations(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (
        await db.execute(select(Location).where(Location.merchant_id == merchant_id).order_by(Location.is_primary.desc(), asc(Location.created_at)))
    ).scalars().all()
    return {"data": [location_to_dto(l) for l in rows]}


@router.post("/merchants/{merchant_id}/locations", response_model=LocationResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Location", merchant_id_param="merchant_id")
async def create_location(merchant_id: str, dto: CreateLocationDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    data = to_snake_dict(dto.model_dump(exclude_unset=True))
    location = Location(merchant_id=merchant_id, **data)
    db.add(location)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return location_to_dto(location)


@router.patch("/locations/{id}", response_model=LocationResponseDto, dependencies=[_edit])
@audited(entity_type="Location", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_location_raw)
async def update_location(id: str, dto: UpdateLocationDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    location = await db.get(Location, id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    data = to_snake_dict(dto.model_dump(exclude_unset=True))
    for k, v in data.items():
        setattr(location, k, v)
    await db.commit()
    await refresh_completion_cache(db, location.merchant_id)
    return location_to_dto(location)


@router.delete("/locations/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Location", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_location_raw)
async def delete_location(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    location = await db.get(Location, id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    merchant_id = location.merchant_id
    await db.delete(location)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return Response(status_code=204)


# ========================================================== Keywords ========
async def _keyword_raw(id: str, db: AsyncSession):
    k = await db.get(Keyword, id)
    return keyword_to_dto(k).model_dump(mode="json") if k else None


@router.get("/merchants/{merchant_id}/keywords", response_model=KeywordsResponseDto)
async def list_keywords(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (await db.execute(select(Keyword).where(Keyword.merchant_id == merchant_id).order_by(asc(Keyword.type), asc(Keyword.created_at)))).scalars().all()
    return {"data": [keyword_to_dto(k) for k in rows]}


@router.post("/merchants/{merchant_id}/keywords", response_model=KeywordResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Keyword", merchant_id_param="merchant_id")
async def create_keyword(merchant_id: str, dto: CreateKeywordDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    keyword = Keyword(merchant_id=merchant_id, **to_snake_dict(dto.model_dump()))
    db.add(keyword)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This term already exists for this merchant and type")
    return keyword_to_dto(keyword)


@router.patch("/keywords/{id}", response_model=KeywordResponseDto, dependencies=[_edit])
@audited(entity_type="Keyword", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_keyword_raw)
async def update_keyword(id: str, dto: UpdateKeywordDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    keyword = await db.get(Keyword, id)
    if not keyword:
        raise HTTPException(status_code=404, detail="Keyword not found")
    for k, v in to_snake_dict(dto.model_dump(exclude_unset=True)).items():
        setattr(keyword, k, v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This term already exists for this merchant and type")
    return keyword_to_dto(keyword)


@router.delete("/keywords/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Keyword", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_keyword_raw)
async def delete_keyword(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    keyword = await db.get(Keyword, id)
    if not keyword:
        raise HTTPException(status_code=404, detail="Keyword not found")
    await db.delete(keyword)
    await db.commit()
    return Response(status_code=204)


# ========================================================== Competitors =====
async def _competitor_raw(id: str, db: AsyncSession):
    c = await db.get(Competitor, id)
    return competitor_to_dto(c).model_dump(mode="json") if c else None


@router.get("/merchants/{merchant_id}/competitors", response_model=CompetitorsResponseDto)
async def list_competitors(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (
        await db.execute(select(Competitor).where(Competitor.merchant_id == merchant_id).order_by(Competitor.rank.asc().nulls_last(), asc(Competitor.created_at)))
    ).scalars().all()
    return {"data": [competitor_to_dto(c) for c in rows]}


@router.post("/merchants/{merchant_id}/competitors", response_model=CompetitorResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Competitor", merchant_id_param="merchant_id")
async def create_competitor(merchant_id: str, dto: CreateCompetitorDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    competitor = Competitor(merchant_id=merchant_id, **to_snake_dict(dto.model_dump()))
    db.add(competitor)
    await db.commit()
    return competitor_to_dto(competitor)


@router.patch("/competitors/{id}", response_model=CompetitorResponseDto, dependencies=[_edit])
@audited(entity_type="Competitor", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_competitor_raw)
async def update_competitor(id: str, dto: UpdateCompetitorDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    competitor = await db.get(Competitor, id)
    if not competitor:
        raise HTTPException(status_code=404, detail="Competitor not found")
    for k, v in to_snake_dict(dto.model_dump(exclude_unset=True)).items():
        setattr(competitor, k, v)
    await db.commit()
    return competitor_to_dto(competitor)


@router.delete("/competitors/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Competitor", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_competitor_raw)
async def delete_competitor(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    competitor = await db.get(Competitor, id)
    if not competitor:
        raise HTTPException(status_code=404, detail="Competitor not found")
    await db.delete(competitor)
    await db.commit()
    return Response(status_code=204)


# ========================================================== Connections =====
async def _connection_raw(id: str, db: AsyncSession):
    c = await db.get(AccessItem, id)
    return connection_to_dto(c).model_dump(mode="json") if c else None


@router.get("/merchants/{merchant_id}/connections", response_model=ConnectionsResponseDto)
async def list_connections(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (
        await db.execute(
            select(AccessItem).where(AccessItem.merchant_id == merchant_id).order_by(asc(AccessItem.criticality), asc(AccessItem.access_item))
        )
    ).scalars().all()
    return {"data": [connection_to_dto(c) for c in rows]}


@router.post("/merchants/{merchant_id}/connections", response_model=ConnectionResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Connection", merchant_id_param="merchant_id")
async def create_connection(merchant_id: str, dto: CreateConnectionDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    connection = AccessItem(merchant_id=merchant_id, **to_snake_dict(dto.model_dump(exclude_unset=True)))
    db.add(connection)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This merchant already has a connection with that accessItem")
    await refresh_completion_cache(db, merchant_id)
    return connection_to_dto(connection)


@router.patch("/connections/{id}", response_model=ConnectionResponseDto, dependencies=[_edit])
@audited(entity_type="Connection", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_connection_raw)
async def update_connection(id: str, dto: UpdateConnectionDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    connection = await db.get(AccessItem, id)
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    for k, v in to_snake_dict(dto.model_dump(exclude_unset=True)).items():
        setattr(connection, k, v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This merchant already has a connection with that accessItem")
    await refresh_completion_cache(db, connection.merchant_id)
    return connection_to_dto(connection)


@router.delete("/connections/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Connection", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_connection_raw)
async def delete_connection(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    connection = await db.get(AccessItem, id)
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    merchant_id = connection.merchant_id
    await db.delete(connection)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return Response(status_code=204)


# ===================================================== Merchant services ====
async def _merchant_service_raw(id: str, db: AsyncSession):
    stmt = select(MerchantService).where(MerchantService.id == id).options(selectinload(MerchantService.service))
    ms = (await db.execute(stmt)).scalar_one_or_none()
    return merchant_service_to_dto(ms).model_dump(mode="json") if ms else None


@router.get("/merchants/{merchant_id}/services", response_model=MerchantServicesResponseDto)
async def list_merchant_services(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    stmt = (
        select(MerchantService)
        .where(MerchantService.merchant_id == merchant_id)
        .options(selectinload(MerchantService.service))
        .order_by(asc(MerchantService.created_at))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {"data": [merchant_service_to_dto(ms) for ms in rows]}


@router.post("/merchants/{merchant_id}/services", response_model=MerchantServiceResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="MerchantService", merchant_id_param="merchant_id")
async def create_merchant_service(merchant_id: str, dto: CreateMerchantServiceDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    if not await db.get(Service, dto.serviceId):
        raise HTTPException(status_code=400, detail="Unknown serviceId")
    ms = MerchantService(merchant_id=merchant_id, **to_snake_dict(dto.model_dump(exclude_unset=True)))
    db.add(ms)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This service is already active for this merchant")
    ms = (await db.execute(select(MerchantService).where(MerchantService.id == ms.id).options(selectinload(MerchantService.service)))).scalar_one()
    return merchant_service_to_dto(ms)


@router.patch("/services/{id}", response_model=MerchantServiceResponseDto, dependencies=[_edit])
@audited(entity_type="MerchantService", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_merchant_service_raw)
async def update_merchant_service(id: str, dto: UpdateMerchantServiceDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    stmt = select(MerchantService).where(MerchantService.id == id).options(selectinload(MerchantService.service))
    ms = (await db.execute(stmt)).scalar_one_or_none()
    if not ms:
        raise HTTPException(status_code=404, detail="Service activation not found")
    for k, v in to_snake_dict(dto.model_dump(exclude_unset=True)).items():
        setattr(ms, k, v)
    await db.commit()
    return merchant_service_to_dto(ms)


@router.delete("/services/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="MerchantService", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_merchant_service_raw)
async def delete_merchant_service(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    ms = await db.get(MerchantService, id)
    if not ms:
        raise HTTPException(status_code=404, detail="Service activation not found")
    await db.delete(ms)
    await db.commit()
    return Response(status_code=204)


# ========================================================== Promotions ======
# Port of promotion.controller.ts / promotion.service.ts (PRD Appendix C-7 /
# PROF-01 §6.2.4). Profiling owns the master list of a merchant's
# promotions/offers; list/create nested under merchant, update/delete flat by
# promotion id — same shape as DocumentController. Not a scored profile
# section, so no completeness-cache refresh (matches the original).
async def _promotion_raw(id: str, db: AsyncSession):
    p = await db.get(Promotion, id)
    return promotion_to_dto(p).model_dump(mode="json") if p else None


@router.get("/merchants/{merchant_id}/promotions", response_model=PromotionsResponseDto)
async def list_promotions(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (
        await db.execute(
            select(Promotion).where(Promotion.merchant_id == merchant_id).order_by(Promotion.created_at.desc())
        )
    ).scalars().all()
    return {"data": [promotion_to_dto(p) for p in rows]}


@router.post("/merchants/{merchant_id}/promotions", response_model=PromotionResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Promotion", merchant_id_param="merchant_id")
async def create_promotion(merchant_id: str, dto: CreatePromotionDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    promotion = Promotion(merchant_id=merchant_id, **to_snake_dict(dto.model_dump(exclude_unset=True)))
    db.add(promotion)
    await db.commit()
    return promotion_to_dto(promotion)


@router.patch("/promotions/{id}", response_model=PromotionResponseDto, dependencies=[_edit])
@audited(entity_type="Promotion", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_promotion_raw)
async def update_promotion(id: str, dto: UpdatePromotionDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    promotion = await db.get(Promotion, id)
    if not promotion:
        raise HTTPException(status_code=404, detail="Promotion not found")
    for k, v in to_snake_dict(dto.model_dump(exclude_unset=True)).items():
        setattr(promotion, k, v)
    await db.commit()
    return promotion_to_dto(promotion)


@router.delete("/promotions/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Promotion", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_promotion_raw)
async def delete_promotion(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    promotion = await db.get(Promotion, id)
    if not promotion:
        raise HTTPException(status_code=404, detail="Promotion not found")
    await db.delete(promotion)
    await db.commit()
    return Response(status_code=204)
