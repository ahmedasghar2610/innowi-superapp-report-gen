"""drop profiling.merchant.multi_location

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-16

`multi_location` (YesNo) and `location_count` (int) recorded the same fact:
a merchant with one location is not multi-location, and one with more is.
The enum carried no information the count doesn't, so it is removed and
`location_count` is now the single source of truth.

The shared `profiling."YesNo"` enum TYPE is deliberately left in place —
`merchant.alcohol_license` and `marketing.promotion.staff_briefed` still use
it, so dropping the type would break them.

Note on completeness: `multiLocation` was a scored (optional, weight 1) field
in the "Business & Service" group, so removing it changes the denominator for
every merchant. Re-run `python -m scripts.backfill_completeness` after
upgrading.

Downgrade restores the column but NOT its data — the values are gone.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("merchant", "multi_location", schema="profiling")


def downgrade() -> None:
    # create_type=False: the YesNo type was never dropped, so don't try to
    # create it again — that would fail with "type already exists".
    op.add_column(
        "merchant",
        sa.Column(
            "multi_location",
            postgresql.ENUM("YES", "NO", "PARTIAL", "UNKNOWN", name="YesNo", schema="profiling", create_type=False),
            nullable=True,
        ),
        schema="profiling",
    )
