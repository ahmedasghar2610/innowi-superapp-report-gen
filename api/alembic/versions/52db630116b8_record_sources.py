"""Record sources: where each merchant and organization came from

- profiling.merchant.source / source_detail       (+ ix_merchant_source)
- profiling.organization.source / source_detail   (+ ix_organization_source)

Backfill from what existing rows already carry:

merchant
  * created together with its churn record (same transaction)  -> CHURN_IMPORT,
    detail = the churn record's "<workbook> / <sheet>"
  * created together with a deal                               -> NEW_DEAL, detail = D-<number>
  * notes "Created from Google Business Profile ..."           -> GOOGLE_PROFILE
  * notes "Created from its SEO site / Google Ads account ..." -> SEO_ADS
  * notes "Created from website /<slug>"                       -> WEBSITE, detail = /<slug>
  * workbook Merchant ID "M-<digits>"                          -> MERCHANT_IMPORT
  * anything else stays NULL ("Not recorded")
organization
  * notes "... Imported <date> from '<file>'."                 -> SPREADSHEET, detail = file
  * partner_lead_id set                                        -> PARTNER_LEAD, detail = lead id
  * anything else                                              -> MANUAL (the New organization
    dialog was the only way to create one before this revision)

New columns only; `alembic downgrade b4d8f2a6c1e3` drops them again.

Revision ID: 52db630116b8
Revises: b4d8f2a6c1e3
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.schemas import qualified

revision: str = "52db630116b8"
down_revision: Union[str, None] = "b4d8f2a6c1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "profiling"


def upgrade() -> None:
    for table in ("merchant", "organization"):
        op.add_column(table, sa.Column("source", sa.String(length=30), nullable=True), schema=S)
        op.add_column(table, sa.Column("source_detail", sa.String(length=300), nullable=True), schema=S)
    op.create_index("ix_merchant_source", "merchant", ["source"], unique=False, schema=S)
    op.create_index("ix_organization_source", "organization", ["source"], unique=False, schema=S)

    p = qualified(S)
    # Order matters: the most specific evidence wins, and every step only fills empty rows.
    op.execute(f"""
        UPDATE {p}.merchant m SET source = 'CHURN_IMPORT', source_detail = left(c.source, 300)
        FROM {p}.merchant_churn c
        WHERE c.merchant_id = m.id AND m.source IS NULL
          AND c.source IS NOT NULL AND c.source <> 'manual'
          AND abs(extract(epoch FROM c.created_at - m.created_at)) < 120
    """)
    op.execute(f"""
        UPDATE {p}.merchant m SET source = 'NEW_DEAL', source_detail = 'D-' || d.number
        FROM {p}.deal d
        WHERE d.merchant_id = m.id AND m.source IS NULL
          AND abs(extract(epoch FROM d.created_at - m.created_at)) < 120
    """)
    op.execute(f"""
        UPDATE {p}.merchant SET source = 'GOOGLE_PROFILE'
        WHERE source IS NULL AND notes LIKE 'Created from Google Business Profile%'
    """)
    op.execute(f"""
        UPDATE {p}.merchant SET source = 'SEO_ADS'
        WHERE source IS NULL AND notes LIKE 'Created from its SEO site%'
    """)
    op.execute(f"""
        UPDATE {p}.merchant SET source = 'WEBSITE',
               source_detail = left(substring(notes FROM '^Created from website (/\\S+)'), 300)
        WHERE source IS NULL AND notes LIKE 'Created from website /%'
    """)
    op.execute(f"""
        UPDATE {p}.merchant SET source = 'MERCHANT_IMPORT'
        WHERE source IS NULL AND merchant_code ~ '^M-[0-9]+$'
    """)

    op.execute(f"""
        UPDATE {p}.organization SET source = 'SPREADSHEET',
               source_detail = left(substring(notes FROM 'Imported [0-9-]+ from ''(.+?)''\\.'), 300)
        WHERE source IS NULL AND notes ~ 'Imported [0-9-]+ from ''.+?''\\.'
    """)
    op.execute(f"""
        UPDATE {p}.organization SET source = 'PARTNER_LEAD', source_detail = partner_lead_id
        WHERE source IS NULL AND partner_lead_id IS NOT NULL
    """)
    op.execute(f"UPDATE {p}.organization SET source = 'MANUAL' WHERE source IS NULL")


def downgrade() -> None:
    op.drop_index("ix_organization_source", table_name="organization", schema=S)
    op.drop_index("ix_merchant_source", table_name="merchant", schema=S)
    for table in ("organization", "merchant"):
        op.drop_column(table, "source_detail", schema=S)
        op.drop_column(table, "source", schema=S)
