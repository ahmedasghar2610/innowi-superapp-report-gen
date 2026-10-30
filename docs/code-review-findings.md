# Report module · code review findings

Read-only review, 2026-10-30. Inputs: `PRD_A_Merchant_Facing_Reports.pdf`, `PRD_B_Partnership_Facing_Reports.pdf`, `Innowi_Reports_Prototype (1).html` (v1.1), `Super_App_Automated_Monthly_Reports_Roadmap_Final (1).docx` (Oct 29), `Progress_Update (1).docx` (Oct 30). Paths below are relative to the repo root. No code was changed. The repo is a plain export (no `.git`); `docs/` did not exist and was created for this file only.

Labels: **live** = table and a month-capable function exist · **new query** = data stored, a new read is needed · **no source** = nothing in the database.

## 1. PRD summary (10 lines)

1. PRD A is the merchant's monthly document: 120 metrics in 11 segments (70 P1, 50 P2), PDF + DOCX, approval before send, approved version stored as an immutable snapshot (MFR10).
2. Fixed section order (MFR02): cover · executive summary (4 headline cards + takeaway) · snapshot table · sales · search · blogs · website · Business Profile · ads · email & SMS · rewards · reviews · what we did / next month · recommendations (owner + target) · bottom line · sources footer.
3. Sections appear only for services in the merchant's package (MFR01, DQ07); a taken service with missing data prints "not supplied" + reason, never zero (MFR04).
4. Every figure shows month-on-month change; year-on-year only with 12 months of history (MFR03). Attributed figures are labelled "tracked" or "modelled"; ROAS as a multiple (MFR05).
5. Never in a merchant report: customer personal data, reviewer names, internal notes, ticket comments, account health, billing, partner or pipeline data (MFR07).
6. Multi-location merchants get a total plus a per-location table (MFR08). Templates: Monthly, Sales-only, Multi-month (MFR12). Highlights message is P2 (MFR11).
7. P1 segments and counts: Sales 12 · Search 10 · Blogs 3 · Website 6 · Business Profile 7 · Ads 9 · Email & SMS 8 · Reviews 5 · Rewards 5 · Ops 4 · headline cards 1.
8. PRD B is the internal partnership report: 118 metrics in 14 segments, generated once a month after the merchant reports (PFR01); revenue sections finance/leadership only (PFR05); one statement per partner with no other partner's data (PFR10, P2).
9. PRD B sections: partners & leads, quote funnel, revenue & billing, delivery & SLA, report pipeline, data readiness, then a health block per module (SEO, website, GBP, ads, messaging, reviews, rewards, sales).
10. Both PRDs: lead and quote counts must reconcile; no partnership or finance field may appear in any merchant payload.

## 2. Metric source table (PRD A, P1 metrics; P2 grouped at the end)

### Cover, headline cards, sales
| Metric | Source in code | Status |
|---|---|---|
| REP01 headline cards | derived from the section figures below | new query (assembly) |
| Display name, cuisine, website, city/state | `profiling.merchant.restaurant_name_dba`, `website_url` (`api/app/models/profiling.py:73-96`); primary `profiling.location` (229-235) | live |
| Service package / section switch (DQ07) | `profiling.merchant_service` + `catalog.service` (`profiling.py:459-484`); `subscription.package_code` (273-294) | live, but the catalogue has **no Google Ads, Sales, Website or Meta service** (`api/scripts/seed.py:23-66`) → Ads switch must use the linked `ads_account`, Sales switch a sales row |
| Recipients | OWNER + MARKETING contacts (`api/app/modules/seo/recipients.py:21-45`) | live (no CC, no report day) |
| SAL01 gross sales · SAL02 net · SAL03 orders · SAL04 AOV · SAL05 per day · SAL06 channel mix · SAL07 online share · SAL09 discounts · SAL10 refunds · SAL11 tips · SAL13 amount collected · SAL14 MoM/YoY | nothing; the only sales number is the monthly billing row `payments.merchant_payment.orders_revenue` (`api/app/models/boundary.py:167`), imported from the revenue sheet (`merchant_profiling/payments_import.py:39`) and blocked for merchant reports | **no source** (12 metrics) |

