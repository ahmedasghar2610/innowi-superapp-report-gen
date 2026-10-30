"""auth: SALES_EXECUTIVE role + invitations

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-10-12

Adds the Sales Executive role (partner leads / sales only) and the
invitation table: an admin invites an e-mail with a role, the person sets
their own name and password from the link.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A new enum value must be committed before anything can use it.
    with op.get_context().autocommit_block():
        op.execute(f"""ALTER TYPE {qualified('auth')}."Role" ADD VALUE IF NOT EXISTS 'SALES_EXECUTIVE'""")

    op.create_table(
        "invitation",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("invited_by", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema="auth",
    )
    op.create_index("ix_auth_invitation_email", "invitation", ["email"], schema="auth")


def downgrade() -> None:
    op.drop_index("ix_auth_invitation_email", table_name="invitation", schema="auth")
    op.drop_table("invitation", schema="auth")
    # Postgres can't drop an enum value; SALES_EXECUTIVE stays in the type (unused).
