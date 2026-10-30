"""ops: comment visibility + @mentions, ticket ↔ Library links, saved views

Revision ID: 65cddf0561bb
Revises: f8979d46e526
Create Date: 2026-10-06

- ops.ticket_comment.visibility (INTERNAL default / MERCHANT) and .mentions.
- NotificationKind gains MENTIONED.
- ops.ticket_library_link: Library pages linked to a ticket.
- ops.saved_view: named Tickets-list filters per person.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "65cddf0561bb"
down_revision: Union[str, None] = "f8979d46e526"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "ops"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f'ALTER TYPE {qualified(S)}."NotificationKind" ADD VALUE IF NOT EXISTS \'MENTIONED\'')

    postgresql.ENUM("INTERNAL", "MERCHANT", name="CommentVisibility", schema=S).create(op.get_bind(), checkfirst=True)
    op.add_column(
        "ticket_comment",
        sa.Column("visibility", postgresql.ENUM(name="CommentVisibility", schema=S, create_type=False), server_default="INTERNAL", nullable=False),
        schema=S,
    )
    op.add_column("ticket_comment", sa.Column("mentions", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False), schema=S)

    op.create_table(
        "ticket_library_link",
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("page_id", sa.String(length=30), sa.ForeignKey(f"{S}.library_page.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("added_by_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_ticket_library_link_page_id", "ticket_library_link", ["page_id"], schema=S)

    op.create_table(
        "saved_view",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("user_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("filters", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_ops_saved_view_user_id", "saved_view", ["user_id"], schema=S)


def downgrade() -> None:
    op.drop_table("saved_view", schema=S)
    op.drop_table("ticket_library_link", schema=S)
    op.drop_column("ticket_comment", "mentions", schema=S)
    op.drop_column("ticket_comment", "visibility", schema=S)
    op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."CommentVisibility"')