### Search and blogs (SEO module, read-only)
| Metric | Source in code | Status |
|---|---|---|
| SEO01 clicks · SEO02 impressions | `seo.data.gsc_window` = Σ `seo_gsc_daily` (`api/app/modules/seo/data.py:37-48`) | live |
| SEO03 CTR · SEO04 position (impression-weighted) | `report_v2.build` (`seo/report_v2.py:613-617`); `data.py:43-48` | live |
| SEO05 branded vs non-branded | `report_v2.branded_split` (92-129), tracked queries only (top 1,000/month, `seo/sync.py:44`) | live (label "tracked clicks") |
| SEO06 top queries | `seo_gsc_query` month rows (`report_v2.py:652-657`) | live |
| SEO07 local / near-me queries | `report_v2.opportunities`, `generic_queries` (154-162, 387-392); no near-me filter | new query (word list) |
| SEO08 top pages | `seo_gsc_page` month rows (658-663) | live |
| SEO09 device split | `report_v2.device_rows` from `seo_gsc_split` (187-197) | live |
| SEO14 fixes completed | `seo_finding` closed in period (`seo/client_reports.py:233-236`) | live |
| SEO15 blogs published vs planned | `seo_blog_post.published_on` (`api/app/models/seo.py:511-539`); planned = `catalog.entitlement.qty_per_period` | live / new query (month filter) |
| SEO16 blog impressions and clicks + share | `seo_blog_gsc_daily` (546-559); UI sums 28/90-day windows only (`seo/blog_views.py:75-83`) | new query (month sum, `is_final`) |
| SEO18 top posts | same table per post | new query |

### Website
| Metric | Source in code | Status |
|---|---|---|
| WEB01 visits | `seo_ga4_daily.sessions` via `data.ga4_window` (`data.py:51-65`), only where a GA4 property is linked | live (partial coverage) |
| WEB03 traffic by source | GA4 is read by channel but only "Organic Search" is stored (`seo/google.py:269-291`) | **no source** (would need an SEO-module change) |
| WEB07 order-button clicks | blog landing pages only (`models/seo.py:593-606`; `seo/blogs.py:81`) | no source (site-wide) |
| WEB08 website orders · WEB09 conversion · WEB10 website revenue | needs the sales feed with a source tag | **no source** |

### Business Profile (GBP module; Google API approval pending)
| Metric | Source in code | Status |
|---|---|---|
| GBP01 views · GBP03 calls · GBP04 directions · GBP05 website clicks · GBP07 total actions | `gbp.reports.aggregate` over `gbp_daily_metric` (`api/app/modules/gbp/reports.py:111-123`) | live in code, no data yet |
| GBP11 completeness | `profile.pct(profile_fields)` (`gbp/reports.py:214`) | live in code |
| GBP12 by location | `gbp_location.merchant_id` (`models/gbp.py:131-133`) | live in code |

### Ads (Google; Meta has nothing)
| Metric | Source in code | Status |
|---|---|---|
| ADS01 spend · ADS02 impressions · ADS03 clicks | Σ `ads_daily_metric` via `ads.reports.campaign_totals` (`api/app/modules/ads/reports.py:126-137`) | live |
| ADS06 orders · ADS08 cost per order · ADS09 ROAS | `calc.kpis` (`ads/calc.py:93-120`) | live |
| ADS07 attributed revenue | orders × current typed ticket (`calc.py:112-113`; `models/ads.py:115-119`); no history, no label | live (must snapshot the ticket and add the "modelled" label) |
| ADS11 budget pacing | `calc.Budget` (`calc.py:217-271`) vs `merchant.google_ads_budget`; budget empty on all accounts | live, data missing |
| ADS12 top campaigns | `ads.reports.account_detail` (336-360) | live |
| ADS04 CTR · ADS05 CPC (P2) | clicks and cost stored, not computed | new query |
| ADS13 search terms · ADS14/15 Meta (P2) | not read (`ads/google.py:95-101`); no Meta integration | no source |

