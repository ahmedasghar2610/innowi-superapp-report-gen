"""settings: personal preferences and workspace settings

Revision ID: 6c624d1fce80
Revises: 7abc6abb07f7
Create Date: 2026-10-05

- auth.user.preferences (JSONB, default {}): start page and notification
  choices, edited in Settings → Profile / Notifications.
- ops.app_setting (key → JSONB): workspace details and SLA targets, edited
  in Settings → Workspace / Ops CRM. No rows = built-in defaults.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "6c624d1fce80"
down_revision: Union[str, None] = "7abc6abb07f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("preferences", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        schema="auth",
    )
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(length=60), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("updated_by_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema="ops",
    )


def downgrade() -> None:
    op.drop_table("app_setting", schema="ops")
    op.drop_column("user", "preferences", schema="auth")
