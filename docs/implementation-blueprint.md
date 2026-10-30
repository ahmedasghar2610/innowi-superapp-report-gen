# Merchant Report module · implementation blueprint

Date 2026-10-30. Builds on `docs/code-review-findings.md` (read-only review) and `docs/requirements-traceability.md`. Paths are relative to the repo root; `report_gen/` means `api/app/modules/report_gen/`. Where a name or behaviour is not verified in the code it is marked "assumption".

## 0. Where the repo stands today

### 0.1 Environment facts that shape the plan

- The working copy has no `.git` directory and no `git` binary on this machine, so the git status and branch could not be checked. `README.md:13` says the folder is a zip import. Python 3.12 is installed; `pytest`, `node`, `npm`, `docker` and `alembic` are not. **No test in this document has been run; every "tests pass" claim is for the future.**
- Stack: FastAPI 0.141.1 · SQLAlchemy 2.0.52 async · Alembic 1.17.1 · Postgres 16 on Supabase (`superapp_` schema prefix, `api/app/db/schemas.py`) · Next.js 15.5.20 · React 19 · TanStack Query 5 · Tailwind 4. Run, test and migrate: `api/README.md:20-99` (`uvicorn app.main:app --port 3000`, `pytest -q`, `alembic upgrade head`); `web`: `npm run dev` on 3001. Production migrations run automatically from `api/scripts/deploy.py:51` on every production deploy.
- Alembic chain has one head, `c9d4e2a7b1f3` (our migration), parent `6a20d6bb572a` (verified by scanning every revision file).

### 0.2 Phase 0 work that already exists (verified file by file)

| Area | Done | Gap |
|---|---|---|
| Models | `api/app/models/report_gen.py`: `report_gen_report`, `_snapshot`, `_audit`, `_send`, `_run`, `_file`, `_merchant_settings` in schema `marketing` | `_run`, `_file`, `_merchant_settings` have no code using them yet |
| Migration | `api/alembic/versions/c9d4e2a7b1f3_report_gen.py`, additive, with downgrade | written, not run anywhere |
| Module | `report_gen/{__init__,flag,whitelist,periods,service,sender,narrative,router}.py`, `assemble/{__init__,ads,seo,blogs,stub}.py` | no `gbp`, `reviews`, `website`, `ops`, `sales` adapters; no `jobs.py`; no `exports/`; sender is dry-run only |
| Lifecycle | `service.py`: generating → draft → edited → approved → sent, failed, deleted (soft); four-eyes rule; duplicate-send guard (`version_already_sent` + partial unique index `uq_report_gen_send_once`); `report_gen_audit` rows on every transition | no "generate all"; assembly runs inside the request |
| Routes | 9 endpoints under `/report-gen` (`router.py:4-12`), all behind `report_gen.view` + `flag.require_enabled` (404 when off); writes `@audited` | no settings, files, generate-all, sales upload routes |
| Whitelist | `whitelist.ALLOWED` per table/column, `BLOCKED_KEY_RE`, `scan()`, `assert_clean()` on generate and edit | no test proving another merchant's data cannot enter |
| Tests | `api/tests/test_report_gen_{service,whitelist,assemble}.py` + fixture `fixtures/report_gen/sample_month.json`; smoke count raised to 429 | not executed; acceptance test for pilot figures missing |
| Web | `web/src/features/report-gen/{api,types}.ts`, `components/{queue-page,review-page}.tsx`, pages `(app)/report-gen/page.tsx` and `[reportId]/page.tsx`; nav entry behind `NEXT_PUBLIC_REPORT_GEN_ENABLED` | `sectionNotes` is accepted by the API but not editable in the UI; no included/hidden section chips; no print preview; no "Generate all" |
| Shared files touched | `api/app/main.py:53,180`, `api/app/models/__init__.py:3`, `api/alembic/env.py:13`, `api/app/common/capabilities.py:123-129,212-214,221-222`, `api/app/config.py:328-333`, `api/tests/test_app_smoke.py:262-267,326,329`, `web/src/features/auth/capabilities.ts:98-103,174-176,187`, `web/src/config/nav.ts:141-144`, `api/app/modules/assistant/catalog.py:418-423` | the assistant catalogue edit was not in the review's list; keep it (the assistant refuses to call write routes it does not know) |

Phase 0 "done when" from the review (one click → draft with Ads/Search/Blogs and "not supplied" rows; Approve freezes; Edit creates `edited`; Delete soft-deletes; dry-run send) is implemented in code but **unverified**: nothing has been run.

### 0.3 Conventions the module follows (and must keep following)

