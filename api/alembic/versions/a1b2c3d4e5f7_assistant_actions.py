"""assistant: proposed actions waiting for the user's confirmation

Revision ID: a1b2c3d4e5f7
Revises: 92cec0816908
Create Date: 2026-10-19

In the existing `auth` schema, like the assistant's chats.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "92cec0816908"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "auth"


def upgrade() -> None:
    op.create_table(
        "assistant_action",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("user_id", sa.String(length=30), sa.ForeignKey(f"{S}.user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chat_id", sa.String(length=30), nullable=True),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("destructive", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("results", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        schema=S,
    )
    op.create_index("ix_assistant_action_user_created", "assistant_action", ["user_id", "created_at"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_assistant_action_user_created", table_name="assistant_action", schema=S)
    op.drop_table("assistant_action", schema=S)