### Email & SMS, Rewards, Reviews, Ops
| Metric | Source in code | Status |
|---|---|---|
| ESM01, 03, 04, 06–09, 11 (8 P1) | module is a `ComingSoon` page (`web/src/app/(app)/marketing/email-sms/page.tsx`); no API, no tables | **no source** |
| RWD01, 02, 05, 07, 09 (5 P1) | `ComingSoon` (`marketing/rewards/page.tsx`) | **no source** |
| REV01 new · REV02 total + average · REV04 trend · REV06 response rate · REV10 by location | Google reviews only: `gbp_review.star_rating`, `create_time`, `has_reply` (`models/gbp.py:200-216`); `/reviews` page is `ComingSoon` | new query (Google only, after GBP data flows) |
| OPS01 tickets closed by service | `ops.ticket.type/status` (`api/app/models/ops.py:85-105`); no closed-at month filter, categories ≠ service catalogue | new query (needs a whitelist decision, see §6) |
| OPS02 changes made | `audit.audit_log` only (edit log, not a change log) | no source |
| OPS04 deliverables | `delivery.delivery_item.last_delivered` (`boundary.py:35`) | new query (no per-month record) |
| OPS05 next-month plan | `ops.ticket.due_date` (`ops.py:93`) | new query |

### P2 groups
SAL08/12 no source · SEO10–13, 17, 19–22: SEO11 index verdict `seo_page` (live, inspected pages only), SEO12 `data.keyword_positions` (live), SEO13 `seo_page.psi_*` (live), rest new query · WEB02, 04–06, 11–13 no source · GBP02, 06, 08–10 live in code (`gbp/reports.py:567-660`) · ESM/RWD P2 no source · REV03, 05, 07–09, 11 Google-only new query · QUO15 `quotes.*` live · OPS03/06 `ops.meeting` partial.

### Count for P1 (70)
| Status | Count |
|---|---|
| live | 28 |
| new query | 13 |
| no source | 29 |

## 3. Where the roadmap and prototype do not match the code

