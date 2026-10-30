# Innowi Super App API — FastAPI port

A 1:1 port of the NestJS 10 + Prisma 5 + PostgreSQL "Innowi Super App API" to
FastAPI + Pydantic v2 + SQLAlchemy 2.0 (async) + Alembic. Same endpoints, same
JWT/RBAC model, same audit logging, same profile-completeness scoring, same
8-schema Postgres layout — reimplemented from scratch, not generated.

It also absorbs the standalone `website-api` service (website intake
questionnaires) — see [WEBSITE_PORT.md](./WEBSITE_PORT.md).

## Stack

- FastAPI + Pydantic v2
- SQLAlchemy 2.0 (async, asyncpg) + Alembic migrations
- PyJWT (access tokens) + SHA-256-hashed opaque refresh tokens with rotation
- bcrypt (12 rounds) via `bcrypt`/`passlib`
- PostgreSQL 16, 8 schemas: `audit`, `auth`, `profiling`, `catalog`,
  `delivery`, `performance`, `marketing`, `payments`

## Quick start (local, no Docker)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

cp .env.example .env
# edit .env: point DATABASE_URL / DIRECT_URL at a real Postgres 16 instance,
# and set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET to real 32+ char secrets.

# Create the 8 schemas once (Alembic manages tables, not schemas):
psql "$DIRECT_URL" -f docker/init/01-init.sql

# Apply the schema:
alembic upgrade head

# Seed reference data (packages/services/entitlements) and the default admin:
python -m scripts.seed
python -m scripts.seed_admin

# Run the API:
uvicorn app.main:app --reload --port 3000
```

Swagger UI: http://localhost:3000/api/docs
OpenAPI JSON: http://localhost:3000/api/openapi.json
Liveness probe: http://localhost:3000/health
All routes are under the `/api/v1` prefix, apart from `/health` and the docs.

To also load the website intake records:

```bash
python -m scripts.seed_websites
```

Log in with the bootstrapped Super Admin (`SUPER_ADMIN_EMAIL` /
`SUPER_ADMIN_PASSWORD` in `.env`, defaults `superadmin@innowi.com` /
`ChangeMe123!`) via `POST /api/v1/auth/login`, then change the password
immediately via `POST /api/v1/auth/change-password`.

## Quick start (Docker Compose)

```bash
export JWT_ACCESS_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

This starts Postgres (with the 8 schemas pre-created), an optional PgBouncer
on :6432, and the API on :3000 — the API container runs `alembic upgrade
head`, seeds catalog + admin, then starts uvicorn.

## Scripts

All scripts are run as modules from the project root (so relative imports
resolve): `python -m scripts.<name> [args]`.

