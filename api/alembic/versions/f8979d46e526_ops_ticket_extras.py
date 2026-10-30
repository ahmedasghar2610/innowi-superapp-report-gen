"""ops: ticket attachments, watchers and in-app notifications (SLA alerts)

Revision ID: f8979d46e526
Revises: 65a5db0fcb37
Create Date: 2026-10-06

- ops.ticket_attachment: files on a ticket (bytes in file storage).
- ops.ticket_watcher: people following a ticket.
- ops.notification: the bell — assignments, comments/status on watched
  tickets, SLA at-risk / breached alerts (deduplicated per person).
- TicketEventKind gains ATTACHMENT_ADDED / ATTACHMENT_REMOVED.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "f8979d46e526"
down_revision: Union[str, None] = "65a5db0fcb37"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "ops"
KINDS = ("ASSIGNED", "STATUS_CHANGED", "COMMENTED", "SLA_AT_RISK", "SLA_BREACHED", "RESPONSE_OVERDUE")


def _user_fk(name: str, nullable: bool = True, ondelete: str = "SET NULL") -> sa.Column:
    return sa.Column(name, sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for value in ("ATTACHMENT_ADDED", "ATTACHMENT_REMOVED"):
            op.execute(f"ALTER TYPE {qualified(S)}.\"TicketEventKind\" ADD VALUE IF NOT EXISTS '{value}'")

    postgresql.ENUM(*KINDS, name="NotificationKind", schema=S).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "ticket_attachment",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        _user_fk("uploaded_by_id"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_ticket_attachment_ticket_id", "ticket_attachment", ["ticket_id"], schema=S)

    op.create_table(
        "ticket_watcher",
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="CASCADE"), primary_key=True),
        _user_fk("added_by_id"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_ticket_watcher_user_id", "ticket_watcher", ["user_id"], schema=S)

    op.create_table(
        "notification",
        sa.Column("id", sa.String(length=30), primary_key=True),
        _user_fk("user_id", nullable=False, ondelete="CASCADE"),
        sa.Column("kind", postgresql.ENUM(name="NotificationKind", schema=S, create_type=False), nullable=False),
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), nullable=True),
        _user_fk("actor_id"),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("body", sa.String(length=500), nullable=True),
        sa.Column("dedupe_key", sa.String(length=200), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_notification_user_unread", "notification", ["user_id", "read_at"], schema=S)
    op.create_index("uq_ops_notification_user_dedupe", "notification", ["user_id", "dedupe_key"], unique=True, schema=S)

    # Everyone who created a ticket follows it from now on (the app does this
    # for new tickets).
    op.execute(
        f"INSERT INTO {qualified(S)}.ticket_watcher (ticket_id, user_id, added_by_id) "
        f"SELECT id, created_by_id, created_by_id FROM {qualified(S)}.ticket WHERE created_by_id IS NOT NULL ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("notification", schema=S)
    op.drop_table("ticket_watcher", schema=S)
    op.drop_table("ticket_attachment", schema=S)
    op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."NotificationKind"')
    # Enum values added to TicketEventKind are left in place (Postgres can't drop them).