### Roadmap (Oct 29)
| # | Roadmap says | Code says | Effect |
|---|---|---|---|
| R1 | Phase 0 adds recipients, CC, report day and service flags "to the merchant record" | `profiling.merchant` belongs to Merchant Profiling; it already has unused free-text `report_frequency` / `report_recipients` (`profiling.py:119-120`); recipients come from contacts (`seo/recipients.py`) | keep these in a new `report_gen_merchant_settings` table; no edit to `merchant` |
| R2 | Service flags decide which sections appear | `merchant_service` exists, but the catalogue has no Google Ads, Sales, Website or Meta entry (`seed.py:23-66`) | Ads section = active linked `ads_account`; Sales section = sales row for the month; Website = linked `profiling.website` or GA4 |
| R3 | Phase 1 (weeks 2–3) ships PDF **and Word** | no DOCX writer exists anywhere (only a reader, `websites/docx_import.py`); no server PDF for reports, "PDF" is browser print (`seo/components/report-preview-page.tsx:26-43`); reportlab is installed for quotes (`requirements.txt:17`, `quotes/pdf.py`) | PDF via reportlab is feasible; DOCX needs a new dependency (`python-docx`) and its own phase |
| R4 | Phase 2 (weeks 3–4) ships a live sales feed | nothing exists: "Ordering conversions feed" is a disabled preview card (`web/src/features/seo/components/connections-catalog.tsx:65`), KPI catalogue says "on hold" (`seo/catalog.py:92`), roadmap seed puts orders in Apr–Jun 2027 (`roadmap/seed_data.py:178-197`) | the feed is an integration project of its own; CSV upload is the only path inside 4 weeks |
| R5 | Status flow Generating → Ready for approval → Needs changes → Approved → Sent → Failed | SEO has `awaiting_signoff → signed → sent / failed` (`seo/client_reports.py:287-313, 606-628`); Ahmed's brief: draft, edited, approved, sent, deleted, failed; prototype: Due → Generating → In review → Approved → Sent, held/failed retry | one lifecycle must be fixed before the model file is written (see §5) |
| R6 | Ad revenue labelled "Estimated" | no label at all in `calc.kpis` (`calc.py:107-120`); PRD A MFR05 says "tracked or modelled"; prototype footer says "modelled" | use "modelled" |
| R7 | Per-merchant report day and scheduler | no long-lived worker: pg_cron calls `POST /jobs/{job}` from a fixed tuple `JOBS` (`api/app/modules/jobs/router.py:37`), each call limited to `JOBS_TIME_BUDGET_S` 600 s (`config.py:229`) | a `report-gen` job entry + cron row (`api/sql/jobs_cron.sql`); generate-all must be incremental, one merchant per step |
| R8 | "test user roles" in Phase 0; PRD B needs finance, leadership, team-lead, partner views | roles are SUPER_ADMIN, ADMIN, MARKETING_MANAGER, MARKETING_EXECUTIVE, SALES_EXECUTIVE, SALES_MANAGER (`models/enums.py:252-261`); grants only for 5 capabilities (`common/capabilities.py:211-212`); no Finance or Partner role | PRD A works with STAFF/MANAGERS; PRD B needs new capabilities |
| R9 | Phase 0 "link Ads and SEO accounts" (9 accounts, 23 sites) | data clean-up on the hosted DB, not code; tooling exists (`linking/engine.py`, `/merchants/{id}/connections`) | no build work; needs a data owner |
| R10 | "Confirm how the generator reads data" | every merchant metric is reachable by `merchant_id` FK on the module table (`ads_account.merchant_id` `models/ads.py:113`; `seo_site.merchant_id` `seo.py:109`; `gbp_location.merchant_id` `gbp.py:131`); several accounts/sites per merchant, no primary marker | rule needed: sum all active non-DEMO + optional primary override |
| R11 | 4 weeks for Phases 0–2 | file-level sizing in the audit: ~6–8 dev weeks for Phase 0–1 (PDF only) + 3 for sales; web has no tests, API smoke test pins an exact endpoint count (`tests/test_app_smoke.py:322`) | 4 weeks covers an MVP (Ads + SEO, PDF, dry-run send), not DOCX or the sales feed |

### Prototype (v1.1)
| # | Prototype shows | Code says |
|---|---|---|
| P1 | A "Reports Hub" with Overview, Restaurants, Compare, Customers, Report, Queue, Partnership, Catalogue, Alerts pages | `/reports` is a portfolio KPI dashboard (`web/src/features/portfolio/reports-page.tsx:13-31`, nav `web/src/config/nav.ts:108`); none of the hub pages exist |
| P2 | Customers page (total, new, returning, repeat rate, 90-day retention) | no customers table; `/guests` and the merchant Customers tab are `ComingSoon` (`merchants/[merchantId]/modules/[moduleId]/page.tsx:23-26`) |
| P3 | Module filter includes Meta Ads | no Meta integration; only `merchant.meta_ads_budget` (`profiling.py:103`) |
| P4 | "Generate", "Generate all", "Generate with not supplied", "Held for missing data (REP-04)" | no per-merchant generation exists; SEO auto-assembles per site at the end of its sync (`client_reports.py:631-648`) and refuses a period that has not ended (290-291) |
| P5 | "Snapshot frozen … won't change if source data changes" | `seo_report.snapshot` is frozen at assemble, overwritten on regenerate, no version (`models/seo.py:309-333`) |
| P6 | PDF and DOCX buttons | neither exists for reports (R3) |
| P7 | "Recipients from merchant profile" | true today (OWNER + MARKETING contacts, `recipients.py:21-45`); CC and report day do not exist |
| P8 | Statuses Due, Generating, In review, Approved, Sent, Failed | Due and Held have no counterpart; map Due = no row for the month, Held = draft with missing sources |
| P9 | "Viewing as" Partnership lead / Leadership / Finance / Team lead / Partner | roles do not exist (R8) |
| P10 | Partner statement from partner leads | partner leads live in plain SQL tables `public.partner_leads*` outside the models (`README.md:70-72`); quotes in `quotes.*` (`models/quotes.py:85-304`) |
| P11 | "Data connections" per restaurant | exists: `GET /merchants/{id}/links` (`linking/connector.py:117-142`), page `merchants/[merchantId]/connections` |
| P12 | Highlights message / Send highlights | nothing (P2 anyway) |
| P13 | Alerts page fed by daily metrics (PFR13) | `/issues` page exists (nav.ts:106) and Ops SLA alerts run as a job (`jobs/router.py:49-57`); whether module metrics raise issues was not verified |
| P14 | Period picker Sep/Aug/Jul 2026, "Phase 1 and 2 / Phase 1 only" toggle | UI-only sample data |

