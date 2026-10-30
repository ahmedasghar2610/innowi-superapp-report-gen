"""payments: merchant_payment — monthly billing per merchant from the revenue report

Revision ID: b7d2e4f19c63
Revises: a8f3c1d27e90
Create Date: 2026-10-23

One row per merchant per month (contract, charged, variance, online-order revenue,
commission charge, notes), imported from the paid-marketing "Revenue Sheet <month>".
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7d2e4f19c63"
down_revision: Union[str, None] = "a8f3c1d27e90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "payments"


def upgrade() -> None:
    op.create_table(
        "merchant_payment",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("merchant_id", sa.String(), sa.ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("account_name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("package_type", sa.String(), nullable=True),
        sa.Column("contract_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("charged_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("variance", sa.Numeric(10, 2), nullable=True),
        sa.Column("orders_revenue", sa.Numeric(12, 2), nullable=True),
        sa.Column("commission_charge", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("source_file", sa.String(), nullable=True),
        sa.Column("source_sheet", sa.String(), nullable=True),
        sa.Column("imported_by", sa.String(), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("merchant_id", "month", name="uq_merchant_payment_merchant_month"),
        schema=S,
    )
    op.create_index("ix_merchant_payment_month", "merchant_payment", ["month"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_merchant_payment_month", table_name="merchant_payment", schema=S)
    op.drop_table("merchant_payment", schema=S)
