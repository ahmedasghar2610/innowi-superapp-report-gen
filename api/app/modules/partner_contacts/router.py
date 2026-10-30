"""/partner-contacts — the partner network: people met at conferences (business
cards scanned by the card agent), imported, or added by hand.

A contact is not a lead. The team reviews contacts here and promotes the ones
that look like partner prospects; promotion creates the row in partner_leads
and the normal lead pipeline (owner e-mail, reminders) takes over from there.

Read: partners.view. Edit / add / promote: partners.edit.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.modules.partner_contacts import service
from app.schemas.partner_contacts import (
    PARTNER_CONTACT_SOURCES,
    PARTNER_CONTACT_STATUSES,
    CreatePartnerContactDto,
    PaginatedPartnerContactsDto,
    PartnerContactDto,
    PartnerContactSummaryDto,
    PromotedDto,
    PromotePartnerContactDto,
    UpdatePartnerContactDto,
)

router = APIRouter(prefix="/partner-contacts", tags=["Partner Network"])

_view = require_capability("partners.view")
_edit = require_capability("partners.edit")


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")


def _contact_id(raw: str) -> str:
    cid = service.parse_uuid(raw)
    if not cid:
        raise _not_found()
    return cid


async def _contact_raw(id: str, db: AsyncSession) -> Optional[dict]:
    """Before-snapshot for the audit log (camelCase, like the response)."""
    cid = service.parse_uuid(id)
    if not cid:
        return None
    row = await service.get_contact(db, cid)
    return PartnerContactDto.model_validate(row).model_dump(mode="json") if row else None


@router.get("", response_model=PaginatedPartnerContactsDto)
async def list_partner_contacts(
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_view),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    sortBy: str = Query("createdAt", pattern="^(createdAt|name|company|metOn|status)$"),
    q: Optional[str] = Query(None, max_length=200, description="Search name, company, title or email"),
    status_: Optional[str] = Query(None, alias="status"),
    event: Optional[str] = Query(None, max_length=120, description="Where they were met (met_at)"),
    source: Optional[str] = Query(None, max_length=40),
    promoted: Optional[bool] = Query(None, description="true = only promoted to a lead, false = only not yet"),
    from_: Optional[dt.datetime] = Query(None, alias="from"),
    to: Optional[dt.datetime] = None,
):
    if status_ and status_ not in PARTNER_CONTACT_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(PARTNER_CONTACT_STATUSES)}")
    if source and source not in PARTNER_CONTACT_SOURCES:
        raise HTTPException(status_code=400, detail=f"source must be one of: {', '.join(PARTNER_CONTACT_SOURCES)}")
    filters = service.ContactFilters(q=q, status=status_, event=event, source=source, promoted=promoted, from_=from_, to=to)
    rows, total = await service.list_contacts(db, filters, offset=(page - 1) * limit, limit=limit, order=order,
                                              sort=sortBy)
    return PaginatedPartnerContactsDto(
        data=[PartnerContactDto.model_validate(r) for r in rows],
        meta=PageMeta.build(page, limit, total),
    )


@router.get("/summary", response_model=PartnerContactSummaryDto)
async def partner_contact_summary(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    return PartnerContactSummaryDto(**(await service.summary(db)))


@router.get("/{id}", response_model=PartnerContactDto)
async def get_partner_contact(id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    row = await service.get_contact(db, _contact_id(id))
    if not row:
        raise _not_found()
    return PartnerContactDto.model_validate(row)


@router.post("", response_model=PartnerContactDto, status_code=201)
@audited(entity_type="PartnerContact")
async def create_partner_contact(
    dto: CreatePartnerContactDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    try:
        row = await service.create_contact(db, dto.model_dump(), user.email)
    except service.ContactError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return PartnerContactDto.model_validate(row)


@router.patch("/{id}", response_model=PartnerContactDto)
@audited(entity_type="PartnerContact", id_param="id", read=_contact_raw)
async def update_partner_contact(
    id: str,
    dto: UpdatePartnerContactDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    cid = _contact_id(id)
    if not await service.get_contact(db, cid):
        raise _not_found()
    changes = {k: v for k, v in dto.model_dump().items() if k in dto.model_fields_set}
    if "status" in changes and changes["status"] is None:
        raise HTTPException(status_code=400, detail="status can't be empty")
    if "fullName" in changes and not changes["fullName"]:
        raise HTTPException(status_code=400, detail="Name can't be empty")
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change")
    try:
        await service.update_contact(db, cid, changes)
    except service.ContactError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return PartnerContactDto.model_validate(await service.get_contact(db, cid))


@router.post("/{id}/promote", response_model=PromotedDto)
@audited(entity_type="PartnerContact", id_param="id", read=_contact_raw)
async def promote_partner_contact(
    id: str,
    dto: PromotePartnerContactDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    """Decide this contact is a partner prospect: creates the partner lead (the portal
    then e-mails the team to assign it, like any new lead) and links the two."""
    cid = _contact_id(id)
    row = await service.get_contact(db, cid)
    if not row:
        raise _not_found()
    if row.get("promoted_lead_id"):
        raise HTTPException(status_code=409, detail="Already promoted to a partner lead")
    try:
        lead_id = await service.promote(db, cid, dto.partnerType, user.email)
    except service.ContactError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return PromotedDto(contact=PartnerContactDto.model_validate(await service.get_contact(db, cid)), leadId=lead_id)
