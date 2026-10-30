"""Website intake questionnaires.

Ported from the standalone `website-api` FastAPI service. The HTTP surface is
unchanged apart from the `/api/v1` prefix and authentication; the storage moved
from a single-table SQLite file to the platform's `marketing` Postgres schema.
"""
