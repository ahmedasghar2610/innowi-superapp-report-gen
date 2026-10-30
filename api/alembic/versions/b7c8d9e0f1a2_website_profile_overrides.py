"""website: business fields changed on the website only

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-09-28

A linked website no longer writes name / phone / email / address / hours
back to the merchant Profile. Changes made in the visual editor are kept on
the website in `profile_overrides` until that Profile field is next edited.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "website",
        sa.Column("profile_overrides", sa.JSON(), nullable=False, server_default="{}"),
        schema="marketing",
    )


def downgrade() -> None:
    op.drop_column("website", "profile_overrides", schema="marketing")
