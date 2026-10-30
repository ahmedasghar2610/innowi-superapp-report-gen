"""Postgres schema names, with an optional deployment prefix.

The models and migrations use the plain schema names from the original
Prisma design (``profiling``, ``marketing``, ``auth`` ...). When the API shares
a database with other apps - e.g. a Supabase project, where ``auth`` is
reserved and ``marketing`` may already exist - set ``DB_SCHEMA_PREFIX`` (for
example ``superapp_``) and every schema is renamed at runtime:

* ORM / Core statements and Alembic operations: through SQLAlchemy's
  ``schema_translate_map`` (see ``app/db/session.py`` and ``alembic/env.py``).
* Hand-written SQL strings: use :func:`qualified` to build the schema name.

With no prefix configured this module is a no-op.
"""
from __future__ import annotations

from typing import Optional

from app.config import get_settings

# Every schema the app owns (mirrors alembic/env.py SCHEMAS).
APP_SCHEMAS = ("audit", "auth", "profiling", "catalog", "delivery", "performance", "marketing", "payments", "salesforce", "quotes", "roadmap", "ops")


def schema_prefix() -> str:
    return get_settings().DB_SCHEMA_PREFIX or ""


def qualified(schema: str) -> str:
    """The real (possibly prefixed) name of one of the app's schemas."""
    if schema not in APP_SCHEMAS:
        raise ValueError(f"unknown app schema: {schema!r}")
    return f"{schema_prefix()}{schema}"


def schema_translate_map() -> Optional[dict[str, str]]:
    """``{"profiling": "<prefix>profiling", ...}`` or ``None`` when unprefixed."""
    prefix = schema_prefix()
    if not prefix:
        return None
    return {name: f"{prefix}{name}" for name in APP_SCHEMAS}