- API: one package per module, `router.py` docstring lists every endpoint, `APIRouter(prefix, tags, dependencies=[require_capability])`, DTOs with `model_config = {"extra": "forbid"}`, camelCase responses, `@audited(entity_type, id_param, read, resolve_merchant_id)` on writes, `ReportError` → 409. Models: one file per schema, `id_column()` cuid ids, `_created()/_updated()`. Errors through `app/common/errors.py`.
- Jobs: no long-lived worker on Vercel; `jobs.run(work, wait=True)` inside `POST /jobs/{job}` with `jobs.time_up()` checks and `JOBS_TIME_BUDGET_S` = 600 s (`api/app/common/jobs.py`, `api/app/modules/jobs/router.py`, `api/sql/jobs_cron.sql`).
- Files only through the storage port (`api/app/common/storage/port.py`; Supabase bucket when `SUPABASE_URL` is set).
- Tests are DB-free and pure (`api/pytest.ini` asyncio auto); the smoke test pins the exact endpoint count (`test_app_smoke.py:329`).
- Web: feature slice in `src/features/<name>/` (`api.ts` hooks, `types.ts`, `components/`), thin route files, UI from `@/components/ui`, calls through `@/lib/api/client` (`api.postLong` for work that runs inside the request). Capabilities mirrored in `capabilities.ts`; nav in `config/nav.ts`.
- Config only in env vars (`api/app/config.py`), feature off by default (`REPORT_GEN_ENABLED=False`).

### 0.4 Sensitive data map (never into a merchant payload)

`profiling.merchant`: `account_health`, `next_action`, `open_blockers`, `notes`, `source`, `source_detail`, `salesforce_account_id`, `account_tier`, `region`, free-text `report_recipients`/`report_frequency` · `profiling.subscription.mrr`, `status`, dates · `profiling.merchant_churn*` · `profiling.contact.name/phone/preferred_channel/language/responsiveness` (email and role only, as addressing) · `payments.merchant_payment` (all) · `payments.opportunity` · `ops.ticket.description`, `ticket_comment`, `credential*`, `meeting*` transcripts · `audit.audit_log` · `marketing.ads_comment`, `gbp_note`, `gbp_review.reviewer_name/comment`, `seo_finding.note/owner_id/evidence`, `seo_site.owner_id/package/sync_error` · every `*_connection` token · `salesforce.*`, `quotes.*` (except QUO15 status in P2), `deals`, `organization*`, `partner_*`. Enforcement: `whitelist.ALLOWED` (read side) + `scan()` (payload side) + tests.

## 1. Cross-cutting design (applies to every phase)

### 1.1 Report status lifecycle

```
                 ┌────────── regenerate (new version) ──────────┐
                 ▼                                              │
(no row) ─generate─► generating ─ok─► draft ─edit─► edited ─approve─► approved ─send(live)─► sent
                        │                │            │                 │   │
                        └─error──► failed│            │                 │   └─send error──► failed ─retry send─► sent
                                         └──delete────┴──delete─────────┴──delete──► deleted (soft)
```

| From | To | Who / guard | Function |
|---|---|---|---|
| none, draft, edited, failed, deleted | generating → draft or failed | `report_gen.manage`; period must have ended | `service.generate()` (`check_generate`) |
| draft, edited | edited | `report_gen.manage`; snapshot not frozen | `service.edit()` (`check_edit`) |
| draft, edited | approved | `report_gen.approve`; generator of this version ≠ approver (Admin/Super Admin exempt) | `service.approve()` (`check_approve`) |
| approved, failed-after-approval | sent | `report_gen.approve`; version not sent before; recipients ⊆ merchant's own | `service.check_send()` + `record_send()` |
| draft, edited, approved, failed | deleted | `report_gen.manage`; row and `report_gen_audit` kept; `deleted_at`/`deleted_by_id` set | `service.soft_delete()` |
| sent | — | never deleted, never regenerated; a correction (P2, REP07) opens a new version | Phase 3 |

Prototype "Due" = no row for the month; "Held" = draft whose `missing` contains `sales_feed_not_connected` (surface it as a chip, not a status). "Ready for approval" = draft, "Needs changes" = edited. Nothing new to build here; keep the seven statuses.

### 1.2 Data model (final shape; the migration exists, Phase 2 adds one table)

| Table (`marketing` schema) | Key columns | Indexes / constraints | Phase |
|---|---|---|---|
| `report_gen_report` | `merchant_id` FK, `period_start`, `period_end`, `template` (monthly, sales_only, multi_month, partnership), `status`, `current_version`, `generated_by_id/at`, `approved_by_id/at`, `sent_at`, `deleted_by_id/at`, `error`, `data_through` JSONB, `missing` JSONB | unique (merchant, period, template); ix status; ix merchant | exists |
| `report_gen_snapshot` | `report_id` FK, `version`, `payload` JSONB, `frozen`, `created_by_id/at` | unique (report, version) | exists |
| `report_gen_audit` | `report_id`, `version`, `action` (generate, edit, approve, delete, send, send_failed; later: correction, settings), `user_id`, `at`, `note`, `detail` JSONB | ix report | exists |
| `report_gen_send` | `report_id`, `version`, `mode`, `status` (dry_run, sent, failed), `recipients` JSONB, `sent_by_id`, `at`, `error` | partial unique (report, version) where status = 'sent' | exists |
| `report_gen_run` | `trigger`, `status`, `period_start/end`, `started_at`, `finished_at`, `reports`, `failed`, `error`, `created_by_id` | — (add ix `status` in the Phase 1 migration for the "running" lookup) | exists |
| `report_gen_file` | `snapshot_id` FK, `kind` (pdf, docx), `storage_key`, `size_bytes`, `created_at` | unique (snapshot, kind) | exists |
| `report_gen_merchant_settings` | `merchant_id` PK, `recipients` JSONB, `cc` JSONB, `report_day`, `primary_ads_account_id`, `primary_seo_site_id`, `updated_by_id` | — ; Phase 2 adds `service_flags` JSONB (sales, ops on/off) | exists |
| `report_gen_sales_month` | `merchant_id` FK, `month` date, `channel` (pos_card, pos_cash, pos_gift, kiosk, online_pickup, online_delivery, qr), `location_id` nullable FK, `orders`, `gross`, `discounts`, `refunds`, `net`, `tips`, `tax`, `service_fee`, `delivery_fee`, `amount_collected`, `days_with_data`, `source_file`, `uploaded_by_id`, `uploaded_at` | unique (merchant, month, channel, location); ix (merchant, month) | Phase 2 |

