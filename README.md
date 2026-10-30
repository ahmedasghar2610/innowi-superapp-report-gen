# Innowi Super App

One repository, three deployable apps:

| Folder | What it is | Stack | Hosted on (test) |
|---|---|---|---|
| `api/` | Super App API: auth, merchant profiling, websites, the per-site `/admin` editor | FastAPI · SQLAlchemy (async) · Alembic · Postgres | Vercel project `superapp-api-test` |
| `web/` | Super App UI for the Innowi team: merchants, websites, site builder | Next.js 15 · React 19 | Vercel project `superapp-web-test` |
| `site/` | Public restaurant site template, served at `/<slug>`, with `/<slug>/admin` | Next.js 14 | Vercel project `superapp-site-test` |

The database is the Supabase project **innowi-site-manager**. It is shared with other Innowi apps, so every Super App schema carries a `superapp_` prefix (see below).

Source origin: the developer's three repos (`innowi-superapp-api-fastapi`, `innowi-superapp-web`, `nextjs-site`), imported from `innowi-superapp 1.zip` (edits through 2026-09-28). The first commit is that import, unchanged apart from removed `.env` files and build output. Every later commit is a deployment change with its reasoning.

---

## How the pieces talk to each other

```
browser ──► web (Next.js) ──/api/v1/* proxy──► api (FastAPI) ──► Postgres (superapp_* schemas)
browser ──► site (Next.js) ───────────────────► api  /api/v1/websites/<slug> (public)
```

- **web → api:** the web app never calls the API from the browser. `web/src/app/api/v1/[...path]` reads the httpOnly auth cookie and forwards server-side to `API_ORIGIN`.
- **site → api:** the site reads `WEBSITE_API_URL`.

## Running locally (unchanged from the developer's setup)

- `api/`: `docker compose up` (Postgres + pgbouncer + api), or see `api/README.md`. Leave `DB_SCHEMA_PREFIX` empty to keep the plain schema names.
- `web/`: `npm install && npm run dev` (port 3001).
- `site/`: `npm install && npm run dev` (port 5050).

## Deployment (Vercel + Supabase)

Each Vercel project points at this repo with its **Root Directory** set to `api`, `web` or `site`.

### API (`api/`)

- **Build:** Vercel reads `pyproject.toml`. Its dependency list mirrors `requirements.txt`, which the Dockerfile uses; a test fails if the two drift.
- **Release step:** `python -m scripts.deploy`, wired in as the Vercel build script. It runs `alembic upgrade head` and then the idempotent seeds.
- **Region:** all three projects run their functions in `sfo1` (`vercel.json` → `regions`), next to the Supabase database in `us-west-1`. Vercel's default is `iad1` (Washington), which put every database round trip across the country; with a new connection per request (`DB_POOL_MODE=null`) that cost roughly 0.5–1 s per API call. Keep the API, web and site in the database's region.
  - On Vercel it touches the database **only for production deployments**. Preview builds never migrate the shared database.
  - A Super Admin is created only if `SUPER_ADMIN_EMAIL` and a real `SUPER_ADMIN_PASSWORD` (12+ characters) are set. There is no default password.
  - On Docker or Render, run the same command as the pre-deploy / release command.
- **Who can trigger a deploy:** Vercel only builds commits whose author is a member of the Vercel team. A push to `main` by anyone else shows up as **Blocked** and production keeps the previous build. Bring such work in through a pull request that a team member merges (the merge commit is theirs, so Vercel deploys everything on `main`), and check the newest production deployment is **Ready** on the expected commit after every merge.

**Shared-database settings:**

| Env var | Test value | Why |
|---|---|---|
| `DB_SCHEMA_PREFIX` | `superapp_` | Maps `profiling` → `superapp_profiling` etc. at runtime (`api/app/db/schemas.py`). Supabase reserves `auth`, and `marketing` is used by Uplit. |
| `ALEMBIC_VERSION_SCHEMA` | `superapp_meta` | Where Alembic keeps its version table. |
| `DB_POOL_MODE` | `null` | Serverless: no idle connection pool per function instance and no prepared-statement cache, so `DATABASE_URL` can be a *transaction-mode* pooler. Use `queue` on a long-running server. |

