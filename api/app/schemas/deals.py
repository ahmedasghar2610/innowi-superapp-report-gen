"""Spine — organizations and deals: request/response shapes."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.common.pagination import PageMeta
from app.models.enums import (
    DealEventKind, DealStage, DeployedBy, HiredBy, MerchantStatus, OrganizationKind, OrganizationStatus,
)
from app.modules.deals.partners import CameFromKey, StageKey
from app.schemas.ops import PersonRefDto

OrganizationSourceQuery = Literal["MANUAL", "SPREADSHEET", "PARTNER_LEAD", "BUSINESS_CARD", "AGENT_LIST", "SALESFORCE", "NONE"]


def _strip(v):
    return v.strip() if isinstance(v, str) else v


class _In(BaseModel):
    model_config = {"extra": "forbid"}


# ============================================================ organizations ==
class OrganizationContactIn(_In):
    name: str = Field(..., min_length=1, max_length=160)
    role: Optional[str] = Field(None, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=40)
    isPrimary: bool = False

    _s = field_validator("name", "role", "phone", mode="before")(_strip)


class OrganizationContactDto(BaseModel):
    id: str
    name: str
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    isPrimary: bool = False
    createdAt: dt.datetime


class CreateOrganizationDto(_In):
    name: str = Field(..., min_length=1, max_length=200)
    kind: OrganizationKind
    status: OrganizationStatus = OrganizationStatus.PROSPECT
    website: Optional[str] = Field(None, max_length=500)
    phone: Optional[str] = Field(None, max_length=40)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(None, max_length=300)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=40)
    zip: Optional[str] = Field(None, max_length=20)
    notes: Optional[str] = Field(None, max_length=10000)
    partnerLeadId: Optional[str] = Field(None, max_length=60)
    stage: StageKey = "NEW"
    cameFrom: Optional[CameFromKey] = None
    cameFromDetail: Optional[str] = Field(None, max_length=200)
    # An agent under an ISO.
    parentId: Optional[str] = Field(None, max_length=30)
    # Needs organizations.assign unless it is the person creating it.
    ownerId: Optional[str] = Field(None, max_length=30)
    nextStep: Optional[str] = Field(None, max_length=300)
    nextStepDue: Optional[dt.date] = None
    contacts: list[OrganizationContactIn] = Field(default_factory=list, max_length=50)

    _s = field_validator("name", "website", "phone", "address", "city", "state", "zip", "cameFromDetail", "nextStep",
                         mode="before")(_strip)


class UpdateOrganizationDto(_In):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    kind: Optional[OrganizationKind] = None
    status: Optional[OrganizationStatus] = None
    website: Optional[str] = Field(None, max_length=500)
    phone: Optional[str] = Field(None, max_length=40)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(None, max_length=300)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=40)
    zip: Optional[str] = Field(None, max_length=20)
    notes: Optional[str] = Field(None, max_length=10000)
    certified: Optional[bool] = None
    partnerLeadId: Optional[str] = Field(None, max_length=60)
    stage: Optional[StageKey] = None
    cameFrom: Optional[CameFromKey] = None
    cameFromDetail: Optional[str] = Field(None, max_length=200)
    clearCameFrom: bool = False
    parentId: Optional[str] = Field(None, max_length=30)
    clearParent: bool = False
    ownerId: Optional[str] = Field(None, max_length=30)
    clearOwner: bool = False
    nextStep: Optional[str] = Field(None, max_length=300)
    nextStepDue: Optional[dt.date] = None
    clearNextStep: bool = False
    salesforceAccountId: Optional[str] = Field(None, min_length=15, max_length=18)
    clearSalesforce: bool = False

    _s = field_validator("name", "website", "phone", "address", "city", "state", "zip", "cameFromDetail", "nextStep",
                         mode="before")(_strip)


class OrganizationDto(BaseModel):
    id: str
    name: str
    kind: OrganizationKind
    # Kept for history; "selling" below is what active means now.
    status: OrganizationStatus
    website: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    notes: Optional[str] = None
    certified: bool
    certifiedAt: Optional[dt.datetime] = None
    partnerLeadId: Optional[str] = None
    # Where the record came from (app/models/sources.py) and the file / lead behind it.
    source: Optional[str] = None
    sourceDetail: Optional[str] = None
    stage: str = "NEW"
    stageChangedAt: Optional[dt.datetime] = None
    iuEnrolledAt: Optional[dt.datetime] = None
    cameFrom: Optional[str] = None
    cameFromDetail: Optional[str] = None
    owner: Optional[PersonRefDto] = None
    assignedAt: Optional[dt.datetime] = None
    nextStep: Optional[str] = None
    nextStepDue: Optional[dt.date] = None
    needsReview: bool = False
    salesforceAccountId: Optional[str] = None
    parent: Optional["OrgRefDto"] = None
    # Agents under this ISO (0 for everything else).
    agentCount: int = 0
    agentsIuEnrolled: int = 0
    agentsCertified: int = 0
    agentsSelling: int = 0
    # Own deals (an ISO's include its agents' deals).
    dealCount: int = 0
    liveCount: int = 0
    dealsLast30: int = 0
    # At least one deal in the last 30 days (an ISO: itself or any of its agents).
    selling: bool = False
    primaryContact: Optional[OrganizationContactDto] = None
    createdAt: dt.datetime
    updatedAt: dt.datetime


class OrganizationEventDto(BaseModel):
    id: str
    kind: str
    fromValue: Optional[str] = None
    toValue: Optional[str] = None
    body: Optional[str] = None
    actor: Optional[PersonRefDto] = None
    createdAt: dt.datetime


class OrganizationDetailDto(OrganizationDto):
    contacts: list[OrganizationContactDto] = Field(default_factory=list)
    deals: list["DealRowDto"] = Field(default_factory=list)
    events: list[OrganizationEventDto] = Field(default_factory=list)


OrgSortBy = Literal["name", "createdAt", "updatedAt", "stage", "owner", "deals", "agents", "nextStepDue", "cameFrom"]


class OrganizationQueryDto(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(50, ge=1, le=200)
    search: Optional[str] = Field(None, max_length=200)
    kind: Optional[OrganizationKind] = None
    status: Optional[OrganizationStatus] = None
    certified: Optional[bool] = None
    # A source key from app/models/sources.py, or "NONE" for records with none recorded.
    source: Optional[OrganizationSourceQuery] = None
    stage: Optional[StageKey] = None
    cameFrom: Optional[Literal["ELAVON", "BMO", "DIRECT", "CONFERENCE", "INBOUND_PARTNER", "INBOUND_SUPPORT",
                               "INBOUND_GENERIC", "NONE"]] = None
    # A user id, "me", or "none" (unassigned).
    ownerId: Optional[str] = Field(None, max_length=30)
    # The agents of one ISO.
    parentId: Optional[str] = Field(None, max_length=30)
    # Leave out agents (the main Organizations list). Ignored when parentId is set.
    topLevel: bool = False
    needsReview: Optional[bool] = None
    selling: Optional[bool] = None
    sortBy: OrgSortBy = "name"
    order: Literal["asc", "desc"] = "asc"
    model_config = {"extra": "forbid"}

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit


class OrganizationListDto(BaseModel):
    data: list[OrganizationDto]
    meta: PageMeta


class AgentIn(_In):
    """One agent pasted into an ISO (a row of their agent list)."""
    name: str = Field(..., min_length=1, max_length=200)
    contactName: Optional[str] = Field(None, max_length=160)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=40)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=40)

    _s = field_validator("name", "contactName", "phone", "city", "state", mode="before")(_strip)


class AddAgentsDto(_In):
    agents: list[AgentIn] = Field(..., min_length=1, max_length=1000)
    # Leave the ones that match an agent already under this ISO (same name or e-mail) alone.
    dryRun: bool = False


class AddAgentsResultDto(BaseModel):
    created: int
    skipped: list[dict]
    dryRun: bool


class AssignPersonIn(_In):
    userId: str = Field(..., max_length=30)
    # How many this person gets; leave out on every person to split evenly.
    count: Optional[int] = Field(None, ge=0, le=10000)


class AssignDto(_In):
    """Hand many partners or agents to the sales team at once."""
    # Either an explicit list, or every agent of one ISO.
    organizationIds: Optional[list[str]] = Field(None, max_length=2000)
    parentId: Optional[str] = Field(None, max_length=30)
    onlyUnassigned: bool = True
    people: list[AssignPersonIn] = Field(..., min_length=1, max_length=50)
    keepTogether: Literal["state", "city", "none"] = "state"
    # Even split that also evens out what each person already owns.
    balanceLoad: bool = False
    dryRun: bool = True


class AssignPersonResultDto(BaseModel):
    user: PersonRefDto
    target: int
    count: int
    existing: int
    groups: list[str]
    sample: list[str]


class AssignResultDto(BaseModel):
    dryRun: bool
    total: int
    assigned: int
    leftOver: int
    skippedAlreadyOwned: int
    people: list[AssignPersonResultDto]


class OrganizationLinksDto(BaseModel):
    """partner lead id / business card id -> the organization it belongs to."""
    leads: dict[str, "OrgRefDto"] = Field(default_factory=dict)
    cards: dict[str, "OrgRefDto"] = Field(default_factory=dict)


class LinkOrganizationDto(_In):
    """Make (or link) the organization for a partner lead or a business card."""
    organizationId: Optional[str] = Field(None, max_length=30)
    kind: Optional[OrganizationKind] = None


# ==================================================================== deals ==
class NewMerchantIn(_In):
    """A restaurant that isn't a merchant yet: created with the deal, status PROSPECT."""
    restaurantName: str = Field(..., min_length=1, max_length=200)
    region: Optional[str] = Field(None, max_length=60)
    contactName: Optional[str] = Field(None, max_length=160)
    contactEmail: Optional[EmailStr] = None
    contactPhone: Optional[str] = Field(None, max_length=40)
    address: Optional[str] = Field(None, max_length=300)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=40)
    zip: Optional[str] = Field(None, max_length=20)

    _s = field_validator("restaurantName", "region", "contactName", "contactPhone", "address", "city", "state", "zip",
                         mode="before")(_strip)


