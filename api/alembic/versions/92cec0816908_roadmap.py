"""roadmap: phases and items (what is done, in progress and planned, and who owns it)

Revision ID: 92cec0816908
Revises: f1a2b3c4d5e6
Create Date: 2026-10-18

Adds the `roadmap` schema (`<prefix>roadmap` on the shared database). On the
shared Supabase database the `superapp` role may not create schemas: run
api/sql/roadmap_schema.sql once as the project owner before deploying this.
The first roadmap is written by scripts/seed_roadmap.py, only while the roadmap
is empty, so edits made in the app are never overwritten by a deploy.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "92cec0816908"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "roadmap"


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
        "phase",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("start_month", sa.Date(), nullable=False),
        sa.Column("end_month", sa.Date(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        *_created_updated(),
        sa.CheckConstraint("end_month >= start_month", name="ck_phase_months"),
        schema=S,
    )

    op.create_table(
        "item",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("phase_id", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("area", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'TODO'"), nullable=False),
        sa.Column("priority", sa.String(length=10), server_default=sa.text("'NORMAL'"), nullable=False),
        sa.Column("owner_id", sa.String(length=30), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("link", sa.String(length=500), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_by_email", sa.String(length=320), nullable=True),
        sa.Column("updated_by_email", sa.String(length=320), nullable=True),
        *_created_updated(),
        sa.ForeignKeyConstraint(["phase_id"], [f"{S}.phase.id"], ondelete="RESTRICT", name="fk_item_phase_id"),
        sa.ForeignKeyConstraint(["owner_id"], ["auth.user.id"], ondelete="SET NULL", name="fk_item_owner_id"),
        sa.CheckConstraint("area IN ('SALES','MERCHANTS','MARKETING','PLATFORM')", name="ck_item_area"),
        sa.CheckConstraint("status IN ('TODO','IN_PROGRESS','BLOCKED','DONE')", name="ck_item_status"),
        sa.CheckConstraint("priority IN ('HIGH','NORMAL','LOW')", name="ck_item_priority"),
        schema=S,
    )
    op.create_index("ix_roadmap_item_phase_id", "item", ["phase_id"], schema=S)
    op.create_index("ix_roadmap_item_owner_id", "item", ["owner_id"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_roadmap_item_owner_id", table_name="item", schema=S)
    op.drop_index("ix_roadmap_item_phase_id", table_name="item", schema=S)
    op.drop_table("item", schema=S)
    op.drop_table("phase", schema=S)
    op.execute(f"DROP SCHEMA IF EXISTS {qualified(S)}")
