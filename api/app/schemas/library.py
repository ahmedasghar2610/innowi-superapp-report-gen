"""Ops CRM Library + credentials vault DTOs."""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Optional

from pydantic import BaseModel, BeforeValidator, Field

from app.models.enums import CredentialAction, LibrarySection
from app.schemas.ops import MerchantRefDto, PersonRefDto

_FORBID = {"extra": "forbid"}


def _trim(v):
    return v.strip() if isinstance(v, str) else v


def _blank_to_none(v):
    v = _trim(v)
    return None if v == "" else v


Trimmed = Annotated[str, BeforeValidator(_trim)]
OptText = Annotated[Optional[str], BeforeValidator(_blank_to_none)]


# ---- pages --------------------------------------------------------------------
class LibraryPageSummaryDto(BaseModel):
    id: str
    title: str
    section: LibrarySection
    parentId: Optional[str] = None
    merchant: Optional[MerchantRefDto] = None
    version: int
    position: int
    updatedAt: dt.datetime


class LibraryTreeDto(BaseModel):
    data: list[LibraryPageSummaryDto]


class LibraryPageDto(LibraryPageSummaryDto):
    body: str
    owner: Optional[PersonRefDto] = None
    updatedBy: Optional[PersonRefDto] = None
    createdAt: dt.datetime
    childCount: int
    canDelete: bool
    # Tickets this page is linked to (ticket page → Library).
    linkedTickets: list[dict] = []


class CreateLibraryPageDto(BaseModel):
    title: Trimmed = Field(..., min_length=1, max_length=200)
    section: LibrarySection
    parentId: OptText = None
    merchantId: OptText = None  # required when section = MERCHANT
    body: str = Field("", max_length=100_000)
    model_config = _FORBID


class UpdateLibraryPageDto(BaseModel):
    title: Optional[Trimmed] = Field(None, min_length=1, max_length=200)
    body: Optional[str] = Field(None, max_length=100_000)
    section: Optional[LibrarySection] = None
    parentId: OptText = None
    merchantId: OptText = None
    ownerId: OptText = None
    # Optimistic concurrency: the version the editor started from. A save
    # against a newer version is refused (409) instead of overwriting it.
    baseVersion: Optional[int] = None
    model_config = _FORBID


class LibraryVersionDto(BaseModel):
    version: int
    title: str
    body: str
    editedBy: Optional[PersonRefDto] = None
    createdAt: dt.datetime


class LibraryVersionsDto(BaseModel):
    data: list[LibraryVersionDto]


# ---- credentials ----------------------------------------------------------------
class CredentialDto(BaseModel):
    """Never contains the secret — that only comes from POST …/reveal."""

    id: str
    label: str
    username: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None
    merchant: Optional[MerchantRefDto] = None  # null = an Innowi login
    updatedAt: dt.datetime


class CredentialsDto(BaseModel):
    data: list[CredentialDto]
    # Can the signed-in user reveal / manage? (UI hints; enforced by the API.)
    canReveal: bool
    canManage: bool
    # False when CREDENTIAL_ENCRYPTION_KEY isn't set — nothing can be stored.
    configured: bool


class CreateCredentialDto(BaseModel):
    label: Trimmed = Field(..., min_length=1, max_length=120)
    username: OptText = Field(None, max_length=200)
    url: OptText = Field(None, max_length=500)
    notes: OptText = Field(None, max_length=2000)
    secret: str = Field(..., min_length=1, max_length=2000)
    merchantId: OptText = None
    model_config = _FORBID


class UpdateCredentialDto(BaseModel):
    label: Optional[Trimmed] = Field(None, min_length=1, max_length=120)
    username: OptText = Field(None, max_length=200)
    url: OptText = Field(None, max_length=500)
    notes: OptText = Field(None, max_length=2000)
    secret: Optional[str] = Field(None, min_length=1, max_length=2000)  # omit to keep the current one
    model_config = _FORBID


class RevealCredentialDto(BaseModel):
    reason: Trimmed = Field(..., min_length=3, max_length=300)  # e.g. "OPS-1042 · posting the logo"
    model_config = _FORBID


class RevealedCredentialDto(BaseModel):
    id: str
    secret: str


class CredentialLogEntryDto(BaseModel):
    id: str
    action: CredentialAction
    credentialLabel: str
    user: Optional[PersonRefDto] = None
    userEmail: Optional[str] = None
    reason: Optional[str] = None
    createdAt: dt.datetime


class CredentialLogDto(BaseModel):
    data: list[CredentialLogEntryDto]
