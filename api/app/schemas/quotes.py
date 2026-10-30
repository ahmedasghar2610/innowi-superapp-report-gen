"""DTOs for the quote builder (app/modules/quotes). Money is sent as a decimal
string ("24.95") so no float rounding ever touches a price."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.common.pagination import PageMeta

Mode = Literal["SHOW_PRICES", "HIDE_PRICES"]
HardwarePlan = Literal["BUY", "LEASE"]
ItemKind = Literal["DEVICE", "HARDWARE", "SOFTWARE", "SERVICE"]
RequestStatus = Literal["REQUESTED", "PROPOSED", "ACCEPTED", "SIGNED", "EXECUTED", "DECLINED", "CLOSED"]
SignMethod = Literal["DRAWN", "TYPED"]

Money = Optional[Decimal]
_MONEY = dict(ge=0, le=Decimal("1000000"), max_digits=10, decimal_places=2)
_PCT = dict(ge=0, le=100, max_digits=5, decimal_places=2)


def _strip(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class _In(BaseModel):
    model_config = {"extra": "forbid"}


# ── Price list ────────────────────────────────────────────────────────────
class PriceItemDto(BaseModel):
    id: str
    sku: str
    name: str
    description: Optional[str] = None
    note: Optional[str] = None
    section: str
    kind: str
    unitLabel: Optional[str] = None
    monthlyPrice: Money = None
    purchasePrice: Money = None
    leasePrice: Money = None
    isStation: bool
    bundledInSku: Optional[str] = None
    selectable: bool
    maxQty: int
    sortOrder: int
    active: bool
    updatedAt: dt.datetime


class PriceItemUpdateDto(_In):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    description: Optional[str] = Field(None, max_length=300)
    note: Optional[str] = Field(None, max_length=300)
    unitLabel: Optional[str] = Field(None, max_length=40)
    monthlyPrice: Money = Field(None, **_MONEY)
    purchasePrice: Money = Field(None, **_MONEY)
    leasePrice: Money = Field(None, **_MONEY)
    maxQty: Optional[int] = Field(None, ge=1, le=500)
    sortOrder: Optional[int] = Field(None, ge=0, le=100000)
    active: Optional[bool] = None
    bundledInSku: Optional[str] = Field(None, min_length=2, max_length=40, pattern=r"^[A-Z0-9][A-Z0-9-]*$")
    # Explicitly clear a price (e.g. drop the lease option): list the field names here.
    clear: list[Literal["monthlyPrice", "purchasePrice", "leasePrice", "note", "description", "unitLabel",
                        "bundledInSku"]] = []

    _s = field_validator("name", "description", "note", "unitLabel", mode="before")(_strip)


class PriceItemCreateDto(_In):
    sku: str = Field(..., min_length=2, max_length=40, pattern=r"^[A-Z0-9][A-Z0-9-]*$")
    name: str = Field(..., min_length=1, max_length=160)
    description: Optional[str] = Field(None, max_length=300)
    note: Optional[str] = Field(None, max_length=300)
    section: Literal["devices", "hardware", "networking", "software", "marketing", "services"]
    kind: ItemKind
    unitLabel: Optional[str] = Field(None, max_length=40)
    monthlyPrice: Money = Field(None, **_MONEY)
    purchasePrice: Money = Field(None, **_MONEY)
    leasePrice: Money = Field(None, **_MONEY)
    isStation: bool = False
    bundledInSku: Optional[str] = Field(None, min_length=2, max_length=40, pattern=r"^[A-Z0-9][A-Z0-9-]*$")
    maxQty: int = Field(20, ge=1, le=500)
    sortOrder: Optional[int] = Field(None, ge=0, le=100000)

    _s = field_validator("name", "description", "note", "unitLabel", mode="before")(_strip)

    @model_validator(mode="after")
    def _prices_fit_kind(self):
        need = {
            "DEVICE": ("purchasePrice", "monthlyPrice"),
            "HARDWARE": ("purchasePrice",),
            "SOFTWARE": ("monthlyPrice",),
            "SERVICE": ("purchasePrice",),
        }[self.kind]
        missing = [f for f in need if getattr(self, f) is None]
        if missing:
            raise ValueError(f"a {self.kind.lower()} needs: {', '.join(missing)}")
        if self.isStation and self.kind != "DEVICE":
            raise ValueError("only a device can count as a station")
        return self


class PriceListDto(BaseModel):
    data: list[PriceItemDto]


# ── Links ─────────────────────────────────────────────────────────────────
class LinkItemDto(_In):
    """Special pricing for one item on a link. Leave a price empty to use the list price."""

    itemId: str = Field(..., min_length=1, max_length=30)
    percentOff: Money = Field(None, **_PCT)
    monthlyPrice: Money = Field(None, **_MONEY)
    purchasePrice: Money = Field(None, **_MONEY)
    leasePrice: Money = Field(None, **_MONEY)
    hidden: bool = False


class CreateLinkDto(_In):
    mode: Mode
    restaurantName: str = Field(..., min_length=1, max_length=160)
    contactName: Optional[str] = Field(None, max_length=120)
    contactEmail: Optional[EmailStr] = None
    contactPhone: Optional[str] = Field(None, max_length=40)
    merchantId: Optional[str] = Field(None, max_length=30)
    dealId: Optional[str] = Field(None, max_length=30)
    message: Optional[str] = Field(None, max_length=2000)
    discountPercent: Decimal = Field(Decimal("0"), **_PCT)
    allowLease: bool = True
    expiresInDays: Optional[int] = Field(30, ge=1, le=365)
    items: list[LinkItemDto] = Field(default_factory=list, max_length=200)

    _s = field_validator("restaurantName", "contactName", "contactPhone", "message", "merchantId", mode="before")(_strip)


class UpdateLinkDto(_In):
    restaurantName: Optional[str] = Field(None, min_length=1, max_length=160)
    contactName: Optional[str] = Field(None, max_length=120)
    contactEmail: Optional[EmailStr] = None
    contactPhone: Optional[str] = Field(None, max_length=40)
    message: Optional[str] = Field(None, max_length=2000)
    discountPercent: Money = Field(None, **_PCT)
    allowLease: Optional[bool] = None
    expiresInDays: Optional[int] = Field(None, ge=1, le=365)
    # When given, replaces the link's whole special-pricing list.
    items: Optional[list[LinkItemDto]] = Field(None, max_length=200)

    _s = field_validator("restaurantName", "contactName", "contactPhone", "message", mode="before")(_strip)


class LinkItemOutDto(BaseModel):
    itemId: str
    percentOff: Money = None
    monthlyPrice: Money = None
    purchasePrice: Money = None
    leasePrice: Money = None
    hidden: bool = False


class RequestBriefDto(BaseModel):
    id: str
    number: str
    status: str
    createdAt: dt.datetime
    oneTimeTotal: Decimal
    monthlyTotal: Decimal


class LinkDto(BaseModel):
    id: str
    mode: str
    status: str
    restaurantName: str
    contactName: Optional[str] = None
    contactEmail: Optional[str] = None
    contactPhone: Optional[str] = None
    merchantId: Optional[str] = None
    dealId: Optional[str] = None
    message: Optional[str] = None
    discountPercent: Decimal
    allowLease: bool
    expiresAt: Optional[dt.datetime] = None
    expired: bool
    createdByEmail: str
    createdAt: dt.datetime
    lastOpenedAt: Optional[dt.datetime] = None
    openCount: int
    requestCount: int = 0
    latestRequest: Optional[RequestBriefDto] = None
    items: list[LinkItemOutDto] = []


class LinkCreatedDto(BaseModel):
    link: LinkDto
    # Shown once: only a hash of the token is stored. "New link" makes a fresh one.
    url: str


class PaginatedLinksDto(BaseModel):
    data: list[LinkDto]
    meta: PageMeta


# ── Pricing ───────────────────────────────────────────────────────────────
class SelectionDto(_In):
    itemId: str = Field(..., min_length=1, max_length=30)
    qty: int = Field(..., ge=0, le=500)


class PriceRequestDto(_In):
    hardwarePlan: HardwarePlan = "BUY"
    items: list[SelectionDto] = Field(..., max_length=200)


class LineDto(BaseModel):
    sku: str
    name: str
    section: str
    category: str
    billing: str
    qty: int
    unitList: Optional[Decimal] = None
    unitPrice: Optional[Decimal] = None
    total: Optional[Decimal] = None
    listTotal: Optional[Decimal] = None
    detail: Optional[str] = None
    unitLabel: Optional[str] = None


class TotalsDto(BaseModel):
    oneTime: Decimal
    monthlySoftware: Decimal
    monthlyLease: Decimal
    monthly: Decimal
    listOneTime: Decimal
    listMonthly: Decimal
    savingsOneTime: Decimal
    savingsMonthly: Decimal


class PricedDto(BaseModel):
    lines: list[LineDto]
    totals: TotalsDto
    # Names of items dropped because a selected bundle already includes them.
    bundledOut: list[str] = []


# ── Public (the restaurant) ───────────────────────────────────────────────
class PublicItemDto(BaseModel):
    id: str
    sku: str
    name: str
    description: Optional[str] = None
    note: Optional[str] = None
    kind: str
    unitLabel: Optional[str] = None
    isStation: bool
    maxQty: int
    # Set when a bundle on this quote already includes the item (e.g. the
    # marketing package includes email/SMS): the UI disables it with a note.
    bundledInSku: Optional[str] = None
    bundledInName: Optional[str] = None
    # Prices: only on links that show prices.
    listMonthly: Money = None
    listPurchase: Money = None
    listLease: Money = None
    monthly: Money = None
    purchase: Money = None
    lease: Money = None


class PublicSectionDto(BaseModel):
    key: str
    title: str
    blurb: Optional[str] = None
    items: list[PublicItemDto]


class PublicRequestBriefDto(BaseModel):
    id: str
    number: str
    status: str
    createdAt: dt.datetime


class PublicOfferDto(BaseModel):
    restaurantName: str
    contactName: Optional[str] = None
    message: Optional[str] = None
    showPrices: bool
    allowLease: bool
    leaseMonths: int
    firstStationMonthly: Money = None
    sections: list[PublicSectionDto]
    goldIncluded: list[str]
    terms: list[str]
    preparedBy: Optional[str] = None
    latestRequest: Optional[PublicRequestBriefDto] = None


# ── Revisions, signatures, events ─────────────────────────────────────────
class RevisionDto(BaseModel):
    """Staff view of one send in the negotiation (always priced)."""

    revNo: int
    authorKind: Literal["STAFF", "RESTAURANT"]
    authorName: Optional[str] = None
    authorEmail: Optional[str] = None
    note: Optional[str] = None
    hardwarePlan: str
    lines: list[LineDto]
    totals: TotalsDto
    contentHash: str
    createdAt: dt.datetime


class PublicRevisionDto(BaseModel):
    """Restaurant view of one revision; prices only when the request shows them."""

    revNo: int
    authorKind: Literal["STAFF", "RESTAURANT"]
    note: Optional[str] = None
    hardwarePlan: str
    lines: list[LineDto]
    totals: Optional[TotalsDto] = None
    createdAt: dt.datetime


class SignatureDto(BaseModel):
    revNo: int
    role: Literal["CLIENT", "INNOWI"]
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    method: SignMethod
    signatureData: str
    consentVersion: str
    contentHash: str
    voidedAt: Optional[dt.datetime] = None
    ip: Optional[str] = None
    userAgent: Optional[str] = None
    signedAt: dt.datetime


class PublicSignatureDto(BaseModel):
    """What the restaurant sees of a signature: who signed, how, when (no IP/UA)."""

    revNo: int
    role: Literal["CLIENT", "INNOWI"]
    name: str
    title: Optional[str] = None
    method: SignMethod
    signatureData: str
    voidedAt: Optional[dt.datetime] = None
    signedAt: dt.datetime


class EventDto(BaseModel):
    revNo: Optional[int] = None
    kind: str
    actor: Optional[str] = None
    detail: Optional[dict] = None
    ip: Optional[str] = None
    createdAt: dt.datetime


class StaffReviseDto(_In):
    """Staff counter-offer: new quantities (priced from the link), a note, and
    on hidden-price links the choice to reveal prices to the client."""

    hardwarePlan: HardwarePlan = "BUY"
    items: list[SelectionDto] = Field(..., min_length=1, max_length=200)
    note: Optional[str] = Field(None, max_length=2000)
    revealPrices: bool = False

    _s = field_validator("note", mode="before")(_strip)


class SignDto(_In):
    """The client signs the current revision (replaces the old accept)."""

    revisionNo: int = Field(..., ge=1, le=10000)
    name: str = Field(..., min_length=2, max_length=120)
    title: Optional[str] = Field(None, max_length=120)
    method: SignMethod
    signatureData: str = Field(..., min_length=2, max_length=300_000)
    agree: Literal[True]

    _s = field_validator("name", "title", mode="before")(_strip)


class CountersignDto(_In):
    """Innowi's countersignature on a client-signed revision."""

    name: str = Field(..., min_length=2, max_length=120)
    title: Optional[str] = Field(None, max_length=120)
    method: SignMethod
    signatureData: str = Field(..., min_length=2, max_length=300_000)
    agree: Literal[True]

    _s = field_validator("name", "title", mode="before")(_strip)


