"""marketing schema — Google Business Profile (GBP) reporting.

Everything here is a local copy of what Google returns for the restaurant
listings managed by ONE connected Google account, refreshed by the daily sync
(modules/gbp/sync.py). Reports read only these tables, never Google live, so a
page load costs no API quota and history keeps building up over time.

    gbp_connection     the connected Google account + its encrypted refresh token
    gbp_location       one row per Business Profile listing (Google "locations/<id>")
    gbp_daily_metric   one row per listing per day (Business Profile Performance API)
    gbp_search_keyword monthly search terms per listing (Google only gives months)
    gbp_review         reviews (My Business v4 API)
    gbp_post           posts / offers / events (My Business v4 localPosts)
    gbp_note           internal reporting notes written by staff (never sent to Google)
    gbp_sync_run       one row per sync, for the status strip and troubleshooting

`source` on a location is GOOGLE for synced listings and DEMO for the sample
data loaded by scripts/seed_gbp_demo.py. The first real sync removes DEMO rows.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
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


class GbpConnection(Base):
    __tablename__ = "gbp_connection"
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


class GbpLocation(Base):
    __tablename__ = "gbp_location"
    __table_args__ = (
        Index("ix_gbp_location_merchant_id", "merchant_id"),
        Index("ix_gbp_location_store_code", "store_code"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    # "locations/1234567890" — Google's id; unique across accounts.
    google_location_id: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    # "accounts/123" the listing was read from (needed by the v4 reviews/posts API).
    google_account_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="GOOGLE", server_default="GOOGLE")

    store_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    address_line: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    website_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    menu_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    ordering_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    social_links: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    primary_category: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    additional_categories: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # [{"day": "MONDAY", "open": "11:00", "close": "22:00"}, …]
    regular_hours: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attribute_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    photo_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    has_logo: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    has_cover: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    maps_uri: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    place_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    # OPEN | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY | UNKNOWN
    open_status: Mapped[str] = mapped_column(String(24), nullable=False, default="OPEN", server_default="OPEN")
    # verified | pending | required | unknown
    verification: Mapped[str] = mapped_column(String(12), nullable=False, default="unknown", server_default="unknown")

    # [{"key": "phone", "label": "Phone", "done": true}, …] — see modules/gbp/profile.py
    profile_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Google's own totals from the reviews endpoint (cover reviews we never paged in).
    rating_average: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    review_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    merchant_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True
    )

    first_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_synced_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_metrics_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    last_review_sync_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Whole listing failed (metrics couldn't be read) → shown as "Sync failed".
    sync_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Synced, but an optional part (photos, posts, keywords…) couldn't be read.
    sync_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


METRIC_COLUMNS = (
    "impressions_desktop_maps",
    "impressions_desktop_search",
    "impressions_mobile_maps",
    "impressions_mobile_search",
    "website_clicks",
    "call_clicks",
    "direction_requests",
    "menu_clicks",
    "food_orders",
    "bookings",
    "conversations",
)


class GbpDailyMetric(Base):
    __tablename__ = "gbp_daily_metric"
    __table_args__ = (Index("ix_gbp_daily_metric_date", "date"), {"schema": SCHEMA})

    location_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.gbp_location.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    impressions_desktop_maps: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    impressions_desktop_search: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    impressions_mobile_maps: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    impressions_mobile_search: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    website_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    call_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    direction_requests: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    menu_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    food_orders: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    bookings: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    conversations: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class GbpSearchKeyword(Base):
    """Google reports search terms per month only, and hides small counts:
    `impressions` is exact, or None with `threshold` set ("fewer than N")."""

    __tablename__ = "gbp_search_keyword"
    __table_args__ = {"schema": SCHEMA}

    location_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.gbp_location.id", ondelete="CASCADE"), primary_key=True
    )
    month: Mapped[dt.date] = mapped_column(Date, primary_key=True)  # first day of the month
    keyword: Mapped[str] = mapped_column(String(300), primary_key=True)
    impressions: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    threshold: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class GbpReview(Base):
    __tablename__ = "gbp_review"
    __table_args__ = (
        Index("ix_gbp_review_location_created", "location_id", "create_time"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    location_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.gbp_location.id", ondelete="CASCADE"), nullable=False)
    google_review_id: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    star_rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    create_time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    update_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    has_reply: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    reply_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class GbpPost(Base):
    __tablename__ = "gbp_post"
    __table_args__ = (Index("ix_gbp_post_location_created", "location_id", "create_time"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    location_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.gbp_location.id", ondelete="CASCADE"), nullable=False)
    google_post_id: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    topic_type: Mapped[str] = mapped_column(String(20), nullable=False, default="STANDARD")  # STANDARD|EVENT|OFFER|ALERT
    title: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # LIVE | PROCESSING | REJECTED
    create_time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    start_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    coupon_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    search_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


class GbpNote(Base):
    __tablename__ = "gbp_note"
    __table_args__ = (Index("ix_gbp_note_location_id", "location_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    location_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.gbp_location.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class GbpSyncRun(Base):
    __tablename__ = "gbp_sync_run"
    __table_args__ = (Index("ix_gbp_sync_run_started_at", "started_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    trigger: Mapped[str] = mapped_column(String(12), nullable=False)  # manual | schedule | connect
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="running")  # running | success | partial | failed
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    locations: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locations_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metric_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reviews: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
