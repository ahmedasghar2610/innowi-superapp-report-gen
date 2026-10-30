"""merge heads: churned accounts (main) + SEO GSC split / Blog Impact (feature/seo-blog-impact)

Both branches started from c3d4e5f6a7b9, so the database had two heads. This joins them; it
changes nothing by itself.

Revision ID: a8f3c1d27e90
Revises: 6b538c4b8e17, 7c41e9b2d5f8
Create Date: 2026-10-23
"""
from typing import Sequence, Union

revision: str = "a8f3c1d27e90"
down_revision: Union[str, Sequence[str], None] = ("6b538c4b8e17", "7c41e9b2d5f8")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