## 4. Reusable parts

| Need | Reuse as-is (read-only import) | Copy the pattern into the new module |
|---|---|---|
| Auth + roles | `require_capability` (`api/app/common/deps.py:71-82`), capability matrix (`common/capabilities.py`), web mirror `web/src/features/auth/capabilities.ts`, middleware cookie check (`web/src/middleware.ts`) | add `report_gen.view / manage / approve` |
| Audit log | `@audited(entity_type, id_param, read, resolve_merchant_id)` (`common/audit.py:50-58`), used on SEO sign-off/send (`seo/router.py:602-666`) | — |
| Report workflow | — | `seo/client_reports.py`: assemble → snapshot → edit summary/next steps → sign-off → send (137-170, 173-313, 606-628); refuse unfinished period (290-291) |
| Snapshot | — | `seo_report.snapshot` JSONB (`models/seo.py:309-333`) + add `version` and an immutable row per approval |
| Narrative text | `report_v2` pure functions (`seo/report_v2.py:219-362`) as examples | own templates per section |
| Ads month figures | `ads.reports.campaign_totals`, `load_ctx`, `account_detail` (`ads/reports.py:126-137, 159-192, 336-360`), `calc.kpis`, `calc.Budget` | CTR/CPC, ticket snapshot, label |
| SEO month figures | `seo.data.gsc_window`, `ga4_window`, `keyword_positions` (`seo/data.py:37-65, 185-205`); `report_v2.branded_split`, `device_rows`, `country_block`, `opportunities` | blog month sums |
| GBP month figures | `gbp.reports.aggregate` (`gbp/reports.py:111-123`), `_reviews` (505-564) | — |
| Recipients | `seo.recipients.merchant_contacts`, `merged` (`recipients.py:25-54`) | settings table for CC / report day |
| E-mail | Gmail via the SEO connection: public `seo.connection.access_token` + `GMAIL_SEND_URL` (`client_reports.py:36, 359`); `_gmail_send` is private (342) so do not import it; Resend (`config.py:135`) for everything else | own `sender.py` with dry-run / sandbox / live and attachments |
| PDF | reportlab 4.4.4 (`requirements.txt:17`), example `quotes/pdf.py`; print-preview page pattern `seo/components/report-preview-page.tsx` | report layout |
| File storage | storage port `common/storage/port.py:30-41` (local disk or Supabase bucket, `config.py:85-91`) | — |
| Background jobs | `jobs.run / time_up / stale_after` (`common/jobs.py:44-74`), run-row + advisory lock (`ads/sync.py:76-89`), job tuple + pg_cron (`jobs/router.py:37`, `sql/jobs_cron.sql`) | `report-gen` job |
| CSV import | — | `merchant_profiling/payments_import.py` preview → apply, merchant matching (215-237, 308-329) |
| Merchant links | `GET /merchants/{id}/links` (`linking/connector.py:117-142`); DEMO filter (`linking/engine.py:324, 362, 405`) | — |
| Review UI | `seo/components/report-page.tsx` (status, edit panels, sign-off, send dialog 292-372), `reports-page.tsx` tiles, `report-document-v2.tsx` | queue + review pages |
| Merchant tab pages | `web/src/app/(app)/merchants/[merchantId]/{ads,seo,gbp}/page.tsx` thin wrappers | a `reports` tab later |

