"""Response shapes for the Sales module (/api/v1/sales/*). camelCase on the wire, like every other DTO here."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.common.pagination import PageMeta
from app.models.enums import Role, UserStatus


class SalesMeDto(BaseModel):
    """What the signed-in person can see in the Sales module."""

    configured: bool            # Salesforce credentials are set on the API
    linked: bool                # this login is tied to a Salesforce user
    sfUserId: Optional[str] = None
    sfUserName: Optional[str] = None
    seeAll: bool                # sees every salesperson's records
    canManage: bool             # runs the sync, links logins
    lastSyncAt: Optional[dt.datetime] = None
    salesforceUrl: Optional[str] = None  # base for "Open in Salesforce" links


class DealDto(BaseModel):
    id: str
    name: str
    accountId: Optional[str] = None
    accountName: Optional[str] = None
    ownerId: Optional[str] = None
    ownerName: Optional[str] = None
    stageName: str
    columnKey: str
    columnLabel: str
    isOpen: bool
    isWon: bool
    amount: Optional[Decimal] = None
    closeDate: Optional[dt.date] = None
    recordTypeName: Optional[str] = None
    createdAt: Optional[dt.datetime] = None
    lastModifiedAt: Optional[dt.datetime] = None
    daysSinceChange: Optional[int] = None
    isStale: bool = False       # open and unchanged for 6+ months
    isStuck: bool = False       # open, not stale, unchanged for 30+ days


class PaginatedDealsDto(BaseModel):
    data: list[DealDto]
    meta: PageMeta


class PipelineColumnDto(BaseModel):
    key: str
    label: str
    isOpen: bool
    isWon: bool
    count: int
    amount: Decimal
    deals: list[DealDto]        # the most recently changed, up to `perColumn`


class PipelineDto(BaseModel):
    columns: list[PipelineColumnDto]
    openCount: int
    openAmount: Decimal
    staleHidden: int            # open deals left out because they are stale


class VisitDto(BaseModel):
    id: str
    name: Optional[str] = None
    accountId: Optional[str] = None
    accountName: Optional[str] = None
    ownerId: Optional[str] = None
    ownerName: Optional[str] = None
    visitType: Optional[str] = None
    status: Optional[str] = None
    address: Optional[str] = None
    dueDateStart: Optional[dt.date] = None
    dueDateEnd: Optional[dt.date] = None
    appointmentTime: Optional[str] = None
    completedDate: Optional[dt.date] = None
    isOverdue: bool = False


class PaginatedVisitsDto(BaseModel):
    data: list[VisitDto]
    meta: PageMeta


class CaseDto(BaseModel):
    id: str
    caseNumber: Optional[str] = None
    subject: Optional[str] = None
    status: Optional[str] = None
    origin: Optional[str] = None
    priority: Optional[str] = None
    accountId: Optional[str] = None
    accountName: Optional[str] = None
    ownerName: Optional[str] = None
    isClosed: bool
    createdAt: Optional[dt.datetime] = None
    closedAt: Optional[dt.datetime] = None
    issueCategory: Optional[str] = None
    # Recorded team, else estimated from the issue category (departmentSource says which).
    department: Optional[str] = None
    departmentSource: Optional[str] = None
    details: Optional[str] = None
    resolutionType: Optional[str] = None


class PaginatedCasesDto(BaseModel):
    data: list[CaseDto]
    meta: PageMeta


class ContactDto(BaseModel):
    id: str
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    mobilePhone: Optional[str] = None


class TouchpointDto(BaseModel):
    id: str
    healthStatus: Optional[str] = None
    latestStatus: Optional[str] = None
    latestTouchpointDate: Optional[dt.date] = None
    ownerName: Optional[str] = None


class CustomerDto(BaseModel):
    id: str
    name: str
    city: Optional[str] = None
    state: Optional[str] = None
    phone: Optional[str] = None
    ownerName: Optional[str] = None
    health: Optional[str] = None
    lastTouchpointDate: Optional[dt.date] = None
    openDeals: int = 0
    wonDeals: int = 0
    openCases: int = 0


class PaginatedCustomersDto(BaseModel):
    data: list[CustomerDto]
    meta: PageMeta


class CustomerDetailDto(CustomerDto):
    website: Optional[str] = None
    street: Optional[str] = None
    postalCode: Optional[str] = None
    contacts: list[ContactDto] = []
    deals: list[DealDto] = []
    visits: list[VisitDto] = []
    cases: list[CaseDto] = []
    touchpoints: list[TouchpointDto] = []


class DealDetailDto(DealDto):
    probability: Optional[Decimal] = None
    leadSource: Optional[str] = None
    customer: Optional[CustomerDetailDto] = None


class SummaryCountsDto(BaseModel):
    openDeals: int
    stuckDeals: int
    staleDeals: int
    visitsDueToday: int
    visitsOverdue: int
    visitsNext7Days: int
    openCases: int


class SummaryDto(BaseModel):
    today: dt.date
    counts: SummaryCountsDto
    stuckDeals: list[DealDto]
    visitsDue: list[VisitDto]
    openCases: list[CaseDto]
    lastSyncAt: Optional[dt.datetime] = None


class OwnerDto(BaseModel):
    id: str
    name: str


class TeamMemberDto(BaseModel):
    sfUserId: str
    name: str
    email: Optional[str] = None
    isActive: bool
    lastSalesforceLogin: Optional[dt.datetime] = None
    openDeals: int
    staleDeals: int
    dealsCreated30d: int
    wonDeals: int
    visitsPending: int
    visitsCompleted30d: int
    openCases: int
    superappUserEmail: Optional[str] = None


class LinkedUserDto(BaseModel):
    id: str
    email: str
    role: Role
    status: UserStatus


class PersonDto(BaseModel):
    """A Salesforce user and the SuperApp login linked to it, if any."""

    sfUserId: str
    name: str
    email: Optional[str] = None
    profileName: Optional[str] = None
    isActive: bool
    lastSalesforceLogin: Optional[dt.datetime] = None
    ownsDeals: int
    ownsVisits: int
    linkedUser: Optional[LinkedUserDto] = None
    suggestedUser: Optional[LinkedUserDto] = None   # an unlinked login with the same email


class CreateLoginDto(BaseModel):
    role: Literal["SALES_EXECUTIVE", "SALES_MANAGER"] = "SALES_EXECUTIVE"
    # Validated (as an email) when the login is built, which also covers the Salesforce email fallback.
    email: Optional[str] = Field(None, max_length=255, description="Defaults to the Salesforce user's email")

    model_config = {"extra": "forbid"}


class CreatedLoginDto(BaseModel):
    person: PersonDto
    temporaryPassword: str = Field(..., description="Shown once. Share it privately. (No forced change or reset "
                                                     "screen exists yet.)")


class LinkUserDto(BaseModel):
    userId: str = Field(..., min_length=1, max_length=30)

    model_config = {"extra": "forbid"}


class RunSyncDto(BaseModel):
    full: bool = Field(False, description="Forget saved positions and re-copy everything, then check every "
                                          "object against Salesforce for deletions. Resumes over later runs if cut short.")

    model_config = {"extra": "forbid"}


class SyncObjectDto(BaseModel):
    objectName: str
    recordCount: int
    lastSuccessAt: Optional[dt.datetime] = None
    lastModstamp: Optional[dt.datetime] = None
    lastError: Optional[str] = None


class SyncRunDto(BaseModel):
    id: str
    trigger: str
    status: str
    startedAt: dt.datetime
    finishedAt: Optional[dt.datetime] = None
    apiCalls: int
    upserted: int
    deleted: int
    error: Optional[str] = None


class SyncStatusDto(BaseModel):
    configured: bool
    lastSuccessAt: Optional[dt.datetime] = None
    apiCallsLast24h: int
    objects: list[SyncObjectDto]
    runs: list[SyncRunDto]


class MonthPointDto(BaseModel):
    month: str                  # "2026-10"
    count: int
    amount: Decimal


class StageBarDto(BaseModel):
    key: str
    label: str
    count: int
    amount: Decimal


class HealthSliceDto(BaseModel):
    status: str                 # Touchpoint health as Salesforce has it, or "No check-in"
    count: int


class LeaderDto(BaseModel):
    ownerId: str
    name: str
    wonCount: int               # won with a close date in the last 90 days
    wonAmount: Decimal
    openDeals: int


class InsightTotalsDto(BaseModel):
    openDeals: int
    openAmount: Decimal
    wonThisMonth: int
    wonThisMonthAmount: Decimal
    wonLast12Months: int
    wonLast12MonthsAmount: Decimal
    lostLast12Months: int
    winRate: Optional[float] = None   # won / (won + lost) over 12 months; None when nothing closed
    dealsWithoutAmount: int           # open deals with a blank amount (so $ totals undercount)


class InsightsDto(BaseModel):
    """Numbers for the animated overview on My Day. Same visibility rules as every Sales endpoint."""

    today: dt.date
    totals: InsightTotalsDto
    wonByMonth: list[MonthPointDto]      # last 12 calendar months, oldest first, by close date
    newByMonth: list[MonthPointDto]      # deals created per month, same window
    pipelineByStage: list[StageBarDto]   # open, not stale, in pipeline order
    health: list[HealthSliceDto]         # restaurants the viewer works with, by latest check-in
    leaderboard: list[LeaderDto] = []    # managers looking at everyone only