| Script | Port of | Purpose |
|---|---|---|
| `scripts/seed.py` | `prisma/seed.ts` | Seeds Packages, the 14-service catalog, and the Entitlement matrix. Idempotent. |
| `scripts/seed_admin.py` | `prisma/seed-admin.ts` | Bootstraps the default `SUPER_ADMIN` user. Idempotent — never overwrites an existing password. |
| `scripts/import_xlsx.py <path>` | `prisma/import-xlsx.ts` | Imports `Merchant_Profile_System.xlsx` (Merchants/Access/Baselines/Promotions/Scorecard/Opportunities/Delivery sheets), upserting merchants and all child rows. Idempotent (matches on Merchant ID/code). |
| `scripts/reimport_xlsx.py <path> [--purge-files]` | `prisma/reimport-xlsx.ts` | Deletes every merchant + account manager (Postgres cascades to all owned rows), then re-runs the importer and the completeness backfill. Auth users, catalog, and the audit log survive. `--purge-files` also deletes uploaded files from `STORAGE_DIR`. |
| `scripts/backfill_completeness.py [--dry-run]` | `prisma/backfill-completeness.ts` | Recomputes and persists `profile_completion_pct` for every merchant using the same calculator the API uses. |
| `scripts/seed_websites.py [--update\|--reset\|--from-sqlite PATH\|--dry-run]` | `website-api/seed.py` | Loads the website intake records from `scripts/data/websites_seed.json` (a snapshot of the standalone service's SQLite database), or from that database directly with `--from-sqlite`. Idempotent. |
| `scripts/seed_gbp_demo.py [--reset\|--remove]` | — | Loads 150 sample Google Business Profile listings (source DEMO) so Web & Search → GBP works before Google approves API access. The first real sync deletes them. |
| `scripts/gbp_sync.py [--quiet]` | — | Runs a Google Business Profile sync now (same as "Sync now"). Schedule it once a day; exits 1 when the run fails. See `../Doc/GBP_MODULE.md`. |
| `scripts/ads_sync.py [--quiet]` | n8n "Google Ads Reporting" | Runs a Google Ads sync now (same as "Refresh data" on the Ads page). The API also syncs daily by itself (`ADS_AUTO_SYNC`). Exits 1 when the run fails. See `../Doc/ADS_MODULE.md`. |
| `scripts/seed_ads_demo.py [--reset\|--remove]` | — | Loads 30 sample Google Ads accounts (source DEMO) so Modules → Ads works before Google Ads is connected. The first real sync deletes them. |
| `scripts/import_ads_accounts.py <xlsx>` | the n8n Google Sheet | Imports the old sheet's account list ("GBP Dashboard" tab): customer IDs, names, average-ticket inputs; links merchants with the exact same name. Idempotent. |

## Migrations

```bash
alembic upgrade head                 # apply
alembic revision --autogenerate -m "message"   # generate a new migration after model changes
alembic check                        # verify models match the DB (no-op if clean)
alembic downgrade -1                 # roll back one revision
```

## Tests

```bash
pytest -q
```

54 tests, all DB-independent (pure-function domain logic, capability matrix,
local-disk storage, website slug/summary/mapping logic, and an
app-import/OpenAPI/route-registration smoke test). They do not require a
running Postgres instance.

## Project layout

```
app/
  main.py                 FastAPI app factory, OpenAPI/Swagger setup
  config.py               pydantic-settings Settings (mirrors env.validation.ts)
  db/                     async engine/session, declarative Base
  common/
    security/             JWT + bcrypt password hashing
    deps.py                current-user + capability-gated dependencies
    capabilities.py        role -> capability matrix (RBAC source of truth)
    pagination.py           PageMeta / pagination dependency
    errors.py               uniform error envelope + exception handlers
    audit.py                 @audited(...) route decorator (audit logging)
    case.py                   camelCase <-> snake_case dict helper
    storage/                  FileStorage port + local-disk implementation
  models/                  SQLAlchemy 2.0 models, one module per Prisma schema
  schemas/                 Pydantic DTOs (1:1 with the original class-validator DTOs)
  modules/
    auth/                  users + login/refresh/logout/change-password
    audit/                 GET /audit-logs
    catalog/               packages / services / entitlements (read-only)
    merchant_profiling/    the large module: merchants, contacts, locations,
                            keywords, competitors, connections, services,
                            documents, brand assets, brand/catering profile,
                            account managers, subscription, data-quality,
                            plus domain/ (completeness calculator + alerts —
                            framework-free, directly unit tested)
    websites/              website intake questionnaires — merged in from the
                            standalone website-api service. Document-shaped
                            `values` column, slug-addressed public read,
                            capability-gated writes. See WEBSITE_PORT.md.
    delivery/marketing/payments/performance/  genuine stubs (README only,
                            matching the NestJS source's own empty stub modules)
alembic/                 migrations
scripts/                 seed / import / backfill (see table above)
tests/                   pytest suite
docker/init/01-init.sql  creates the 8 Postgres schemas
```

## Known differences from the NestJS original

- **IDs**: generated with a Python `cuid()`-shaped ID generator (same string
  shape/length as the npm `cuid` package — lowercase alphanumeric, `c` prefix)
  but not byte-for-byte identical output for the same inputs, since it's a
  from-scratch implementation, not a port of the npm package's exact PRNG/counter.
- **bcrypt rounds**: 12, matching the Node `bcrypt` library's default that the
  original uses.
- **Audit route decorator**: NestJS's `AuditInterceptor` is a framework-level
  interceptor around every controller method; FastAPI has no equivalent
  pipeline stage, so it's reproduced as an explicit `@audited(...)` decorator
  applied per-route. Behavior (before/after snapshot capture, diffing,
  write-on-success-and-failure, never blocking the request) is intended to be
  identical; the mechanism differs.
- **Prisma error mapping**: Postgres SQLSTATE 23505 (unique violation) and
  23503 (FK violation) are mapped to 409/400 in `app/common/errors.py` via
  SQLAlchemy's `IntegrityError`, mirroring Prisma's P2002/P2003 mapping in the
  original's `all-exceptions.filter.ts`.
