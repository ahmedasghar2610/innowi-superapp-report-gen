"""Pydantic schemas mirroring merchant-profiling's DTOs 1:1 (field names, constraints)."""
from __future__ import annotations

import datetime as dt
from typing import Any, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import (
    MerchantStatus,
    AccessCriticality,
    AccessFlag,
    AccessStatus,
    AccountHealth,
    ContactRole,
    DocumentCategory,
    DocumentStatus,
    KeywordType,
    MerchantServiceStatus,
    PackageStatus,
    PreferredChannel,
    PromotionStatus,
    Responsiveness,
    VerificationConfidence,
    YesNo,
)


def _trim(v):
    return v.strip() if isinstance(v, str) else v


# ---- Merchant ---------------------------------------------------------------
class CreateMerchantDto(BaseModel):
    restaurantName: str = Field(..., min_length=1, max_length=200)
    merchantCode: Optional[str] = Field(None, max_length=50)
    status: Optional[MerchantStatus] = None
    region: Optional[str] = Field(None, max_length=60)
    innowiSolution: Optional[str] = Field(None, max_length=120)
    accountTier: Optional[int] = Field(None, ge=0, le=10)
    legalName: Optional[str] = Field(None, max_length=200)
    cuisineCategory: Optional[str] = Field(None, max_length=200)
    websiteUrl: Optional[str] = Field(None, max_length=500)
    websitePlatform: Optional[str] = Field(None, max_length=200)
    onlineOrdering: Optional[str] = Field(None, max_length=500)
    posSystem: Optional[str] = Field(None, max_length=200)
    customerListSource: Optional[str] = Field(None, max_length=300)
    googleAdsBudget: Optional[float] = Field(None, ge=0)
    metaAdsBudget: Optional[float] = Field(None, ge=0)
    businessGoals: Optional[str] = Field(None, max_length=2000)
    targetAudience: Optional[str] = Field(None, max_length=2000)
    slowDayparts: Optional[str] = Field(None, max_length=1000)
    seasonalPeaks: Optional[str] = Field(None, max_length=1000)
    alcoholLicense: Optional[YesNo] = None
    dietaryCerts: Optional[str] = Field(None, max_length=1000)
    locationCount: Optional[int] = Field(None, ge=0)
    reportFrequency: Optional[str] = Field(None, max_length=100)
    reportRecipients: Optional[str] = Field(None, max_length=500)
    accountHealth: Optional[AccountHealth] = None
    nextAction: Optional[str] = Field(None, max_length=2000)
    openBlockers: Optional[str] = Field(None, max_length=2000)
    notes: Optional[str] = Field(None, max_length=4000)
    onboardingDate: Optional[dt.datetime] = None
    goLiveDate: Optional[dt.datetime] = None
    accountManagerId: Optional[str] = None

    _trim_restaurant = field_validator("restaurantName", "merchantCode", "legalName", "cuisineCategory", "reportFrequency", "reportRecipients", mode="before")(_trim)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateMerchantDto(BaseModel):
    restaurantName: Optional[str] = Field(None, min_length=1, max_length=200)
    merchantCode: Optional[str] = Field(None, max_length=50)
    # Lifecycle. Setting CHURNED here only flips the status; use POST /churn/{id}
    # to record why (it creates the churn record and sets the status too).
    status: Optional[MerchantStatus] = None
    region: Optional[str] = Field(None, max_length=60)
    innowiSolution: Optional[str] = Field(None, max_length=120)
    accountTier: Optional[int] = Field(None, ge=0, le=10)
    legalName: Optional[str] = Field(None, max_length=200)
    cuisineCategory: Optional[str] = Field(None, max_length=200)
    websiteUrl: Optional[str] = Field(None, max_length=500)
    websitePlatform: Optional[str] = Field(None, max_length=200)
    onlineOrdering: Optional[str] = Field(None, max_length=500)
    posSystem: Optional[str] = Field(None, max_length=200)
    customerListSource: Optional[str] = Field(None, max_length=300)
    googleAdsBudget: Optional[float] = Field(None, ge=0)
    metaAdsBudget: Optional[float] = Field(None, ge=0)
    businessGoals: Optional[str] = Field(None, max_length=2000)
    targetAudience: Optional[str] = Field(None, max_length=2000)
    slowDayparts: Optional[str] = Field(None, max_length=1000)
    seasonalPeaks: Optional[str] = Field(None, max_length=1000)
    alcoholLicense: Optional[YesNo] = None
    dietaryCerts: Optional[str] = Field(None, max_length=1000)
    locationCount: Optional[int] = Field(None, ge=0)
    reportFrequency: Optional[str] = Field(None, max_length=100)
    reportRecipients: Optional[str] = Field(None, max_length=500)
    accountHealth: Optional[AccountHealth] = None
    nextAction: Optional[str] = Field(None, max_length=2000)
    openBlockers: Optional[str] = Field(None, max_length=2000)
    notes: Optional[str] = Field(None, max_length=4000)
    onboardingDate: Optional[dt.datetime] = None
    goLiveDate: Optional[dt.datetime] = None
    accountManagerId: Optional[str] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class QueryMerchantDto(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(25, ge=1, le=100)
    order: str = Field("desc", pattern="^(asc|desc)$")
    sortBy: str = Field("createdAt", pattern="^(createdAt|updatedAt|restaurantName|profileCompletionPct)$")
    search: Optional[str] = Field(None, max_length=200)
    accountHealth: Optional[AccountHealth] = None
    accountManagerId: Optional[str] = None
    cuisineCategory: Optional[str] = None
    subscriptionStatus: Optional[PackageStatus] = None
    packageCode: Optional[str] = None
    # Account lifecycle. Left out → every status except CHURNED (churned
    # accounts live on /churn and would otherwise swamp the directory);
    # "ALL" → everything; a status → just that one.
    status: Optional[Literal["PROSPECT", "ONBOARDING", "ACTIVE", "PAUSED", "CHURNED", "ALL"]] = None
    region: Optional[str] = Field(None, max_length=60)
    # Where the record came from (app/models/sources.py), or "NONE" for records with none recorded.
    source: Optional[Literal["MANUAL", "NEW_DEAL", "MERCHANT_IMPORT", "CHURN_IMPORT", "GOOGLE_PROFILE", "SEO_ADS",
                             "WEBSITE", "SALESFORCE", "SAMPLE", "NONE"]] = None

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class AccountManagerRefDto(BaseModel):
    id: str
    name: str


class MerchantSubscriptionDto(BaseModel):
    package: dict
    status: PackageStatus
    startDate: Optional[dt.datetime]
    renewalDate: Optional[dt.datetime]
    mrr: Optional[str]
    isCurrent: bool


class MerchantResponseDto(BaseModel):
    id: str
    merchantCode: Optional[str] = None
    restaurantName: str
    status: MerchantStatus = MerchantStatus.ACTIVE
    region: Optional[str] = None
    innowiSolution: Optional[str] = None
    accountTier: Optional[int] = None
    # Where the record came from (app/models/sources.py) and the file / slug / deal behind it.
    source: Optional[str] = None
    sourceDetail: Optional[str] = None
    legalName: Optional[str] = None
    cuisineCategory: Optional[str] = None
    websiteUrl: Optional[str] = None
    websitePlatform: Optional[str] = None
    onlineOrdering: Optional[str] = None
    posSystem: Optional[str] = None
    customerListSource: Optional[str] = None
    googleAdsBudget: Optional[str] = None
    metaAdsBudget: Optional[str] = None
    businessGoals: Optional[str] = None
    targetAudience: Optional[str] = None
    slowDayparts: Optional[str] = None
    seasonalPeaks: Optional[str] = None
    alcoholLicense: Optional[YesNo] = None
    dietaryCerts: Optional[str] = None
    locationCount: Optional[int] = None
    reportFrequency: Optional[str] = None
    reportRecipients: Optional[str] = None
    accountHealth: Optional[AccountHealth] = None
    profileCompletionPct: Optional[int] = None
    nextAction: Optional[str] = None
    openBlockers: Optional[str] = None
    notes: Optional[str] = None
    onboardingDate: Optional[dt.datetime] = None
    goLiveDate: Optional[dt.datetime] = None
    accountManagerId: Optional[str] = None
    accountManager: Optional[AccountManagerRefDto] = None
    subscription: Optional[MerchantSubscriptionDto] = None
    createdAt: dt.datetime
    updatedAt: dt.datetime


# ---- Contacts -----------------------------------------------------------------
class CreateContactDto(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    role: ContactRole
    email: Optional[EmailStr] = Field(None, max_length=320)
    phone: Optional[str] = Field(None, max_length=50)
    preferredChannel: Optional[PreferredChannel] = None
    language: Optional[str] = Field(None, max_length=100)
    responsiveness: Optional[Responsiveness] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateContactDto(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    role: Optional[ContactRole] = None
    email: Optional[EmailStr] = Field(None, max_length=320)
    phone: Optional[str] = Field(None, max_length=50)
    preferredChannel: Optional[PreferredChannel] = None
    language: Optional[str] = Field(None, max_length=100)
    responsiveness: Optional[Responsiveness] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class ContactResponseDto(BaseModel):
    id: str
    merchantId: str
    name: Optional[str]
    role: ContactRole
    email: Optional[str]
    phone: Optional[str]
    preferredChannel: Optional[PreferredChannel]
    language: Optional[str]
    responsiveness: Optional[Responsiveness]
    createdAt: dt.datetime
    updatedAt: dt.datetime

    model_config = {"from_attributes": True}


# ---- Locations ------------------------------------------------------------------
class CreateLocationDto(BaseModel):
    address: Optional[str] = Field(None, max_length=300)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=120)
    zip: Optional[str] = Field(None, max_length=20)
    hours: Optional[str] = Field(None, max_length=500)
    timezone: Optional[str] = Field(None, max_length=100)
    isPrimary: Optional[bool] = None
    napStatus: Optional[str] = Field(None, max_length=100)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateLocationDto(CreateLocationDto):
    pass

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class LocationResponseDto(BaseModel):
    id: str
    merchantId: str
    address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zip: Optional[str]
    hours: Optional[str]
    timezone: Optional[str]
    isPrimary: bool
    napStatus: Optional[str]
    createdAt: dt.datetime
    updatedAt: dt.datetime

    model_config = {"from_attributes": True}


# ---- Merchant Services ----------------------------------------------------------
class CreateMerchantServiceDto(BaseModel):
    serviceId: str = Field(..., min_length=1)
    status: Optional[MerchantServiceStatus] = None
    activatedAt: Optional[dt.datetime] = None
    notes: Optional[str] = Field(None, max_length=1000)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateMerchantServiceDto(BaseModel):
    status: Optional[MerchantServiceStatus] = None
    activatedAt: Optional[dt.datetime] = None
    notes: Optional[str] = Field(None, max_length=1000)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class MerchantServiceResponseDto(BaseModel):
    id: str
    merchantId: str
    serviceId: str
    serviceName: str
    serviceCategory: str
    status: MerchantServiceStatus
    activatedAt: Optional[dt.datetime]
    notes: Optional[str]
    createdAt: dt.datetime
    updatedAt: dt.datetime


# ---- Documents --------------------------------------------------------------------
class CreateDocumentDto(BaseModel):
    category: DocumentCategory
    fileName: str = Field(..., min_length=1, max_length=300)
    storageUrl: str = Field(..., min_length=1, max_length=1000)
    locationId: Optional[str] = None
    mimeType: Optional[str] = Field(None, max_length=150)
    sizeBytes: Optional[int] = Field(None, ge=0)
    version: Optional[int] = Field(None, ge=1)
    uploadedBy: Optional[str] = Field(None, max_length=200)
    status: Optional[DocumentStatus] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateDocumentDto(BaseModel):
    category: Optional[DocumentCategory] = None
    fileName: Optional[str] = Field(None, max_length=300)
    storageUrl: Optional[str] = Field(None, max_length=1000)
    locationId: Optional[str] = None
    mimeType: Optional[str] = Field(None, max_length=150)
    sizeBytes: Optional[int] = Field(None, ge=0)
    version: Optional[int] = Field(None, ge=1)
    uploadedBy: Optional[str] = Field(None, max_length=200)
    status: Optional[DocumentStatus] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class DocumentResponseDto(BaseModel):
    id: str
    merchantId: str
    locationId: Optional[str]
    category: DocumentCategory
    fileName: str
    storageUrl: str
    mimeType: Optional[str]
    sizeBytes: Optional[int]
    version: int
    uploadedBy: Optional[str]
    status: DocumentStatus
    createdAt: dt.datetime
    updatedAt: dt.datetime
    hasFile: bool = False
    downloadPath: Optional[str] = None

    model_config = {"from_attributes": True}


# ---- Connections ------------------------------------------------------------------
class CreateConnectionDto(BaseModel):
    accessItem: str = Field(..., min_length=1, max_length=200)
    criticality: AccessCriticality
    status: Optional[AccessStatus] = None
    flag: Optional[AccessFlag] = None
    owner: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)
    dateRequested: Optional[dt.datetime] = None
    dateReceived: Optional[dt.datetime] = None
    verified: Optional[bool] = None
    verifiedDate: Optional[dt.datetime] = None
    expiry: Optional[dt.datetime] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateConnectionDto(BaseModel):
    accessItem: Optional[str] = Field(None, max_length=200)
    criticality: Optional[AccessCriticality] = None
    status: Optional[AccessStatus] = None
    flag: Optional[AccessFlag] = None
    owner: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)
    dateRequested: Optional[dt.datetime] = None
    dateReceived: Optional[dt.datetime] = None
    verified: Optional[bool] = None
    verifiedDate: Optional[dt.datetime] = None
    expiry: Optional[dt.datetime] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class ConnectionResponseDto(BaseModel):
    id: str
    merchantId: str
    accessItem: str
    criticality: AccessCriticality
    status: AccessStatus
    flag: AccessFlag
    owner: Optional[str]
    notes: Optional[str]
    dateRequested: Optional[dt.datetime]
    dateReceived: Optional[dt.datetime]
    verified: bool
    verifiedDate: Optional[dt.datetime]
    expiry: Optional[dt.datetime]
    createdAt: dt.datetime
    updatedAt: dt.datetime

    model_config = {"from_attributes": True}


