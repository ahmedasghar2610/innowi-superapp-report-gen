"""profiling: the spine — organizations, deals, deal events; quote_link.deal_id

Revision ID: 4e3c4c26cfd1
Revises: b7d2e4f19c63
Create Date: 2026-10-23

* ``organization`` + ``organization_contact``: ISOs, agents, resellers and
  contractors (``kind``), with a non-expiring ``certified`` flag.
* ``deal`` (number from ``deal_number_seq``, shown as D-1001…) + ``deal_event``.
  Stages run from the sales steps into the onboarding steps ops tracks.
* ``quotes.quote_link.deal_id``: quotes hang off deals.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.db.schemas import qualified

revision: str = "4e3c4c26cfd1"
down_revision: Union[str, None] = "b7d2e4f19c63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "profiling"
Q = "quotes"
ORG_KIND = ("PARTNER_ISO", "PARTNER_AGENT", "PARTNER_RESELLER", "CONTRACTOR", "OTHER")
ORG_STATUS = ("PROSPECT", "ACTIVE", "INACTIVE")
STAGE = ("NEW", "DEMO_BOOKED", "DEMO_DONE", "QUOTE_SENT", "ORDER_FORM_SIGNED", "PROCESSOR_SETUP", "MENU",
         "READY_TO_DEPLOY", "DEPLOYED", "LIVE", "LOST")
DEPLOYED_BY = ("INNOWI", "CONTRACTOR")
HIRED_BY = ("INNOWI", "PARTNER")
EVENT_KIND = ("CREATED", "STAGE_CHANGED", "NOTE", "QUOTE_LINKED", "QUOTE_EXECUTED", "OWNER_CHANGED")


def _e(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(name=name, schema=S, create_type=False)


def _ts(name: str, nullable: bool = True, default: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable,
                     server_default=sa.text("now()") if default else None)


def upgrade() -> None:
    bind = op.get_bind()
    for values, name in ((ORG_KIND, "OrganizationKind"), (ORG_STATUS, "OrganizationStatus"), (STAGE, "DealStage"),
                         (DEPLOYED_BY, "DeployedBy"), (HIRED_BY, "HiredBy"), (EVENT_KIND, "DealEventKind")):
        postgresql.ENUM(*values, name=name, schema=S).create(bind, checkfirst=True)

    op.create_table(
        "organization",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", _e("OrganizationKind"), nullable=False),
        sa.Column("status", _e("OrganizationStatus"), server_default="PROSPECT", nullable=False),
        sa.Column("website", sa.String(length=500), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("email", sa.String(length=200), nullable=True),
        sa.Column("address", sa.String(length=300), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=40), nullable=True),
        sa.Column("zip", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("certified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _ts("certified_at"),
        sa.Column("partner_lead_id", sa.String(length=60), nullable=True),
        _ts("created_at", nullable=False, default=True),
        _ts("updated_at", nullable=False, default=True),
        schema=S,
    )
    op.create_index("ix_organization_name", "organization", ["name"], schema=S)
    op.create_index("ix_organization_kind", "organization", ["kind"], schema=S)

    op.create_table(
        "organization_contact",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("organization_id", sa.String(), sa.ForeignKey(f"{S}.organization.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=True),
        sa.Column("email", sa.String(length=200), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _ts("created_at", nullable=False, default=True),
        schema=S,
    )
    op.create_index("ix_organization_contact_org", "organization_contact", ["organization_id"], schema=S)

    op.execute(f"CREATE SEQUENCE IF NOT EXISTS {qualified(S)}.deal_number_seq START WITH 1001")
    op.create_table(
        "deal",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("number", sa.Integer(), server_default=sa.text(f"nextval('{qualified(S)}.deal_number_seq'::regclass)"),
                  nullable=False, unique=True),
        sa.Column("merchant_id", sa.String(), sa.ForeignKey(f"{S}.merchant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.String(), sa.ForeignKey(f"{S}.organization.id", ondelete="SET NULL"), nullable=True),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("stage", _e("DealStage"), server_default="NEW", nullable=False),
        _ts("stage_changed_at", nullable=False, default=True),
        sa.Column("source", sa.String(length=60), nullable=True),
        sa.Column("lost_reason", sa.String(length=500), nullable=True),
        sa.Column("amount_monthly", sa.Numeric(10, 2), nullable=True),
        sa.Column("amount_one_time", sa.Numeric(10, 2), nullable=True),
        _ts("demo_at"),
        sa.Column("deployment_date", sa.Date(), nullable=True),
        sa.Column("deployed_by", _e("DeployedBy"), nullable=True),
        sa.Column("contractor_organization_id", sa.String(), sa.ForeignKey(f"{S}.organization.id", ondelete="SET NULL"), nullable=True),
        sa.Column("hired_by", _e("HiredBy"), nullable=True),
        sa.Column("go_live_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        _ts("created_at", nullable=False, default=True),
        _ts("updated_at", nullable=False, default=True),
        schema=S,
    )
    op.execute(f"ALTER SEQUENCE {qualified(S)}.deal_number_seq OWNED BY {qualified(S)}.deal.number")
    for col in ("merchant_id", "organization_id", "owner_id", "stage"):
        op.create_index(f"ix_deal_{col}", "deal", [col], schema=S)

    op.create_table(
        "deal_event",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("deal_id", sa.String(), sa.ForeignKey(f"{S}.deal.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", _e("DealEventKind"), nullable=False),
        sa.Column("from_stage", _e("DealStage"), nullable=True),
        sa.Column("to_stage", _e("DealStage"), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        _ts("created_at", nullable=False, default=True),
        schema=S,
    )
    op.create_index("ix_deal_event_deal_id", "deal_event", ["deal_id"], schema=S)

    op.add_column("quote_link", sa.Column("deal_id", sa.String(length=30), nullable=True), schema=Q)
    op.create_index("ix_quote_link_deal_id", "quote_link", ["deal_id"], schema=Q)


def downgrade() -> None:
    op.drop_index("ix_quote_link_deal_id", table_name="quote_link", schema=Q)
    op.drop_column("quote_link", "deal_id", schema=Q)
    op.drop_table("deal_event", schema=S)
    op.drop_table("deal", schema=S)
    op.execute(f"DROP SEQUENCE IF EXISTS {qualified(S)}.deal_number_seq")
    op.drop_table("organization_contact", schema=S)
    op.drop_table("organization", schema=S)
    for name in ("DealEventKind", "HiredBy", "DeployedBy", "DealStage", "OrganizationStatus", "OrganizationKind"):
        op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."{name}"')
