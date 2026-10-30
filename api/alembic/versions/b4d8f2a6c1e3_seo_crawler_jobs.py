"""SEO: Screaming Frog crawler helpers — keys and the crawl queue

- marketing.seo_crawler_key  one key per helper PC (only a hash is stored)
- marketing.seo_crawl_job    "crawl this site" requests, picked up by a helper

New tables only. `alembic downgrade a1c5e9f3b7d2` removes them again.

Revision ID: b4d8f2a6c1e3
Revises: a1c5e9f3b7d2
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b4d8f2a6c1e3"
down_revision: Union[str, None] = "a1c5e9f3b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "marketing"


def upgrade() -> None:
    op.create_table(
        "seo_crawler_key",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("key_hint", sa.String(length=8), nullable=False),
        sa.Column("created_by_id", sa.String(length=30), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("helper_name", sa.String(length=120), nullable=True),
        sa.Column("helper_version", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key_hash"),
        schema=S,
    )
    op.create_table(
        "seo_crawl_job",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("site_id", sa.String(length=30), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("requested_by_id", sa.String(length=30), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("key_id", sa.String(length=30), nullable=True),
        sa.Column("helper_name", sa.String(length=120), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("crawl_id", sa.String(length=30), nullable=True),
        sa.Column("urls", sa.Integer(), nullable=True),
        sa.Column("duration_sec", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["site_id"], [f"{S}.seo_site.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["key_id"], [f"{S}.seo_crawler_key.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["crawl_id"], [f"{S}.seo_crawl.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema=S,
    )
    op.create_index("ix_seo_crawl_job_status", "seo_crawl_job", ["status", "requested_at"], schema=S)
    op.create_index("ix_seo_crawl_job_site", "seo_crawl_job", ["site_id", "requested_at"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_seo_crawl_job_site", table_name="seo_crawl_job", schema=S)
    op.drop_index("ix_seo_crawl_job_status", table_name="seo_crawl_job", schema=S)
    op.drop_table("seo_crawl_job", schema=S)
    op.drop_table("seo_crawler_key", schema=S)
