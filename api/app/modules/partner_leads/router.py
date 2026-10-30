"""/partner-leads — partner applications (the leads data lives in public.partner_leads).

Read: any staff role (partners.view). Change status / owner and add notes:
partners.edit. The partner team — who a lead can be given to, and who gets the
new-lead e-mails — comes from the Super App's own people (auth.lead_team()):
everyone signed up or invited with a role that can work leads. Admins change
the two per-person switches here (users.manage). The lead e-mails read the same
function, so both always agree.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser, require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.modules.partner_leads import service
from app.schemas.partner_leads import (
    PARTNER_LEAD_STATUSES,
    CreatePartnerLeadNoteDto,
    PaginatedPartnerLeadsDto,
    PartnerLeadDetailDto,
    PartnerLeadDto,
    PartnerLeadEventDto,
    PartnerLeadNoteDto,
    PartnerLeadSummaryDto,
    PartnerTeamDto,
    PartnerTeamMemberDto,
    UpdatePartnerLeadDto,
    UpdatePartnerTeamMemberDto,
)

router = APIRouter(prefix="/partner-leads", tags=["Partner Leads"])

_view = require_capability("partners.view")
_edit = require_capability("partners.edit")
_delete = require_capability("partners.delete")
_manage_team = require_capability("users.manage")


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner lead not found")


def _lead_id(raw: str) -> str:
    lead_id = service.parse_uuid(raw)
    if not lead_id:
        raise _not_found()
    return lead_id


async def _lead_raw(id: str, db: AsyncSession) -> Optional[dict]:
    """Before-snapshot for the audit log (camelCase, like the response)."""
    lead_id = service.parse_uuid(id)
    if not lead_id:
        return None
    row = await service.get_lead(db, lead_id)
    return PartnerLeadDto.model_validate(row).model_dump(mode="json") if row else None


@router.get("", response_model=PaginatedPartnerLeadsDto)
async def list_partner_leads(
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_view),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    sortBy: str = Query("createdAt", pattern="^(createdAt|name|company|status|owner)$"),
    q: Optional[str] = Query(None, max_length=200, description="Search name, company or email"),
    status_: Optional[str] = Query(None, alias="status"),
    source: Optional[str] = Query(None, max_length=80, description="The CTA the lead came from (source_cta)"),
    assignedTo: Optional[str] = Query(None, max_length=254, description="An owner's email, or 'unassigned'"),
    includeSpam: bool = False,
    from_: Optional[dt.datetime] = Query(None, alias="from"),
    to: Optional[dt.datetime] = None,
):
    if status_ and status_ not in PARTNER_LEAD_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(PARTNER_LEAD_STATUSES)}")
    filters = service.LeadFilters(
        q=q, status=status_, source=source, assigned_to=assignedTo, include_spam=includeSpam, from_=from_, to=to
    )
    rows, total = await service.list_leads(db, filters, offset=(page - 1) * limit, limit=limit, order=order,
                                           sort=sortBy)
    return PaginatedPartnerLeadsDto(
        data=[PartnerLeadDto.model_validate(r) for r in rows],
        meta=PageMeta.build(page, limit, total),
    )


@router.get("/summary", response_model=PartnerLeadSummaryDto)
async def partner_lead_summary(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    return PartnerLeadSummaryDto(**(await service.summary(db)))


@router.get("/team", response_model=PartnerTeamDto)
async def partner_team(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    """The partner team: Super App people who can work leads (signed up or invited), with their
    switches, followed by known names that can't take leads right now."""
    rows = [PartnerTeamMemberDto.model_validate(r) for r in await service.get_team(db)]
    if not has_capability(user.role, "users.manage"):
        for m in rows:  # people's exact Super App role is for admins
            m.superAppRole = None
    return PartnerTeamDto(data=rows)


async def _team_member_raw(email: str, db: AsyncSession) -> Optional[dict]:
    m = {r["email"]: r for r in await service.get_team(db)}.get((email or "").strip().lower())
    return PartnerTeamMemberDto.model_validate(m).model_dump(mode="json") if m else None