class CreateDealDto(_In):
    merchantId: Optional[str] = Field(None, max_length=30)
    newMerchant: Optional[NewMerchantIn] = None
    organizationId: Optional[str] = Field(None, max_length=30)
    ownerId: Optional[str] = Field(None, max_length=30)
    stage: DealStage = DealStage.NEW
    source: Optional[str] = Field(None, max_length=60)
    demoAt: Optional[dt.datetime] = None
    notes: Optional[str] = Field(None, max_length=10000)


class UpdateDealDto(_In):
    stage: Optional[DealStage] = None
    lostReason: Optional[str] = Field(None, max_length=500)
    ownerId: Optional[str] = Field(None, max_length=30)
    clearOwner: bool = False
    organizationId: Optional[str] = Field(None, max_length=30)
    clearOrganization: bool = False
    source: Optional[str] = Field(None, max_length=60)
    amountMonthly: Optional[Decimal] = Field(None, ge=0, le=Decimal("99999999.99"))
    amountOneTime: Optional[Decimal] = Field(None, ge=0, le=Decimal("99999999.99"))
    demoAt: Optional[dt.datetime] = None
    clearDemoAt: bool = False
    deploymentDate: Optional[dt.date] = None
    clearDeploymentDate: bool = False
    deployedBy: Optional[DeployedBy] = None
    contractorOrganizationId: Optional[str] = Field(None, max_length=30)
    clearContractor: bool = False
    hiredBy: Optional[HiredBy] = None
    goLiveDate: Optional[dt.date] = None
    notes: Optional[str] = Field(None, max_length=10000)


