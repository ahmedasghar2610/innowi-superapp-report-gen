"""assistant: saved chats and usage for the home-screen AI assistant

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-10-18

Both tables live in the existing `auth` schema, so nothing has to be run by
the database owner first.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "auth"


def upgrade() -> None:
    op.create_table(
        "assistant_chat",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("user_id", sa.String(length=30), sa.ForeignKey(f"{S}.user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_assistant_chat_user_updated", "assistant_chat", ["user_id", "updated_at"], schema=S)

    op.create_table(
        "assistant_usage",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("user_id", sa.String(length=30), sa.ForeignKey(f"{S}.user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chat_id", sa.String(length=30), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=False),
        sa.Column("rounds", sa.Integer(), nullable=False),
        sa.Column("tool_calls", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_assistant_usage_user_created", "assistant_usage", ["user_id", "created_at"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_assistant_usage_user_created", table_name="assistant_usage", schema=S)
    op.drop_table("assistant_usage", schema=S)
    op.drop_index("ix_assistant_chat_user_updated", table_name="assistant_chat", schema=S)
    op.drop_table("assistant_chat", schema=S)
