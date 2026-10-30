"""ops: ticket SLA clock, Library pages, credentials vault

Revision ID: 7abc6abb07f7
Revises: 50c8e72bcd7e
Create Date: 2026-10-05

- ops.ticket gains the SLA clock: first_response_at, response_due_at,
  resolution_due_at, sla_paused_at, sla_paused_seconds. Existing tickets are
  backfilled from their created_at and priority (modules/ops/sla.py).
- ops.library_page + ops.library_page_version — the Library.
- ops.credential + ops.credential_access_log — the credentials vault
  (secrets Fernet-encrypted with CREDENTIAL_ENCRYPTION_KEY).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified
from sqlalchemy.dialects import postgresql

revision: str = "7abc6abb07f7"
down_revision: Union[str, None] = "50c8e72bcd7e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "ops"
ENUMS = {
    "LibrarySection": ("COMPANY", "PROCESS", "TEMPLATE", "MERCHANT"),
    "CredentialAction": ("CREATED", "UPDATED", "REVEALED", "DELETED"),
}


def _enum(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(*ENUMS[name], name=name, schema=S, create_type=False)


def _ts(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def _user_fk(name: str) -> sa.Column:
    return sa.Column(name, sa.String(length=30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)


def upgrade() -> None:
    # ---- SLA clock on tickets
    for col in ("first_response_at", "response_due_at", "resolution_due_at", "sla_paused_at"):
        op.add_column("ticket", sa.Column(col, sa.DateTime(timezone=True), nullable=True), schema=S)
    op.add_column(
        "ticket", sa.Column("sla_paused_seconds", sa.Integer(), server_default=sa.text("0"), nullable=False), schema=S
    )

    from app.models.enums import TicketPriority
    from app.modules.ops.sla import resolution_due, response_due

    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, created_at, priority, status FROM {qualified(S)}.ticket")).all()
    for tid, created_at, priority, status in rows:
        p = TicketPriority(priority)
        bind.execute(
            sa.text(
                f"UPDATE {qualified(S)}.ticket SET response_due_at = :r, resolution_due_at = :s, "
                "first_response_at = CASE WHEN status <> 'NEW' THEN updated_at ELSE NULL END, "
                "sla_paused_at = CASE WHEN status = 'AWAITING_MERCHANT' THEN updated_at ELSE NULL END "
                "WHERE id = :id"
            ),
            {"r": response_due(created_at, p), "s": resolution_due(created_at, p), "id": tid},
        )

    for name, values in ENUMS.items():
        postgresql.ENUM(*values, name=name, schema=S).create(bind, checkfirst=True)

    # ---- Library
    op.create_table(
        "library_page",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("section", _enum("LibrarySection"), nullable=False),
        sa.Column("parent_id", sa.String(length=30), sa.ForeignKey(f"{S}.library_page.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("merchant_id", sa.String(length=30), sa.ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=True),
        sa.Column("body", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _user_fk("owner_id"),
        _user_fk("updated_by_id"),
        _ts("created_at"),
        _ts("updated_at"),
        schema=S,
    )
    for col in ("section", "merchant_id", "parent_id"):
        op.create_index(f"ix_ops_library_page_{col}", "library_page", [col], schema=S)

    op.create_table(
        "library_page_version",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("page_id", sa.String(length=30), sa.ForeignKey(f"{S}.library_page.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        _user_fk("edited_by_id"),
        _ts("created_at"),
        schema=S,
    )
    op.create_index("ix_ops_library_page_version_page_id", "library_page_version", ["page_id"], schema=S)

    # ---- Credentials vault
    op.create_table(
        "credential",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("merchant_id", sa.String(length=30), sa.ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=True),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("username", sa.String(length=200), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        _user_fk("created_by_id"),
        _ts("created_at"),
        _ts("updated_at"),
        schema=S,
    )
    op.create_index("ix_ops_credential_merchant_id", "credential", ["merchant_id"], schema=S)

    op.create_table(
        "credential_access_log",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("credential_id", sa.String(length=30), sa.ForeignKey(f"{S}.credential.id", ondelete="SET NULL"), nullable=True),
        sa.Column("credential_label", sa.String(length=120), nullable=False),
        sa.Column("merchant_id", sa.String(length=30), nullable=True),
        _user_fk("user_id"),
        sa.Column("user_email", sa.String(length=255), nullable=True),
        sa.Column("action", _enum("CredentialAction"), nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        _ts("created_at"),
        schema=S,
    )
    op.create_index("ix_ops_credential_access_log_credential_id", "credential_access_log", ["credential_id"], schema=S)


def downgrade() -> None:
    op.drop_table("credential_access_log", schema=S)
    op.drop_table("credential", schema=S)
    op.drop_table("library_page_version", schema=S)
    op.drop_table("library_page", schema=S)
    for name in ENUMS:
        postgresql.ENUM(name=name, schema=S).drop(op.get_bind(), checkfirst=True)
    for col in ("sla_paused_seconds", "sla_paused_at", "resolution_due_at", "response_due_at", "first_response_at"):
        op.drop_column("ticket", col, schema=S)
