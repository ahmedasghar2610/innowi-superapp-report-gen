"""Blog Impact: US-only numbers next to the all-countries ones ("All countries / US only" toggle)

- seo_blog_gsc_daily / seo_blog_gsc_hourly / seo_blog_query / seo_blog_ga4_daily / seo_blog_site_daily:
  new `scope` column ('all' | 'us', existing rows = 'all') added to the primary key.
- seo_blog_site_daily: clicks / impressions / organic_sessions (filled for scope 'us' only).
- seo_blog_post: us_gsc_final_through, us_ga4_through; seo_blog_state: us_nonbrand_through,
  us_site_through, us_ga4_site_through — so the US history backfills on the next refresh.

Existing data is kept. `alembic downgrade 196a5ecb5a59` removes the US rows and the new columns.

Revision ID: a1c5e9f3b7d2
Revises: 196a5ecb5a59
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.schemas import qualified

revision: str = "a1c5e9f3b7d2"
down_revision: Union[str, None] = "196a5ecb5a59"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "marketing"
# table → its primary key without scope
TABLES = {
    "seo_blog_gsc_daily": ["post_id", "date"],
    "seo_blog_gsc_hourly": ["post_id", "hour"],
    "seo_blog_query": ["post_id", "month", "query"],
    "seo_blog_ga4_daily": ["post_id", "date"],
    "seo_blog_site_daily": ["site_id", "date"],
}


def upgrade() -> None:
    for table, pk in TABLES.items():
        op.add_column(table, sa.Column("scope", sa.String(length=3), server_default="all", nullable=False), schema=S)
        op.drop_constraint(f"{table}_pkey", table, type_="primary", schema=S)
        op.create_primary_key(f"{table}_pkey", table, [*pk, "scope"], schema=S)
    for col in ("clicks", "impressions", "organic_sessions"):
        op.add_column("seo_blog_site_daily", sa.Column(col, sa.Integer(), nullable=True), schema=S)
    for col in ("us_gsc_final_through", "us_ga4_through"):
        op.add_column("seo_blog_post", sa.Column(col, sa.Date(), nullable=True), schema=S)
    for col in ("us_nonbrand_through", "us_site_through", "us_ga4_site_through"):
        op.add_column("seo_blog_state", sa.Column(col, sa.Date(), nullable=True), schema=S)


def downgrade() -> None:
    for col in ("us_nonbrand_through", "us_site_through", "us_ga4_site_through"):
        op.drop_column("seo_blog_state", col, schema=S)
    for col in ("us_gsc_final_through", "us_ga4_through"):
        op.drop_column("seo_blog_post", col, schema=S)
    for col in ("clicks", "impressions", "organic_sessions"):
        op.drop_column("seo_blog_site_daily", col, schema=S)
    for table, pk in TABLES.items():
        op.execute(f"DELETE FROM {qualified(S)}.{table} WHERE scope <> 'all'")
        op.drop_constraint(f"{table}_pkey", table, type_="primary", schema=S)
        op.create_primary_key(f"{table}_pkey", table, pk, schema=S)
        op.drop_column(table, "scope", schema=S)