Migration plan: `c9d4e2a7b1f3` is run once the feature branch is on the test database (`alembic upgrade head` through `scripts/deploy.py`; the flag stays off so nothing changes for users). Phase 1 adds `<rev>_report_gen_run_index.py` (index only). Phase 2 adds `<rev>_report_gen_sales.py` (new table + `service_flags` column). Every migration is additive with a downgrade; none touches another module's table.

### 1.3 Whitelist and the isolation test

The whitelist stays in `report_gen/whitelist.py`. Additions by phase: Phase 1 adds `marketing.seo_ga4_daily` reads (already allowed), `marketing.gbp_*` (allowed), `ops.ticket.completed_at` and `category`; Phase 2 adds `marketing.report_gen_sales_month` (own table); P2 of PRD A adds `quotes.quote_request.status/created_at/valid_until` for QUO15 only.

New test `api/tests/test_report_gen_isolation.py` (pure, no DB):

1. Build `Ctx` for merchant A and call `compose()` with sections produced by every `compute()` from two fixture merchants (A and B) deliberately mixed into the input lists; assert every `merchant_id`, account id, site id and location id inside the payload belongs to A (walk the payload with a helper that collects `*Id`/`id` keys) and that B's names never appear as strings.
2. Assert `whitelist.scan()` is empty on the composed payload and non-empty on the same payload with one injected key from each blocked group (`notes`, `accountHealth`, `mrr`, `contractAmount`, `reviewerName`, `comments`, `partnerPayout`, `phone`).
3. Assert `check_reads(mod.READS)` is empty for every adapter module (extend the existing loop to the new adapters).
4. Assert `check_recipients()` refuses an address that is not one of A's contacts (exists) and that `cc` from settings is only accepted when it is in `settings.cc` for the same merchant (Phase 2).

### 1.4 Approval rules

`report_gen.approve` = MANAGERS plus a per-person grant (`USER_GRANTABLE` in `capabilities.py:221`, `scripts/grant_capability.py`). The generator of the current version cannot approve it (`service.check_approve`, exempt ADMIN and SUPER_ADMIN for the pilot). Keep as is; the only open item is whether the Admin exemption stays after the pilot (one constant, `APPROVER_EXEMPT`).

### 1.5 Duplicate-send guard and idempotency

Two layers already exist: `service.version_already_sent()` before sending, and the partial unique index on `report_gen_send(report_id, version) where status='sent'`. Phase 1 adds the third: `record_send()` is called inside the same transaction as the Gmail call result, and the Gmail message id is stored in `report_gen_send.detail` (new JSONB column in the Phase 1 migration) so a retry after a timeout can check Gmail's own `messages.get` before resending (assumption: the SEO connection has `gmail.readonly`; if not, skip this and rely on the index).

### 1.6 Audit events

Every transition writes `report_gen_audit` (`service._audit`) **and** an `audit.audit_log` row through `@audited` on the route (`router.py` decorators). Actions: `generate` (detail: missing count or error), `edit` (detail: changed keys), `approve`, `delete` (note, detail.from), `send` (mode, recipients), `send_failed` (error). Phase 1 adds `file` (kind, storage key), Phase 2 adds `settings` (changed keys), `sales_upload` (month, rows), Phase 3 adds `correction`. The review page lists them from `GET /report-gen/reports/{id}` → `history`.

### 1.7 Background job design (generate-all, Phase 1)

