"""ops: meetings and action items from Fathom

Revision ID: 3a7313586c89
Revises: 6c624d1fce80
Create Date: 2026-10-05

- ops.meeting: one recorded call (Fathom recording_id unique), summary,
  transcript and attendees as JSON, matched merchant.
- ops.meeting_action_item: action items Fathom heard; each becomes a ticket
  or is dismissed.
- ops.ticket.meeting_id: the meeting a ticket was made from.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "3a7313586c89"
down_revision: Union[str, None] = "6c624d1fce80"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "ops"


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM("FATHOM", "DEMO", name="MeetingSource", schema=S).create(bind, checkfirst=True)
    postgresql.ENUM("OPEN", "TICKET", "DISMISSED", name="ActionItemStatus", schema=S).create(bind, checkfirst=True)

    op.create_table(
        "meeting",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("fathom_recording_id", sa.BigInteger(), nullable=True, unique=True),
        sa.Column("source", postgresql.ENUM(name="MeetingSource", schema=S, create_type=False), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        _ts("started_at"),
        _ts("ended_at"),
        _ts("scheduled_start_at"),
        _ts("scheduled_end_at"),
        sa.Column("fathom_url", sa.String(length=500), nullable=True),
        sa.Column("share_url", sa.String(length=500), nullable=True),
        sa.Column("call_url", sa.String(length=500), nullable=True),
        sa.Column("recorded_by_name", sa.String(length=200), nullable=True),
        sa.Column("recorded_by_email", sa.String(length=255), nullable=True),
        sa.Column("merchant_id", sa.String(length=30), sa.ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("merchant_match", sa.String(length=10), nullable=True),
        sa.Column("project_id", sa.String(length=30), sa.ForeignKey(f"{S}.project.id", ondelete="SET NULL"), nullable=True),
        sa.Column("attendees", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("transcript", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("language", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_meeting_merchant_id", "meeting", ["merchant_id"], schema=S)
    op.create_index("ix_ops_meeting_started_at", "meeting", ["started_at"], schema=S)

    op.create_table(
        "meeting_action_item",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("meeting_id", sa.String(length=30), sa.ForeignKey(f"{S}.meeting.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("assignee_name", sa.String(length=200), nullable=True),
        sa.Column("assignee_email", sa.String(length=255), nullable=True),
        sa.Column("assignee_user_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("recording_timestamp", sa.String(length=20), nullable=True),
        sa.Column("playback_url", sa.String(length=500), nullable=True),
        sa.Column("status", postgresql.ENUM(name="ActionItemStatus", schema=S, create_type=False), server_default="OPEN", nullable=False),
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decided_by_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        _ts("decided_at"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_meeting_action_item_meeting_id", "meeting_action_item", ["meeting_id"], schema=S)

    op.add_column(
        "ticket",
        sa.Column("meeting_id", sa.String(length=30), sa.ForeignKey(f"{S}.meeting.id", ondelete="SET NULL"), nullable=True),
        schema=S,
    )


def downgrade() -> None:
    op.drop_column("ticket", "meeting_id", schema=S)
    op.drop_table("meeting_action_item", schema=S)
    op.drop_table("meeting", schema=S)
    op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."ActionItemStatus"')
    op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."MeetingSource"')