**Merchant data isolation.** The app is a staff tool, not multi-tenant: there is no row-level security. Separation is by explicit `merchant_id` filters in every query (`seo/router.py:782`, `ads/reports.py:702-707`), the 409 when a record belongs to another merchant (`linking/connector.py:169-205`), and the audit row's merchant id. For the generator: every adapter is called with one `merchant_id`; the snapshot row carries the merchant id; recipients come only from that merchant's contacts; a unit test asserts every merchant id inside the payload equals the report's. Role checks will not keep billing or notes out, because every STAFF role can read the Payments tab and internal notes (`merchant_profiling/routers/payments.py:69`; `mappers.py:84-88`); the whitelist in the generator is the only guard.

## 5. Proposed updated roadmap (small phases, self-contained)

Lifecycle used below: `generating → draft → edited → approved → sent | failed | deleted` (soft delete, audit row kept). Prototype "Due" = no row; "Held" = draft with a `missing` list. Everything new lives in `api/app/modules/report_gen/`, `api/app/models/report_gen.py`, `web/src/features/report-gen/`, `web/src/app/(app)/report-gen/`. Shared files are touched once each, listed per phase, so the merge into the company repo is a short, known diff.

### Phase 0 · Minimal working version (button → draft → approve / edit / delete → dry-run send) · ~1.5 weeks
New files
- `api/app/models/report_gen.py` — `report_gen_report` (merchant_id FK, period, template, status, current_version, generated/approved/sent by+at, error, data_through JSONB, missing JSONB, deleted_at; unique merchant+period+template), `report_gen_snapshot` (report_id, version, payload JSONB, created_by/at, frozen), `report_gen_recommendation`, `report_gen_audit` (action approve/edit/delete/send, user, at, note), `report_gen_run`, `report_gen_merchant_settings` (recipients, cc, report_day, primary ads/seo ids), `report_gen_file`. Schema `marketing`, prefix `report_gen_`.
- `api/alembic/versions/<rev>_report_gen.py` — additive, with downgrade; written, not run.
- `api/app/modules/report_gen/__init__.py`, `flag.py` (`REPORT_GEN_ENABLED` guard → 404 when off), `whitelist.py`, `periods.py`, `service.py` (state machine, four-eyes rule, duplicate-send guard on `(report_id, version)`), `assemble/__init__.py` (section order, package switch, "not supplied" rule), `assemble/ads.py`, `assemble/seo.py`, `assemble/blogs.py`, `assemble/stub.py` (sales, website, gbp, esm, rewards, reviews, ops → reason-coded missing), `narrative.py` (minimal), `sender.py` (dry-run only), `router.py` (queue, generate one, get, patch text, approve, delete, send, preview).
- `api/tests/test_report_gen_whitelist.py`, `test_report_gen_service.py`, `test_report_gen_assemble.py` (fixtures in `api/tests/fixtures/report_gen/`).
- `web/src/features/report-gen/{api.ts,types.ts,components/queue-page.tsx,components/review-page.tsx}`; `web/src/app/(app)/report-gen/page.tsx`, `web/src/app/(app)/report-gen/[reportId]/page.tsx`.
Shared files (one line or one block each)
- `api/app/main.py` (one `include_router`), `api/app/models/__init__.py`, `api/alembic/env.py` (model import), `api/app/common/capabilities.py` + `web/src/features/auth/capabilities.ts` (`report_gen.view/manage/approve`, approve grantable), `api/app/config.py` (`REPORT_GEN_ENABLED=False`, `REPORT_GEN_SEND_MODE="dry-run"`, `REPORT_GEN_SANDBOX_RECIPIENTS`), `api/tests/test_app_smoke.py` (endpoints + count), `web/src/config/nav.ts` (one entry under Marketing, hidden when the flag is off).
Done when: on a merchant with linked Ads + SEO, one click creates a draft with Ads, Search and Blogs sections and "not supplied" rows for the rest; Approve freezes v1; Edit creates v2 and sets `edited`; Delete soft-deletes; Send in dry-run logs recipients and sets `sent`; whitelist test passes.

