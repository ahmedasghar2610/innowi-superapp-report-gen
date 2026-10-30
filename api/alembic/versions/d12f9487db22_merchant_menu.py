"""profiling: merchant menu extracted from Innowi Online Ordering

Revision ID: d12f9487db22
Revises: 3430cbf43fb8
Create Date: 2026-10-12

Two tables behind Merchant → Profiling → Menu:
merchant_menu (1:1, source link + last run) and merchant_menu_item.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "d12f9487db22"
down_revision: Union[str, None] = "3430cbf43fb8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "profiling"


def upgrade() -> None:
    op.create_table(
        "merchant_menu",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("merchant_id", sa.String(length=30), sa.ForeignKey(f"{S}.merchant.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("source_url", sa.String(length=500), nullable=True),
        sa.Column("sub_url", sa.String(length=120), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("restaurant_name", sa.String(), nullable=True),
        sa.Column("logo_url", sa.String(length=1000), nullable=True),
        sa.Column("banner_url", sa.String(length=1000), nullable=True),
        sa.Column("exclude_catering", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("filter_graphics", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("valid_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("graphic_skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("no_image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_status", sa.String(length=16), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extracted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extracted_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema=S,
    )
    op.create_table(
        "merchant_menu_item",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("merchant_id", sa.String(length=30), sa.ForeignKey(f"{S}.merchant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Numeric(10, 2), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(length=1000), nullable=True),
        sa.Column("image_hash", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="VALID"),
        schema=S,
    )
    op.create_index("ix_merchant_menu_item_merchant_id", "merchant_menu_item", ["merchant_id", "position"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_merchant_menu_item_merchant_id", table_name="merchant_menu_item", schema=S)
    op.drop_table("merchant_menu_item", schema=S)
    op.drop_table("merchant_menu", schema=S)
