"""quotes: the restaurant quote builder (price list, quote links, requests)

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-10-18

Adds the `quotes` schema (`<prefix>quotes` on the shared database). On the
shared Supabase database the `superapp` role may not create schemas: run
api/sql/quotes_schema.sql once as the project owner before deploying this.
The price list itself is filled by scripts/seed_quotes.py (insert-only, so
prices edited in the app are never overwritten by a deploy).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "e0f1a2b3c4d5"
down_revision: Union[str, None] = "d9e0f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "quotes"


def _money(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.Numeric(10, 2), nullable=nullable)


def _created_updated() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    exists = op.get_bind().execute(
        sa.text("SELECT 1 FROM pg_namespace WHERE nspname = :n"), {"n": qualified(S)}
    ).scalar()
    if not exists:
        op.execute(f"CREATE SCHEMA {qualified(S)}")

    op.create_table(
        "price_item",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("sku", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("section", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("unit_label", sa.String(length=40), nullable=True),
        _money("monthly_price"),
        _money("purchase_price"),
        _money("lease_price"),
        sa.Column("is_station", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("selectable", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("max_qty", sa.Integer(), server_default=sa.text("20"), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        *_created_updated(),
        sa.UniqueConstraint("sku", name="uq_price_item_sku"),
        sa.CheckConstraint("kind IN ('DEVICE','HARDWARE','SOFTWARE','SERVICE')", name="ck_price_item_kind"),
        sa.CheckConstraint("max_qty BETWEEN 1 AND 500", name="ck_price_item_max_qty"),
        schema=S,
    )

    op.create_table(
        "quote_link",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'ACTIVE'"), nullable=False),
        sa.Column("restaurant_name", sa.String(length=160), nullable=False),
        sa.Column("contact_name", sa.String(length=120), nullable=True),
        sa.Column("contact_email", sa.String(length=200), nullable=True),
        sa.Column("contact_phone", sa.String(length=40), nullable=True),
        sa.Column("merchant_id", sa.String(length=30), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("discount_percent", sa.Numeric(5, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("allow_lease", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.String(length=30), nullable=False),
        sa.Column("created_by_email", sa.String(length=200), nullable=False),
        *_created_updated(),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("open_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_quote_link_token_hash"),
        sa.CheckConstraint("mode IN ('SHOW_PRICES','HIDE_PRICES')", name="ck_quote_link_mode"),
        sa.CheckConstraint("status IN ('ACTIVE','REVOKED')", name="ck_quote_link_status"),
        sa.CheckConstraint("discount_percent BETWEEN 0 AND 100", name="ck_quote_link_discount"),
        schema=S,
    )
    op.create_index("ix_quote_link_created_at", "quote_link", ["created_at"], schema=S)

    op.create_table(
        "quote_link_item",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("link_id", sa.String(length=30), sa.ForeignKey(f"{S}.quote_link.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_id", sa.String(length=30), sa.ForeignKey(f"{S}.price_item.id", ondelete="CASCADE"), nullable=False),
        sa.Column("percent_off", sa.Numeric(5, 2), nullable=True),
        _money("monthly_price"),
        _money("purchase_price"),
        _money("lease_price"),
        sa.Column("hidden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.UniqueConstraint("link_id", "item_id", name="uq_quote_link_item"),
        sa.CheckConstraint("percent_off IS NULL OR percent_off BETWEEN 0 AND 100", name="ck_quote_link_item_pct"),
        schema=S,
    )

    op.create_table(
        "quote_request",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("number", sa.String(length=24), nullable=False),
        sa.Column("link_id", sa.String(length=30), sa.ForeignKey(f"{S}.quote_link.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("restaurant_name", sa.String(length=160), nullable=False),
        sa.Column("contact_name", sa.String(length=120), nullable=False),
        sa.Column("contact_email", sa.String(length=200), nullable=False),
        sa.Column("contact_phone", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("hardware_plan", sa.String(length=10), nullable=False),
        sa.Column("selections", sa.JSON(), nullable=False),
        sa.Column("lines", sa.JSON(), nullable=False),
        _money("one_time_total", nullable=False),
        _money("monthly_software_total", nullable=False),
        _money("monthly_lease_total", nullable=False),
        _money("list_one_time_total", nullable=False),
        _money("list_monthly_total", nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_name", sa.String(length=120), nullable=True),
        sa.Column("accepted_title", sa.String(length=120), nullable=True),
        sa.Column("accepted_ip", sa.String(length=64), nullable=True),
        sa.Column("client_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("notified", sa.JSON(), nullable=False),
        sa.Column("staff_note", sa.Text(), nullable=True),
        *_created_updated(),
        sa.UniqueConstraint("number", name="uq_quote_request_number"),
        sa.CheckConstraint(
            "status IN ('REQUESTED','PROPOSED','ACCEPTED','DECLINED','CLOSED')", name="ck_quote_request_status"
        ),
        sa.CheckConstraint("hardware_plan IN ('BUY','LEASE')", name="ck_quote_request_hw_plan"),
        schema=S,
    )
    op.create_index("ix_quote_request_link_id", "quote_request", ["link_id"], schema=S)
    op.create_index("ix_quote_request_created_at", "quote_request", ["created_at"], schema=S)


def downgrade() -> None:
    op.drop_table("quote_request", schema=S)
    op.drop_table("quote_link_item", schema=S)
    op.drop_table("quote_link", schema=S)
    op.drop_table("price_item", schema=S)
