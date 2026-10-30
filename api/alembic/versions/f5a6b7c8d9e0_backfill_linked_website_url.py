"""merchant: fill website_url for merchants already linked to a website

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-28

Linking used to set the merchant's website_url only when the site was live, so
merchants linked to a draft site showed "—" in the Merchants table and Profile.
A linked site now always sets it; this fills in the ones linked before that.
Data only — no schema change. Only empty URLs are touched.
"""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:  # the API's own setting (.env), same as the app uses when linking
        from app.config import get_settings

        base = get_settings().SITE_TEMPLATE_URL
    except Exception:  # noqa: BLE001
        base = os.getenv("SITE_TEMPLATE_URL") or "http://localhost:5050"
    base = base.rstrip("/")
    from app.db.schemas import qualified

    op.execute(
        sa.text(
            f"""
            update {qualified("profiling")}.merchant m
               set website_url = :base || '/' || w.slug,
                   website_platform = 'Innowi'
              from {qualified("marketing")}.website w
             where w.merchant_id = m.id
               and coalesce(trim(m.website_url), '') = ''
            """
        ).bindparams(base=base)
    )


def downgrade() -> None:
    pass  # data backfill; nothing to undo safely
