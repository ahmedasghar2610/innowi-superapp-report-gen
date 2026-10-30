"""requests: the team's feature asks, bugs and complaints, with upvotes, comments and triage

Revision ID: 196a5ecb5a59
Revises: 4e3c4c26cfd1
Create Date: 2026-10-24

* Tables ``request``, ``request_vote``, ``request_comment``, ``request_event`` in
  the existing ``roadmap`` schema (an approved request becomes a roadmap item),
  so no owner SQL is needed on the shared database.
* ``ops.notification`` gains ``link`` (where a notice that isn't about a ticket
  opens) and ``NotificationKind`` gains REQUEST_NEW / REQUEST_UPDATED, so
  requests show in the same bell.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "196a5ecb5a59"
down_revision: Union[str, None] = "4e3c4c26cfd1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "roadmap"
OPS = "ops"

TYPES = ("FEATURE", "IMPROVEMENT", "BUG", "COMPLAINT", "DATA", "PROCESS")
AREAS = ("SALES", "PARTNERS", "SUPPORT", "OPERATIONS", "MARKETING", "PAYMENTS", "REPORTING", "PLATFORM", "OTHER")
URGENCIES = ("LOW", "NORMAL", "HIGH", "BLOCKING")
STATUSES = ("NEW", "UNDER_REVIEW", "NEEDS_INFO", "APPROVED", "IN_PROGRESS", "SHIPPED", "DECLINED", "DUPLICATE")
EVENTS = ("CREATED", "EDITED", "STATUS", "ROADMAP")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN (" + ",".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    # ADD VALUE cannot run inside the migration's transaction on every Postgres.
    with op.get_context().autocommit_block():
        for value in ("REQUEST_NEW", "REQUEST_UPDATED"):
            op.execute(f"ALTER TYPE {qualified(OPS)}.\"NotificationKind\" ADD VALUE IF NOT EXISTS '{value}'")
    op.add_column("notification", sa.Column("link", sa.String(length=300), nullable=True), schema=OPS)

    op.execute(f"CREATE SEQUENCE IF NOT EXISTS {qualified(S)}.request_number_seq START 1001")
    op.create_table(
        "request",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False,
                  server_default=sa.text(f"nextval('{qualified(S)}.request_number_seq')")),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("area", sa.String(length=20), nullable=False),
        sa.Column("urgency", sa.String(length=10), server_default=sa.text("'NORMAL'"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.Column("why", sa.Text(), nullable=True),
        sa.Column("who_affected", sa.String(length=300), nullable=True),
        sa.Column("links", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'NEW'"), nullable=False),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("duplicate_of_id", sa.String(length=30), nullable=True),
        sa.Column("roadmap_item_id", sa.String(length=30), nullable=True),
        sa.Column("requester_id", sa.String(length=30), nullable=True),
        sa.Column("requester_email", sa.String(length=320), nullable=False),
        sa.Column("triaged_by_email", sa.String(length=320), nullable=True),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("number", name="uq_request_number"),
        sa.ForeignKeyConstraint(["duplicate_of_id"], [f"{S}.request.id"], ondelete="SET NULL",
                                name="fk_request_duplicate_of_id"),
        sa.ForeignKeyConstraint(["roadmap_item_id"], [f"{S}.item.id"], ondelete="SET NULL",
                                name="fk_request_roadmap_item_id"),
        sa.ForeignKeyConstraint(["requester_id"], ["auth.user.id"], ondelete="SET NULL",
                                name="fk_request_requester_id"),
        sa.CheckConstraint(_in("type", TYPES), name="ck_request_type"),
        sa.CheckConstraint(_in("area", AREAS), name="ck_request_area"),
        sa.CheckConstraint(_in("urgency", URGENCIES), name="ck_request_urgency"),
        sa.CheckConstraint(_in("status", STATUSES), name="ck_request_status"),
        schema=S,
    )
    op.execute(f"ALTER SEQUENCE {qualified(S)}.request_number_seq OWNED BY {qualified(S)}.request.number")
    op.create_index("ix_roadmap_request_status", "request", ["status"], schema=S)
    op.create_index("ix_roadmap_request_requester_id", "request", ["requester_id"], schema=S)

    op.create_table(
        "request_vote",
        sa.Column("request_id", sa.String(length=30), primary_key=True),
        sa.Column("user_id", sa.String(length=30), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], [f"{S}.request.id"], ondelete="CASCADE",
                                name="fk_request_vote_request_id"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.user.id"], ondelete="CASCADE", name="fk_request_vote_user_id"),
        schema=S,
    )

    op.create_table(
        "request_comment",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("request_id", sa.String(length=30), nullable=False),
        sa.Column("author_id", sa.String(length=30), nullable=True),
        sa.Column("author_email", sa.String(length=320), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], [f"{S}.request.id"], ondelete="CASCADE",
                                name="fk_request_comment_request_id"),
        sa.ForeignKeyConstraint(["author_id"], ["auth.user.id"], ondelete="SET NULL",
                                name="fk_request_comment_author_id"),
        schema=S,
    )
    op.create_index("ix_roadmap_request_comment_request_id", "request_comment", ["request_id"], schema=S)

    op.create_table(
        "request_event",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("request_id", sa.String(length=30), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], [f"{S}.request.id"], ondelete="CASCADE",
                                name="fk_request_event_request_id"),
        sa.CheckConstraint(_in("kind", EVENTS), name="ck_request_event_kind"),
        schema=S,
    )
    op.create_index("ix_roadmap_request_event_request_id", "request_event", ["request_id"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_roadmap_request_event_request_id", table_name="request_event", schema=S)
    op.drop_table("request_event", schema=S)
    op.drop_index("ix_roadmap_request_comment_request_id", table_name="request_comment", schema=S)
    op.drop_table("request_comment", schema=S)
    op.drop_table("request_vote", schema=S)
    op.drop_index("ix_roadmap_request_requester_id", table_name="request", schema=S)
    op.drop_index("ix_roadmap_request_status", table_name="request", schema=S)
    op.drop_table("request", schema=S)  # the OWNED BY sequence goes with it
    op.execute(f"DELETE FROM {qualified(OPS)}.notification WHERE kind IN ('REQUEST_NEW', 'REQUEST_UPDATED')")
    op.drop_column("notification", "link", schema=OPS)
    # Postgres can't drop enum values; REQUEST_NEW / REQUEST_UPDATED stay (unused).
