"""website: link to merchant

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-25

Adds `merchant_id` to marketing.website — the Website module's link to the
Merchant (Customer Profiling) record that owns the site. Nullable: a website
may be created before its merchant exists ("unassigned") and linked later.
ON DELETE SET NULL, so deleting a merchant leaves its sites as unassigned
instead of taking the public page offline.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("website", sa.Column("merchant_id", sa.String(length=30), nullable=True), schema="marketing")
    op.create_index("ix_website_merchant_id", "website", ["merchant_id"], schema="marketing")
    op.create_foreign_key(
        "fk_website_merchant_id",
        "website",
        "merchant",
        ["merchant_id"],
        ["id"],
        source_schema="marketing",
        referent_schema="profiling",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_website_merchant_id", "website", schema="marketing", type_="foreignkey")
    op.drop_index("ix_website_merchant_id", table_name="website", schema="marketing")
    op.drop_column("website", "merchant_id", schema="marketing")
