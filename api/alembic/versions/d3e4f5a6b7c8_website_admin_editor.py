"""website: /admin visual editor — password and edited pages

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-23

Adds three nullable columns to marketing.website for the per-site /admin
editor served by the public site template (nextjs-site at /<slug>/admin):

- admin_password_hash — bcrypt hash of the site's editor password
- editor_content      — the visually edited pages ({pages, site}); NULL means
                        the site is still rendered live from `values_json`
- editor_updated_at   — when editor_content was last saved

All nullable with no default, so existing rows need no backfill.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("website", sa.Column("admin_password_hash", sa.String(length=255), nullable=True), schema="marketing")
    op.add_column("website", sa.Column("editor_content", sa.JSON(), nullable=True), schema="marketing")
    op.add_column(
        "website", sa.Column("editor_updated_at", sa.DateTime(timezone=True), nullable=True), schema="marketing"
    )


def downgrade() -> None:
    op.drop_column("website", "editor_updated_at", schema="marketing")
    op.drop_column("website", "editor_content", schema="marketing")
    op.drop_column("website", "admin_password_hash", schema="marketing")
