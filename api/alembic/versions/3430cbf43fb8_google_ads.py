"""marketing: Google Ads reporting (+ profiling.merchant.ads_paid_by)

Revision ID: 3430cbf43fb8
Revises: 65cddf0561bb
Create Date: 2026-10-07

Replaces the n8n "Google Ads Reporting" workflow and its Google Sheet
(modules/ads):

- marketing.ads_connection    connected Google account (adwords) + encrypted refresh token
- marketing.ads_account       client accounts under the manager account, optional merchant link,
                              avg-ticket inputs, verification, sync state
- marketing.ads_campaign      campaigns (status, type, dates, daily budget)
- marketing.ads_daily_metric  per campaign per day: spend, impressions, clicks, calls,
                              directions, website, orders, menu
- marketing.ads_asset         PMax assets, sitelinks, promotions, callouts
- marketing.ads_comment       Analysis / Future Actions comments
- marketing.ads_sync_run      sync history
- profiling.merchant.ads_paid_by  "Merchant" | "Innowi" (Profile → Marketing → Ads Paid By)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "3430cbf43fb8"
down_revision: Union[str, None] = "65cddf0561bb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "marketing"


def _ts(name: str, nullable: bool = True, now: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable, server_default=sa.text("now()") if now else None)


def _num(name: str, p: int = 12) -> sa.Column:
    return sa.Column(name, sa.Numeric(p, 2), nullable=False, server_default="0")



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
    op.add_column("merchant", sa.Column("ads_paid_by", sa.String(), nullable=True), schema="profiling")

    op.create_table(
        "ads_connection",
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
        "ads_account",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("customer_id", sa.String(12), nullable=False, unique=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("manager_customer_id", sa.String(12), nullable=True),
        sa.Column("source", sa.String(10), nullable=False, server_default="GOOGLE"),
        sa.Column("state", sa.String(10), nullable=False, server_default="active"),
        sa.Column("google_status", sa.String(16), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=True),
        sa.Column("time_zone", sa.String(60), nullable=True),
        sa.Column("merchant_id", sa.String(30), sa.ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ticket_total_sales", sa.Numeric(14, 2), nullable=True),
        sa.Column("ticket_order_count", sa.Integer(), nullable=True),
        _ts("ticket_updated_at"),
        sa.Column("verification", sa.String(14), nullable=False, server_default="unknown"),
        sa.Column("verification_message", sa.Text(), nullable=True),
        _ts("verification_deadline"),
        sa.Column("demo_profile", postgresql.JSONB(), nullable=True),
        _ts("first_seen_at", nullable=False, now=True),
        _ts("last_synced_at"),
        sa.Column("last_metrics_date", sa.Date(), nullable=True),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("sync_warning", sa.Text(), nullable=True),
        _ts("created_at", nullable=False, now=True),
        _ts("updated_at", nullable=False, now=True),
        schema=S,
    )
    op.create_index("ix_ads_account_merchant_id", "ads_account", ["merchant_id"], schema=S)

    op.create_table(
        "ads_campaign",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("account_id", sa.String(30), sa.ForeignKey(f"{S}.ads_account.id", ondelete="CASCADE"), nullable=False),
        sa.Column("google_campaign_id", sa.String(24), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="UNKNOWN"),
        sa.Column("channel_type", sa.String(30), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("daily_budget", sa.Numeric(12, 2), nullable=True),
        _ts("created_at", nullable=False, now=True),
        _ts("updated_at", nullable=False, now=True),
        sa.UniqueConstraint("account_id", "google_campaign_id", name="uq_ads_campaign_account_google_id"),
        schema=S,
    )
    op.create_index("ix_ads_campaign_account_id", "ads_campaign", ["account_id"], schema=S)

    op.create_table(
        "ads_daily_metric",
        sa.Column("campaign_id", sa.String(30), sa.ForeignKey(f"{S}.ads_campaign.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("date", sa.Date(), primary_key=True),
        _num("cost", 14),
        sa.Column("impressions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clicks", sa.Integer(), nullable=False, server_default="0"),
        _num("calls"),
        _num("directions"),
        _num("website"),
        _num("orders"),
        _num("menu"),
        schema=S,
    )
    op.create_index("ix_ads_daily_metric_date", "ads_daily_metric", ["date"], schema=S)

    op.create_table(
        "ads_asset",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("account_id", sa.String(30), sa.ForeignKey(f"{S}.ads_account.id", ondelete="CASCADE"), nullable=False),
        sa.Column("campaign_id", sa.String(30), sa.ForeignKey(f"{S}.ads_campaign.id", ondelete="CASCADE"), nullable=True),
        sa.Column("google_asset_id", sa.String(24), nullable=False),
        sa.Column("field_type", sa.String(40), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="ENABLED"),
        sa.Column("name", sa.String(300), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(1000), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        _ts("synced_at", nullable=False, now=True),
        schema=S,
    )
    op.create_index("ix_ads_asset_account_id", "ads_asset", ["account_id"], schema=S)
    op.create_index("ix_ads_asset_campaign_id", "ads_asset", ["campaign_id"], schema=S)

    op.create_table(
        "ads_comment",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("account_id", sa.String(30), sa.ForeignKey(f"{S}.ads_account.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("edited", sa.Boolean(), nullable=False, server_default="false"),
        _ts("created_at", nullable=False, now=True),
        _ts("updated_at", nullable=False, now=True),
        schema=S,
    )
    op.create_index("ix_ads_comment_account_id", "ads_comment", ["account_id"], schema=S)

    op.create_table(
        "ads_sync_run",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("trigger", sa.String(12), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="running"),
        _ts("started_at", nullable=False, now=True),
        _ts("finished_at"),
        sa.Column("started_by_id", sa.String(30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accounts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accounts_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metric_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("new_accounts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        schema=S,
    )
    op.create_index("ix_ads_sync_run_started_at", "ads_sync_run", ["started_at"], schema=S)


def downgrade() -> None:
    for t in ("ads_sync_run", "ads_comment", "ads_asset", "ads_daily_metric", "ads_campaign", "ads_account", "ads_connection"):
        op.drop_table(t, schema=S)
    op.drop_column("merchant", "ads_paid_by", schema="profiling")
