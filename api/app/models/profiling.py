"""profiling schema — the Merchant Profiling system of record. Mirrors schema.prisma `@@schema("profiling")`."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import (
    AccessCriticality,
    AccessFlag,
    AccessStatus,
    AccountHealth,
    ContactRole,
    DocumentCategory,
    DocumentStatus,
    KeywordType,
    MerchantServiceStatus,
    MerchantStatus,
    PackageStatus,
    PreferredChannel,
    Responsiveness,
    VerificationConfidence,
    WinbackStatus,
    YesNo,
)

SCHEMA = "profiling"


class AccountManager(Base):
    __tablename__ = "account_manager"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String, nullable=False)
    team: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String, unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())

    merchants: Mapped[list["Merchant"]] = relationship(back_populates="account_manager")


class Merchant(Base):
    __tablename__ = "merchant"
    __table_args__ = (
        Index("ix_merchant_restaurant_name", "restaurant_name_dba"),
        Index("ix_merchant_account_manager_id", "account_manager_id"),
        Index("ix_merchant_account_health", "account_health"),
        Index("ix_merchant_created_at", "created_at"),
        Index("ix_merchant_status", "status"),
        Index("ix_merchant_source", "source"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_code: Mapped[Optional[str]] = mapped_column("merchant_code", String, unique=True, nullable=True)
    restaurant_name: Mapped[str] = mapped_column("restaurant_name_dba", String, nullable=False)
    legal_name: Mapped[Optional[str]] = mapped_column("legal_name", String, nullable=True)
    cuisine_category: Mapped[Optional[str]] = mapped_column("cuisine_category", String, nullable=True)

    # Lifecycle of the account itself (not the marketing package). CHURNED
    # merchants carry a MerchantChurn record and make up the win-back list.
    status: Mapped[MerchantStatus] = mapped_column(
        Enum(MerchantStatus, name="MerchantStatus", schema=SCHEMA, native_enum=True),
        nullable=False, default=MerchantStatus.ACTIVE, server_default=MerchantStatus.ACTIVE.value,
    )
    # Innowi territory as the team uses it: BA, LA, NY, Sacramento, ...
    region: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # What Innowi runs there: "Full Solution", "Kiosk Only", "Online + Marketing", ...
    innowi_solution: Mapped[Optional[str]] = mapped_column("innowi_solution", String, nullable=True)
    # Account tier as the CSM team grades it (0-5 in the churn workbook).
    account_tier: Mapped[Optional[int]] = mapped_column("account_tier", Integer, nullable=True)
    # Where this record came from (app/models/sources.py MERCHANT_SOURCES) and the
    # file / slug / deal behind it. Set by the code that creates it; never edited.
    source: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    source_detail: Mapped[Optional[str]] = mapped_column("source_detail", String(300), nullable=True)
    # The Salesforce Account this merchant is (salesforce.account.id), when linked.
    salesforce_account_id: Mapped[Optional[str]] = mapped_column("salesforce_account_id", String(18), nullable=True)

    website_url: Mapped[Optional[str]] = mapped_column("website_url", String, nullable=True)
    website_platform: Mapped[Optional[str]] = mapped_column("website_platform", String, nullable=True)
    online_ordering: Mapped[Optional[str]] = mapped_column("online_ordering", String, nullable=True)
    pos_system: Mapped[Optional[str]] = mapped_column("pos_system", String, nullable=True)
    customer_list_source: Mapped[Optional[str]] = mapped_column("customer_list_source", String, nullable=True)

    google_ads_budget: Mapped[Optional[float]] = mapped_column("google_ads_budget", Numeric(10, 2), nullable=True)
    meta_ads_budget: Mapped[Optional[float]] = mapped_column("meta_ads_budget", Numeric(10, 2), nullable=True)
    # Who pays the Google Ads spend: "Merchant" | "Innowi". Shown in the Ads
    # module (informational, never used in a calculation).
    ads_paid_by: Mapped[Optional[str]] = mapped_column("ads_paid_by", String, nullable=True)

    business_goals: Mapped[Optional[str]] = mapped_column("business_goals", String, nullable=True)
    target_audience: Mapped[Optional[str]] = mapped_column("target_audience", String, nullable=True)
    slow_dayparts: Mapped[Optional[str]] = mapped_column("slow_dayparts", String, nullable=True)
    seasonal_peaks: Mapped[Optional[str]] = mapped_column("seasonal_peaks", String, nullable=True)
    alcohol_license: Mapped[Optional[YesNo]] = mapped_column(
        "alcohol_license", Enum(YesNo, name="YesNo", schema=SCHEMA, native_enum=True), nullable=True
    )
    dietary_certs: Mapped[Optional[str]] = mapped_column("dietary_certifications", String, nullable=True)

    location_count: Mapped[Optional[int]] = mapped_column("location_count", Integer, nullable=True)

    report_frequency: Mapped[Optional[str]] = mapped_column("report_frequency", String, nullable=True)
    report_recipients: Mapped[Optional[str]] = mapped_column("report_recipients", String, nullable=True)

    account_health: Mapped[Optional[AccountHealth]] = mapped_column(
        "account_health", Enum(AccountHealth, name="AccountHealth", schema=SCHEMA, native_enum=True), nullable=True
    )
    profile_completion_pct: Mapped[Optional[int]] = mapped_column("profile_completion_pct", Integer, nullable=True)
    next_action: Mapped[Optional[str]] = mapped_column("next_action", String, nullable=True)
    open_blockers: Mapped[Optional[str]] = mapped_column("open_blockers", String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    onboarding_date: Mapped[Optional[dt.datetime]] = mapped_column("onboarding_date", DateTime(timezone=True), nullable=True)
    go_live_date: Mapped[Optional[dt.datetime]] = mapped_column("go_live_date", DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    account_manager_id: Mapped[Optional[str]] = mapped_column(
        "account_manager_id", ForeignKey(f"{SCHEMA}.account_manager.id"), nullable=True
    )
    account_manager: Mapped[Optional["AccountManager"]] = relationship(back_populates="merchants")

    locations: Mapped[list["Location"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    contacts: Mapped[list["Contact"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    subscription: Mapped[Optional["Subscription"]] = relationship(back_populates="merchant", cascade="all, delete-orphan", uselist=False)
    brand_profile: Mapped[Optional["BrandProfile"]] = relationship(back_populates="merchant", cascade="all, delete-orphan", uselist=False)
    brand_assets: Mapped[list["BrandAsset"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    keywords: Mapped[list["Keyword"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    competitors: Mapped[list["Competitor"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    catering_profile: Mapped[Optional["CateringProfile"]] = relationship(back_populates="merchant", cascade="all, delete-orphan", uselist=False)
    access_items: Mapped[list["AccessItem"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    field_verifications: Mapped[list["FieldVerification"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    merchant_services: Mapped[list["MerchantService"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    documents: Mapped[list["Document"]] = relationship(back_populates="merchant", cascade="all, delete-orphan")
    churn: Mapped[Optional["MerchantChurn"]] = relationship(back_populates="merchant", cascade="all, delete-orphan", uselist=False)


class MerchantChurn(Base):
    """Why and when a merchant left, and where the win-back stands. One per
    merchant; created by the churn import or when a merchant is marked CHURNED."""
    __tablename__ = "merchant_churn"
    __table_args__ = (
        Index("ix_merchant_churn_churned_on", "churned_on"),
        Index("ix_merchant_churn_winback_status", "winback_status"),
        Index("ix_merchant_churn_winback_owner_id", "winback_owner_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column(
        "merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    merchant: Mapped["Merchant"] = relationship(back_populates="churn")

    churned_on: Mapped[Optional[dt.date]] = mapped_column("churned_on", Date, nullable=True)
    # Free text as the CSM team records it ("Price; Product Features"). Split on ";" for analysis.
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    csm_name: Mapped[Optional[str]] = mapped_column("csm_name", String, nullable=True)
    mrr_at_churn: Mapped[Optional[float]] = mapped_column("mrr_at_churn", Numeric(10, 2), nullable=True)
    gpv_at_churn: Mapped[Optional[float]] = mapped_column("gpv_at_churn", Numeric(12, 2), nullable=True)
    start_date: Mapped[Optional[dt.date]] = mapped_column("start_date", Date, nullable=True)
    last_touchpoint_on: Mapped[Optional[dt.date]] = mapped_column("last_touchpoint_on", Date, nullable=True)
    # Where the row came from: the workbook + sheet name, or "manual".
    source: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    winback_status: Mapped[WinbackStatus] = mapped_column(
        "winback_status", Enum(WinbackStatus, name="WinbackStatus", schema=SCHEMA, native_enum=True),
        nullable=False, default=WinbackStatus.NOT_STARTED, server_default=WinbackStatus.NOT_STARTED.value,
    )
    winback_owner_id: Mapped[Optional[str]] = mapped_column(
        "winback_owner_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    winback_notes: Mapped[Optional[str]] = mapped_column("winback_notes", String, nullable=True)
    next_follow_up_on: Mapped[Optional[dt.date]] = mapped_column("next_follow_up_on", Date, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    notes: Mapped[list["MerchantChurnNote"]] = relationship(
        back_populates="churn", cascade="all, delete-orphan", order_by="MerchantChurnNote.created_at.desc()"
    )


class MerchantChurnNote(Base):
    """A dated touch on a churned account (call, email, visit) by a team member."""
    __tablename__ = "merchant_churn_note"
    __table_args__ = (Index("ix_merchant_churn_note_churn_id", "churn_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    churn_id: Mapped[str] = mapped_column(
        "churn_id", ForeignKey(f"{SCHEMA}.merchant_churn.id", ondelete="CASCADE"), nullable=False
    )
    churn: Mapped["MerchantChurn"] = relationship(back_populates="notes")
    user_id: Mapped[Optional[str]] = mapped_column("user_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


class Location(Base):
    __tablename__ = "location"
    __table_args__ = (Index("ix_location_merchant_id", "merchant_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="locations")

    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    zip: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    hours: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    timezone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_primary: Mapped[bool] = mapped_column("is_primary", Boolean, nullable=False, default=False)
    nap_status: Mapped[Optional[str]] = mapped_column("nap_status", String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    documents: Mapped[list["Document"]] = relationship(back_populates="location")


class Contact(Base):
    __tablename__ = "contact"
    __table_args__ = (Index("ix_contact_merchant_id", "merchant_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="contacts")

    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    role: Mapped[ContactRole] = mapped_column(Enum(ContactRole, name="ContactRole", schema=SCHEMA, native_enum=True), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    preferred_channel: Mapped[Optional[PreferredChannel]] = mapped_column(
        "preferred_channel", Enum(PreferredChannel, name="PreferredChannel", schema=SCHEMA, native_enum=True), nullable=True
    )
    language: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    responsiveness: Mapped[Optional[Responsiveness]] = mapped_column(
        Enum(Responsiveness, name="Responsiveness", schema=SCHEMA, native_enum=True), nullable=True
    )

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Subscription(Base):
    __tablename__ = "subscription"
    __table_args__ = (Index("ix_subscription_package_code", "package_code"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column(
        "merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    merchant: Mapped["Merchant"] = relationship(back_populates="subscription")

    package_code: Mapped[str] = mapped_column("package_code", ForeignKey("catalog.package.code"), nullable=False)
    package = relationship("Package", back_populates="subscriptions")

    status: Mapped[PackageStatus] = mapped_column(Enum(PackageStatus, name="PackageStatus", schema=SCHEMA, native_enum=True), nullable=False)
    start_date: Mapped[Optional[dt.datetime]] = mapped_column("start_date", DateTime(timezone=True), nullable=True)
    renewal_date: Mapped[Optional[dt.datetime]] = mapped_column("renewal_date", DateTime(timezone=True), nullable=True)
    mrr: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    is_current: Mapped[bool] = mapped_column("is_current", Boolean, nullable=False, default=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BrandProfile(Base):
    __tablename__ = "brand_profile"
    __table_args__ = {"schema": SCHEMA}

    merchant_id: Mapped[str] = mapped_column(
        "merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), primary_key=True
    )
    merchant: Mapped["Merchant"] = relationship(back_populates="brand_profile")

    brand_colors: Mapped[Optional[str]] = mapped_column("brand_colors", String, nullable=True)
    brand_fonts: Mapped[Optional[str]] = mapped_column("brand_fonts", String, nullable=True)
    logo_vector: Mapped[Optional[YesNo]] = mapped_column(
        "logo_vector", Enum(YesNo, name="YesNo", schema=SCHEMA, native_enum=True, create_type=False), nullable=True
    )
    photo_library_status: Mapped[Optional[str]] = mapped_column("photo_library_status", String, nullable=True)
    menu_format: Mapped[Optional[str]] = mapped_column("menu_format", String, nullable=True)
    signature_dishes: Mapped[Optional[str]] = mapped_column("signature_dishes", String, nullable=True)
    tone_of_voice: Mapped[Optional[str]] = mapped_column("tone_of_voice", String, nullable=True)
    do_not_say: Mapped[Optional[str]] = mapped_column("do_not_say", String, nullable=True)
    content_restrictions: Mapped[Optional[str]] = mapped_column("content_restrictions", String, nullable=True)

    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BrandAsset(Base):
    __tablename__ = "brand_asset"
    __table_args__ = (Index("ix_brand_asset_merchant_id", "merchant_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="brand_assets")

    type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True, default="ACTIVE")
    mime_type: Mapped[Optional[str]] = mapped_column("mime_type", String, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column("size_bytes", Integer, nullable=True)
    uploaded_by: Mapped[Optional[str]] = mapped_column("uploaded_by", String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


class Keyword(Base):
    __tablename__ = "keyword"
    __table_args__ = (
        UniqueConstraint("merchant_id", "term", "type", name="uq_keyword_merchant_term_type"),
        Index("ix_keyword_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="keywords")

    term: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[KeywordType] = mapped_column(Enum(KeywordType, name="KeywordType", schema=SCHEMA, native_enum=True), nullable=False)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


class Competitor(Base):
    __tablename__ = "competitor"
    __table_args__ = (Index("ix_competitor_merchant_id", "merchant_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="competitors")

    name: Mapped[str] = mapped_column(String, nullable=False)
    rank: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


class CateringProfile(Base):
    __tablename__ = "catering_profile"
    __table_args__ = {"schema": SCHEMA}

    merchant_id: Mapped[str] = mapped_column(
        "merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), primary_key=True
    )
    merchant: Mapped["Merchant"] = relationship(back_populates="catering_profile")

    offered: Mapped[Optional[YesNo]] = mapped_column(
        Enum(YesNo, name="YesNo", schema=SCHEMA, native_enum=True, create_type=False), nullable=True
    )
    contact: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    lead_flow: Mapped[Optional[str]] = mapped_column("lead_flow", String, nullable=True)
    min_order: Mapped[Optional[str]] = mapped_column("min_order", String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AccessItem(Base):
    __tablename__ = "access_item"
    __table_args__ = (
        UniqueConstraint("merchant_id", "access_item", name="uq_access_item_merchant_item"),
        Index("ix_access_item_merchant_id", "merchant_id"),
        Index("ix_access_item_flag", "flag"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="access_items")

    access_item: Mapped[str] = mapped_column("access_item", String, nullable=False)
    criticality: Mapped[AccessCriticality] = mapped_column(
        Enum(AccessCriticality, name="AccessCriticality", schema=SCHEMA, native_enum=True), nullable=False
    )
    status: Mapped[AccessStatus] = mapped_column(
        Enum(AccessStatus, name="AccessStatus", schema=SCHEMA, native_enum=True), nullable=False, default=AccessStatus.NOT_REQUESTED
    )
    date_requested: Mapped[Optional[dt.datetime]] = mapped_column("date_requested", DateTime(timezone=True), nullable=True)
    date_received: Mapped[Optional[dt.datetime]] = mapped_column("date_received", DateTime(timezone=True), nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verified_date: Mapped[Optional[dt.datetime]] = mapped_column("verified_date", DateTime(timezone=True), nullable=True)
    expiry: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    flag: Mapped[AccessFlag] = mapped_column(
        Enum(AccessFlag, name="AccessFlag", schema=SCHEMA, native_enum=True), nullable=False, default=AccessFlag.OPEN
    )
    notes: Mapped[Optional[str]] = mapped_column("why_it_matters", String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FieldVerification(Base):
    __tablename__ = "field_verification"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", "field_name", name="uq_field_verification_entity_field"),
        Index("ix_field_verification_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="field_verifications")

    entity_type: Mapped[str] = mapped_column("entity_type", String, nullable=False)
    entity_id: Mapped[str] = mapped_column("entity_id", String, nullable=False)
    field_name: Mapped[str] = mapped_column("field_name", String, nullable=False)
    value: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    confidence: Mapped[VerificationConfidence] = mapped_column(
        Enum(VerificationConfidence, name="VerificationConfidence", schema=SCHEMA, native_enum=True),
        nullable=False,
        default=VerificationConfidence.UNVERIFIED,
    )
    verified_by: Mapped[Optional[str]] = mapped_column("verified_by", String, nullable=True)
    verified_at: Mapped[Optional[dt.datetime]] = mapped_column("verified_at", DateTime(timezone=True), nullable=True)


class MerchantService(Base):
    __tablename__ = "merchant_service"
    __table_args__ = (
        UniqueConstraint("merchant_id", "service_id", name="uq_merchant_service_merchant_service"),
        Index("ix_merchant_service_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="merchant_services")
    service_id: Mapped[str] = mapped_column("service_id", ForeignKey("catalog.service.id"), nullable=False)
    service = relationship("Service")

    status: Mapped[MerchantServiceStatus] = mapped_column(
        Enum(MerchantServiceStatus, name="MerchantServiceStatus", schema=SCHEMA, native_enum=True),
        nullable=False,
        default=MerchantServiceStatus.ACTIVE,
    )
    activated_at: Mapped[Optional[dt.datetime]] = mapped_column("activated_at", DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Document(Base):
    __tablename__ = "document"
    __table_args__ = (
        Index("ix_document_merchant_id", "merchant_id"),
        Index("ix_document_location_id", "location_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant: Mapped["Merchant"] = relationship(back_populates="documents")
    location_id: Mapped[Optional[str]] = mapped_column(
        "location_id", ForeignKey(f"{SCHEMA}.location.id", ondelete="SET NULL"), nullable=True
    )
    location: Mapped[Optional["Location"]] = relationship(back_populates="documents")

    category: Mapped[DocumentCategory] = mapped_column(
        Enum(DocumentCategory, name="DocumentCategory", schema=SCHEMA, native_enum=True), nullable=False
    )
    file_name: Mapped[str] = mapped_column("file_name", String, nullable=False)
    storage_url: Mapped[str] = mapped_column("storage_url", String, nullable=False)
    mime_type: Mapped[Optional[str]] = mapped_column("mime_type", String, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column("size_bytes", Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    uploaded_by: Mapped[Optional[str]] = mapped_column("uploaded_by", String, nullable=True)
    status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus, name="DocumentStatus", schema=SCHEMA, native_enum=True), nullable=False, default=DocumentStatus.ACTIVE
    )

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
