"""add marketing.website (ported from the standalone website-api service)

Revision ID: b1c2d3e4f5a6
Revises: 5794397107b7
Create Date: 2026-09-16

Creates the single table the standalone `website-api` FastAPI service owned,
inside this database's existing `marketing` schema. No new Postgres schema is
introduced, so docker/init/01-init.sql is unchanged.

`status` is a plain VARCHAR rather than a native enum on purpose: the intake
workflow's states (draft / in_review / live) change more freely than the
profiling enums, and a VARCHAR avoids an ALTER TYPE for each new one.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "5794397107b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "website",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("tagline", sa.String(length=255), nullable=False),
        sa.Column("contact_email", sa.String(length=320), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        # `values` is reserved in SQL, hence the distinct column name.
        sa.Column("values_json", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="marketing",
    )
    # SQLAlchemy names a schema-qualified column index ix_<schema>_<table>_<col>;
    # keep that exact name so `alembic check` reports no drift against the model.
    op.create_index("ix_marketing_website_slug", "website", ["slug"], unique=True, schema="marketing")
    op.create_index("ix_website_status", "website", ["status"], unique=False, schema="marketing")
    op.create_index("ix_website_name", "website", ["name"], unique=False, schema="marketing")
    op.create_index("ix_website_updated_at", "website", ["updated_at"], unique=False, schema="marketing")


def downgrade() -> None:
    op.drop_index("ix_website_updated_at", table_name="website", schema="marketing")
    op.drop_index("ix_website_name", table_name="website", schema="marketing")
    op.drop_index("ix_website_status", table_name="website", schema="marketing")
    op.drop_index("ix_marketing_website_slug", table_name="website", schema="marketing")
    op.drop_table("website", schema="marketing")