**Other API env vars:**
- **Set by you, kept secret:** `DATABASE_URL` (the Supabase **transaction pooler** URL for the `superapp` role, host `aws-1-us-west-1.pooler.supabase.com`, port **6543**, user `superapp.<project-ref>`), `DIRECT_URL` (the same host on the **session pooler**, port **5432** — Alembic needs a session; the direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from Vercel), `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (different values), and `SUPER_ADMIN_PASSWORD`. Session mode caps clients at the Supabase *pool size* per role (15 by default), which a handful of busy users exhaust (`EMAXCONNSESSION`); transaction mode does not.
- **Plain settings:** `NODE_ENV=production`, `ENABLE_HSTS=true` (production refuses to start without it), `CORS_ORIGINS` (https only), `SITE_TEMPLATE_URL`, `API_PUBLIC_URL`, `SUPER_ADMIN_EMAIL`, `STORAGE_DIR`.

### Web (`web/`)

- **Env:** `NEXT_PUBLIC_API_BASE_URL=/api/v1`, `API_ORIGIN=<api url>`, `NEXT_PUBLIC_SITE_TEMPLATE_URL=<site url>`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- **Fixes applied to deploy on Vercel:** Next 15.5.20 (15.5.4 is blocked by Vercel for CVE-2025-66478), ESLint ignores for the site-builder templates, and `maxDuration` 800.

### Site (`site/`)

- **Env:** `WEBSITE_API_URL=<api url>/api/v1`, `SITE_REVALIDATE`, `SITE_EDITOR_ENABLED`, `SITE_INTERNAL_URL`.

## Partner leads (from partners.innowi.com)

Sidebar → **Partner leads** (`/partners`) shows the applications submitted on partners.innowi.com — the same rows the partner portal's own dashboard uses (`public.partner_leads`, `partner_lead_notes`, `partner_lead_events`, `partner_team` in this Supabase project).

- API: `api/app/modules/partner_leads` — `GET /partner-leads` (search / status / owner / source filters), `/summary`, `/team`, `GET|PATCH /partner-leads/{id}`, `POST /partner-leads/{id}/notes`. Plain SQL, no ORM models, so Alembic never touches the partner portal's tables.
- Capabilities `partners.view` (Admin, Marketing Manager, Sales Executive) / `partners.edit` (Admin, Sales Executive). Status and owner changes are audited (`PartnerLead`) and also appear in the lead's own history (the portal's trigger records the Super App user via `app.actor`).
- Owners come from the portal's team list (`partner_team`, managed in partners.innowi.com/admin → Team).
- `/partners?lead=<id>` opens a lead directly.
- Assigning a lead here calls the portal's `partner-lead-assigned` function (owner e-mail + Teams card). Setting: `PARTNER_LEADS_NOTIFY_URL` ("" turns it off).

## Team members & Settings

- Admin → **Team members** (`/team-members`, capability `users.manage`): invite by e-mail + role, change roles, turn accounts off/on. Super Admin and your own account can't be edited here.
- **Invitations** (`api/app/modules/invitations`, table `auth.invitation`): `POST /invitations {email, role}` creates a one-time link (7 days; only its SHA-256 is stored) and asks the partner portal's Supabase function `superapp-invite-email` to e-mail it (setting `INVITE_EMAIL_URL`, "" turns e-mail off; link base `APP_WEB_URL`). The link is also returned once so the admin can copy it. `GET /invitations` (pending), `POST /invitations/{id}/resend` (new link, old one dies), `DELETE /invitations/{id}`. Public: `GET /auth/invitations/{token}` (preview) and `POST /auth/invitations/accept {token, password, firstName, lastName}` — the person sets their own password at `/invite?token=…`. One live invite per address; inviting an existing user is a 409. The e-mail function only sends a fresh, never-e-mailed invite whose token matches, so it can't be used to mail anyone else.

### Access levels (`api/app/common/capabilities.py`, mirrored in `web/src/features/auth/capabilities.ts`)

| Role | Marketing screens | Partner leads | Audit log | Team members |
|---|---|---|---|---|
| Admin (and Super Admin) | view + edit | view + edit | ✓ | ✓ |
| Marketing Manager | view + edit | view only | ✓ | – |
| Marketing Executive | view + edit | – | – | – |
| Sales Executive | – | view + edit | – | – |

The sidebar hides what a role can't use; a Sales Executive's Home goes straight to Partner leads. The API enforces the same rules (403).
- **Settings** (`/settings`, sidebar gear): change your own password. Uses `fetch` (not the axios client) so a wrong current password (401) shows as a form error instead of a sign-out; a successful change signs you out everywhere.
- **One-time DB setup:** run `api/sql/partner_leads_access.sql` in the Supabase SQL editor. Until then the page shows "Couldn't load partner leads".

## Known limits on Vercel (by design, for now)

- **Uploads:** they go to local disk (`STORAGE_DIR`), which Vercel wipes between requests. Next step: a Supabase Storage (S3) backend behind `app/common/storage/port.py`.
- **Clone / SEO / pSEO / studio:** these need a Chrome browser and files kept between steps. They're off until a browser worker is added (Browserless via `PLAYWRIGHT_WS_ENDPOINT`, or a small Render worker).

## Rules that keep a later move to Render or Docker cheap

1. Files only through the storage port.
2. Background jobs in Postgres (pg_cron / pgmq) or plain HTTP endpoints, not Vercel-only queues.
3. Migrations only through `scripts/deploy.py`.
4. Config only in env vars, and keep `api/Dockerfile` building.
5. The database stays on Supabase.
