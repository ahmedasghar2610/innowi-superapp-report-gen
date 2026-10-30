"""salesforce schema - a read-only copy of Innowi's Salesforce records.

The Sales module shows Salesforce data inside the SuperApp. Salesforce stays the
system of record: nothing here is ever written back. The sync
(app/modules/salesforce/sync.py) copies changed records on a schedule, keyed
by the Salesforce record id, so every table's primary key is that 18-character
id and every write is an upsert.

Only what the Sales screens need is copied. Accounts and contacts are limited
to restaurants that have a deal, a support case, a field visit or a
touchpoint - not the ~66,000 cold accounts imported in 2022.

`sf_*` column names hold Salesforce's own timestamps (CreatedDate,
LastModifiedDate, SystemModstamp); `synced_at` is when this copy last changed.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "salesforce"

SF_ID = 18  # Salesforce's case-safe record id length.


def _sf_id(primary_key: bool = False, nullable: bool = True):
    if primary_key:
        return mapped_column(String(SF_ID), primary_key=True)
    return mapped_column(String(SF_ID), nullable=nullable)


def _modstamp():
    return mapped_column("sf_system_modstamp", DateTime(timezone=True), nullable=True)


def _synced_at():
    return mapped_column(
        "synced_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SfUser(Base):
    """A Salesforce user - a salesperson, a field engineer, a support agent."""

    __tablename__ = "sf_user"
    __table_args__ = (Index("ix_sf_user_email", "email"), {"schema": SCHEMA})

    id: Mapped[str] = _sf_id(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    username: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    profile_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    role_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_login_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfAccount(Base):
    """A restaurant (Salesforce Account)."""

    __tablename__ = "account"
    __table_args__ = (
        Index("ix_sf_account_owner_id", "owner_id"),
        Index("ix_sf_account_name", "name"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = _sf_id(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    billing_street: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    billing_city: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    billing_state: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    billing_postal_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    owner_id: Mapped[Optional[str]] = _sf_id()
    sf_created_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_last_modified_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    # When this restaurant's contacts were last fetched in full. NULL = not yet:
    # the next sync fetches them (a newly copied restaurant can have old contacts
    # the "changed since" query would never return). The sync's upserts never
    # set this column, so re-copying the account keeps it.
    contacts_fetched_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfContact(Base):
    __tablename__ = "contact"
    __table_args__ = (Index("ix_sf_contact_account_id", "account_id"), {"schema": SCHEMA})

    id: Mapped[str] = _sf_id(primary_key=True)
    account_id: Mapped[Optional[str]] = _sf_id()
    name: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    mobile_phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    owner_id: Mapped[Optional[str]] = _sf_id()
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfOpportunityStage(Base):
    """Salesforce's stage list (OpportunityStage), active and retired.

    ~680 deals still sit in stages that were switched off later, so the copy
    keeps the inactive ones too; app/modules/salesforce/stages.py maps every
    stage to a display column.
    """

    __tablename__ = "opportunity_stage"
    __table_args__ = {"schema": SCHEMA}

    label: Mapped[str] = mapped_column(String, primary_key=True)
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_won: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_probability: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfOpportunity(Base):
    """A deal."""

    __tablename__ = "opportunity"
    __table_args__ = (
        Index("ix_sf_opportunity_owner_id", "owner_id"),
        Index("ix_sf_opportunity_account_id", "account_id"),
        Index("ix_sf_opportunity_stage_name", "stage_name"),
        Index("ix_sf_opportunity_last_modified", "sf_last_modified_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = _sf_id(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    account_id: Mapped[Optional[str]] = _sf_id()
    owner_id: Mapped[Optional[str]] = _sf_id()
    stage_name: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(16, 2), nullable=True)
    close_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    probability: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_won: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    record_type_id: Mapped[Optional[str]] = _sf_id()
    record_type_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    lead_source: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_activity_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    sf_created_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_last_modified_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfCase(Base):
    """A support ticket. Its owner may be a user or a queue (id prefix 00G)."""

    __tablename__ = "case"
    __table_args__ = (
        Index("ix_sf_case_account_id", "account_id"),
        Index("ix_sf_case_owner_id", "owner_id"),
        Index("ix_sf_case_created", "sf_created_at"),
        Index("ix_sf_case_issue_category", "issue_category"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = _sf_id(primary_key=True)
    case_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    subject: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    origin: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    priority: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    account_id: Mapped[Optional[str]] = _sf_id()
    contact_id: Mapped[Optional[str]] = _sf_id()
    owner_id: Mapped[Optional[str]] = _sf_id()
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sf_created_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_closed_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # The care team's fields (Case.Issue_Category__c, Case_Assigned_To__c, ...). assigned_team is
    # filled on few cases; see salesforce/case_insights.py for the estimated department.
    issue_category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    assigned_team: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    resolution_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    caller_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    details: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfVisit(Base):
    """A field visit or task (Salesforce custom object Innowi_Task__c)."""

    __tablename__ = "visit"
    __table_args__ = (
        Index("ix_sf_visit_owner_id", "owner_id"),
        Index("ix_sf_visit_account_id", "account_id"),
        Index("ix_sf_visit_due_start", "due_date_start"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = _sf_id(primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    account_id: Mapped[Optional[str]] = _sf_id()
    account_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    owner_id: Mapped[Optional[str]] = _sf_id()
    visit_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sales_agent: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    due_date_start: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    due_date_end: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    appointment_time: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    completed_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    sf_created_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfTouchpoint(Base):
    """Customer health log (Salesforce custom object Touchpoint_History__c)."""

    __tablename__ = "touchpoint"
    __table_args__ = (Index("ix_sf_touchpoint_account_id", "account_id"), {"schema": SCHEMA})

    id: Mapped[str] = _sf_id(primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    account_id: Mapped[Optional[str]] = _sf_id()
    owner_id: Mapped[Optional[str]] = _sf_id()
    health_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    latest_status: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    latest_touchpoint_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    sf_system_modstamp: Mapped[Optional[dt.datetime]] = _modstamp()
    synced_at: Mapped[dt.datetime] = _synced_at()


class SfSyncState(Base):
    """Where the incremental sync of one Salesforce object got to."""

    __tablename__ = "sync_state"
    __table_args__ = {"schema": SCHEMA}

    object_name: Mapped[str] = mapped_column(String, primary_key=True)
    # Position reached: (SystemModstamp, Id) of the last record copied. The next run
    # asks for records strictly after that pair, so many records sharing one
    # timestamp (a bulk update) can't make it re-read the same page forever.
    # last_id NULL means "from last_modstamp inclusive".
    last_modstamp: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # When deletions were last checked (Salesforce keeps them for 30 days).
    deleted_checked_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Salesforce refused the object's optional fields on some run, so rows copied since then
    # lack them. The next run that can read them re-reads the whole object, then clears this.
    optional_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SfSyncRun(Base):
    """One sync request: what it copied, how many API calls it made, and how it ended."""

    __tablename__ = "sync_run"
    __table_args__ = (Index("ix_sf_sync_run_started_at", "started_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)  # "schedule" | "manual" | "full"
    started_by: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # auth.user id for manual runs
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # "running" | "success" | "partial" (time budget hit, continues next run) | "error" | "skipped"
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    api_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class SfUserLink(Base):
    """Which Salesforce user a SuperApp login is.

    A salesperson's Sales screens are filtered to records this Salesforce user
    owns. Kept in the salesforce schema (not a column on auth.user) so the
    Sales module can be removed without touching the login tables.
    """

    __tablename__ = "user_link"
    __table_args__ = {"schema": SCHEMA}

    user_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("auth.user.id", ondelete="CASCADE"), primary_key=True
    )
    sf_user_id: Mapped[str] = mapped_column(String(SF_ID), nullable=False, unique=True)
    linked_by: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    linked_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
