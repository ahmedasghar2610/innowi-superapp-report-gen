"""marketing: Search Console monthly split by device and country (client report)

Revision ID: d2e3f4a5b6c7
Revises: c3d4e5f6a7b9
Create Date: 2026-10-20

- marketing.seo_gsc_split   clicks / impressions / position per site, month, device or country

New table only; nothing existing changes. `alembic downgrade c1d2e3f4a5b6` removes it again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, None] = "c3d4e5f6a7b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "seo_gsc_split",
        sa.Column("site_id", sa.String(length=30), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("dimension", sa.String(length=12), nullable=False),
        sa.Column("key", sa.String(length=60), nullable=False),
        sa.Column("clicks", sa.Integer(), nullable=False),
        sa.Column("impressions", sa.Integer(), nullable=False),
        sa.Column("position", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["site_id"], ["marketing.seo_site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id", "month", "dimension", "key"),
        schema="marketing",
    )


def downgrade() -> None:
    op.drop_table("seo_gsc_split", schema="marketing")
