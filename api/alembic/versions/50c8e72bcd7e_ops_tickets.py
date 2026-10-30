"""ops: tickets (Ops CRM phase 1)

Revision ID: 50c8e72bcd7e
Revises: b2c3d4e5f6a8
Create Date: 2026-10-05

Creates the `ops` schema with the Ops CRM ticket tables:

- ops.project          the folders every ticket belongs to (seeded below)
- ops.ticket           one piece of work, one assignee, optional merchant;
                       `number` from ops.ticket_number_seq → shown as OPS-1001…
- ops.ticket_subtask   checklist items
- ops.ticket_comment   comments
- ops.ticket_event     change history shown on the ticket page

Also adds auth.user.granted_capabilities (text[]), used to give individual
people capabilities their role doesn't have — today only "ticket.manage",
for the two people allowed to create tickets.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "50c8e72bcd7e"
down_revision: Union[str, None] = "b2c3d4e5f6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "ops"

ENUMS = {
    "TicketType": ("MARKETING", "DESIGN", "WEBSITE", "INTERNAL"),
    "TicketPriority": ("URGENT", "HIGH", "MEDIUM", "LOW"),
    "TicketStatus": ("NEW", "IN_PROGRESS", "AWAITING_MERCHANT", "IN_REVIEW", "DONE"),
    "TicketRequestType": ("NEW_REQUEST", "UPDATE", "QUERY", "ISSUE"),
    "TicketSource": ("MANUAL", "EMAIL", "MODULE", "MEETING"),
    "TicketEventKind": (
        "CREATED", "STATUS_CHANGED", "ASSIGNED", "PRIORITY_CHANGED", "DUE_DATE_CHANGED", "UPDATED",
        "SUBTASK_ADDED", "SUBTASK_COMPLETED", "SUBTASK_REOPENED", "SUBTASK_REMOVED",
    ),
}

DEFAULT_PROJECTS = ["Merchant requests", "Email & SMS", "SuperApp", "Website relaunch"]


def _enum(name: str) -> postgresql.ENUM:
    # create_type=False: the types are created explicitly in upgrade().
    return postgresql.ENUM(*ENUMS[name], name=name, schema=S, create_type=False)


def _ts(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)



def _ensure_schema(name: str) -> None:
    """Create an app schema only when it is really missing. On the shared
    Supabase database the restricted `superapp` role may not create schemas:
    the owner creates them once (sql/*_schema.sql) and hands them over, and
    CREATE SCHEMA IF NOT EXISTS would still need the privilege."""
    real = qualified(name)
    exists = op.get_bind().execute(sa.text("SELECT 1 FROM pg_namespace WHERE nspname = :n"), {"n": real}).scalar()
    if not exists:
        op.execute(f'CREATE SCHEMA "{real}"')

def upgrade() -> None:
    _ensure_schema(S)
    for name, values in ENUMS.items():
        postgresql.ENUM(*values, name=name, schema=S).create(op.get_bind(), checkfirst=True)
    op.execute(f"CREATE SEQUENCE IF NOT EXISTS {qualified(S)}.ticket_number_seq START WITH 1001")

    op.add_column(
        "user",
        sa.Column("granted_capabilities", postgresql.ARRAY(sa.String()), server_default=sa.text("'{}'"), nullable=False),
        schema="auth",
    )

    project = op.create_table(
        "project",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _ts("created_at"),
        schema=S,
    )

    op.create_table(
        "ticket",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column(
            "number", sa.Integer(), server_default=sa.text(f"nextval('{qualified(S)}.ticket_number_seq'::regclass)"),
            nullable=False, unique=True,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", _enum("TicketType"), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("sub_category", sa.String(length=80), nullable=True),
        sa.Column("request_type", _enum("TicketRequestType"), nullable=False),
        sa.Column("priority", _enum("TicketPriority"), nullable=False),
        sa.Column("status", _enum("TicketStatus"), nullable=False),
        sa.Column("source", _enum("TicketSource"), nullable=False),
        sa.Column("project_id", sa.String(length=30), sa.ForeignKey(f"{S}.project.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("merchant_id", sa.String(length=30), sa.ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignee_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        schema=S,
    )
    op.execute(f"ALTER SEQUENCE {qualified(S)}.ticket_number_seq OWNED BY {qualified(S)}.ticket.number")
    for col in ("status", "assignee_id", "merchant_id", "project_id", "type", "due_date"):
        op.create_index(f"ix_ops_ticket_{col}", "ticket", [col], schema=S)

    op.create_table(
        "ticket_subtask",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("done", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        _ts("created_at"),
        schema=S,
    )
    op.create_index("ix_ops_ticket_subtask_ticket_id", "ticket_subtask", ["ticket_id"], schema=S)

    op.create_table(
        "ticket_comment",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        _ts("created_at"),
        schema=S,
    )
    op.create_index("ix_ops_ticket_comment_ticket_id", "ticket_comment", ["ticket_id"], schema=S)

    op.create_table(
        "ticket_event",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("ticket_id", sa.String(length=30), sa.ForeignKey(f"{S}.ticket.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", _enum("TicketEventKind"), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        _ts("created_at"),
        schema=S,
    )
    op.create_index("ix_ops_ticket_event_ticket_id", "ticket_event", ["ticket_id"], schema=S)

    op.bulk_insert(
        project,
        [{"id": f"cproj{i:020d}", "name": name, "position": i} for i, name in enumerate(DEFAULT_PROJECTS)],
    )


def downgrade() -> None:
    op.drop_table("ticket_event", schema=S)
    op.drop_table("ticket_comment", schema=S)
    op.drop_table("ticket_subtask", schema=S)
    op.drop_table("ticket", schema=S)  # drops the OWNED BY sequence with it
    op.drop_table("project", schema=S)
    op.execute(f"DROP SEQUENCE IF EXISTS {qualified(S)}.ticket_number_seq")
    for name in ENUMS:
        postgresql.ENUM(name=name, schema=S).drop(op.get_bind(), checkfirst=True)
    op.drop_column("user", "granted_capabilities", schema="auth")
    # The schema itself is left in place (it may hold objects created outside
    # this migration); `DROP SCHEMA ops` by hand if it is really unwanted.
