"""Churned accounts (the win-back list) — request/response shapes."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.common.pagination import PageMeta
from app.models.enums import MerchantStatus, WinbackStatus
from app.schemas.ops import PersonRefDto


class ChurnContactDto(BaseModel):
    id: str
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class ChurnLocationDto(BaseModel):
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None


class ChurnNoteDto(BaseModel):
    id: str
    body: str
    author: Optional[PersonRefDto] = None
    createdAt: dt.datetime


class ChurnRowDto(BaseModel):
    """One churned merchant as the list shows it."""
    merchantId: str
    churnId: str
    restaurantName: str
    merchantCode: Optional[str] = None
    merchantStatus: MerchantStatus
    region: Optional[str] = None
    innowiSolution: Optional[str] = None
    accountTier: Optional[int] = None
    accountManager: Optional[str] = None
    churnedOn: Optional[dt.date] = None
    category: Optional[str] = None
    categories: list[str] = Field(default_factory=list)
    reason: Optional[str] = None
    csmName: Optional[str] = None
    mrrAtChurn: Optional[Decimal] = None
    gpvAtChurn: Optional[Decimal] = None
    startDate: Optional[dt.date] = None
    lastTouchpointOn: Optional[dt.date] = None
    source: Optional[str] = None
    winbackStatus: WinbackStatus
    winbackOwner: Optional[PersonRefDto] = None
    winbackNotes: Optional[str] = None
    nextFollowUpOn: Optional[dt.date] = None
    contact: Optional[ChurnContactDto] = None
    location: Optional[ChurnLocationDto] = None
    notesCount: int = 0
    updatedAt: dt.datetime


class ChurnDetailDto(ChurnRowDto):
    notes: list[ChurnNoteDto] = Field(default_factory=list)
    contacts: list[ChurnContactDto] = Field(default_factory=list)


class ChurnListDto(BaseModel):
    data: list[ChurnRowDto]
    meta: PageMeta


class ChurnQueryDto(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(50, ge=1, le=200)
    search: Optional[str] = Field(None, max_length=200)
    region: Optional[str] = Field(None, max_length=60)
    category: Optional[str] = Field(None, max_length=120)
    csm: Optional[str] = Field(None, max_length=120)
    winbackStatus: Optional[WinbackStatus] = None
    ownerId: Optional[str] = None
    # "mine" — only accounts whose win-back owner is the caller
    mine: bool = False
    churnedFrom: Optional[dt.date] = None
    churnedTo: Optional[dt.date] = None
    hasReason: Optional[bool] = None
    sortBy: str = Field("churnedOn", pattern="^(churnedOn|restaurantName|mrrAtChurn|gpvAtChurn|updatedAt|nextFollowUpOn)$")
    order: str = Field("desc", pattern="^(asc|desc)$")

    model_config = {"extra": "forbid"}

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit


class CountDto(BaseModel):
    key: str
    count: int
    mrr: Decimal = Decimal("0")
    gpv: Decimal = Decimal("0")


class ChurnSummaryDto(BaseModel):
    total: int
    withReason: int
    mrrLost: Decimal
    gpvLost: Decimal
    byRegion: list[CountDto]
    byCategory: list[CountDto]
    byWinback: list[CountDto]
    byCsm: list[CountDto]
    bySolution: list[CountDto]
    byMonth: list[CountDto]
    # distinct values for filter dropdowns
    regions: list[str]
    categories: list[str]
    csms: list[str]
    owners: list[PersonRefDto]


class UpdateChurnDto(BaseModel):
    """Win-back fields and (for managers) the churn facts themselves."""
    winbackStatus: Optional[WinbackStatus] = None
    winbackOwnerId: Optional[str] = None
    clearWinbackOwner: bool = False
    winbackNotes: Optional[str] = Field(None, max_length=10000)
    nextFollowUpOn: Optional[dt.date] = None
    clearNextFollowUp: bool = False
    churnedOn: Optional[dt.date] = None
    category: Optional[str] = Field(None, max_length=200)
    reason: Optional[str] = Field(None, max_length=5000)
    csmName: Optional[str] = Field(None, max_length=120)
    mrrAtChurn: Optional[Decimal] = None
    gpvAtChurn: Optional[Decimal] = None

    model_config = {"extra": "forbid"}


class MarkChurnedDto(BaseModel):
    """Mark an existing merchant as churned (creates the churn record)."""
    churnedOn: Optional[dt.date] = None
    category: Optional[str] = Field(None, max_length=200)
    reason: Optional[str] = Field(None, max_length=5000)
    csmName: Optional[str] = Field(None, max_length=120)
    mrrAtChurn: Optional[Decimal] = None
    gpvAtChurn: Optional[Decimal] = None

    model_config = {"extra": "forbid"}


class CreateChurnNoteDto(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)

    model_config = {"extra": "forbid"}


class ImportSheetDto(BaseModel):
    name: str
    layout: str
    rows: int
    skipped: int


class ChurnImportReportDto(BaseModel):
    fileName: str
    dryRun: bool
    sheets: list[ImportSheetDto]
    rowsRead: int
    merchantsCreated: int
    merchantsMatched: int
    contactsAdded: int
    locationsAdded: int
    churnRecordsCreated: int
    churnRecordsUpdated: int
    duplicatesInFile: int
    ambiguous: list[dict[str, Any]]
    skipped: list[dict[str, Any]]