- Entry: `POST /jobs/report-gen` (token-authenticated, like the other jobs) and `POST /report-gen/generate-all?month=` (staff, `report_gen.manage`), both calling `report_gen.jobs.tick()`.
- `tick(db, period)`:
  1. `SELECT pg_advisory_xact_lock(7244121)` (the Ads sync uses 7244120, `ads/sync.py:77`), then `running()` with `jobs.stale_after()`; if a run is active, return.
  2. Create `report_gen_run` (trigger `job` or `manual`, `created_by_id`).
  3. Load active merchants with no report row for the period, or whose row is `failed` from assembly; order by name; skip `approved`, `sent`, `draft`, `edited`.
  4. Loop one merchant per step: `service.generate(db, merchant_id, period, user_id=None)` → commit after each merchant → `run.reports += 1` or `run.failed += 1` (a failed assembly marks only that report `failed` with the error; the loop continues).
  5. Before each step check `jobs.time_up()`; if up, set `run.status = 'partial'`, `finished_at`, commit and return. The next tick (hourly cron row, see §3) resumes with the merchants still due. Budget 600 s; one merchant takes a few seconds (≈ 12 queries), so one tick covers well over a hundred merchants.
  6. End: `run.status = 'success'` or `'partial'` when any failed.
- "When due": a date rule in `jobs.due_today(settings)` — default the 3rd of the month (matches the SEO due day), overridden per merchant by `report_gen_merchant_settings.report_day` in Phase 2. Ads conversions may still move until mid-month; the draft records `data_through`, and a reviewer can regenerate.
- Partial failures: visible on the queue (status `failed`, error text); retry = regenerate.

### 1.8 Metric adapters (one per group)

Each adapter is `assemble/<group>.py` with `READS`, a pure `compute()` and an async `build(db, ctx)`; it returns `section()` with figures or `not_supplied(id, label, reason)`. Reason codes live in `REASONS` (`assemble/__init__.py`). Multiple accounts/sites per merchant are summed and named in `sources` (settings override `primary_*` in Phase 2).

| Group | File | Source | Query approach | Missing-source reasons |
|---|---|---|---|---|
| Ads | `assemble/ads.py` (exists) | `ads_account`, `ads_campaign`, `ads_daily_metric` through `ads.reports.campaign_totals` + `ads.calc` | two windows (month, prior month) summed per account | `ads_not_linked`, `no_data_in_period`, `ticket_not_set`, `budget_not_set` |
| Search | `assemble/seo.py` (exists) | `seo_site`, `seo_gsc_daily/query/page/split`, `seo_finding` via `seo.data.gsc_window`, `report_v2.branded_split/device_rows` | month sums, month tables | `seo_not_linked`, `gsc_not_connected`, `no_data_in_period`, `no_queries_stored` |
| Blogs | `assemble/blogs.py` (exists) | `seo_blog_post`, `seo_blog_gsc_daily` | month sum of final days; Phase 1 adds planned = `catalog.entitlement.qty_per_period` | `no_blog_posts`, `no_data_in_period`, `blog_plan_not_recorded` |
| Website | `assemble/website.py` (Phase 1) | `seo_ga4_daily` via `seo.data.ga4_window` for sites with `ga4_property` | WEB01 sessions, WEB02 users; WEB03–10 not supplied | `website_analytics_not_connected`, `source_split_not_tracked` (new), `sales_feed_not_connected` |
| Business Profile | `assemble/gbp.py` (Phase 1) | `gbp_location` (non-DEMO, linked), `gbp_daily_metric` via `gbp.reports.aggregate`, `profile.pct` | month vs prior month per location + total (MFR08) | `gbp_not_linked` (new), `gbp_pending_google`, `no_data_in_period` |
| Reviews | `assemble/reviews.py` (Phase 1) | `gbp_review` star, create_time, has_reply, reply_time; `gbp_location.rating_average/review_count` | counts and means per location + total | `reviews_module_not_connected`, `gbp_pending_google` |
| Ops | `assemble/ops.py` (Phase 1) | `ops.ticket` title, type, category, status, due_date, created_at, completed_at; `delivery_item.last_delivered` | OPS01 closed in month by type; OPS04 delivered in month; OPS05 due next month | `ops_not_assembled` → replaced by `no_data_in_period`; OPS02/03/06 keep `change_log_not_recorded` (new) |
| Sales | `assemble/sales.py` (Phase 2) | `report_gen_sales_month` | per channel rows → SAL01–14; per-location table when `location_id` present | `sales_feed_not_connected`, `sales_month_not_uploaded` (new) |
| Email & SMS, Rewards | `assemble/stub.py` until their modules exist (Phase 3) | — | — | `module_not_connected` |

Payload shape (unchanged): `{payloadVersion, template, merchant, period, previous, services, sectionOrder, sections{key: {included, metrics[], tables{}, missing[], caption, dataThrough, sources[]}}, headline[], summary[], sectionNotes{}, recommendations[], bottomLine, sources[], dataThrough{}, missing[], generatedAt, recipients[]}`. Phase 1 adds `yoy` fields on metrics and a `locations[]` table per section where MFR08 applies.

## 2. Phase 0 · Foundations (close-out, ≈ 3 days)

Goal: the code that exists is proven to run; shared-file diffs are frozen for the merge.

Files to create: none. Files to touch: none in the repo beyond fixes found by running the tests.

