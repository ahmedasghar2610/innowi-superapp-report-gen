"""marketing: Google Business Profile reporting

Revision ID: 65a5db0fcb37
Revises: 3a7313586c89
Create Date: 2026-10-06

Local copy of the Business Profile data for the connected Google account,
filled by the daily sync (modules/gbp/sync.py):

- marketing.gbp_connection   connected account + encrypted refresh token
- marketing.gbp_location     one row per listing, optionally linked to a merchant
- marketing.gbp_daily_metric daily views / clicks / calls / directions …
- marketing.gbp_search_keyword monthly search terms
- marketing.gbp_review, marketing.gbp_post
- marketing.gbp_note         internal reporting notes
- marketing.gbp_sync_run     sync history
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "65a5db0fcb37"
down_revision: Union[str, None] = "3a7313586c89"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "marketing"


def _ts(name: str, nullable: bool = True, now: bool = False) -> sa.Column:
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=nullable, server_default=sa.text("now()") if now else None
    )


def _int0(name: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), nullable=False, server_default="0")


def _jsonb_list(name: str) -> sa.Column:
    return sa.Column(name, postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb"))


def _loc_fk() -> sa.Column:
    return sa.Column("location_id", sa.String(30), sa.ForeignKey(f"{S}.gbp_location.id", ondelete="CASCADE"), nullable=False)



def _ensure_schema(name: str) -> None:
    """Create an app schema only when it is really missing. On the shared
    Supabase database the restricted `superapp` role may not create schemas:
    the owner creates them once (sql/*_schema.sql) and hands them over, and
    CREATE SCHEMA IF NOT EXISTS would still need the privilege."""
    real = qualified(name)
    exists = op.get_bind().execute(sa.text("SELECT 1 FROM pg_namespace WHERE nspname = :n"), {"n": real}).scalar()
    if not exists:
        op.execute(f'CREATE SCHEMA "{real}"')

def upgrade() -> None:
    _ensure_schema(S)

    op.create_table(
        "gbp_connection",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("google_email", sa.String(255), nullable=True),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="connected"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("connected_by_id", sa.String(30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        _ts("connected_at", nullable=False, now=True),
        _ts("last_sync_at"),
        _ts("created_at", nullable=False, now=True),
        _ts("updated_at", nullable=False, now=True),
        schema=S,
    )

    op.create_table(
        "gbp_location",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("google_location_id", sa.String(80), nullable=False, unique=True),
        sa.Column("google_account_id", sa.String(80), nullable=True),
        sa.Column("source", sa.String(10), nullable=False, server_default="GOOGLE"),
        sa.Column("store_code", sa.String(80), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("address_line", sa.String(400), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("state", sa.String(80), nullable=True),
        sa.Column("postal_code", sa.String(20), nullable=True),
        sa.Column("country", sa.String(4), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("website_url", sa.String(500), nullable=True),
        sa.Column("menu_url", sa.String(500), nullable=True),
        sa.Column("ordering_url", sa.String(500), nullable=True),
        _jsonb_list("social_links"),
        sa.Column("primary_category", sa.String(200), nullable=True),
        _jsonb_list("additional_categories"),
        _jsonb_list("regular_hours"),
        sa.Column("description", sa.Text(), nullable=True),
        _int0("attribute_count"),
        sa.Column("photo_count", sa.Integer(), nullable=True),
        sa.Column("has_logo", sa.Boolean(), nullable=True),
        sa.Column("has_cover", sa.Boolean(), nullable=True),
        sa.Column("maps_uri", sa.String(500), nullable=True),
        sa.Column("place_id", sa.String(120), nullable=True),
        sa.Column("open_status", sa.String(24), nullable=False, server_default="OPEN"),
        sa.Column("verification", sa.String(12), nullable=False, server_default="unknown"),
        _jsonb_list("profile_fields"),
        sa.Column("rating_average", sa.Float(), nullable=True),
        sa.Column("review_count", sa.Integer(), nullable=True),
        sa.Column("merchant_id", sa.String(30), sa.ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True),
        _ts("first_seen_at", nullable=False, now=True),
        _ts("last_synced_at"),
        sa.Column("last_metrics_date", sa.Date(), nullable=True),
        _ts("last_review_sync_at"),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("sync_warning", sa.Text(), nullable=True),
        _ts("created_at", nullable=False, now=True),
        _ts("updated_at", nullable=False, now=True),
        schema=S,
    )
    op.create_index("ix_gbp_location_merchant_id", "gbp_location", ["merchant_id"], schema=S)
    op.create_index("ix_gbp_location_store_code", "gbp_location", ["store_code"], schema=S)

    op.create_table(
        "gbp_daily_metric",
        sa.Column("location_id", sa.String(30), sa.ForeignKey(f"{S}.gbp_location.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("date", sa.Date(), primary_key=True),
        *[
            _int0(c)
            for c in (
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
        ],
        schema=S,
    )
    op.create_index("ix_gbp_daily_metric_date", "gbp_daily_metric", ["date"], schema=S)

    op.create_table(
        "gbp_search_keyword",
        sa.Column("location_id", sa.String(30), sa.ForeignKey(f"{S}.gbp_location.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("month", sa.Date(), primary_key=True),
        sa.Column("keyword", sa.String(300), primary_key=True),
        sa.Column("impressions", sa.Integer(), nullable=True),
        sa.Column("threshold", sa.Integer(), nullable=True),
        schema=S,
    )

    op.create_table(
        "gbp_review",
        sa.Column("id", sa.String(30), primary_key=True),
        _loc_fk(),
        sa.Column("google_review_id", sa.String(200), nullable=False, unique=True),
        sa.Column("star_rating", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("reviewer_name", sa.String(200), nullable=True),
        _ts("create_time", nullable=False),
        _ts("update_time"),
        sa.Column("has_reply", sa.Boolean(), nullable=False, server_default="false"),
        _ts("reply_time"),
        schema=S,
    )
    op.create_index("ix_gbp_review_location_created", "gbp_review", ["location_id", "create_time"], schema=S)

    op.create_table(
        "gbp_post",
        sa.Column("id", sa.String(30), primary_key=True),
        _loc_fk(),
        sa.Column("google_post_id", sa.String(200), nullable=False, unique=True),
        sa.Column("topic_type", sa.String(20), nullable=False),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("state", sa.String(20), nullable=True),
        _ts("create_time", nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("coupon_code", sa.String(80), nullable=True),
        sa.Column("search_url", sa.String(500), nullable=True),
        schema=S,
    )
    op.create_index("ix_gbp_post_location_created", "gbp_post", ["location_id", "create_time"], schema=S)

    op.create_table(
        "gbp_note",
        sa.Column("id", sa.String(30), primary_key=True),
        _loc_fk(),
        sa.Column("author_id", sa.String(30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("edited", sa.Boolean(), nullable=False, server_default="false"),
        _ts("created_at", nullable=False, now=True),
        _ts("updated_at", nullable=False, now=True),
        schema=S,
    )
    op.create_index("ix_gbp_note_location_id", "gbp_note", ["location_id"], schema=S)

    op.create_table(
        "gbp_sync_run",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("trigger", sa.String(12), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        _ts("started_at", nullable=False, now=True),
        _ts("finished_at"),
        sa.Column("started_by_id", sa.String(30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("locations", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locations_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metric_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reviews", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        schema=S,
    )
    op.create_index("ix_gbp_sync_run_started_at", "gbp_sync_run", ["started_at"], schema=S)


def downgrade() -> None:
    for t in ("gbp_sync_run", "gbp_note", "gbp_post", "gbp_review", "gbp_search_keyword", "gbp_daily_metric", "gbp_location", "gbp_connection"):
        op.drop_table(t, schema=S)