@router.patch("/team/{email}", response_model=PartnerTeamMemberDto)
@audited(entity_type="PartnerTeamMember", id_param="email", read=_team_member_raw)
async def update_partner_team_member(
    email: str,
    dto: UpdatePartnerTeamMemberDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_manage_team),
):
    """Turn "can be given leads" / "gets the new-lead e-mails" on or off for one person.
    Only people who can work leads (signed up or invited with a sales or admin role)."""
    key = (email or "").strip().lower()
    member = {r["email"]: r for r in await service.get_team(db)}.get(key)
    if not member:
        raise HTTPException(status_code=404, detail="That person isn't on the partner team")
    if member["status"] not in service.TEAM_STATUSES_ON_TEAM:
        raise HTTPException(
            status_code=400,
            detail="That person can't take partner leads right now — invite them (or give them a sales role) first",
        )
    changes: dict = {}
    if "assignable" in dto.model_fields_set:
        changes["assignable"] = dto.assignable
    if "receivesNewLeads" in dto.model_fields_set:
        if dto.receivesNewLeads is None:
            raise HTTPException(status_code=400, detail="receivesNewLeads must be true or false")
        changes["receives_new_leads"] = dto.receivesNewLeads
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change — send assignable and/or receivesNewLeads")
    await service.set_routing(db, key, changes, actor_email=user.email, name=member.get("name"))
    updated = {r["email"]: r for r in await service.get_team(db)}[key]
    return PartnerTeamMemberDto.model_validate(updated)


@router.get("/{id}", response_model=PartnerLeadDetailDto)
async def get_partner_lead(id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    lead_id = _lead_id(id)
    row = await service.get_lead(db, lead_id)
    if not row:
        raise _not_found()
    return PartnerLeadDetailDto(
        **PartnerLeadDto.model_validate(row).model_dump(),
        notes=[PartnerLeadNoteDto.model_validate(n) for n in await service.get_notes(db, lead_id)],
        events=[PartnerLeadEventDto.model_validate(e) for e in await service.get_events(db, lead_id)],
    )


@router.patch("/{id}", response_model=PartnerLeadDto)
@audited(entity_type="PartnerLead", id_param="id", read=_lead_raw)
async def update_partner_lead(
    id: str,
    dto: UpdatePartnerLeadDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    lead_id = _lead_id(id)
    if not await service.get_lead(db, lead_id):
        raise _not_found()

    changes: dict = {}
    if "status" in dto.model_fields_set:
        if dto.status is None:
            raise HTTPException(status_code=400, detail="status can't be empty")
        changes["status"] = dto.status
    if "assignedTo" in dto.model_fields_set:
        owner = (dto.assignedTo or "").strip().lower() or None
        if owner is not None:
            team = {m["email"]: m for m in await service.get_team(db)}
            member = team.get(owner)
            if not member or member.get("status") not in service.TEAM_STATUSES_ON_TEAM:
                raise HTTPException(status_code=400, detail="That person isn't on the partner team")
            if not member.get("assignable", True):
                raise HTTPException(status_code=400, detail="That person can't be assigned leads")
        changes["assigned_to"] = owner
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change — send status and/or assignedTo")

    await service.update_lead(db, lead_id, changes, user.email)
    if changes.get("assigned_to"):
        # E-mail the new owner + Teams card, same as the portal's one-click "Assign to" buttons.
        await service.notify_assigned(lead_id)
    row = await service.get_lead(db, lead_id)
    return PartnerLeadDto.model_validate(row)


@router.post("/{id}/notes", response_model=PartnerLeadNoteDto, status_code=201)
@audited(entity_type="PartnerLeadNote")
async def add_partner_lead_note(
    id: str,
    dto: CreatePartnerLeadNoteDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    lead_id = _lead_id(id)
    if not await service.get_lead(db, lead_id):
        raise _not_found()
    return PartnerLeadNoteDto.model_validate(await service.add_note(db, lead_id, user.email, dto.body))


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
@audited(entity_type="PartnerLead", id_param="id", read=_lead_raw)
async def delete_partner_lead(
    id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_delete),
):
    """Permanently delete a lead (admins only). There is no undo; the audit log keeps the lead row
    as it was (not its notes or history)."""
    lead_id = _lead_id(id)
    if not await service.get_lead(db, lead_id):
        raise _not_found()
    await service.delete_lead(db, lead_id)
