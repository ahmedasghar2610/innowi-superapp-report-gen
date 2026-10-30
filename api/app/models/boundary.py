"""Boundary schemas: delivery, performance, marketing, payments. Tables exist
(seeded during merchant onboarding) but the modules that own them are stubs —
see docs/*/README.md in the NestJS source. Mirrors schema.prisma exactly."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import DeliveryStatus, OpportunityStatus, PromotionStatus, Priority, YesNo


# ---- delivery ---------------------------------------------------------------
class DeliveryItem(Base):
    __tablename__ = "delivery_item"
    __table_args__ = (
        UniqueConstraint("merchant_id", "service_id", name="uq_delivery_item_merchant_service"),
        Index("ix_delivery_item_merchant_id", "merchant_id"),
        {"schema": "delivery"},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)
    service_id: Mapped[str] = mapped_column("service_id", ForeignKey("catalog.service.id"), nullable=False)
    entitlement_id: Mapped[Optional[str]] = mapped_column("entitlement_id", ForeignKey("catalog.entitlement.id"), nullable=True)

    status: Mapped[DeliveryStatus] = mapped_column(
        Enum(DeliveryStatus, name="DeliveryStatus", schema="delivery", native_enum=True), nullable=False, default=DeliveryStatus.NOT_STARTED
    )
    assigned_to: Mapped[Optional[str]] = mapped_column("assigned_to", String, nullable=True)
    last_delivered: Mapped[Optional[dt.datetime]] = mapped_column("last_delivered", DateTime(timezone=True), nullable=True)
    next_due: Mapped[Optional[dt.datetime]] = mapped_column("next_due", DateTime(timezone=True), nullable=True)
    flag: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ---- performance --------------------------------------------------------------
class Baseline(Base):
    __tablename__ = "baseline"
    __table_args__ = (
        UniqueConstraint("merchant_id", "category", "metric", name="uq_baseline_merchant_category_metric"),
        Index("ix_baseline_merchant_id", "merchant_id"),
        {"schema": "performance"},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)

    category: Mapped[str] = mapped_column(String, nullable=False)
    metric: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    baseline_date: Mapped[Optional[dt.datetime]] = mapped_column("baseline_date", DateTime(timezone=True), nullable=True)
    baseline_value: Mapped[Optional[str]] = mapped_column("baseline_value", String, nullable=True)
    current_date_: Mapped[Optional[dt.datetime]] = mapped_column("current_date", DateTime(timezone=True), nullable=True)
    current_value: Mapped[Optional[str]] = mapped_column("current_value", String, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class ScorecardEntry(Base):
    __tablename__ = "scorecard_entry"
    __table_args__ = (Index("ix_scorecard_entry_merchant_month", "merchant_id", "month"), {"schema": "performance"})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)
    service_id: Mapped[Optional[str]] = mapped_column("service_id", ForeignKey("catalog.service.id"), nullable=True)

    month: Mapped[str] = mapped_column(String, nullable=False)
    area: Mapped[str] = mapped_column(String, nullable=False)
    kpi: Mapped[str] = mapped_column(String, nullable=False)
    target: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    actual: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    commentary: Mapped[Optional[str]] = mapped_column(String, nullable=True)


# ---- marketing ----------------------------------------------------------------
class Promotion(Base):
    __tablename__ = "promotion"
    __table_args__ = (Index("ix_promotion_merchant_id", "merchant_id"), {"schema": "marketing"})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)

    promo_name: Mapped[Optional[str]] = mapped_column("promo_name", String, nullable=True)
    offer_type: Mapped[Optional[str]] = mapped_column("offer_type", String, nullable=True)
    offer_value: Mapped[Optional[str]] = mapped_column("offer_value", String, nullable=True)
    promo_code: Mapped[Optional[str]] = mapped_column("promo_code", String, nullable=True)
    channels: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    start_date: Mapped[Optional[dt.datetime]] = mapped_column("start_date", DateTime(timezone=True), nullable=True)
    end_date: Mapped[Optional[dt.datetime]] = mapped_column("end_date", DateTime(timezone=True), nullable=True)
    status: Mapped[PromotionStatus] = mapped_column(
        Enum(PromotionStatus, name="PromotionStatus", schema="marketing", native_enum=True),
        nullable=False,
        default=PromotionStatus.NO_PROMOTION,
    )
    redemptions: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    redemption_method: Mapped[Optional[str]] = mapped_column("redemption_method", String, nullable=True)
    approval_owner: Mapped[Optional[str]] = mapped_column("approval_owner", String, nullable=True)
    staff_briefed: Mapped[Optional[YesNo]] = mapped_column(
        "staff_briefed", Enum(YesNo, name="YesNo", schema="profiling", native_enum=True, create_type=False), nullable=True
    )
    blackout_dates: Mapped[Optional[str]] = mapped_column("blackout_dates", String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


# ---- payments -------------------------------------------------------------------
class Opportunity(Base):
    __tablename__ = "opportunity"
    __table_args__ = (Index("ix_opportunity_merchant_id", "merchant_id"), {"schema": "payments"})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column("merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)

    opportunity: Mapped[str] = mapped_column(String, nullable=False)
    current_status: Mapped[OpportunityStatus] = mapped_column(
        "current_status",
        Enum(OpportunityStatus, name="OpportunityStatus", schema="payments", native_enum=True),
        nullable=False,
        default=OpportunityStatus.RECOMMENDED,
    )
    priority: Mapped[Optional[Priority]] = mapped_column(
        Enum(Priority, name="Priority", schema="payments", native_enum=True), nullable=True
    )
    est_monthly_value: Mapped[Optional[float]] = mapped_column("est_monthly_value", Numeric(10, 2), nullable=True)
    rationale: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    next_step: Mapped[Optional[str]] = mapped_column("next_step", String, nullable=True)
    target_date: Mapped[Optional[dt.datetime]] = mapped_column("target_date", DateTime(timezone=True), nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column("created_at", DateTime(timezone=True), server_default=func.now())


class MerchantPayment(Base):
    """One merchant's billing for one month, from the paid-marketing revenue report
    (e.g. "Revenue Sheet Sept. 2026"): contract, what was charged, the variance, the
    month's online-order revenue and notes. One row per merchant per month; re-importing
    the month replaces it."""

    __tablename__ = "merchant_payment"
    __table_args__ = (
        UniqueConstraint("merchant_id", "month", name="uq_merchant_payment_merchant_month"),
        Index("ix_merchant_payment_month", "month"),
        {"schema": "payments"},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column(ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)
    month: Mapped[dt.date] = mapped_column(Date, nullable=False)  # first day of the month
    account_name: Mapped[str] = mapped_column(String, nullable=False)  # as written in the report
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # Active / Paused / Not live yet …
    package_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    contract_amount: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    charged_amount: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    variance: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    orders_revenue: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    commission_charge: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_file: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_sheet: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    imported_by: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
