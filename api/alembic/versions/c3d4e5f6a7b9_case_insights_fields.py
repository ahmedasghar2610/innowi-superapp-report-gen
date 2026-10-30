"""salesforce: copy the care team's case fields (issue category, team, resolution, caller type)

Revision ID: c3d4e5f6a7b9
Revises: e05921e69b74
Create Date: 2026-10-20

Adds the columns, then forgets the Case sync position so the next scheduled sync
re-reads every case (about 3,800, a few pages) and fills them. Nothing else is reset.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "c3d4e5f6a7b9"
down_revision: Union[str, None] = "e05921e69b74"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "salesforce"
COLUMNS = ("issue_category", "assigned_team", "resolution_type", "caller_type", "details")


def upgrade() -> None:
    for c in COLUMNS:
        op.add_column("case", sa.Column(c, sa.String(), nullable=True), schema=S)
    op.create_index("ix_sf_case_issue_category", "case", ["issue_category"], schema=S)
    op.add_column("sync_state", sa.Column("optional_missing", sa.Boolean(), server_default=sa.text("false"),
                                          nullable=False), schema=S)
    op.execute(f"update {qualified(S)}.sync_state set last_modstamp = null, last_id = null where object_name = 'Case'")


def downgrade() -> None:
    op.drop_column("sync_state", "optional_missing", schema=S)
    op.drop_index("ix_sf_case_issue_category", table_name="case", schema=S)
    for c in COLUMNS:
        op.drop_column("case", c, schema=S)
