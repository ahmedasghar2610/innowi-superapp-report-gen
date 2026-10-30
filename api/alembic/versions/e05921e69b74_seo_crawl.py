"""marketing: full-site crawls imported from Screaming Frog

Revision ID: e05921e69b74
Revises: 2eb8feb50f7b
Create Date: 2026-10-15

- marketing.seo_crawl        one imported crawl per site (totals)
- marketing.seo_crawl_issue  Issues Overview rows + sample URLs
- marketing.seo_crawl_page   every crawled URL (Internal → All) + its issues

New tables only; nothing existing changes. `alembic downgrade 2eb8feb50f7b`
removes them again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e05921e69b74"
down_revision: Union[str, None] = "2eb8feb50f7b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "seo_crawl",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("site_id", sa.String(length=30), nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("crawled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("folder", sa.String(length=500), nullable=True),
        sa.Column("totals", JSON, server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["marketing.seo_site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="marketing",
    )
    op.create_index("ix_seo_crawl_site_crawled", "seo_crawl", ["site_id", "crawled_at"], schema="marketing")
    op.create_table(
        "seo_crawl_issue",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("crawl_id", sa.String(length=30), nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("issue_type", sa.String(length=20), nullable=False),
        sa.Column("priority", sa.String(length=10), nullable=False),
        sa.Column("urls", sa.Integer(), nullable=False),
        sa.Column("pct", sa.Float(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("how_to_fix", sa.Text(), nullable=True),
        sa.Column("help_url", sa.String(length=500), nullable=True),
        sa.Column("sample", JSON, server_default="[]", nullable=False),
        sa.Column("links_sample", JSON, server_default="[]", nullable=False),
        sa.ForeignKeyConstraint(["crawl_id"], ["marketing.seo_crawl.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="marketing",
    )
    op.create_index("ix_seo_crawl_issue_crawl", "seo_crawl_issue", ["crawl_id"], schema="marketing")
    op.create_table(
        "seo_crawl_page",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("crawl_id", sa.String(length=30), nullable=False),
        sa.Column("url", sa.String(length=2000), nullable=False),
        sa.Column("path", sa.String(length=2000), nullable=False),
        sa.Column("content_type", sa.String(length=80), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("indexable", sa.Boolean(), nullable=True),
        sa.Column("indexability_status", sa.String(length=120), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("title_length", sa.Integer(), nullable=True),
        sa.Column("title_px", sa.Integer(), nullable=True),
        sa.Column("meta_description", sa.Text(), nullable=True),
        sa.Column("meta_length", sa.Integer(), nullable=True),
        sa.Column("h1", sa.Text(), nullable=True),
        sa.Column("h2", sa.Text(), nullable=True),
        sa.Column("canonical", sa.String(length=2000), nullable=True),
        sa.Column("meta_robots", sa.String(length=200), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=True),
        sa.Column("readability", sa.Float(), nullable=True),
        sa.Column("crawl_depth", sa.Integer(), nullable=True),
        sa.Column("inlinks", sa.Integer(), nullable=True),
        sa.Column("unique_inlinks", sa.Integer(), nullable=True),
        sa.Column("outlinks", sa.Integer(), nullable=True),
        sa.Column("external_outlinks", sa.Integer(), nullable=True),
        sa.Column("link_score", sa.Float(), nullable=True),
        sa.Column("near_duplicates", sa.Integer(), nullable=True),
        sa.Column("response_ms", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("redirect_url", sa.String(length=2000), nullable=True),
        sa.Column("issues", JSON, server_default="[]", nullable=False),
        sa.ForeignKeyConstraint(["crawl_id"], ["marketing.seo_crawl.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="marketing",
    )
    op.create_index("ix_seo_crawl_page_crawl", "seo_crawl_page", ["crawl_id"], schema="marketing")


def downgrade() -> None:
    op.drop_index("ix_seo_crawl_page_crawl", table_name="seo_crawl_page", schema="marketing")
    op.drop_table("seo_crawl_page", schema="marketing")
    op.drop_index("ix_seo_crawl_issue_crawl", table_name="seo_crawl_issue", schema="marketing")
    op.drop_table("seo_crawl_issue", schema="marketing")
    op.drop_index("ix_seo_crawl_site_crawled", table_name="seo_crawl", schema="marketing")
    op.drop_table("seo_crawl", schema="marketing")
