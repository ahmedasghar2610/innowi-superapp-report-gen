"""marketing schema — Google Ads reporting (Ads module).

Replaces the n8n "Google Ads Reporting" workflow and its Google Sheet. The API
keeps a local copy of what Google Ads returns for every client account under
the agency's manager (MCC) account, refreshed by the daily sync
(modules/ads/sync.py). Reports read only these tables, never Google live, so
any period (a day, a week, a month, a custom range) can be reported and
history keeps building up.

    ads_connection    the connected Google account (adwords scope) + encrypted refresh token
    ads_account       one row per Google Ads client account (the sheet's account list)
    ads_campaign      campaigns, with status, type, dates and daily budget
    ads_daily_metric  one row per campaign per day — spend, impressions, clicks and the
                      location-asset actions the n8n workflow reported (calls, directions,
                      website, orders, menu)
    ads_asset         Performance Max asset-group assets + campaign assets (sitelinks,
                      promotions, callouts) — Assets / Content / Sitelinks / Preview Ads
    ads_comment       "Analysis / Future Actions" comments written by staff
    ads_sync_run      one row per sync, for the status strip and troubleshooting

`source` on an account is GOOGLE (found by the sync), SHEET (imported from the
old Google Sheet account list, before the first sync) or DEMO (sample data,
removed by the first real sync).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "marketing"


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _created():
    return mapped_column("created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False)


def _updated():
    return mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


class AdsConnection(Base):
    __tablename__ = "ads_connection"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    google_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Fernet-encrypted (common/security/crypto.py). Never returned by the API.
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # connected | error (token revoked/expired → reconnect)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="connected", server_default="connected")
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    connected_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_sync_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


# active   — reported in the portfolio and synced every day
# archived — kept with its history, shown under "Archived", still synced
# ignored  — hidden everywhere (test accounts, accounts we don't manage); not synced
ACCOUNT_STATES = ("active", "archived", "ignored")
# verified | required | failed | pending | not_required | unknown
VERIFICATION_STATES = ("verified", "required", "failed", "pending", "not_required", "unknown")


class AdsAccount(Base):
    __tablename__ = "ads_account"
    __table_args__ = (
        Index("ix_ads_account_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    # Google Ads customer id, digits only ("2840308978"); shown as 284-030-8978.
    customer_id: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    # The manager (MCC) account it was found under / is reached through.
    manager_customer_id: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="GOOGLE", server_default="GOOGLE")
    state: Mapped[str] = mapped_column(String(10), nullable=False, default="active", server_default="active")
    # Google's own account status: ENABLED | CANCELED | SUSPENDED | CLOSED | UNKNOWN
    google_status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    currency_code: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)
    time_zone: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)

    merchant_id: Mapped[Optional[str]] = mapped_column(ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True)

    # Average ticket size inputs — the sheet's "Total Sales" ÷ "No of Orders"
    # (from Innowi Online Ordering, entered by staff). Avg ticket = sales ÷ orders.
    ticket_total_sales: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    ticket_order_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ticket_updated_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    verification: Mapped[str] = mapped_column(String(14), nullable=False, default="unknown", server_default="unknown")
    verification_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    verification_deadline: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Sample data only (source = DEMO): stands in for the Profile values a real
    # account gets from its linked merchant — {"approvedBudget", "adsPaidBy",
    # "address", "phone"}. Never set for real accounts.
    demo_profile: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    first_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_synced_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_metrics_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    # Whole account failed (metrics couldn't be read) → "Sync Issue".
    sync_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Synced, but an optional part (assets, verification…) couldn't be read.
    sync_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class AdsCampaign(Base):
    __tablename__ = "ads_campaign"
    __table_args__ = (
        UniqueConstraint("account_id", "google_campaign_id", name="uq_ads_campaign_account_google_id"),
        Index("ix_ads_campaign_account_id", "account_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    account_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.ads_account.id", ondelete="CASCADE"), nullable=False)
    google_campaign_id: Mapped[str] = mapped_column(String(24), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    # ENABLED | PAUSED | REMOVED | UNKNOWN
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="UNKNOWN", server_default="UNKNOWN")
    # PERFORMANCE_MAX | SEARCH | DISPLAY | LOCAL | …
    channel_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    start_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    # campaign_budget.amount_micros ÷ 1e6, in the account's currency.
    daily_budget: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


METRIC_COLUMNS = ("cost", "impressions", "clicks", "calls", "directions", "website", "orders", "menu")


class AdsDailyMetric(Base):
    """Location-asset actions are Google "all conversions" and can be fractional
    (data-driven attribution), so they are stored as decimals — n8n truncated
    them with parseInt."""

    __tablename__ = "ads_daily_metric"
    __table_args__ = (Index("ix_ads_daily_metric_date", "date"), {"schema": SCHEMA})

    campaign_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.ads_campaign.id", ondelete="CASCADE"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    cost: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    calls: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    directions: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    website: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    orders: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    menu: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")


class AdsAsset(Base):
    """One asset as used by one campaign. Replaced wholesale for an account on
    every sync (assets have no history worth keeping)."""

    __tablename__ = "ads_asset"
    __table_args__ = (
        Index("ix_ads_asset_account_id", "account_id"),
        Index("ix_ads_asset_campaign_id", "campaign_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    account_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.ads_account.id", ondelete="CASCADE"), nullable=False)
    campaign_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.ads_campaign.id", ondelete="CASCADE"), nullable=True)
    google_asset_id: Mapped[str] = mapped_column(String(24), nullable=False)
    # HEADLINE | LONG_HEADLINE | DESCRIPTION | BUSINESS_NAME | MARKETING_IMAGE |
    # SQUARE_MARKETING_IMAGE | PORTRAIT_MARKETING_IMAGE | LOGO | LANDSCAPE_LOGO |
    # YOUTUBE_VIDEO | SITELINK | PROMOTION | CALLOUT | …
    field_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # text | image | logo | video | sitelink | promotion | callout | other
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    # ENABLED | PAUSED | REMOVED | UNKNOWN
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="ENABLED", server_default="ENABLED")
    name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Sitelink: {linkText, description1, description2, finalUrl}
    # Promotion: {target, discount, code, startDate, endDate, occasion}
    # Video: {youtubeId}
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    synced_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AdsComment(Base):
    __tablename__ = "ads_comment"
    __table_args__ = (Index("ix_ads_comment_account_id", "account_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    account_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.ads_account.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class AdsSyncRun(Base):
    __tablename__ = "ads_sync_run"
    __table_args__ = (Index("ix_ads_sync_run_started_at", "started_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    trigger: Mapped[str] = mapped_column(String(12), nullable=False)  # manual | schedule | connect | cli
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="running")  # running | success | partial | failed
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    accounts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accounts_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metric_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    new_accounts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