class DeclineDto(_In):
    name: str = Field(..., min_length=2, max_length=120)
    reason: Optional[str] = Field(None, max_length=2000)

    _s = field_validator("name", "reason", mode="before")(_strip)


class ContactInDto(_In):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=40)

    _s = field_validator("name", "phone", mode="before")(_strip)


class SubmitRequestDto(_In):
    hardwarePlan: HardwarePlan = "BUY"
    items: list[SelectionDto] = Field(..., min_length=1, max_length=200)
    contact: ContactInDto
    restaurantName: Optional[str] = Field(None, max_length=160)
    notes: Optional[str] = Field(None, max_length=2000)
    # Set to counter an existing request: this becomes its next revision
    # instead of a brand-new request.
    requestId: Optional[str] = Field(None, min_length=1, max_length=30)

    _s = field_validator("restaurantName", "notes", mode="before")(_strip)


class PublicRequestDto(BaseModel):
    id: str
    number: str
    status: str
    showPrices: bool
    createdAt: dt.datetime
    restaurantName: str
    contactName: str
    contactEmail: str
    hardwarePlan: str
    notes: Optional[str] = None
    lines: list[LineDto]
    totals: Optional[TotalsDto] = None
    currentRevisionNo: int = 1
    revisions: list[PublicRevisionDto] = []
    signatures: list[PublicSignatureDto] = []
    consentText: Optional[str] = None
    consentVersion: Optional[str] = None
    declinedReason: Optional[str] = None
    acceptedAt: Optional[dt.datetime] = None
    acceptedName: Optional[str] = None
    terms: list[str] = []
    goldIncluded: list[str] = []
    leaseMonths: int


