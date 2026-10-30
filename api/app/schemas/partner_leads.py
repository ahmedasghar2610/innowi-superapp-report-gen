"""DTOs for partner leads (applications from partners.innowi.com).

The rows live in the partner portal's own tables (public.partner_leads,
partner_lead_notes, partner_lead_events, partner_team); this API reads them
with plain SQL, so these DTOs are built from row mappings (snake_case columns)
and serialised camelCase like every other DTO here.
"""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.common.pagination import PageMeta

PartnerLeadStatus = Literal["new", "contacted", "qualified", "proposal", "won", "lost", "spam"]
PARTNER_LEAD_STATUSES: tuple[str, ...] = ("new", "contacted", "qualified", "proposal", "won", "lost", "spam")

_FROM_ROW = {"from_attributes": True, "populate_by_name": True}


class PartnerLeadDto(BaseModel):
    id: str
    createdAt: dt.datetime = Field(..., validation_alias="created_at")
    updatedAt: dt.datetime = Field(..., validation_alias="updated_at")
    status: str
    fullName: str = Field(..., validation_alias="full_name")
    title: Optional[str] = None
    company: Optional[str] = None
    email: str
    phone: Optional[str] = None
    website: Optional[str] = None
    partnerType: Optional[str] = Field(None, validation_alias="partner_type")
    region: Optional[str] = None
    portfolioSize: Optional[str] = Field(None, validation_alias="portfolio_size")
    restaurantShare: Optional[str] = Field(None, validation_alias="restaurant_share")
    processors: Optional[str] = None
    interests: list[str] = Field(default_factory=list)
    timeline: Optional[str] = None
    heardAbout: Optional[str] = Field(None, validation_alias="heard_about")
    message: Optional[str] = None
    wantsCall: bool = Field(False, validation_alias="wants_call")
    sourceCta: Optional[str] = Field(None, validation_alias="source_cta")
    landingUrl: Optional[str] = Field(None, validation_alias="landing_url")
    referrer: Optional[str] = None
    utmSource: Optional[str] = Field(None, validation_alias="utm_source")
    utmMedium: Optional[str] = Field(None, validation_alias="utm_medium")
    utmCampaign: Optional[str] = Field(None, validation_alias="utm_campaign")
    utmTerm: Optional[str] = Field(None, validation_alias="utm_term")
    utmContent: Optional[str] = Field(None, validation_alias="utm_content")
    assignedTo: Optional[str] = Field(None, validation_alias="assigned_to")
    assignedAt: Optional[dt.datetime] = Field(None, validation_alias="assigned_at")
    lastContactedAt: Optional[dt.datetime] = Field(None, validation_alias="last_contacted_at")
    notifiedAt: Optional[dt.datetime] = Field(None, validation_alias="notified_at")
    teamsNotifiedAt: Optional[dt.datetime] = Field(None, validation_alias="teams_notified_at")

    model_config = _FROM_ROW

    @field_validator("id", mode="before")
    @classmethod
    def _uuid_to_str(cls, v):
        return str(v)

    @field_validator("interests", mode="before")
    @classmethod
    def _interests(cls, v):
        return list(v or [])


class PartnerLeadNoteDto(BaseModel):
    id: str
    authorEmail: str = Field(..., validation_alias="author_email")
    body: str
    createdAt: dt.datetime = Field(..., validation_alias="created_at")

    model_config = _FROM_ROW

    @field_validator("id", mode="before")
    @classmethod
    def _uuid_to_str(cls, v):
        return str(v)


class PartnerLeadEventDto(BaseModel):
    id: str
    actorEmail: Optional[str] = Field(None, validation_alias="actor_email")
    type: str
    detail: Optional[dict] = None
    createdAt: dt.datetime = Field(..., validation_alias="created_at")

    model_config = _FROM_ROW

    @field_validator("id", mode="before")
    @classmethod
    def _uuid_to_str(cls, v):
        return str(v)


class PartnerLeadDetailDto(PartnerLeadDto):
    notes: list[PartnerLeadNoteDto] = Field(default_factory=list)
    events: list[PartnerLeadEventDto] = Field(default_factory=list)


class PaginatedPartnerLeadsDto(BaseModel):
    data: list[PartnerLeadDto]
    meta: PageMeta


class PartnerTeamMemberDto(BaseModel):
    """One person on the partner team, which is built from the Super App's people:
    everyone signed up or invited with a role that can work leads, plus known names
    that can't take leads right now (status other than active / invited)."""

    email: str
    name: Optional[str] = None
    # 'admin' | 'member' (kept from the portal's shape); superAppRole is the real role.
    role: str
    superAppRole: Optional[str] = Field(None, validation_alias="superapp_role")
    assignable: bool = True
    receivesNewLeads: bool = Field(False, validation_alias="receives_new_leads")
    # active | invited | no_login | inactive | other_role
    status: str = "active"

    model_config = _FROM_ROW


class PartnerTeamDto(BaseModel):
    data: list[PartnerTeamMemberDto]


class CountDto(BaseModel):
    key: str
    count: int


class PartnerLeadSummaryDto(BaseModel):
    total: int
    # Status 'new' with no owner — the queue someone has to pick up.
    unassigned: int
    last7Days: int
    byStatus: list[CountDto]
    bySource: list[CountDto]


class UpdatePartnerLeadDto(BaseModel):
    """Only status and owner can change from the Super App. Send `assignedTo: null` to unassign."""

    status: Optional[PartnerLeadStatus] = None
    assignedTo: Optional[str] = Field(None, max_length=254)

    model_config = {"extra": "forbid"}


class UpdatePartnerTeamMemberDto(BaseModel):
    """The two per-person switches. `assignable: null` puts it back to the role's default."""

    assignable: Optional[bool] = None
    receivesNewLeads: Optional[bool] = None

    model_config = {"extra": "forbid"}


class CreatePartnerLeadNoteDto(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)

    model_config = {"extra": "forbid"}

    @field_validator("body")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Note can't be empty")
        return v