Tasks (each one commit):
1. Install the toolchain (Git for Windows, Node 20, Python venv with `api/requirements-dev.txt`); initialise the GitHub repo from this tree (one commit "import of innowi-superapp zip + report_gen Phase 0").
2. `pytest -q` in `api/`; fix anything red in `test_report_gen_*` and the smoke count. Record the number of tests in the PR.
3. Local Postgres via `api/docker-compose.yml`, `alembic upgrade head` (only locally), `alembic check` must be clean against `models/report_gen.py`.
4. `REPORT_GEN_ENABLED=true` locally, `NEXT_PUBLIC_REPORT_GEN_ENABLED=true`, load `scripts/seed_ads_demo.py` and `scripts/seed_seo_demo.py`, link one demo-free merchant by hand, and walk generate → edit → approve → delete → dry-run send on the queue page. Fix what breaks. (Demo rows are excluded by `source != "DEMO"`, so a real-looking row needs one account with source GOOGLE; assumption: the sanitized export of the four pilot merchants arrives, otherwise use a copy of `sample_month.json` through a fixture-backed `build_payload` in a test, not the UI.)
5. Data owner task (not code): link the 9 Ads accounts and 23 SEO sites on the test DB through Settings → Data setup / `POST /merchants/{id}/links`.

Tests: the three existing test files; the smoke test. Done when the walkthrough in task 4 works and `pytest -q` is green.

## 3. Phase 1 · One-click Ads + SEO report (roadmap weeks 2–3)

### 3.1 Files

New:
- `report_gen/assemble/website.py`, `gbp.py`, `reviews.py`, `ops.py` (adapters above).
- `report_gen/jobs.py` (§1.7), `report_gen/exports/__init__.py`, `report_gen/exports/pdf.py` (reportlab), `report_gen/exports/layout.py` (pure: turns the payload into ordered blocks shared by PDF and the print page, hides metric ids in merchant mode).
- `api/alembic/versions/<rev>_report_gen_phase1.py` (index on `report_gen_run.status`; `detail` JSONB on `report_gen_send`).
- `api/tests/test_report_gen_isolation.py`, `test_report_gen_adapters.py` (gbp, reviews, ops, website from fixtures), `test_report_gen_jobs.py` (pure: due rule, time-budget loop with a fake `time_up`), `test_report_gen_pdf.py` (renders the fixture payload, asserts bytes start with `%PDF` and the text layer has no blocked key and no metric id), `test_report_gen_acceptance.py` (PRD A §4 from fixtures), `fixtures/report_gen/{gaters,dla,mgh,pho_ha}.json` once the export exists.
- `web/src/app/report-gen-preview/[reportId]/page.tsx` + `web/src/features/report-gen/components/print-page.tsx` (pattern `features/seo/components/report-preview-page.tsx`: outside the shell, `window.print()` with `?print=1`, same middleware cookie check).
- `web/src/features/report-gen/components/section-chips.tsx` (included / hidden sections before approval), `generate-all-dialog.tsx`.

Shared files touched (one block each): `api/app/modules/jobs/router.py` (`JOBS += ("report-gen",)` and a `_report_gen()` branch, 6 lines), `api/sql/jobs_cron.sql` (one `cron.schedule('superapp-report-gen', '37 * * * *', …)` row), `api/tests/test_app_smoke.py` (+4 endpoints, count 433), `api/app/config.py` (`REPORT_GEN_DUE_DAY: int = 3`), `api/app/modules/assistant/catalog.py` (+1 line for generate-all).

### 3.2 API additions

| Method, path | Guard | Request | Response |
|---|---|---|---|
| `POST /report-gen/generate-all` | manage | `{month?: "YYYY-MM"}` | `{run: {id, status, reports, failed, startedAt, finishedAt}, due: n}`; runs inline within the time budget (`api.postLong` on the web) |
| `GET /report-gen/runs?limit=` | view | — | `[{id, trigger, status, period, reports, failed, error, startedAt, finishedAt}]` |
| `GET /report-gen/reports/{id}/files/{kind}` | view | `kind` = pdf | streamed file from the storage port; 404 until approved; `Content-Disposition: attachment; filename="<merchant>-<month>.pdf"` |
| `POST /report-gen/reports/{id}/files` | approve | `{kind: "pdf"}` | `{file: {kind, sizeBytes, createdAt}}`; renders from the frozen snapshot, stores through `storage.put(PutFileInput(scope="report_gen"))`, writes `report_gen_file`; idempotent per (snapshot, kind) |
| `POST /jobs/report-gen` | X-Sync-Token | — | `{job, ran, runId, detail}` (hidden from OpenAPI like the others) |

Changes to existing routes: `POST /reports/{id}/approve` also renders and stores the PDF (so "approved" always has a file; failure to render leaves the report approved and the error in `report_gen_audit`); `POST /reports/{id}/send` attaches the PDF when mode is sandbox or live.

### 3.3 PDF (server side), DOCX plan, e-mail