### Phase 1 · Real document and background generation · ~2 weeks
- `report_gen/exports/pdf.py` (reportlab; stored via the storage port at approval), `web/src/app/report-gen-preview/[reportId]/page.tsx` (print view outside the shell).
- `report_gen/jobs.py` (generate-all-due, one merchant per step, `time_up()` aware, run row + advisory lock) + shared: `api/app/modules/jobs/router.py` (`"report-gen"` in `JOBS`), `api/sql/jobs_cron.sql` (one row).
- `sender.py` live mode: Gmail through `seo.connection.access_token` with the PDF attached, sandbox recipients first.
- `narrative.py` + `recommendations.py` full (owner + target), per-location tables (MFR08), YoY gate (MFR03), headline cards (REP01).
- `assemble/gbp.py`, `assemble/reviews_google.py` (code is ready; data arrives with Google approval), `assemble/website.py` (WEB01).
- Acceptance tests from PRD A §4 in `api/tests/test_report_gen_acceptance.py`.
Done when: pilot merchants' Ads/SEO figures match fixtures; approved PDF unchanged after a re-sync; sandbox e-mail received with attachment.

### Phase 2 · Sales, settings, DOCX, templates · ~2 weeks
- `report_gen/sales_source.py` (interface) + `sales_upload.py` (CSV preview → apply, pattern from `payments_import.py`) + `assemble/sales.py` + table `report_gen_sales_month`; unlocks SAL01–14 and WEB08–10. An ordering-backend adapter replaces the CSV when access exists (question 1).
- `web/src/features/report-gen/components/settings-panel.tsx` (recipients, CC, report day, primary account/site) + `router.py` settings routes.
- `report_gen/exports/docx.py` + shared `api/requirements.txt`, `api/pyproject.toml` (`python-docx`), drift test `api/tests/test_deploy_config.py`.
- Templates Monthly / Sales-only / Multi-month (MFR12) in `assemble/__init__.py`.
Done when: Sales section renders from an upload; DOCX downloads; report day drives the scheduler.

### Phase 3 · Other modules' adapters (as their tables land)
- `assemble/email_sms.py`, `assemble/rewards.py`, `assemble/reviews.py`, `assemble/ops.py` (pending question 2), `assemble/website.py` source split. One file each, read-only on the owning module's tables.

### Phase 4 · PRD B partnership report (after PRD A is live)
- `report_gen/partnership/` (assemblers over `quotes.*`, `payments.merchant_payment`, `ops.ticket`, `public.partner_leads*`, the `report_gen_*` tables), report type `partnership`, new capabilities `report_gen.finance`, `report_gen.partner` (shared `capabilities.py` + `.ts`), partner-statement isolation test, `web/src/app/(app)/report-gen/partnership/page.tsx`.

## 6. Questions (max 3)

1. **Sales feed.** PRD A marks all 14 Sales metrics "live today", but no sales, orders, channel or refund data exists in the repo. Where are those figures compiled from today, and can the generator get read access (API, DB view or export)? Until then only the CSV upload can fill the Sales section.
2. **Ops read.** OPS01–05 (P1) need `ops.ticket` title, type, status and dates. Hard rule 13 and the audit whitelist block all of `ops.*`. May the generator read those four columns, never comments or credentials?
3. **Approver rule.** Roadmap leaves "who may sign off" open. Default: `report_gen.approve` = MANAGERS plus per-person grant (same as `seo.approve`, `capabilities.py:193, 211`), and the person who generated the current version cannot approve it (Admin exempt). OK?
