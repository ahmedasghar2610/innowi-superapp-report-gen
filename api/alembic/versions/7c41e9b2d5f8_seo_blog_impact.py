"""marketing: Blog Impact (blog posts per site and their Search Console / GA4 figures)

Revision ID: 7c41e9b2d5f8
Revises: d2e3f4a5b6c7
Create Date: 2026-10-22

- marketing.seo_blog_post        blog posts found on each site (+ URL Inspection, last Google crawl)
- marketing.seo_blog_gsc_daily   Search Console per post per day (final or provisional)
- marketing.seo_blog_gsc_hourly  Search Console per post per hour (posts from the last 10 days)
- marketing.seo_blog_query       search terms per post per month
- marketing.seo_blog_ga4_daily   GA4 visits and order clicks per post per day
- marketing.seo_blog_site_daily  site-wide non-brand clicks/impressions per day
- marketing.seo_blog_state       per site: Google's data freshness, last checks, brand terms
- marketing.seo_blog_schedule    when the blog job runs (one row, edited on the page)
- marketing.seo_blog_run         one row per run

New tables only; nothing existing changes. `alembic downgrade d2e3f4a5b6c7` removes them again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "7c41e9b2d5f8"
down_revision: Union[str, None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "marketing"


def _ts(name: str, nullable: bool = True, server_now: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable, server_default=sa.text("now()") if server_now else None)


def upgrade() -> None:
    op.create_table(
        "seo_blog_post",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("site_id", sa.String(length=30), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("title", sa.String(length=600), nullable=True),
        sa.Column("published_on", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=12), nullable=False),
        sa.Column("live", sa.Boolean(), server_default="true", nullable=False),
        _ts("first_seen_at", False),
        _ts("last_seen_at", False),
        sa.Column("index_verdict", sa.String(length=24), nullable=True),
        sa.Column("coverage_state", sa.String(length=200), nullable=True),
        _ts("google_last_crawl_at"),
        _ts("inspected_at"),
        sa.Column("indexed_on", sa.Date(), nullable=True),
        sa.Column("gsc_final_through", sa.Date(), nullable=True),
        sa.Column("ga4_through", sa.Date(), nullable=True),
        _ts("created_at", False, True),
        _ts("updated_at", False, True),
        sa.ForeignKeyConstraint(["site_id"], [f"{S}.seo_site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "url", name="uq_seo_blog_post_site_url"),
        schema=S,
    )
    for name, key, key_type in (("seo_blog_gsc_daily", "date", sa.Date()), ("seo_blog_gsc_hourly", "hour", sa.DateTime(timezone=True))):
        cols = [
            sa.Column("post_id", sa.String(length=30), nullable=False),
            sa.Column(key, key_type, nullable=False),
            sa.Column("clicks", sa.Integer(), nullable=False),
            sa.Column("impressions", sa.Integer(), nullable=False),
            sa.Column("position", sa.Float(), nullable=True),
        ]
        if name == "seo_blog_gsc_daily":
            cols.append(sa.Column("is_final", sa.Boolean(), nullable=False))
        op.create_table(
            name, *cols,
            sa.ForeignKeyConstraint(["post_id"], [f"{S}.seo_blog_post.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("post_id", key),
            schema=S,
        )
    op.create_table(
        "seo_blog_query",
        sa.Column("post_id", sa.String(length=30), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("query", sa.String(length=400), nullable=False),
        sa.Column("clicks", sa.Integer(), nullable=False),
        sa.Column("impressions", sa.Integer(), nullable=False),
        sa.Column("position", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["post_id"], [f"{S}.seo_blog_post.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("post_id", "month", "query"),
        schema=S,
    )
    op.create_table(
        "seo_blog_ga4_daily",
        sa.Column("post_id", sa.String(length=30), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("sessions", sa.Integer(), nullable=False),
        sa.Column("organic_sessions", sa.Integer(), nullable=False),
        sa.Column("engaged_sessions", sa.Integer(), nullable=False),
        sa.Column("order_clicks", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], [f"{S}.seo_blog_post.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("post_id", "date"),
        schema=S,
    )
    op.create_table(
        "seo_blog_site_daily",
        sa.Column("site_id", sa.String(length=30), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("nonbrand_clicks", sa.Integer(), nullable=False),
        sa.Column("nonbrand_impressions", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], [f"{S}.seo_site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id", "date"),
        schema=S,
    )
    op.create_table(
        "seo_blog_state",
        sa.Column("site_id", sa.String(length=30), nullable=False),
        sa.Column("gsc_first_incomplete_date", sa.Date(), nullable=True),
        _ts("gsc_first_incomplete_hour"),
        sa.Column("gsc_final_through", sa.Date(), nullable=True),
        _ts("checked_at"),
        _ts("changed_at"),
        sa.Column("discovered_on", sa.Date(), nullable=True),
        sa.Column("queries_on", sa.Date(), nullable=True),
        sa.Column("nonbrand_through", sa.Date(), nullable=True),
        sa.Column("brand_terms", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_warning", sa.Text(), nullable=True),
        _ts("updated_at", False, True),
        sa.ForeignKeyConstraint(["site_id"], [f"{S}.seo_site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id"),
        schema=S,
    )
    op.create_table(
        "seo_blog_schedule",
        sa.Column("key", sa.String(length=20), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("times", postgresql.JSONB(astext_type=sa.Text()), server_default='["06:00", "13:00", "20:00"]', nullable=False),
        sa.Column("timezone", sa.String(length=40), server_default="Asia/Karachi", nullable=False),
        sa.Column("updated_by_id", sa.String(length=30), nullable=True),
        _ts("updated_at", False, True),
        sa.ForeignKeyConstraint(["updated_by_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("key"),
        schema=S,
    )
    op.create_table(
        "seo_blog_run",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("trigger", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        _ts("started_at", False),
        _ts("finished_at"),
        sa.Column("started_by_id", sa.String(length=30), nullable=True),
        sa.Column("sites", sa.Integer(), nullable=False),
        sa.Column("sites_unchanged", sa.Integer(), nullable=False),
        sa.Column("sites_failed", sa.Integer(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["started_by_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema=S,
    )
    op.create_index("ix_seo_blog_run_started_at", "seo_blog_run", ["started_at"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_seo_blog_run_started_at", table_name="seo_blog_run", schema=S)
    for name in ("seo_blog_run", "seo_blog_schedule", "seo_blog_state", "seo_blog_site_daily", "seo_blog_ga4_daily",
                 "seo_blog_query", "seo_blog_gsc_hourly", "seo_blog_gsc_daily", "seo_blog_post"):
        op.drop_table(name, schema=S)