class DealNoteDto(_In):
    body: str = Field(..., min_length=1, max_length=5000)


class LinkQuoteDto(_In):
    linkId: str = Field(..., max_length=30)


class DealEventDto(BaseModel):
    id: str
    kind: DealEventKind
    fromStage: Optional[DealStage] = None
    toStage: Optional[DealStage] = None
    body: Optional[str] = None
    actor: Optional[PersonRefDto] = None
    createdAt: dt.datetime


class DealQuoteDto(BaseModel):
    linkId: str
    mode: str
    linkStatus: str
    createdAt: dt.datetime
    requestId: Optional[str] = None
    requestNumber: Optional[str] = None
    requestStatus: Optional[str] = None
    oneTimeTotal: Optional[Decimal] = None
    monthlyTotal: Optional[Decimal] = None


class OrgRefDto(BaseModel):
    id: str
    name: str
    kind: OrganizationKind


class DealRowDto(BaseModel):
    id: str
    key: str
    number: int
    merchantId: str
    restaurantName: str
    merchantStatus: MerchantStatus
    region: Optional[str] = None
    organization: Optional[OrgRefDto] = None
    owner: Optional[PersonRefDto] = None
    stage: DealStage
    stageChangedAt: dt.datetime
    source: Optional[str] = None
    lostReason: Optional[str] = None
    amountMonthly: Optional[Decimal] = None
    amountOneTime: Optional[Decimal] = None
    demoAt: Optional[dt.datetime] = None
    deploymentDate: Optional[dt.date] = None
    deployedBy: Optional[DeployedBy] = None
    contractor: Optional[OrgRefDto] = None
    hiredBy: Optional[HiredBy] = None
    goLiveDate: Optional[dt.date] = None
    quoteCount: int = 0
    createdAt: dt.datetime
    updatedAt: dt.datetime