# ---- Keywords / Competitors -----------------------------------------------------
class CreateKeywordDto(BaseModel):
    term: str = Field(..., min_length=1, max_length=200)
    type: KeywordType

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateKeywordDto(BaseModel):
    term: Optional[str] = Field(None, max_length=200)
    type: Optional[KeywordType] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class KeywordResponseDto(BaseModel):
    id: str
    merchantId: str
    term: str
    type: KeywordType
    createdAt: dt.datetime

    model_config = {"from_attributes": True}


class CreateCompetitorDto(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    rank: Optional[int] = Field(None, ge=1, le=99)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateCompetitorDto(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    rank: Optional[int] = Field(None, ge=1, le=99)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class CompetitorResponseDto(BaseModel):
    id: str
    merchantId: str
    name: str
    rank: Optional[int]
    createdAt: dt.datetime

    model_config = {"from_attributes": True}


# ---- Brand / Catering profile -----------------------------------------------------
class UpsertBrandProfileDto(BaseModel):
    brandColors: Optional[str] = Field(None, max_length=1000)
    brandFonts: Optional[str] = Field(None, max_length=500)
    logoVector: Optional[YesNo] = None
    photoLibraryStatus: Optional[str] = Field(None, max_length=1000)
    menuFormat: Optional[str] = Field(None, max_length=1000)
    signatureDishes: Optional[str] = Field(None, max_length=2000)
    toneOfVoice: Optional[str] = Field(None, max_length=1000)
    doNotSay: Optional[str] = Field(None, max_length=2000)
    contentRestrictions: Optional[str] = Field(None, max_length=2000)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class BrandProfileResponseDto(BaseModel):
    merchantId: str
    exists: bool
    brandColors: Optional[str] = None
    brandFonts: Optional[str] = None
    logoVector: Optional[YesNo] = None
    photoLibraryStatus: Optional[str] = None
    menuFormat: Optional[str] = None
    signatureDishes: Optional[str] = None
    toneOfVoice: Optional[str] = None
    doNotSay: Optional[str] = None
    contentRestrictions: Optional[str] = None
    updatedAt: Optional[dt.datetime] = None


class UpsertCateringProfileDto(BaseModel):
    offered: Optional[YesNo] = None
    contact: Optional[str] = Field(None, max_length=300)
    leadFlow: Optional[str] = Field(None, max_length=1000)
    minOrder: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=2000)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class CateringProfileResponseDto(BaseModel):
    merchantId: str
    exists: bool
    offered: Optional[YesNo] = None
    contact: Optional[str] = None
    leadFlow: Optional[str] = None
    minOrder: Optional[str] = None
    notes: Optional[str] = None
    updatedAt: Optional[dt.datetime] = None


# ---- Account managers -----------------------------------------------------------
class CreateAccountManagerDto(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    team: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateAccountManagerDto(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    team: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class AccountManagerResponseDto(BaseModel):
    id: str
    name: str
    team: Optional[str]
    email: Optional[str]
    merchantCount: int
    createdAt: dt.datetime


# ---- Subscription ------------------------------------------------------------------
class UpsertSubscriptionDto(BaseModel):
    packageCode: Optional[str] = Field(None, max_length=20)
    status: Optional[PackageStatus] = None
    startDate: Optional[dt.datetime] = None
    renewalDate: Optional[dt.datetime] = None
    mrr: Optional[float] = Field(None, ge=0)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class SubscriptionResponseDto(BaseModel):
    merchantId: str
    package: dict
    status: PackageStatus
    startDate: Optional[dt.datetime]
    renewalDate: Optional[dt.datetime]
    mrr: Optional[str]
    isCurrent: bool


# ---- Profile fields ---------------------------------------------------------------
class ProfileFieldDto(BaseModel):
    key: str
    label: str
    type: str
    value: Any = None
    options: Optional[list[str]] = None
    note: Optional[str] = None
    group: Optional[str] = None
    required: Optional[bool] = None
    source: Optional[str] = None
    confidence: str = "UNVERIFIED"
    verifiedBy: Optional[str] = None
    verifiedAt: Optional[dt.datetime] = None
    verified: bool = False


class UpdateProfileFieldDto(BaseModel):
    value: Any = Field(...)
    source: Optional[str] = Field(None, max_length=500)
    confidence: Optional[VerificationConfidence] = None
    verifiedBy: Optional[str] = Field(None, max_length=200)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class AttestFieldDto(BaseModel):
    confidence: VerificationConfidence
    source: Optional[str] = Field(None, max_length=500)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


# ---- Brand assets / documents upload -----------------------------------------------
class UpdateBrandAssetDto(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = Field(None, max_length=200)
    status: Optional[str] = None

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class BrandAssetResponseDto(BaseModel):
    id: str
    merchantId: str
    type: str
    name: Optional[str]
    status: Optional[str]
    mimeType: Optional[str]
    sizeBytes: Optional[int]
    uploadedBy: Optional[str]
    # Nest's BrandAssetResponseDto exposes hasFile + downloadPath and
    # deliberately does NOT return `url` (the internal storage key).
    hasFile: bool = False
    downloadPath: Optional[str] = None
    createdAt: dt.datetime

    model_config = {"from_attributes": True}


# ---- Promotions ---------------------------------------------------------------
# PRD Appendix C-7 / PROF-01 §6.2.4 — Profiling's master list of a merchant's
# promotions/offers. Port of create-promotion.dto.ts / update-promotion.dto.ts /
# promotion-response.dto.ts.
class CreatePromotionDto(BaseModel):
    promoName: Optional[str] = Field(None, max_length=300)
    offerType: Optional[str] = Field(None, max_length=200)
    offerValue: Optional[str] = Field(None, max_length=300)
    promoCode: Optional[str] = Field(None, max_length=200)
    channels: Optional[str] = Field(None, max_length=500)
    startDate: Optional[dt.datetime] = None
    endDate: Optional[dt.datetime] = None
    status: Optional[PromotionStatus] = None
    redemptions: Optional[str] = Field(None, max_length=200)
    redemptionMethod: Optional[str] = Field(None, max_length=300)
    approvalOwner: Optional[str] = Field(None, max_length=200)
    staffBriefed: Optional[YesNo] = None
    blackoutDates: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=4000)

    _trim_promo_name = field_validator("promoName")(_trim)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdatePromotionDto(BaseModel):
    promoName: Optional[str] = Field(None, max_length=300)
    offerType: Optional[str] = Field(None, max_length=200)
    offerValue: Optional[str] = Field(None, max_length=300)
    promoCode: Optional[str] = Field(None, max_length=200)
    channels: Optional[str] = Field(None, max_length=500)
    startDate: Optional[dt.datetime] = None
    endDate: Optional[dt.datetime] = None
    status: Optional[PromotionStatus] = None
    redemptions: Optional[str] = Field(None, max_length=200)
    redemptionMethod: Optional[str] = Field(None, max_length=300)
    approvalOwner: Optional[str] = Field(None, max_length=200)
    staffBriefed: Optional[YesNo] = None
    blackoutDates: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=4000)

    _trim_promo_name = field_validator("promoName")(_trim)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class PromotionResponseDto(BaseModel):
    id: str
    merchantId: str
    promoName: Optional[str]
    offerType: Optional[str]
    offerValue: Optional[str]
    promoCode: Optional[str]
    channels: Optional[str]
    startDate: Optional[dt.datetime]
    endDate: Optional[dt.datetime]
    status: PromotionStatus
    redemptions: Optional[str]
    redemptionMethod: Optional[str]
    approvalOwner: Optional[str]
    staffBriefed: Optional[YesNo]
    blackoutDates: Optional[str]
    notes: Optional[str]
    createdAt: dt.datetime

    model_config = {"from_attributes": True}


# =====================================================================================
# List / page envelopes and derived-view schemas.
#
# The Nest API declared a DTO for every response, including the `{ data }` list
# envelope (ContactsResponseDto, LocationsResponseDto, …), the `{ data, meta }`
# page envelope (PaginatedMerchantsDto) and the derived profiling views
# (ProfileCompletenessDto, ProfileAlertsResponseDto, DataQualityResponseDto).
# Those routes were returning bare dicts here, so the OpenAPI document carried
# no schema for them and nothing validated the shape. These mirror
# merchant-profiling/api/dto/*.ts field-for-field.
# =====================================================================================
from app.common.pagination import PageMeta  # noqa: E402


class ContactsResponseDto(BaseModel):
    data: list[ContactResponseDto]


class LocationsResponseDto(BaseModel):
    data: list[LocationResponseDto]


class KeywordsResponseDto(BaseModel):
    data: list[KeywordResponseDto]


class CompetitorsResponseDto(BaseModel):
    data: list[CompetitorResponseDto]


class ConnectionsResponseDto(BaseModel):
    data: list[ConnectionResponseDto]


class MerchantServicesResponseDto(BaseModel):
    data: list[MerchantServiceResponseDto]


class DocumentsResponseDto(BaseModel):
    data: list[DocumentResponseDto]


class BrandAssetsResponseDto(BaseModel):
    data: list[BrandAssetResponseDto]


class PromotionsResponseDto(BaseModel):
    data: list[PromotionResponseDto]


class AccountManagersResponseDto(BaseModel):
    data: list[AccountManagerResponseDto]


class PaginatedMerchantsDto(BaseModel):
    data: list[MerchantResponseDto]
    meta: PageMeta


# ---- Profile completeness (PROF-02 / PROF-03) ---------------------------------------
class CompletenessSectionDto(BaseModel):
    key: str
    label: str
    requirement: str
    weight: float
    earned: float
    available: float
    percent: Optional[float] = None
    applicable: bool


class MissingItemDto(BaseModel):
    key: str
    label: str
    area: str
    severity: str
    group: Optional[str] = None


class PendingConnectionDto(BaseModel):
    id: str
    accessItem: str
    criticality: str
    status: str
    blocking: bool


class ExpiredConnectionDto(BaseModel):
    id: str
    accessItem: str
    criticality: str
    expiry: Optional[str] = None
    blocking: bool


class NapConflictDto(BaseModel):
    locationId: str
    label: str
    napStatus: Optional[str] = None


class AttestationFlagDto(BaseModel):
    key: str
    label: str
    group: Optional[str] = None
    required: Optional[bool] = None
    lastVerifiedAt: Optional[str] = None
    verifiedBy: Optional[str] = None


class ConfidenceBreakdownDto(BaseModel):
    confirmed: int
    needsReview: int
    unverified: int
    outdated: int
    placeholder: int
    missing: int


class ProfileCompletenessDto(BaseModel):
    percent: int
    completeAtPct: int
    isComplete: bool
    sections: list[CompletenessSectionDto]
    missingInformation: list[MissingItemDto]
    missingFiles: list[MissingItemDto]
    pendingConnections: list[PendingConnectionDto]
    confidence: ConfidenceBreakdownDto
    expiredConnections: list[ExpiredConnectionDto]
    napConflicts: list[NapConflictDto]
    outdatedFields: list[AttestationFlagDto]
    placeholderFields: list[AttestationFlagDto]
    fields: dict
    requiredMissingCount: int


class ProfileFieldsResponseDto(BaseModel):
    """GET /merchants/:id/fields — Nest returned `data` AND `completion` so the
    Profile tab can render missing files / pending connections without a second
    request. `completion` was missing here."""

    data: list[ProfileFieldDto]
    completion: ProfileCompletenessDto


class MerchantProfileDto(BaseModel):
    """GET /merchants/:id/profile — merchant + fields + completion (PRD §22)."""

    merchant: MerchantResponseDto
    fields: list[ProfileFieldDto]
    completion: ProfileCompletenessDto


# ---- Profiling alerts (§6.4) ---------------------------------------------------------
class AlertEvidenceDto(BaseModel):
    label: str
    source: Optional[str] = None


class ProfileAlertDto(BaseModel):
    id: str
    dedupKey: str
    merchantId: str
    module: str
    type: str
    severity: str
    title: str
    summary: str
    evidence: list[AlertEvidenceDto]
    impact: Optional[str] = None
    recommendation: Optional[str] = None
    targetTab: Optional[str] = None
    itemCount: int


class ProfileAlertsResponseDto(BaseModel):
    data: list[ProfileAlertDto]
    total: int


# ---- Portfolio data quality (M1-02) --------------------------------------------------
class DataQualityThresholdsDto(BaseModel):
    completeAtPct: int
    criticalBelowPct: int


class DataQualityTotalsDto(BaseModel):
    merchants: int
    scored: int
    averagePercent: Optional[int] = None
    medianPercent: Optional[int] = None


class DataQualityBandsDto(BaseModel):
    complete: int
    partial: int
    critical: int
    unscored: int


class DataQualityConfidenceDto(BaseModel):
    confirmed: int
    needsReview: int
    unverified: int
    outdated: int
    placeholder: int
    noAttestation: int
    fieldSlots: int


class DataQualityConnectionsDto(BaseModel):
    pending: int
    blocking: int
    merchantsWithBlockers: int


class DataQualityMerchantDto(BaseModel):
    id: str
    merchantCode: Optional[str] = None
    restaurantName: str
    accountHealth: Optional[str] = None
    accountManagerName: Optional[str] = None
    subscriptionStatus: Optional[str] = None
    profileCompletionPct: Optional[int] = None
    band: str
    blockingConnections: int
    updatedAt: Optional[str] = None


class DataQualityResponseDto(BaseModel):
    generatedAt: str
    thresholds: DataQualityThresholdsDto
    totals: DataQualityTotalsDto
    bands: DataQualityBandsDto
    confidence: DataQualityConfidenceDto
    connections: DataQualityConnectionsDto
    merchants: list[DataQualityMerchantDto]
