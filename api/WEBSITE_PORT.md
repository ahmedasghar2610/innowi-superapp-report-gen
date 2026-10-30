# Website Intake — merged in from the standalone `website-api` service

Ported: 2026-09-16. Source: `website-api` (FastAPI + SQLite, no auth).

The standalone service stored the answers to the Super App's website
questionnaire (**Web & Search → Website**) in one SQLite table and served them
back to the Super App and to the public `nextjs-site` template. Everything it
did now lives in this API. Nothing was left behind.

---

## What moved where

| From `website-api` | To this repo |
|---|---|
| `app/models.py` (`Website`) | `app/models/website.py` — same columns, `marketing` Postgres schema |
| `app/schemas.py` | `app/schemas/website.py` — camelCase DTOs, `extra="forbid"` on inputs |
| `app/crud.py` | `app/modules/websites/service.py` — converted to `AsyncSession` |
| `app/routers/websites.py` | `app/modules/websites/router.py` — under `/api/v1`, capability-gated |
| — | `app/modules/websites/mappers.py` — new; snake_case row → camelCase DTO |
| `app/database.py` (`init_db`, column backfill) | dropped — Alembic owns the schema here |
| `app/config.py` (`cors_origins`) | `app/config.py` → `CORS_ORIGINS` + `cors_origins_list` |
| `app/main.py` (CORS, error shape, `/health`) | `app/main.py` — CORS and `/health` added; the error envelope this API already emitted is identical |
| `seed.py` | `scripts/seed_websites.py` + `scripts/data/websites_seed.json` |
| `tests/test_websites.py` | `tests/test_websites.py` (domain logic) + 4 route assertions in `tests/test_app_smoke.py` |
| `website_api.db` (3 records) | `scripts/data/websites_seed.json`, loaded by the seed |

## Endpoints

All five, at the same shape, now under the versioned prefix:

| Method | Path | Capability |
|---|---|---|
| `GET` | `/api/v1/websites` | `website.view` |
| `POST` | `/api/v1/websites` | `website.edit` |
| `GET` | `/api/v1/websites/{key}` | **public** — `key` is the id *or* the slug |
| `PATCH` | `/api/v1/websites/{key}` | `website.edit` |
| `DELETE` | `/api/v1/websites/{key}` | `website.delete` |
| `GET` | `/health` | public (liveness probe, also new) |

`GET /websites/{key}` is deliberately unauthenticated: it is what the public
site template calls to render `/<slug>`, and what it returns is by definition
the page the merchant is publishing. Every other operation is a staff action
and needs a bearer token.

## Decisions made during the port

**Schema.** `marketing`, alongside `Promotion` — "Web & Search → Website" is a
marketing service. No ninth Postgres schema, so `docker/init/01-init.sql` is
unchanged.

**Capabilities.** Three new entries in `app/common/capabilities.py`:
`website.view` and `website.edit` for all staff, `website.delete` for managers
and up (deleting a website takes a published URL offline). These are additions
to the NestJS-derived matrix, not part of it — that service had no auth at all,
so there was nothing to port. Reusing `profile.*` was the alternative; separate
capabilities mean website access can be granted or revoked without touching
merchant profiling.

**Ids.** Records keep the `web_<16 hex>` shape rather than moving to this
codebase's `cuid()`. Three records already exist, the Super App's frontend
holds their ids, and the site template resolves pages by slug — changing either
would orphan a published site.

**`status`.** Stays a `VARCHAR(16)` rather than becoming a native Postgres enum.
The intake workflow's states (`draft` / `in_review` / `live`) change more freely
than the profiling enums, and a VARCHAR avoids an `ALTER TYPE` for each new one.

**Pagination.** This API's `page` / `limit` / `order` convention replaces
`limit` / `offset`. Both are accepted: `offset` is still a query parameter (it
overrides `page` when supplied) and `meta` carries `offset` and `hasMore`
alongside `page`, `pageCount`, `hasNextPage` and `hasPreviousPage`. Clients
written against the standalone service keep working unchanged.

**Timestamps.** `created_at` / `updated_at` are generated Python-side
(`models/website.utcnow`), as the standalone service did, with `server_default`
kept for rows inserted outside the ORM. Postgres `now()` is the *transaction*
timestamp, so a DB-side default would give every row in the seed's single
transaction an identical `updated_at` — which is the column the list orders by.

**Audit.** Create / update / delete are wrapped in this codebase's `@audited`
decorator, so website writes now appear in `GET /api/v1/audit-logs` under
`entityType=Website`. The standalone service had no audit trail.

**Dropped.** `app/database.py`'s `init_db()` and its SQLite column-backfill
shim. Alembic owns the schema here, so `create_all()`-on-startup and the
`ALTER TABLE … ADD COLUMN slug` catch-up have nothing to do.

## Migration and seeding

```bash
alembic upgrade head              # creates marketing.website
python -m scripts.seed_websites   # loads the 3 records from the snapshot
```

The seed is idempotent — a slug that already exists is left alone.

| Flag | Effect |
|---|---|
| *(none)* | Add what's missing from `scripts/data/websites_seed.json` |
| `--update` | Also refresh records that already exist |
| `--reset` | Delete every website first, then load |
| `--from-sqlite [PATH]` | Read the old `website_api.db` directly instead of the snapshot, and refresh the snapshot from it (default path `../website-api/website_api.db`) |
| `--no-write-snapshot` | With `--from-sqlite`, don't rewrite the snapshot |
| `--dry-run` | Report what would change; write nothing |

Records keep their original ids, slugs and `status`; `name`, `tagline` and
`contactEmail` are re-derived from `values.business.*` on load, exactly as they
are on every write.

## Verification

- 54 tests pass (`pytest -q`) — was 30; 24 added.
- 86 endpoints published (80 reference + 5 websites + `/health`), asserted
  against the generated OpenAPI document.
- 55 runtime assertions run against the real app on a throwaway database
  covering the full CRUD round-trip, slug generation / collision / stability /
  reserved names, lookup by id and by slug, server-owned summary derivation,
  search, status filtering, both pagination styles, the `extra="forbid"` 400,
  the error envelope, the public-read / protected-write split, and the
  capability matrix per role.
- Seed verified end-to-end: first run, idempotent re-run, `--update`,
  `--dry-run`, and `--from-sqlite` against the live `website_api.db`.

**Not covered:** nothing was exercised against a live Postgres. Run
`alembic upgrade head` followed by `python -m scripts.seed_websites` against a
real database before shipping, and confirm `GET /api/v1/websites` returns the
three records.

## Follow-ups

- Point the Super App's `NEXT_PUBLIC_WEBSITES_API_BASE_URL` at this API
  (`http://localhost:3000/api/v1`) and retire the port-8000 service.
- Images in `values` are still `data:` URLs for anything uploaded through the
  form. Fine for a handful of logos; move to the existing `FileStorage` port
  (`app/common/storage/`) once merchants start attaching photo galleries — that
  infrastructure now exists in the same process, which it did not before.
- `website_api.db` can be deleted once the seed has run against production.
