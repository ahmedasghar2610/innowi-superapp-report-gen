"""website: PRD WEB-06 status lifecycle

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-09-28

draft / in_review / live become the PRD's eight statuses (not_started,
in_creation, content_required, content_map_required, under_review, live,
update_required, inactive). The column widens to fit them; existing rows map
draft -> in_creation and in_review -> under_review. Only live and
update_required are public from now on.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, None] = "f5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("website", "status", type_=sa.String(length=32), existing_nullable=False, schema="marketing")
    op.execute(f"update {qualified('marketing')}.website set status = 'in_creation' where status = 'draft'")
    op.execute(f"update {qualified('marketing')}.website set status = 'under_review' where status = 'in_review'")
    op.alter_column("website", "status", server_default=None, existing_type=sa.String(length=32), schema="marketing")


def downgrade() -> None:
    op.execute(f"update {qualified('marketing')}.website set status = 'draft' where status in ('not_started','in_creation','content_required','content_map_required')")
    op.execute(f"update {qualified('marketing')}.website set status = 'in_review' where status = 'under_review'")
    op.execute(f"update {qualified('marketing')}.website set status = 'live' where status = 'update_required'")
    op.execute(f"update {qualified('marketing')}.website set status = 'draft' where status = 'inactive'")
    op.alter_column("website", "status", type_=sa.String(length=16), existing_nullable=False, schema="marketing")