- PDF: reportlab 4.4.4 (already pinned). `exports/pdf.py` follows `quotes/pdf.py` (styles dict, `SimpleDocTemplate`, `Table`/`Paragraph`). Pages: cover (display name, period, location line, "Prepared by Innowi Inc."), executive summary (4 cards + takeaway), snapshot table (every included section's first three metrics with MoM), one block per included section (metrics grid, tables, caption, data-through), recommendations (action, why, owner, target), bottom line, sources footer with the labels note. Merchant mode hides metric ids and prints the catalogue definition under a metric when `showDefinitions` is on. Letter size, no images, no fonts beyond Helvetica (Vercel-safe).
- DOCX (Phase 2): `python-docx` is the only sane option (**new dependency**, flagged); `exports/docx.py` reuses `exports/layout.py` blocks. Touches `api/requirements.txt` and `api/pyproject.toml` together (drift test `test_deploy_config.py::test_pyproject_dependencies_match_requirements`). Alternative without a dependency: a minimal OOXML writer using `zipfile` (the repo already parses DOCX with the stdlib in `websites/docx_import.py`); roughly two days more and fragile in Word; only if the dependency is refused.
- E-mail: `sender.py` gains sandbox and live. Transport = Gmail API as the SEO-connected Google account, using the public seam `seo.connection.current()` + `seo.connection.access_token()` and `GMAIL_SEND_URL` (never the private `_gmail_send`). Message: HTML body (short cover note + headline cards), PDF attached (`EmailMessage.add_attachment`). Recipients: merchant OWNER + MARKETING contacts (and settings recipients in Phase 2) checked by `check_recipients`; CC from settings (Phase 2). Modes: `dry-run` records only; `sandbox` sends to `REPORT_GEN_SANDBOX_RECIPIENTS` with the subject prefixed `[SANDBOX]`; `live` sends to the merchant. `From` name `SEO_REPORT_FROM_NAME`; a `REPORT_GEN_FROM_NAME` setting is optional. Failures → `record_send(status="failed")`, report `failed`, retry allowed (`check_send`).

### 3.4 Frontend

- Queue page (`queue-page.tsx`): add "Generate all due" button (dialog shows the count, calls `POST /generate-all`, then polls `GET /runs`), a "Held" chip when `missing` has a sales reason, and a PDF icon when a file exists.
- Review page (`review-page.tsx`): section chips (included / hidden) above the document; `sectionNotes` editor (one textarea per included section, API already accepts it); "Preview as merchant" link to `/report-gen-preview/{id}`; "Download PDF" after approval; recipients line shows CC in Phase 2.
- Print page: reuse `Card`, `Table*`, `StatTile`, `Badge`, `Button` from `@/components/ui`; copy the `@page` CSS from `report-preview-page.tsx:39-43`.
- Merchant tab later (Phase 3): `web/src/app/(app)/merchants/[merchantId]/reports/page.tsx` as a thin wrapper, like `merchants/[merchantId]/ads/page.tsx`.

### 3.5 Tests and how to run

`cd api && pytest -q` (all pure). Coverage per phase: adapters from fixtures (`compute()` only), lifecycle (`service` checks), isolation (§1.3), jobs (due rule, budget loop), PDF (bytes + text scan), acceptance (fixtures of the four pilots; figures asserted with the tolerance 0 for Ads/SEO; a fixed "today" so `data_through` is deterministic). Smoke test: endpoint list + count. Web has no test runner; `npm run typecheck` and `npm run lint` are the gate.

Done when: a pilot merchant with linked Ads + SEO (and GBP when Google approves) produces a draft with Ads, Search, Blogs, Website (WEB01), Business Profile and Reviews sections or reason-coded "not supplied"; approve stores a PDF that does not change after a sync; sandbox e-mail arrives with the attachment; generate-all creates drafts for every due merchant within one tick.

### 3.6 Risks and dependencies

Google approval for GBP (data, not code); Ads conversions moving for 14 days after month end (`ADS_REFRESH_DAYS`, record `data_through`, regenerate before approval); Supabase Storage must be configured on the test API or PDFs vanish between requests (`README.md:98`); Gmail `gmail.send` scope on the SEO connection; the four pilot exports for acceptance.

## 4. Phase 2 · Sales and scheduling (roadmap weeks 3–4)

### 4.1 Files

New: `report_gen/sales_upload.py` (CSV preview → apply, pattern `merchant_profiling/payments_import.py`: header aliases, `money()`, month from the file name or a form field, merchant chosen on the upload page so no name matching is needed), `report_gen/assemble/sales.py`, `report_gen/settings.py` (merchant settings CRUD), `report_gen/exports/docx.py`, `api/alembic/versions/<rev>_report_gen_sales.py`, `api/tests/test_report_gen_sales.py`, `test_report_gen_settings.py`, `test_report_gen_docx.py`, `web/src/features/report-gen/components/{settings-panel,sales-upload-dialog}.tsx`, `api/app/modules/report_gen/templates/sales_upload_template.csv`.

Shared files touched: `api/requirements.txt` + `api/pyproject.toml` (`python-docx==1.1.2`, flagged new dependency), `api/tests/test_app_smoke.py` (+6 endpoints), `api/app/modules/assistant/catalog.py` (+3 write routes).

### 4.2 Sales upload

CSV columns (from the sample reports, until a real export is shared): `channel, orders, gross, discounts, refunds, net, tips, tax, service_fee, delivery_fee, amount_collected[, location, days_with_data]`; one row per channel (and location) per month. Flow: `POST /report-gen/merchants/{id}/sales/upload?dryRun=true` returns the parsed rows, warnings (unknown channel, totals that do not add up) and the derived SAL01–SAL13 figures; the same call without `dryRun` replaces that month's rows and writes `report_gen_audit` `sales_upload`. `assemble/sales.py` reads only `report_gen_sales_month` and produces SAL01–SAL14, the channel table (SAL06), payment mix (SAL08) and the per-location table (MFR08). The ordering-backend feed, when access exists, is a second writer into the same table (a sync job), so nothing downstream changes.

### 4.3 Settings, templates, scheduler

- `GET/PUT /report-gen/merchants/{id}/settings` (view / manage): `{recipients[], cc[], reportDay, primaryAdsAccountId, primarySeoSiteId, serviceFlags: {sales, ops}}`; `check_recipients` accepts contacts ∪ settings.recipients; CC must be in settings.cc; both audited.
- Templates (MFR12): `template` chosen at generate time, default from settings or package: `sales_only` when the merchant has only Sales/Ops, `multi_month` on request (three-month sales table from the last three uploads), else `monthly`. `compose()` filters `SECTION_ORDER` per template.
- Scheduler: `jobs.due_today()` uses `report_day` per merchant (default `REPORT_GEN_DUE_DAY`); the cron row from Phase 1 already ticks hourly.
- YoY (MFR03): adapters add the 12-months-earlier window when `yoy_available(first_data_date)`; first data date = `min(seo_gsc_daily.date)` / `min(ads_daily_metric.date)` per merchant (one query each).

### 4.4 API additions

| Method, path | Guard | Request → response |
|---|---|---|
| `POST /report-gen/merchants/{id}/sales/upload?dryRun=` | manage | multipart `file`, `month` → `{month, rows[], warnings[], figures{}}` |
| `GET /report-gen/merchants/{id}/sales?month=` | view | `{months: [{month, channels[], uploadedAt, uploadedBy}]}` |
| `DELETE /report-gen/merchants/{id}/sales/{month}` | manage | soft: rows kept with `deleted_at`? No: hard delete of upload rows is acceptable (they are re-uploadable); audited |
| `GET/PUT /report-gen/merchants/{id}/settings` | view / manage | shape above |
| `POST /report-gen/reports/{id}/files` with `{kind: "docx"}` | approve | as PDF |
| `GET /report-gen/reports/{id}/files/docx` | view | stream |

Tests: CSV parsing (aliases, money, totals), SAL maths from a fixture month, template section filtering, settings validation (e-mail format, report day 1–28), DOCX bytes are a zip with `word/document.xml` containing the display name and no blocked key.

Done when: a merchant with an upload prints the Sales section and headline cards; a sales-only merchant gets the sales-only template; DOCX downloads; a merchant with `report_day` = 5 is generated on the 5th by the job.

## 5. Phase 3 · Expand (after month 1, as modules ship)

- 3a Email & SMS, Rewards, non-Google Reviews, Website source split: one adapter file each, replacing the stub; read-only on the owning module's tables; whitelist rows added with the owner's sign-off. Each is ≤ 2 days once the tables exist.
- 3a Correction flow (REP07, P2): `POST /reports/{id}/correct` (approve) → `sent → draft` with `current_version + 1`, audit `correction`; the old version stays frozen and sent.
- 3a Highlights message (MFR11, P2): `narrative.highlight_message()` + `highlights` key in the payload, editable through the text patch, sent as a separate short e-mail.
- 3a Merchant tab `merchants/[merchantId]/reports`.
- 3b PRD B partnership report: `report_gen/partnership/` package with assemblers over `deals`, `quotes.*`, `payments.merchant_payment`, `profiling.subscription`, `ops.*`, our own `report_gen_*` tables and the PRD A adapters' `missing` lists (module health). Report row `template = "partnership"`, `merchant_id` null (requires making `merchant_id` nullable in a small migration, or a separate `report_gen_partnership_report` table; prefer the nullable column, one line). New capabilities `report_gen.partnership` (STAFF managers), `report_gen.finance` (grantable, no role), `report_gen.teamlead` (grantable) in `capabilities.py` + `.ts`; revenue sections are stripped from the response unless `user.can("report_gen.finance")`; OPS12/13 unless `report_gen.teamlead`. Page `web/src/app/(app)/report-gen/partnership/page.tsx`. Partner statements (PFR10, P2) as a per-organization slice with an isolation test; no partner login in this release. Daily alerts (PFR13) wait on the Issues owner.

## 6. Delivery plan

### 6.1 Task checklist (one commit each)

Phase 0 (3 days): toolchain + repo init · pytest green · alembic check clean · local walkthrough fixed · data-link owner briefed.

Phase 1 (10 working days):
1. `assemble/website.py` + fixture test
2. `assemble/gbp.py` + test (per-location table)
3. `assemble/reviews.py` + test
4. `assemble/ops.py` + whitelist rows (`completed_at`, `category`) + test
5. `blogs.py` planned posts from entitlements
6. `test_report_gen_isolation.py`
7. `exports/layout.py` + `exports/pdf.py` + `test_report_gen_pdf.py`
8. file routes + approve renders PDF + migration `<rev>_report_gen_phase1`
9. `sender.py` sandbox/live with attachment + tests with a fake `httpx` client (pattern `tests/test_ads_google.py`)
10. `jobs.py` + `test_report_gen_jobs.py`
11. shared: `jobs/router.py` entry + `jobs_cron.sql` row + smoke count + config due day
12. web: generate-all dialog + runs list
13. web: section chips + sectionNotes editor
14. web: print page + download buttons
15. acceptance fixtures + `test_report_gen_acceptance.py`

Phase 2 (8 working days):
1. migration `<rev>_report_gen_sales` (table + `service_flags`)
2. `sales_upload.py` parser + tests + CSV template
3. upload routes + web dialog
4. `assemble/sales.py` + tests; headline cards use it
5. templates (sales_only, multi_month) in `compose()` + tests
6. `settings.py` routes + web panel + recipients/CC in `check_recipients`
7. YoY windows in ads/seo/blogs + tests
8. scheduler `report_day` + job test
9. DOCX: dependency commit (requirements + pyproject together) then `exports/docx.py` + test + routes
10. smoke count, assistant catalogue, docs

### 6.2 Branching and commits (own repo)

- `main` = the import. One long-lived feature branch `feature/report-gen` cut from `main`; short task branches off it (`report-gen/p1-gbp-adapter`), squash-merged into `feature/report-gen` with a conventional message: `report-gen: <area>: <what>` (`report-gen: assemble: GBP adapter with per-location table`). Shared-file edits in their own commits, titled `report-gen(shared): …`, so the later merge reviewer sees them in isolation.
- Never commit `.env`; never commit a run migration's output; migrations are reviewed before `main` because production deploys run them (`scripts/deploy.py:51`).
- Tag `report-gen-phase1`, `report-gen-phase2` on `feature/report-gen`.

### 6.3 Merging into the company repo later

1. Fetch the company `main`; `git rebase` `feature/report-gen` onto it (the module is self-contained, so conflicts land only in shared files).
2. Shared files that will conflict and how to resolve: `api/app/main.py` (re-add the import and `include_router` line), `api/app/models/__init__.py` and `api/alembic/env.py` (append `report_gen` to the import tuple), `api/app/common/capabilities.py` and `web/src/features/auth/capabilities.ts` (re-add the three entries and the grantable name), `api/app/config.py` (the `REPORT_GEN_*` block), `api/tests/test_app_smoke.py` (re-append our endpoints and recompute the count), `web/src/config/nav.ts` (one entry), `api/app/modules/jobs/router.py` + `api/sql/jobs_cron.sql` (one entry, one row), `api/app/modules/assistant/catalog.py` (our lines), `api/requirements.txt` + `api/pyproject.toml` (python-docx, if accepted).
3. Alembic: set our migrations' `down_revision` to the company head at merge time (`alembic heads` must print one head); never merge two heads with a merge revision if a rebase can avoid it.
4. Run `pytest -q`, `alembic check`, `npm run typecheck`; open the PR with the flag off (`REPORT_GEN_ENABLED` unset) so the deploy changes nothing visible; turn it on per environment afterwards.

### 6.4 Timeline against the 4-week MVP

| Week | Delivered |
|---|---|
| 1 | Phase 0 close-out (3 days) + Phase 1 tasks 1–6 (adapters, isolation test) |
| 2 | Phase 1 tasks 7–11 (PDF, files, sender, job, shared edits) |
| 3 | Phase 1 tasks 12–15 (web, acceptance) + Phase 2 tasks 1–4 (sales upload and section) |
| 4 | Phase 2 tasks 5–8 (templates, settings, YoY, scheduler); sandbox e-mails to the team; go-live decision |

Included in the MVP: one-click report for every active merchant with Ads, Search, Blogs, Website visits, Business Profile and Reviews (the last two render when Google approves), reason-coded "not supplied" elsewhere, approval with frozen snapshot, server PDF, sandbox/live e-mail with attachment, generate-all by cron, sales from a monthly CSV, per-merchant recipients/CC/report day, Monthly and Sales-only templates.

**Not included** in the 4 weeks: DOCX (Phase 2 task 9, week 5, pending the dependency decision), the live sales feed (integration project, "blocked"), Email & SMS, Rewards and non-Google Reviews sections (other teams' modules), Meta Ads, WEB03–WEB10, the highlights message, corrections/reissue, YoY for merchants without 12 months of data (by rule), the Reports Hub dashboard/compare/customers/alerts pages, and all of PRD B. Dates count from the day the toolchain and GitHub access exist; a late pilot export moves the acceptance test, not the build.
