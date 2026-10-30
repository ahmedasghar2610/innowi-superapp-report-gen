"""profiling: merchant lifecycle status + churn record (win-back list)

Revision ID: 6b538c4b8e17
Revises: 9eeab288cdf0
Create Date: 2026-10-22

A churned restaurant stays a merchant (Shayan, 2026-10-22: "populate them in
merchants first and then make their status churned, and that's how they end
up in the churned list").

* ``merchant.status`` — PROSPECT / ONBOARDING / ACTIVE / PAUSED / CHURNED.
  Every existing merchant becomes ACTIVE.
* ``merchant.region``, ``innowi_solution``, ``account_tier`` — the territory,
  the Innowi product mix and the CSM tier, as the churn workbooks record them.
* ``merchant_churn`` — one per churned merchant: when, why, the CSM, MRR/GPV at
  churn, and the win-back status/owner/notes.
* ``merchant_churn_note`` — dated touches on a churned account.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.db.schemas import qualified

revision: str = "6b538c4b8e17"
down_revision: Union[str, None] = "9eeab288cdf0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "profiling"
MERCHANT_STATUS = ("PROSPECT", "ONBOARDING", "ACTIVE", "PAUSED", "CHURNED")
WINBACK_STATUS = ("NOT_STARTED", "CONTACTED", "IN_TALKS", "WON_BACK", "DECLINED", "CLOSED_PERMANENTLY")


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(*MERCHANT_STATUS, name="MerchantStatus", schema=S).create(bind, checkfirst=True)
    postgresql.ENUM(*WINBACK_STATUS, name="WinbackStatus", schema=S).create(bind, checkfirst=True)

    op.add_column(
        "merchant",
        sa.Column("status", postgresql.ENUM(name="MerchantStatus", schema=S, create_type=False),
                  server_default="ACTIVE", nullable=False),
        schema=S,
    )
    op.add_column("merchant", sa.Column("region", sa.String(), nullable=True), schema=S)
    op.add_column("merchant", sa.Column("innowi_solution", sa.String(), nullable=True), schema=S)
    op.add_column("merchant", sa.Column("account_tier", sa.Integer(), nullable=True), schema=S)
    op.create_index("ix_merchant_status", "merchant", ["status"], schema=S)

    op.create_table(
        "merchant_churn",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("merchant_id", sa.String(), sa.ForeignKey(f"{S}.merchant.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("churned_on", sa.Date(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("csm_name", sa.String(), nullable=True),
        sa.Column("mrr_at_churn", sa.Numeric(10, 2), nullable=True),
        sa.Column("gpv_at_churn", sa.Numeric(12, 2), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("last_touchpoint_on", sa.Date(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("winback_status", postgresql.ENUM(name="WinbackStatus", schema=S, create_type=False),
                  server_default="NOT_STARTED", nullable=False),
        sa.Column("winback_owner_id", sa.String(), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("winback_notes", sa.String(), nullable=True),
        sa.Column("next_follow_up_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_merchant_churn_churned_on", "merchant_churn", ["churned_on"], schema=S)
    op.create_index("ix_merchant_churn_winback_status", "merchant_churn", ["winback_status"], schema=S)
    op.create_index("ix_merchant_churn_winback_owner_id", "merchant_churn", ["winback_owner_id"], schema=S)

    op.create_table(
        "merchant_churn_note",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("churn_id", sa.String(), sa.ForeignKey(f"{S}.merchant_churn.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_merchant_churn_note_churn_id", "merchant_churn_note", ["churn_id"], schema=S)


def downgrade() -> None:
    op.drop_table("merchant_churn_note", schema=S)
    op.drop_table("merchant_churn", schema=S)
    op.drop_index("ix_merchant_status", table_name="merchant", schema=S)
    op.drop_column("merchant", "account_tier", schema=S)
    op.drop_column("merchant", "innowi_solution", schema=S)
    op.drop_column("merchant", "region", schema=S)
    op.drop_column("merchant", "status", schema=S)
    op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."WinbackStatus"')
    op.execute(f'DROP TYPE IF EXISTS {qualified(S)}."MerchantStatus"')
