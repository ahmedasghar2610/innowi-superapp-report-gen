"""marketing: report_gen_* — one-click monthly merchant reports (modules/report_gen)

Revision ID: c9d4e2a7b1f3
Revises: 6a20d6bb572a
Create Date: 2026-10-30

Additive only: seven new tables in the marketing schema, no change to any
existing table. Downgrade drops them again. Written for Phase 0 of the Report
Generator; run only with approval (the feature stays behind REPORT_GEN_ENABLED).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c9d4e2a7b1f3"
down_revision: Union[str, None] = "6a20d6bb572a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "marketing"


def _user_fk(name: str) -> sa.Column:
    return sa.Column(name, sa.String(30), sa.ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()") if not nullable else None, nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "report_gen_report",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("merchant_id", sa.String(30), sa.ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("template", sa.String(16), server_default="monthly", nullable=False),
        sa.Column("status", sa.String(12), server_default="generating", nullable=False),
        sa.Column("current_version", sa.Integer(), server_default="0", nullable=False),
        _user_fk("generated_by_id"),
        _ts("generated_at", nullable=True),
        _user_fk("approved_by_id"),
        _ts("approved_at", nullable=True),
        _ts("sent_at", nullable=True),
        _user_fk("deleted_by_id"),
        _ts("deleted_at", nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("data_through", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("missing", postgresql.JSONB(), server_default="[]", nullable=False),
        _ts("created_at"),
        _ts("updated_at"),
        sa.UniqueConstraint("merchant_id", "period_start", "period_end", "template", name="uq_report_gen_report_merchant_period"),
        schema=S,
    )
    op.create_index("ix_report_gen_report_status", "report_gen_report", ["status"], schema=S)
    op.create_index("ix_report_gen_report_merchant_id", "report_gen_report", ["merchant_id"], schema=S)

    op.create_table(
        "report_gen_snapshot",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("report_id", sa.String(30), sa.ForeignKey(f"{S}.report_gen_report.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("frozen", sa.Boolean(), server_default="false", nullable=False),
        _user_fk("created_by_id"),
        _ts("created_at"),
        _ts("updated_at"),
        sa.UniqueConstraint("report_id", "version", name="uq_report_gen_snapshot_report_version"),
        schema=S,
    )

    op.create_table(
        "report_gen_audit",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("report_id", sa.String(30), sa.ForeignKey(f"{S}.report_gen_report.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        _user_fk("user_id"),
        _ts("at"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("detail", postgresql.JSONB(), server_default="{}", nullable=False),
        schema=S,
    )
    op.create_index("ix_report_gen_audit_report_id", "report_gen_audit", ["report_id"], schema=S)

    op.create_table(
        "report_gen_send",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("report_id", sa.String(30), sa.ForeignKey(f"{S}.report_gen_report.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(8), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("recipients", postgresql.JSONB(), server_default="[]", nullable=False),
        _user_fk("sent_by_id"),
        _ts("at"),
        sa.Column("error", sa.Text(), nullable=True),
        schema=S,
    )
    op.create_index("ix_report_gen_send_report_id", "report_gen_send", ["report_id"], schema=S)
    op.create_index(
        "uq_report_gen_send_once", "report_gen_send", ["report_id", "version"], unique=True, schema=S,
        postgresql_where=sa.text("status = 'sent'"),
    )

    op.create_table(
        "report_gen_run",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("trigger", sa.String(8), server_default="manual", nullable=False),
        sa.Column("status", sa.String(8), server_default="running", nullable=False),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        _ts("started_at"),
        _ts("finished_at", nullable=True),
        sa.Column("reports", sa.Integer(), server_default="0", nullable=False),
        sa.Column("failed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        _user_fk("created_by_id"),
        schema=S,
    )

    op.create_table(
        "report_gen_file",
        sa.Column("id", sa.String(30), primary_key=True),
        sa.Column("snapshot_id", sa.String(30), sa.ForeignKey(f"{S}.report_gen_snapshot.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("size_bytes", sa.Integer(), server_default="0", nullable=False),
        _ts("created_at"),
        sa.UniqueConstraint("snapshot_id", "kind", name="uq_report_gen_file_snapshot_kind"),
        schema=S,
    )

    op.create_table(
        "report_gen_merchant_settings",
        sa.Column("merchant_id", sa.String(30), sa.ForeignKey("profiling.merchant.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("recipients", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("cc", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("report_day", sa.Integer(), nullable=True),
        sa.Column("primary_ads_account_id", sa.String(30), sa.ForeignKey(f"{S}.ads_account.id", ondelete="SET NULL"), nullable=True),
        sa.Column("primary_seo_site_id", sa.String(30), sa.ForeignKey(f"{S}.seo_site.id", ondelete="SET NULL"), nullable=True),
        _user_fk("updated_by_id"),
        _ts("created_at"),
        _ts("updated_at"),
        schema=S,
    )


def downgrade() -> None:
    op.drop_table("report_gen_merchant_settings", schema=S)
    op.drop_table("report_gen_file", schema=S)
    op.drop_table("report_gen_run", schema=S)
    op.drop_index("uq_report_gen_send_once", table_name="report_gen_send", schema=S)
    op.drop_index("ix_report_gen_send_report_id", table_name="report_gen_send", schema=S)
    op.drop_table("report_gen_send", schema=S)
    op.drop_index("ix_report_gen_audit_report_id", table_name="report_gen_audit", schema=S)
    op.drop_table("report_gen_audit", schema=S)
    op.drop_table("report_gen_snapshot", schema=S)
    op.drop_index("ix_report_gen_report_merchant_id", table_name="report_gen_report", schema=S)
    op.drop_index("ix_report_gen_report_status", table_name="report_gen_report", schema=S)
    op.drop_table("report_gen_report", schema=S)
