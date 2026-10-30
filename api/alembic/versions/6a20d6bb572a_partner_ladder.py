"""Partner ladder: stages, came-from, owners, agents under an ISO, history

profiling.organization gains
  parent_id (agent -> its ISO), stage (+ stage_changed_at, iu_enrolled_at),
  came_from (+ came_from_detail), owner_id (+ assigned_at), next_step (+ next_step_due),
  needs_review, salesforce_account_id
profiling.organization_contact gains partner_contact_id (the business card it came from)
profiling.merchant gains salesforce_account_id
profiling.organization_event (new): the organization's history

Backfill: every existing organization starts at stage NEW (certified ones at CERTIFIED),
and gets a CREATED event dated with its creation.

New columns/table only; `alembic downgrade 52db630116b8` removes them again.

Revision ID: 6a20d6bb572a
Revises: 52db630116b8
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.schemas import qualified

revision: str = "6a20d6bb572a"
down_revision: Union[str, None] = "52db630116b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "profiling"


def upgrade() -> None:
    add = lambda col: op.add_column("organization", col, schema=S)  # noqa: E731
    add(sa.Column("parent_id", sa.String(length=30), nullable=True))
    add(sa.Column("stage", sa.String(length=30), server_default="NEW", nullable=False))
    add(sa.Column("stage_changed_at", sa.DateTime(timezone=True), nullable=True))
    add(sa.Column("iu_enrolled_at", sa.DateTime(timezone=True), nullable=True))
    add(sa.Column("came_from", sa.String(length=30), nullable=True))
    add(sa.Column("came_from_detail", sa.String(length=200), nullable=True))
    add(sa.Column("owner_id", sa.String(length=30), nullable=True))
    add(sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    add(sa.Column("next_step", sa.String(length=300), nullable=True))
    add(sa.Column("next_step_due", sa.Date(), nullable=True))
    add(sa.Column("needs_review", sa.Boolean(), server_default="false", nullable=False))
    add(sa.Column("salesforce_account_id", sa.String(length=18), nullable=True))
    op.create_foreign_key("organization_parent_id_fkey", "organization", "organization", ["parent_id"], ["id"],
                          source_schema=S, referent_schema=S, ondelete="SET NULL")
    op.create_foreign_key("organization_owner_id_fkey", "organization", "user", ["owner_id"], ["id"],
                          source_schema=S, referent_schema="auth", ondelete="SET NULL")
    for name, col in (("ix_organization_parent_id", "parent_id"), ("ix_organization_stage", "stage"),
                      ("ix_organization_owner_id", "owner_id"), ("ix_organization_came_from", "came_from")):
        op.create_index(name, "organization", [col], unique=False, schema=S)

    op.add_column("organization_contact", sa.Column("partner_contact_id", sa.String(length=60), nullable=True), schema=S)
    op.add_column("merchant", sa.Column("salesforce_account_id", sa.String(length=18), nullable=True), schema=S)

    op.create_table(
        "organization_event",
        sa.Column("id", sa.String(length=30), nullable=False),
        sa.Column("organization_id", sa.String(length=30), nullable=False),
        sa.Column("user_id", sa.String(length=30), nullable=True),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("from_value", sa.String(length=200), nullable=True),
        sa.Column("to_value", sa.String(length=200), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], [f"{S}.organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema=S,
    )
    op.create_index("ix_organization_event_org", "organization_event", ["organization_id"], unique=False, schema=S)

    p = qualified(S)
    op.execute(f"UPDATE {p}.organization SET stage = 'CERTIFIED', stage_changed_at = certified_at WHERE certified")
    op.execute(f"""
        INSERT INTO {p}.organization_event (id, organization_id, kind, body, created_at)
        SELECT 'ev' || substr(md5(id || 'created'), 1, 23), id, 'CREATED', NULL, created_at
        FROM {p}.organization
    """)


def downgrade() -> None:
    op.drop_index("ix_organization_event_org", table_name="organization_event", schema=S)
    op.drop_table("organization_event", schema=S)
    op.drop_column("merchant", "salesforce_account_id", schema=S)
    op.drop_column("organization_contact", "partner_contact_id", schema=S)
    for name in ("ix_organization_came_from", "ix_organization_owner_id", "ix_organization_stage", "ix_organization_parent_id"):
        op.drop_index(name, table_name="organization", schema=S)
    op.drop_constraint("organization_owner_id_fkey", "organization", schema=S, type_="foreignkey")
    op.drop_constraint("organization_parent_id_fkey", "organization", schema=S, type_="foreignkey")
    for col in ("salesforce_account_id", "needs_review", "next_step_due", "next_step", "assigned_at", "owner_id",
                "came_from_detail", "came_from", "iu_enrolled_at", "stage_changed_at", "stage", "parent_id"):
        op.drop_column("organization", col, schema=S)
