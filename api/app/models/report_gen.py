"""marketing schema — Report Generator (modules/report_gen): one-click monthly merchant reports.

Every table carries the `report_gen_` prefix and lives next to `seo_report` in
the marketing schema, so no schema list has to change. Nothing here touches
another module's table; links to merchants and users are plain foreign keys.

    report_gen_report             one row per merchant per period per template; the lifecycle
                                  generating → draft → edited → approved → sent | failed | deleted
    report_gen_snapshot           the assembled payload, one row per generated version; the
                                  approved version is frozen and never changes again
    report_gen_audit              who generated / edited / approved / deleted / sent, and when
    report_gen_send               one row per send attempt; a unique index stops a version
                                  from being sent twice
    report_gen_run                "generate all" runs (Phase 1)
    report_gen_file               PDF / DOCX exports of an approved snapshot (Phase 1)
    report_gen_merchant_settings  recipients, CC, report day, primary account / site
                                  per merchant, without touching profiling.merchant (Phase 2)
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "marketing"

STATUSES = ("generating", "draft", "edited", "approved", "sent", "failed", "deleted")
TEMPLATES = ("monthly", "sales_only", "multi_month")
AUDIT_ACTIONS = ("generate", "edit", "approve", "delete", "send", "send_failed")
SEND_MODES = ("dry-run", "sandbox", "live")


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _created():
    return mapped_column("created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False)


def _updated():
    return mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


def _user_fk():
    return mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)


class ReportGenReport(Base):
    __tablename__ = "report_gen_report"
    __table_args__ = (
        UniqueConstraint("merchant_id", "period_start", "period_end", "template", name="uq_report_gen_report_merchant_period"),
        Index("ix_report_gen_report_status", "status"),
        Index("ix_report_gen_report_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column(ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False)
    period_start: Mapped[dt.date] = mapped_column(Date, nullable=False)
    period_end: Mapped[dt.date] = mapped_column(Date, nullable=False)
    template: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly", server_default="monthly")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="generating", server_default="generating")
    # The snapshot version the report currently shows (bumped on every generate).
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    generated_by_id: Mapped[Optional[str]] = _user_fk()
    generated_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[Optional[str]] = _user_fk()
    approved_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[Optional[str]] = _user_fk()
    deleted_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Per source: the last day of data when the draft was made ("data through"), and the
    # list of {id, reason} figures that printed "not supplied" — copied from the snapshot
    # so the queue can show them without loading the payload.
    data_through: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    missing: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class ReportGenSnapshot(Base):
    __tablename__ = "report_gen_snapshot"
    __table_args__ = (
        UniqueConstraint("report_id", "version", name="uq_report_gen_snapshot_report_version"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    report_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.report_gen_report.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # True once approved: the service refuses every later write to this row.
    frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_by_id: Mapped[Optional[str]] = _user_fk()
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class ReportGenAudit(Base):
    __tablename__ = "report_gen_audit"
    __table_args__ = (Index("ix_report_gen_audit_report_id", "report_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    report_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.report_gen_report.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    user_id: Mapped[Optional[str]] = _user_fk()
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")


class ReportGenSend(Base):
    """One row per send attempt. `status`: dry_run | sent | failed. The partial unique
    index lets a version be marked `sent` once only, whatever the service does."""

    __tablename__ = "report_gen_send"
    __table_args__ = (
        Index("uq_report_gen_send_once", "report_id", "version", unique=True, postgresql_where=text("status = 'sent'")),
        Index("ix_report_gen_send_report_id", "report_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    report_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.report_gen_report.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    recipients: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    sent_by_id: Mapped[Optional[str]] = _user_fk()
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ReportGenRun(Base):
    """A "generate all due reports" run (Phase 1). Same shape as ads_sync_run."""

    __tablename__ = "report_gen_run"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    trigger: Mapped[str] = mapped_column(String(8), nullable=False, default="manual", server_default="manual")  # manual | job
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="running", server_default="running")  # running | success | partial | failed
    period_start: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    period_end: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reports: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[Optional[str]] = _user_fk()


class ReportGenFile(Base):
    """PDF / DOCX export of an approved snapshot, stored through app/common/storage (Phase 1)."""

    __tablename__ = "report_gen_file"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "kind", name="uq_report_gen_file_snapshot_kind"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    snapshot_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.report_gen_snapshot.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # pdf | docx
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[dt.datetime] = _created()


class ReportGenMerchantSettings(Base):
    """Report settings per merchant (Phase 2). Kept here so profiling.merchant stays untouched."""

    __tablename__ = "report_gen_merchant_settings"
    __table_args__ = {"schema": SCHEMA}

    merchant_id: Mapped[str] = mapped_column(ForeignKey("profiling.merchant.id", ondelete="CASCADE"), primary_key=True)
    recipients: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    cc: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    report_day: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    primary_ads_account_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.ads_account.id", ondelete="SET NULL"), nullable=True)
    primary_seo_site_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="SET NULL"), nullable=True)
    updated_by_id: Mapped[Optional[str]] = _user_fk()
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()
