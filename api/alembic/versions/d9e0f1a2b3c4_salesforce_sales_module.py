"""salesforce: Sales module (read-only copy of Salesforce) + sales roles

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-10-13

Adds the `salesforce` schema (`<prefix>salesforce` on the shared database):
the tables the Salesforce sync copies into, its bookkeeping (sync_state,
sync_run) and user_link, which ties a SuperApp login to a Salesforce user.

Also adds SALES_MANAGER to auth."Role" (Sales Executive, the rep role, came
with c8d9e0f1a2b3). Postgres cannot remove a value from an enum, so the
downgrade leaves it in place (harmless: no code path assigns it once this
module is gone) and only drops the tables and the schema.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "salesforce"


def _sf_id(name: str, *, nullable: bool = True, primary_key: bool = False) -> sa.Column:
    return sa.Column(name, sa.String(length=18), nullable=False if primary_key else nullable, primary_key=primary_key)


def _ts(name: str, *, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _synced_at() -> sa.Column:
    return sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def upgrade() -> None:
    # ADD VALUE cannot run inside the migration's transaction on every Postgres
    # version, and a new value can't be used in the transaction that adds it.
    with op.get_context().autocommit_block():
        op.execute(f"""ALTER TYPE {qualified('auth')}."Role" ADD VALUE IF NOT EXISTS 'SALES_MANAGER'""")

    # On the shared Supabase DB the `superapp` role may not create schemas: the
    # owner creates this one once (sql/salesforce_schema.sql) and hands it to
    # superapp. CREATE SCHEMA IF NOT EXISTS still needs the privilege, so only
    # issue it when the schema is really missing (local / docker databases).
    exists = op.get_bind().execute(
        sa.text("SELECT 1 FROM pg_namespace WHERE nspname = :n"), {"n": qualified(S)}
    ).scalar()
    if not exists:
        op.execute(f"CREATE SCHEMA {qualified(S)}")

    op.create_table(
        "sf_user",
        _sf_id("id", primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("profile_name", sa.String(), nullable=True),
        sa.Column("role_name", sa.String(), nullable=True),
        sa.Column("user_type", sa.String(), nullable=True),
        _ts("last_login_at"),
        _ts("sf_system_modstamp"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_user_email", "sf_user", ["email"], schema=S)

    op.create_table(
        "account",
        _sf_id("id", primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("website", sa.String(), nullable=True),
        sa.Column("billing_street", sa.String(), nullable=True),
        sa.Column("billing_city", sa.String(), nullable=True),
        sa.Column("billing_state", sa.String(), nullable=True),
        sa.Column("billing_postal_code", sa.String(), nullable=True),
        _sf_id("owner_id"),
        _ts("sf_created_at"),
        _ts("sf_last_modified_at"),
        _ts("sf_system_modstamp"),
        _ts("contacts_fetched_at"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_account_owner_id", "account", ["owner_id"], schema=S)
    op.create_index("ix_sf_account_name", "account", ["name"], schema=S)

    op.create_table(
        "contact",
        _sf_id("id", primary_key=True),
        _sf_id("account_id"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("mobile_phone", sa.String(), nullable=True),
        _sf_id("owner_id"),
        _ts("sf_system_modstamp"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_contact_account_id", "contact", ["account_id"], schema=S)

    op.create_table(
        "opportunity_stage",
        sa.Column("label", sa.String(), primary_key=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_closed", sa.Boolean(), nullable=False),
        sa.Column("is_won", sa.Boolean(), nullable=False),
        sa.Column("default_probability", sa.Numeric(5, 2), nullable=True),
        _synced_at(),
        schema=S,
    )

    op.create_table(
        "opportunity",
        _sf_id("id", primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        _sf_id("account_id"),
        _sf_id("owner_id"),
        sa.Column("stage_name", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(16, 2), nullable=True),
        sa.Column("close_date", sa.Date(), nullable=True),
        sa.Column("probability", sa.Numeric(5, 2), nullable=True),
        sa.Column("is_closed", sa.Boolean(), nullable=False),
        sa.Column("is_won", sa.Boolean(), nullable=False),
        _sf_id("record_type_id"),
        sa.Column("record_type_name", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("lead_source", sa.String(), nullable=True),
        sa.Column("last_activity_date", sa.Date(), nullable=True),
        _ts("sf_created_at"),
        _ts("sf_last_modified_at"),
        _ts("sf_system_modstamp"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_opportunity_owner_id", "opportunity", ["owner_id"], schema=S)
    op.create_index("ix_sf_opportunity_account_id", "opportunity", ["account_id"], schema=S)
    op.create_index("ix_sf_opportunity_stage_name", "opportunity", ["stage_name"], schema=S)
    op.create_index("ix_sf_opportunity_last_modified", "opportunity", ["sf_last_modified_at"], schema=S)

    op.create_table(
        "case",
        _sf_id("id", primary_key=True),
        sa.Column("case_number", sa.String(), nullable=True),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("origin", sa.String(), nullable=True),
        sa.Column("priority", sa.String(), nullable=True),
        _sf_id("account_id"),
        _sf_id("contact_id"),
        _sf_id("owner_id"),
        sa.Column("is_closed", sa.Boolean(), nullable=False),
        _ts("sf_created_at"),
        _ts("sf_closed_at"),
        _ts("sf_system_modstamp"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_case_account_id", "case", ["account_id"], schema=S)
    op.create_index("ix_sf_case_owner_id", "case", ["owner_id"], schema=S)
    op.create_index("ix_sf_case_created", "case", ["sf_created_at"], schema=S)

    op.create_table(
        "visit",
        _sf_id("id", primary_key=True),
        sa.Column("name", sa.String(), nullable=True),
        _sf_id("account_id"),
        sa.Column("account_name", sa.String(), nullable=True),
        _sf_id("owner_id"),
        sa.Column("visit_type", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("sales_agent", sa.String(), nullable=True),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("due_date_start", sa.Date(), nullable=True),
        sa.Column("due_date_end", sa.Date(), nullable=True),
        sa.Column("appointment_time", sa.String(length=16), nullable=True),
        sa.Column("completed_date", sa.Date(), nullable=True),
        _ts("sf_created_at"),
        _ts("sf_system_modstamp"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_visit_owner_id", "visit", ["owner_id"], schema=S)
    op.create_index("ix_sf_visit_account_id", "visit", ["account_id"], schema=S)
    op.create_index("ix_sf_visit_due_start", "visit", ["due_date_start"], schema=S)

    op.create_table(
        "touchpoint",
        _sf_id("id", primary_key=True),
        sa.Column("name", sa.String(), nullable=True),
        _sf_id("account_id"),
        _sf_id("owner_id"),
        sa.Column("health_status", sa.String(), nullable=True),
        sa.Column("latest_status", sa.Text(), nullable=True),
        sa.Column("latest_touchpoint_date", sa.Date(), nullable=True),
        _ts("sf_system_modstamp"),
        _synced_at(),
        schema=S,
    )
    op.create_index("ix_sf_touchpoint_account_id", "touchpoint", ["account_id"], schema=S)

    op.create_table(
        "sync_state",
        sa.Column("object_name", sa.String(), primary_key=True),
        _ts("last_modstamp"),
        sa.Column("last_id", sa.String(), nullable=True),
        _ts("deleted_checked_at"),
        _ts("last_success_at"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("record_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )

    op.create_table(
        "sync_run",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("started_by", sa.String(length=30), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        _ts("finished_at"),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("api_calls", sa.Integer(), nullable=False),
        sa.Column("upserted", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Integer(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        schema=S,
    )
    op.create_index("ix_sf_sync_run_started_at", "sync_run", ["started_at"], schema=S)

    op.create_table(
        "user_link",
        sa.Column("user_id", sa.String(length=30), primary_key=True),
        sa.Column("sf_user_id", sa.String(length=18), nullable=False, unique=True),
        sa.Column("linked_by", sa.String(length=30), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["auth.user.id"], ondelete="CASCADE", name="fk_user_link_user_id"),
        schema=S,
    )


def downgrade() -> None:
    for table in ("user_link", "sync_run", "sync_state", "touchpoint", "visit", "case", "opportunity",
                  "opportunity_stage", "contact", "account", "sf_user"):
        op.drop_table(table, schema=S)
    op.execute(f"DROP SCHEMA IF EXISTS {qualified(S)}")