class DealDetailDto(DealRowDto):
    notes: Optional[str] = None
    events: list[DealEventDto] = Field(default_factory=list)
    quotes: list[DealQuoteDto] = Field(default_factory=list)


class DealQueryDto(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(50, ge=1, le=200)
    search: Optional[str] = Field(None, max_length=200)
    stage: Optional[DealStage] = None
    # "OPEN" = everything that is not LIVE or LOST
    bucket: Optional[Literal["OPEN", "WON", "LOST", "ALL"]] = None
    ownerId: Optional[str] = None
    mine: bool = False
    organizationId: Optional[str] = None
    merchantId: Optional[str] = None
    sortBy: str = Field("updatedAt", pattern="^(updatedAt|createdAt|stageChangedAt|restaurantName|amountMonthly|number)$")
    order: str = Field("desc", pattern="^(asc|desc)$")
    model_config = {"extra": "forbid"}

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit


class MerchantPickDto(BaseModel):
    """A merchant as the new-deal picker shows it (the sales roles cannot read /merchants)."""
    id: str
    restaurantName: str
    merchantCode: Optional[str] = None
    region: Optional[str] = None
    status: MerchantStatus
    openDeals: int = 0


class DealListDto(BaseModel):
    data: list[DealRowDto]
    meta: PageMeta


class StageColumnDto(BaseModel):
    stage: DealStage
    count: int
    monthly: Decimal = Decimal("0")
    deals: list[DealRowDto] = Field(default_factory=list)


class DealBoardDto(BaseModel):
    columns: list[StageColumnDto]
    total: int
    lost: int
    live: int
    owners: list[PersonRefDto] = Field(default_factory=list)
    organizations: list[OrgRefDto] = Field(default_factory=list)


OrganizationDto.model_rebuild()
OrganizationDetailDto.model_rebuild()
OrganizationListDto.model_rebuild()
OrganizationLinksDto.model_rebuild()
