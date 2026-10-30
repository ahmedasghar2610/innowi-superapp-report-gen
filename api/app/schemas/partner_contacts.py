"""DTOs for the partner network (public.partner_contacts).

A contact is someone met at a conference (business card), imported, or added by
hand. It is not a lead: the team decides a contact is a potential partner and
promotes it, which creates the partner lead. Rows are read with plain SQL from
the portal's `public` schema, so DTOs are built from snake_case row mappings and
serialised camelCase like every other DTO here.
"""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.common.pagination import PageMeta

PartnerContactStatus = Literal["new", "potential_partner", "not_a_fit", "customer", "vendor", "other"]
PARTNER_CONTACT_STATUSES: tuple[str, ...] = ("new", "potential_partner", "not_a_fit", "customer", "vendor", "other")
PARTNER_CONTACT_SOURCES: tuple[str, ...] = ("business-card", "manual", "import")

# Same options the partner portal's application form offers.
PARTNER_TYPES: tuple[str, ...] = (
    "ISO / agent organization",
    "Independent sales agent",
    "Bank or financial institution",
    "Payment gateway or processor",
    "Restaurant consultant or POS dealer",
    "Other",
)

_FROM_ROW = {"from_attributes": True, "populate_by_name": True}


def _clean(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


class PartnerContactDto(BaseModel):
    id: str
    createdAt: dt.datetime = Field(..., validation_alias="created_at")
    updatedAt: dt.datetime = Field(..., validation_alias="updated_at")
    status: str
    fullName: str = Field(..., validation_alias="full_name")
    title: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    partnerType: Optional[str] = Field(None, validation_alias="partner_type")
    notes: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    metAt: Optional[str] = Field(None, validation_alias="met_at")
    metOn: Optional[dt.date] = Field(None, validation_alias="met_on")
    source: str
    scannedBy: Optional[str] = Field(None, validation_alias="scanned_by")
    cardId: Optional[str] = Field(None, validation_alias="card_id")
    otherText: Optional[str] = Field(None, validation_alias="other_text")
    photoUrl: Optional[str] = Field(None, validation_alias="photo_url")
    batchId: Optional[str] = Field(None, validation_alias="batch_id")
    promotedLeadId: Optional[str] = Field(None, validation_alias="promoted_lead_id")
    promotedAt: Optional[dt.datetime] = Field(None, validation_alias="promoted_at")
    promotedBy: Optional[str] = Field(None, validation_alias="promoted_by")

    model_config = _FROM_ROW

    @field_validator("id", "promotedLeadId", mode="before")
    @classmethod
    def _uuid_to_str(cls, v):
        return None if v is None else str(v)

    @field_validator("tags", mode="before")
    @classmethod
    def _tags(cls, v):
        return list(v or [])


class PaginatedPartnerContactsDto(BaseModel):
    data: list[PartnerContactDto]
    meta: PageMeta


class CountDto(BaseModel):
    key: str
    count: int


class PartnerContactSummaryDto(BaseModel):
    total: int
    # Status 'new': nobody has looked at it yet.
    unreviewed: int
    promoted: int
    last7Days: int
    byStatus: list[CountDto]
    byEvent: list[CountDto]


class _ContactInput(BaseModel):
    """Shared cleaning rules for create / update / promote bodies."""

    model_config = {"extra": "forbid"}

    @field_validator(
        "fullName", "title", "company", "email", "phone", "website", "address", "partnerType", "notes", "metAt",
        mode="after", check_fields=False,
    )
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)

    @field_validator("email", mode="after", check_fields=False)
    @classmethod
    def _email(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.lower()
        if "@" not in v or v.startswith("@") or v.endswith("@") or " " in v:
            raise ValueError("That doesn't look like an e-mail address")
        return v

    @field_validator("partnerType", mode="after", check_fields=False)
    @classmethod
    def _partner_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in PARTNER_TYPES:
            raise ValueError(f"partnerType must be one of: {', '.join(PARTNER_TYPES)}")
        return v

    @field_validator("tags", mode="after", check_fields=False)
    @classmethod
    def _tags(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if v is None:
            return None
        out: list[str] = []
        for t in v:
            t = (t or "").strip()
            if t and t not in out:
                out.append(t[:40])
        if len(out) > 20:
            raise ValueError("At most 20 tags")
        return out


class UpdatePartnerContactDto(_ContactInput):
    """Everything the team may edit. Omitted fields are left alone; send null to clear a text field."""

    status: Optional[PartnerContactStatus] = None
    fullName: Optional[str] = Field(None, max_length=200)
    title: Optional[str] = Field(None, max_length=200)
    company: Optional[str] = Field(None, max_length=200)
    email: Optional[str] = Field(None, max_length=254)
    phone: Optional[str] = Field(None, max_length=60)
    website: Optional[str] = Field(None, max_length=300)
    address: Optional[str] = Field(None, max_length=500)
    partnerType: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = Field(None, max_length=8000)
    tags: Optional[list[str]] = None
    metAt: Optional[str] = Field(None, max_length=120)
    metOn: Optional[dt.date] = None
    # A blank fullName cleans to None; the router rejects that when the field was sent.


class CreatePartnerContactDto(_ContactInput):
    """Add a contact by hand from the Super App."""

    fullName: str = Field(..., max_length=200)
    title: Optional[str] = Field(None, max_length=200)
    company: Optional[str] = Field(None, max_length=200)
    email: Optional[str] = Field(None, max_length=254)
    phone: Optional[str] = Field(None, max_length=60)
    website: Optional[str] = Field(None, max_length=300)
    address: Optional[str] = Field(None, max_length=500)
    partnerType: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = Field(None, max_length=8000)
    tags: list[str] = Field(default_factory=list)
    metAt: Optional[str] = Field(None, max_length=120)
    metOn: Optional[dt.date] = None

    @field_validator("fullName", mode="after")
    @classmethod
    def _name_required(cls, v: Optional[str]) -> str:
        if not v:
            raise ValueError("Name can't be empty")
        return v


class PromotePartnerContactDto(_ContactInput):
    """Turn a contact into a partner lead. partnerType overrides the contact's own if given."""

    partnerType: Optional[str] = Field(None, max_length=80)


class PromotedDto(BaseModel):
    contact: PartnerContactDto
    leadId: str