# ── Staff view of requests ────────────────────────────────────────────────
class RequestDto(BaseModel):
    id: str
    number: str
    status: str
    mode: str
    linkId: str
    restaurantName: str
    contactName: str
    contactEmail: str
    contactPhone: Optional[str] = None
    notes: Optional[str] = None
    hardwarePlan: str
    lines: list[LineDto]
    totals: TotalsDto
    createdAt: dt.datetime
    currentRevisionNo: int = 1
    pricesRevealed: bool = False
    declinedReason: Optional[str] = None
    revisions: list[RevisionDto] = []
    signatures: list[SignatureDto] = []
    events: list[EventDto] = []
    acceptedAt: Optional[dt.datetime] = None
    acceptedName: Optional[str] = None
    acceptedTitle: Optional[str] = None
    staffNote: Optional[str] = None
    notified: dict = {}
    linkCreatedByEmail: Optional[str] = None


class PaginatedRequestsDto(BaseModel):
    data: list[RequestDto]
    meta: PageMeta


class UpdateRequestDto(_In):
    status: Optional[Literal["REQUESTED", "PROPOSED", "DECLINED", "CLOSED"]] = None
    staffNote: Optional[str] = Field(None, max_length=4000)


class QuoteSummaryDto(BaseModel):
    activeLinks: int
    requestsOpen: int
    accepted30d: int
    acceptedMonthly30d: Decimal
