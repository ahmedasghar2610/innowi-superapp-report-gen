# Requirements traceability · PRD A and PRD B against the code

Date 2026-10-30. Inputs: `PRD_A_Merchant_Facing_Reports.pdf`, `PRD_B_Partnership_Facing_Reports.pdf` (both read in full from the text layer), the 238-metric catalogue embedded in `Innowi_Reports_Prototype (1).html` (v1.1), the roadmap of Oct 29 and `docs/code-review-findings.md`. Paths are relative to the repo root. Nothing from either PRD is dropped: every metric ID and every functional requirement has a row.

**Status vocabulary**

| Status | Meaning |
|---|---|
| reuse | an existing function produces the figure or rule today, including the Phase 0 code already in `api/app/modules/report_gen/` |
| extend | the data is stored; a new query or a small addition inside our module is needed, no change to the owning module |
| build new | a new table, file, dependency or capability inside our module |
| blocked | nothing in the database can supply it; depends on a feed, another team's module or a decision. The section still renders "not supplied" with a reason code (MFR04), so the one-click flow is never blocked by it |

Phase is the PRD's own P1/P2. "Where it comes from" names the table or function; `assemble/x.py` means `api/app/modules/report_gen/assemble/x.py`.

Change of conclusion versus `docs/code-review-findings.md`: OPS01 was listed as "no closed-at month filter"; `ops.ticket.completed_at` exists (`api/app/models/ops.py:149`), so the month filter is a plain query (extend, not blocked). The review also planned a `report_gen_recommendation` table; the Phase 0 code keeps recommendations inside the snapshot payload (`service.apply_edit`), which is simpler and keeps the approved version in one row, so that table is dropped from the plan.

## 1. PRD A · functional requirements (MFR01–MFR12) and acceptance criteria

| Requirement | Where it comes from in the code | Status | Notes |
|---|---|---|---|
| MFR01 build from the service package (DQ07); a section for a service not taken never appears | `assemble/__init__.py` `package_switch()` reads `profiling.merchant_service` + `catalog.service.name` through `SERVICE_SWITCH`; hidden sections return `included=False` with empty metrics; `narrative.py` only writes about included sections | reuse | Catalogue has no Google Ads, Sales or Website service (`api/scripts/seed.py:23-66`), so Ads = active linked `ads_account`, Website = `merchant.website_url`, Sales and Ops = always on. Phase 2 moves the Sales/Ops switch to `report_gen_merchant_settings` (extend) |
| MFR02 fixed order: cover, executive summary (4 cards + takeaway), snapshot table, sales, search, blogs, website, Business Profile, ads, email & SMS, rewards, reviews, what we did, recommendations (owner + target), bottom line, sources footer | `SECTION_ORDER` in `assemble/__init__.py`; `compose()` writes `headline`, `summary`, `recommendations`, `bottomLine`, `sources` | extend | Missing today: the one-line takeaway (summary is 1–6 sentences), the snapshot table (figures are in `sections[*].metrics`, the renderer must draw the table), and "Your quote" after Ops (prototype, P2). Small renderer work, no engine change |
| MFR03 change on the prior month for every figure; YoY only with 12 months | `metric()` computes `change` from `prev`; `periods.yoy_available()` exists; `periods.shift_months()` | extend | No adapter fills a YoY value yet; add `yoyValue`/`yoyChange` to `metric()` and a second query window in `ads.py`, `seo.py`, `blogs.py` gated by `yoy_available(first_data_date)` |
| MFR04 "not supplied" with reason, never zero; section keeps heading + one-line note | `not_supplied()`, `REASONS`, `section()` → `missing`/`caption`; `assemble/stub.py` | reuse | Test `test_no_figure_is_ever_zero_when_missing` |
| MFR05 attributed figures labelled tracked/modelled; ROAS as a multiple; YTD labelled | `assemble/ads.py` tags ADS06 `tracked`, ADS07/ADS09 `modelled`, unit `multiple`; ticket used stored in `tables.tickets` | reuse | YTD does not arise (calendar months only). Roadmap wording "Estimated" is replaced by the PRD word "modelled" (change recorded in review R6) |
| MFR06 plain language, no internal codes; display name and recipients from the merchant profile | `load_ctx()` reads `restaurant_name_dba` and OWNER/MARKETING `profiling.contact.email`; metric IDs travel in the payload | extend | Renderers (review page, PDF) must hide `metric.id` in the merchant preview and print the one-line definitions from the catalogue; IDs stay in the internal view |
| MFR07 never customer personal data, reviewer names, internal notes, ticket comments, account health, billing, partner or pipeline data | `whitelist.py` `ALLOWED` + `BLOCKED_KEY_RE` + `scan()`; `service.generate()`/`edit()` call `assert_clean()`; `tests/test_report_gen_whitelist.py` | reuse | Role checks cannot do this (every STAFF role reads the Payments tab, `merchant_profiling/routers/payments.py:69`); the whitelist is the guard. Add the isolation test (§4 of the blueprint) |
| MFR08 multi-location: total + per-location table where locations differ | `profiling.location` rows; `gbp_location.merchant_id`; `gbp_review.location_id` | build new | Per-location tables for GBP and reviews come with the GBP adapter (Phase 1); per-location sales need the sales source with a location column (Phase 2) |
| MFR09 recommendations limited to what the data supports, each with owner + target | `narrative.recommendations()`; editable through `PATCH /report-gen/reports/{id}/text` (`service.apply_edit`) | reuse | Owner and target are required fields in `apply_edit` |
| MFR10 PDF and DOCX; approval before send; approved version stored as a snapshot | approval + frozen snapshot: `service.approve()` sets `report_gen_snapshot.frozen`; `check_send()` refuses unapproved; `report_gen_file` table exists | build new | PDF: reportlab is already a dependency (`api/requirements.txt:17`, pattern `api/app/modules/quotes/pdf.py`). DOCX: no writer in the repo; needs `python-docx` (new dependency, flagged) |
| MFR11 highlights message drafted from headline cards, edited and sent by the account manager (P2) | nothing | build new | P2; `narrative.highlight_message()` + a text field on the snapshot |
| MFR12 templates Monthly, Sales-only, Multi-month selected by package | `TEMPLATES` constant in `api/app/models/report_gen.py`; `template` column; `compose(template=…)` | extend | Only `monthly` is assembled. Sales-only = sales + ops sections; Multi-month = three month columns in the sales snapshot (prototype MFR-12 table) |
| Acceptance: pilot report reproduces the manual figures exactly | fixtures `api/tests/fixtures/report_gen/sample_month.json` (synthetic) | build new | Needs a sanitized export of the four pilot merchants (open question in the review); Ads figures may move for 14 days after month end (`config.py:286`) |
| Acceptance: a merchant without ads, rewards or reviews gets no section | `package_switch()`; `test_package_switch_follows_services_and_links` | reuse | — |
| Acceptance: every missing figure shows "not supplied" and a reason | `test_no_figure_is_ever_zero_when_missing`, `test_stubs_cover_every_segment_with_a_known_reason` | reuse | — |
| Acceptance: no Payments, Partnerships or internal Ops fields in payload or document | `test_whitelist_never_allows_blocked_tables_or_columns`, `scan()` | reuse | Extend with the cross-merchant isolation test |
| Acceptance: cover shows the display name | `load_ctx()` → `merchant.name` = `restaurant_name_dba` | reuse | — |
| Acceptance: approved reports do not change when source data changes | frozen snapshot; `check_generate()` refuses approved/sent; files rendered from the frozen payload only | reuse | Add `test_report_gen_acceptance.py::test_frozen_snapshot_survives_resync` |
| Open question: delivery channel (attachment, link, portal) | `sender.py` dry-run only | build new | Assumption: e-mail with PDF attached; link/portal out of scope |

## 2. PRD A · 120 merchant-facing metrics

### Cover and headline cards (REP)

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| REP01 Report headline cards | P1 | `narrative.headline()`: SAL01, SAL03, SEO01, SEO03 + one card per live module | reuse | Sales cards print "not supplied" until the sales source exists |

### Sales performance (SAL01–SAL14)

No sales, orders, channel, refund or tip data exists anywhere in the repo. The only monthly figure is the billing row `payments.merchant_payment.orders_revenue` (`api/app/models/boundary.py:167`), which is billing data and blocked by MFR07. Every row below renders "not supplied – sales_feed_not_connected" from `assemble/stub.py` today. Phase 2 adds `report_gen_sales_month` filled by a CSV upload (build new); the ordering-backend feed replaces the CSV when access exists.

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| SAL01 Gross sales | P1 | none → `report_gen_sales_month.gross` (Phase 2) | blocked | unlocked by the sales upload |
| SAL02 Net sales | P1 | none → gross − discounts − refunds | blocked | same |
| SAL03 Orders | P1 | none → `orders` | blocked | same |
| SAL04 Average order value | P1 | none → gross ÷ orders, per channel | blocked | same |
| SAL05 Sales and orders per day | P1 | none → ÷ `Period.days` (`periods.py`) | blocked | day maths exists |
| SAL06 Channel mix | P1 | none → one row per channel (POS card/cash/gift, kiosk, online pickup, delivery, QR) | blocked | CSV columns in blueprint §Phase 2 |
| SAL07 Online share of sales | P1 | none → online gross ÷ total gross | blocked | same |
| SAL08 Payment mix | P2 | none → POS card/cash/gift-card rows | blocked | same |
| SAL09 Discounts | P1 | none → `discounts` | blocked | same |
| SAL10 Refunds (called out when it jumps) | P1 | none → `refunds`; jump = > 2× prior month | blocked | same |
| SAL11 Tips | P1 | none → `tips` | blocked | same |
| SAL12 Tax, service and delivery fees | P2 | none → `tax`, `service_fee`, `delivery_fee` | blocked | same |
| SAL13 Amount collected | P1 | none → net + tax + tips + fees | blocked | same |
| SAL14 Period comparison (MoM, YoY) | P1 | `metric()` change; YoY per MFR03 | blocked | same; YoY needs 12 uploaded months |

### Search (SEO01–SEO14)

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| SEO01 Organic clicks | P1 | `assemble/seo.py` → `seo.data.gsc_window()` over `seo_gsc_daily` | reuse | several sites summed |
| SEO02 Impressions | P1 | same | reuse | — |
| SEO03 Click-through rate | P1 | `seo.compute()` clicks ÷ impressions | reuse | — |
| SEO04 Average position | P1 | impression-weighted in `gsc_window` | reuse | — |
| SEO05 Branded vs non-branded clicks | P1 | `seo.report_v2.branded_split()` over `seo_gsc_query` month rows | reuse | tracked queries only (top 1,000/month, `seo/sync.py:44`); caption says so |
| SEO06 Top queries | P1 | `tables.topQueries` | reuse | "share of clicks with query data" = `trackedShareOfClicks` |
| SEO07 Local and near-me queries | P1 | `seo.is_local()` with `LOCAL_WORDS` + city | reuse | word list is ours; extend the list when the SEO lead reviews it |
| SEO08 Top pages | P1 | `seo_gsc_page` month rows → `tables.topPages` | reuse | — |
| SEO09 Device split | P1 | `seo_gsc_split` dimension device → `report_v2.device_rows()` | reuse | — |
| SEO10 Searcher location | P2 | `seo_gsc_split` dimension country; `report_v2.country_block()` | extend | "outside service area" = share of impressions not from USA |
| SEO11 Pages indexed | P2 | `seo_page.index_verdict` (inspected pages, `SEO_INSPECT_PER_SITE`); crawl totals | extend | partial coverage; print "of pages checked" |
| SEO12 Tracked keyword rankings | P2 | `seo.data.keyword_positions()` (`seo/data.py:185-205`) | extend | month vs previous month already computed |
| SEO13 PageSpeed score | P2 | `seo_page.psi_score`, `cwv` (`models/seo.py:234-241`) | extend | mobile only is stored |
| SEO14 Fixes completed | P1 | `seo_finding` closed/fixed in period (`seo.fixed_between`) + open count | reuse | — |

### Blogs (SEO15–SEO22)

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| SEO15 Blogs published vs planned, with titles | P1 | `assemble/blogs.py` over `seo_blog_post.published_on`; planned = `catalog.entitlement.qty_per_period` for "Blogs" | reuse | planned prints `blog_plan_not_recorded` today; wire the entitlement in Phase 1 (extend) |
| SEO16 Blog impressions and clicks + share of site | P1 | `seo_blog_gsc_daily` month sum, `is_final`, scope all | reuse | share needs site clicks passed in (`site_clicks` argument exists, caller passes None) |
| SEO17 Blog CTR and position | P2 | same table has `position` | extend | one more sum |
| SEO18 Top posts | P1 | `tables.topPosts` | reuse | — |
| SEO19 Posts with a first click | P2 | first `seo_blog_gsc_daily.date` with clicks > 0 per post | extend | new query |
| SEO20 Posts with impressions but no clicks | P2 | same table | extend | new query |
| SEO21 Order path from blogs | P2 | `seo_blog_ga4_daily.order_clicks` ÷ sessions (`models/seo.py:593-606`) | extend | GA4-linked sites only |
| SEO22 Topic coverage | P2 | nothing records planned topics | blocked | needs a topic plan field in the SEO module |

### Website (WEB01–WEB13)

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| WEB01 Website visits | P1 | `seo.data.ga4_window()` over `seo_ga4_daily.sessions` where `seo_site.ga4_property` is set | extend | new `assemble/website.py`; "website_analytics_not_connected" otherwise |
| WEB02 Unique visitors, new vs returning | P2 | `seo_ga4_daily.users` | extend | new vs returning not stored → print users only, note the gap |
| WEB03 Traffic by source | P1 | GA4 read by channel but only Organic Search stored (`seo/google.py:269-291`) | blocked | needs the SEO module to store channel rows (not ours to change) |
| WEB04 Visits by device | P2 | not stored | blocked | same |
| WEB05 Top pages | P2 | not stored (blog landing pages only) | blocked | same |
| WEB06 Menu views | P2 | not stored | blocked | same |
| WEB07 Order-button clicks | P1 | blog landing pages only (`seo_blog_ga4_daily.order_clicks`) | blocked | site-wide figure needs GA4 event rows; print the blog-only figure labelled as such |
| WEB08 Website orders (attributed) | P1 | sales source with a channel/source tag | blocked | unlocked by the sales upload if it carries an "online pickup/delivery" split; attribution to the site needs the feed |
| WEB09 Website conversion rate | P1 | WEB08 ÷ WEB01 | blocked | same |
| WEB10 Website revenue | P1 | sales source | blocked | same |
| WEB11 Calls, directions, form fills | P2 | not stored | blocked | — |
| WEB12 Site health | P2 | `seo_page.psi_*`, `seo_crawl_issue` (broken links) | extend | uptime and certificate not stored; partial |
| WEB13 Pages published or updated | P2 | `profiling.website` content versions (assumption: editor saves carry timestamps) | blocked | verify in `websites/editor.py` before promising |

### Business Profile (GBP01–GBP12)

Code is complete; live data waits for Google API approval (`api/app/modules/settings/router.py:354`). Until then the section prints `gbp_pending_google`.

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| GBP01 Profile views | P1 | `gbp.reports.aggregate()` Σ four impression columns of `gbp_daily_metric` | extend | new `assemble/gbp.py` |
| GBP02 Searches that showed the profile (direct/discovery/branded) | P2 | not synced | blocked | Google split not read by `gbp/google.py` |
| GBP03 Calls | P1 | `call_clicks` | extend | — |
| GBP04 Direction requests | P1 | `direction_requests` | extend | — |
| GBP05 Website clicks | P1 | `website_clicks` | extend | — |
| GBP06 Order and menu clicks | P2 | `menu_clicks`, `food_orders` | extend | — |
| GBP07 Total actions | P1 | Σ `ACTIONS` (`gbp/reports.py:22`) | extend | — |
| GBP08 Top search terms | P2 | `gbp_search_keyword` (month, impressions or threshold) | extend | — |
| GBP09 Photos added and views | P2 | not stored as counts | blocked | assumption: sync reads photos but keeps no monthly count |
| GBP10 Posts published | P2 | `gbp_post.create_time` | extend | — |
| GBP11 Profile completeness | P1 | `gbp.profile.pct(profile_fields)` | extend | — |
| GBP12 By location | P1 | `gbp_location.merchant_id` → one row per listing | extend | satisfies MFR08 for this section |

### Ads (ADS01–ADS15)

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| ADS01 Spend | P1 | `assemble/ads.py` → `ads.reports.campaign_totals()` | reuse | accounts summed, listed in sources |
| ADS02 Impressions | P1 | same | reuse | — |
| ADS03 Clicks | P1 | same | reuse | — |
| ADS04 Click-through rate | P2 | computed in `ads.compute()` | reuse | already there |
| ADS05 Average cost per click | P2 | computed | reuse | — |
| ADS06 Orders from ads | P1 | `orders` conversions, tag `tracked` | reuse | location-asset orders, fractional |
| ADS07 Attributed ad revenue | P1 | orders × `calc.avg_ticket()`, tag `modelled`, ticket snapshotted | reuse | ticket has no history (`models/ads.py:115-119`); the snapshot keeps the value used |
| ADS08 Cost per order | P1 | computed | reuse | — |
| ADS09 Return on ad spend | P1 | computed, unit `multiple`, tag `modelled` | reuse | — |
| ADS10 Ad revenue share | P2 | ADS07 ÷ online gross sales | blocked | needs sales |
| ADS11 Budget pacing | P1 | spend ÷ `merchant.google_ads_budget` | reuse | budget is empty on every merchant today → `budget_not_set` (data task, not code) |
| ADS12 Top campaigns | P1 | `tables.topCampaigns` | reuse | — |
| ADS13 Top search terms | P2 | not synced (`ads/google.py:95-101`) | blocked | needs an Ads module query |
| ADS14 Meta reach and frequency | P2 | no Meta integration (`profiling.py:103` budget only) | blocked | — |
| ADS15 Meta results | P2 | same | blocked | — |

### Email & SMS (ESM01–ESM14)

The module is a `ComingSoon` page (`web/src/app/(app)/marketing/email-sms/page.tsx`); no API, no tables. Section prints `module_not_connected` when the merchant has the SMS/Email or Customer List service. All 14 rows: **blocked** until that module lands; then one adapter file (`assemble/email_sms.py`).

| ID · metric | Phase | Status | ID · metric | Phase | Status |
|---|---|---|---|---|---|
| ESM01 Messages sent | P1 | blocked | ESM08 Messaging cost | P1 | blocked |
| ESM02 Delivered | P2 | blocked | ESM09 Campaign results | P1 | blocked |
| ESM03 Open rate | P1 | blocked | ESM10 Funnel | P2 | blocked |
| ESM04 Click rate | P1 | blocked | ESM11 Customer list size | P1 | blocked |
| ESM05 Opt-outs | P2 | blocked | ESM12 Reachable share | P2 | blocked |
| ESM06 Orders attributed | P1 | blocked | ESM13 Sends per customer | P2 | blocked |
| ESM07 Revenue attributed | P1 | blocked | ESM14 In-store redemptions | P2 | blocked |

### Rewards (RWD01–RWD11)

`ComingSoon` (`marketing/rewards/page.tsx`); no tables. All 11 rows **blocked**; section prints `module_not_connected` for merchants with the Rewards service.

| ID · metric | Phase | Status | ID · metric | Phase | Status |
|---|---|---|---|---|---|
| RWD01 Members enrolled | P1 | blocked | RWD07 Member revenue | P1 | blocked |
| RWD02 Active members | P1 | blocked | RWD08 Member vs non-member order value | P2 | blocked |
| RWD03 Enrolment rate | P2 | blocked | RWD09 Repeat rate | P1 | blocked |
| RWD04 Points issued | P2 | blocked | RWD10 Reward cost ratio | P2 | blocked |
| RWD05 Points redeemed | P1 | blocked | RWD11 Flyer and QR sign-ups | P2 | blocked |
| RWD06 Redemption rate | P2 | blocked | | | |

### Reviews (REV01–REV11)

Google reviews only, from `marketing.gbp_review` (`models/gbp.py:200-216`), aggregates only; `reviewer_name` and `comment` stay blocked. Data arrives with GBP approval.

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| REV01 New reviews | P1 | count `create_time` in month | extend | `assemble/reviews.py` |
| REV02 Total reviews and average rating | P1 | `gbp_location.review_count`, `rating_average` | extend | Google's own totals |
| REV03 Rating distribution | P2 | `star_rating` histogram | extend | — |
| REV04 Rating trend | P1 | mean `star_rating` last 30/90 days vs prior | extend | — |
| REV05 Review volume trend | P2 | counts per month, 6 months | extend | — |
| REV06 Response rate | P1 | `has_reply` ÷ count | extend | — |
| REV07 Response time | P2 | median `reply_time − create_time` | extend | — |
| REV08 Recency | P2 | days since max `create_time` | extend | — |
| REV09 Review themes | P2 | needs review text; `comment` is blocked by the whitelist | blocked | would need an aggregate computed inside the GBP module |
| REV10 Reviews by location | P1 | group by `location_id` | extend | MFR08 |
| REV11 Review requests and conversion | P2 | nothing records requests | blocked | — |

### What we did and next month (OPS01–OPS06)

Whitelist allows `ops.ticket` id, merchant_id, title, type, status, due_date, created_at, updated_at (decision 2026-10-30); add `completed_at` and `category` (same spirit: dates and classification, no text). Comments, description and credentials stay blocked.

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| OPS01 Work completed by service | P1 | `ops.ticket` with `status = DONE` and `completed_at` in month, grouped by `type`/`category` (`models/ops.py:108-109, 149`) | extend | categories ≠ service catalogue; map `TicketType` MARKETING/DESIGN/WEBSITE + category to the PRD's buckets in `assemble/ops.py` |
| OPS02 Changes made with expected outcome | P1 | no change log (`audit.audit_log` is an edit log and blocked) | blocked | needs a "changes" record in Ops; print the reason |
| OPS03 Measured outcome of changes | P2 | nothing | blocked | — |
| OPS04 Deliverables | P1 | `delivery.delivery_item.last_delivered` (`boundary.py:35`); `seo_blog_post` for blogs | extend | no per-month log; deliverables = items with `last_delivered` in month + blogs published |
| OPS05 Next month plan | P1 | `ops.ticket.due_date` in next month, status ≠ DONE, title + type | extend | titles are staff-written; reviewer sees them before approval |
| OPS06 Review meeting | P2 | `ops.meeting` date only; transcripts/summaries blocked | blocked | needs a decision to read the meeting date; nothing else |

### Your quote (QUO15)

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| QUO15 Quote status for the merchant | P2 | `quotes.quote_request.status`, `quote_link` (`models/quotes.py:85-304`) | extend | `BLOCKED_KEY_RE` blocks `quote.*` keys today; P2 needs a deliberate whitelist entry for status and dates only |

### PRD A metric totals

| Status | P1 (70) | P2 (50) | Total (120) |
|---|---|---|---|
| reuse | 23 | 2 | 25 |
| extend | 16 | 18 | 34 |
| build new | 0 | 0 | 0 (the sales upload is the build-new item that unlocks 17 blocked rows) |
| blocked | 31 | 30 | 61 |

Blocked P1 by cause: sales feed 12 SAL + WEB07–10 (16); Email & SMS 8; Rewards 5; website source split WEB03 (1); OPS02 (1).

## 3. PRD B · functional requirements (PFR01–PFR13) and acceptance criteria

PRD B is a second report type on the same engine. Nothing is built for it yet; the rows below say which source exists.

| Requirement | Where it comes from in the code | Status | Notes |
|---|---|---|---|
| PFR01 one partnership report per month after the merchant reports, sections in the listed order | `report_gen_report.template` can take `partnership` (no merchant); `report_gen_run` for the job | build new | Phase 3b; generated by the `report-gen` job after the merchant pass |
| PFR02 executive page: leads, qualified, won, partner-sourced revenue, MRR movement, on-time rate, report-ready share, five biggest risks | roll-up of the rows below | build new | — |
| PFR03 partners and leads | `deals` + `organizations` (`api/app/models/deals.py:56-224`); partner applications in `public.partner_leads*` (plain SQL) | extend | see PRT rows |
| PFR04 quote funnel, counts reconcile with Partnerships | `quotes.*` (`models/quotes.py`); `deals.link-quote` | extend | — |
| PFR05 revenue: MRR/ARR by module, churn, billed vs charged, leakage, failed/overdue, contract vs billed; finance and leadership only | `payments.merchant_payment`, `profiling.subscription.mrr`, `merchant_churn.mrr_at_churn` | build new | new capability `report_gen.finance`; no Finance role exists (`models/enums.py:252-261`) |
| PFR06 module health per module | same tables as PRD A plus sync runs | extend | the PRD A adapters' "missing" reasons feed this directly |
| PFR07 delivery: backlog, ageing, SLA, on-time, workload, open issues; individual performance team leads only | `ops.ticket` SLA columns, `ops/reports.py` team reports, `ops/sla.py` | build new | capability `report_gen.teamlead` for OPS12/OPS13 |
| PFR08 data readiness | `profile_completion_pct`, linking coverage (`linking/engine.py:776-783`), connection tables | extend | — |
| PFR09 risk list ranked with owner (score P2) | rules over the module-health figures | build new | thresholds are "proposed defaults" in the catalogue |
| PFR10 partner statement with no other partner's data (P2) | `organizations` + deals per partner | build new | isolation test per partner |
| PFR11 role-based access | capability matrix (`common/capabilities.py`) has no finance, leadership, team-lead or partner | build new | three new capabilities granted per person; partners get no login in this release |
| PFR12 every figure follows SR03–SR06 | `metric()`, `not_supplied()`, snapshot freeze | reuse | same engine |
| PFR13 daily alerts from these metrics land in Issues | `/issues` page is derived at read time from Command Center sources (`features/portfolio/issues-page.tsx:33`); no stored issue queue | extend | assumption: write daily-refresh metrics as rows a new `/issues` source can read; needs the Issues owner |
| Acceptance: lead and quote counts reconcile | `deals.link-quote` relation | build new | test |
| Acceptance: partner-sourced revenue = closed-won quote value and MRR | quotes totals + subscription.mrr | build new | test |
| Acceptance: user without finance cannot see revenue | capability guard | build new | test |
| Acceptance: partner statement contains no other partner's data | per-partner query + test | build new | — |
| Acceptance: merchants with missing data listed with reason and days outstanding | PRD A `missing` + `data_through` on `report_gen_report` | extend | days outstanding = today − last sync |
| Acceptance: no partnership or finance field in any merchant report | `whitelist.BLOCKED_KEY_RE` (`partner.*`, `quote.*`, `pipeline.*`, `payout.*`, `commission.*`, `billed.*`, `mrr`) | reuse | — |

## 4. PRD B · 118 partnership-facing metrics

| ID · metric | Phase | Where it comes from | Status | Notes |
|---|---|---|---|---|
| **Partnerships (PRT)** | | | | partner = `deals.organization`; referred merchant lead = `deals.deal` (`models/deals.py`) |
| PRT01 Lead volume by partner | P1 | `deal.created_at`, `deal.organization_id` | extend | — |
| PRT02 Qualified leads and rate | P1 | deal stage ≥ Contacted (assumption; rule undefined) | extend | open question in PRD |
| PRT03 Lead source mix | P1 | `deal.source` / organization type | extend | — |
| PRT04 Pipeline by stage | P1 | deal stage enum; `GET /deals/board` | extend | stages differ from the PRD's six; map |
| PRT05 Stage conversion | P1 | stage change events | extend | assumption: deal notes/events carry stage changes |
| PRT06 Lead-to-won rate | P1 | won ÷ created, by partner and month | extend | — |
| PRT07 Time to first contact | P1 | first note/event after creation | extend | assumption, verify `deals/service.py` |
| PRT08 Time to close | P2 | won date − created | extend | — |
| PRT09 Stale leads > 14 days | P1 | last event date | extend | — |
| PRT10 Lost reasons | P2 | lost reason field (assumption) | extend | verify field exists |
| PRT11 Partner-sourced revenue (MRR, ACV) | P1 | linked quote value + `subscription.mrr` of the created merchant | extend | — |
| PRT12 Active partners | P2 | organizations with ≥ 1 deal in month | extend | — |
| PRT13 Partner updates | P1 | organization notes (`POST /organizations/{id}/notes`) | extend | — |
| PRT14 Partner payout | P2 | no payout rules or amounts | blocked | open question in PRD |
| PRT15 90-day retention | P2 | merchant `status` + `go_live_date` of partner-sourced merchants | extend | — |
| PRT16 Partner-sourced merchant performance | P2 | sums over those merchants' `report_gen_snapshot` figures | build new | reads our own snapshots |
| PRT17 Partner statement | P2 | per-organization slice | build new | PFR10 |
| **Quotes (QUO)** | | | | `quotes.quote_request`, `quote_revision`, `quote_signature`, `quote_event`, `quote_link` |
| QUO01 Quotes created | P1 | `quote_request.created_at`, owner, link partner | extend | — |
| QUO02 Quotes sent | P1 | `quote_link` sent events | extend | — |
| QUO03 Quotes approved (internal) | P1 | discount approval events (`quotes.discount`) | extend | assumption on event type |
| QUO04 Quotes accepted (merchant) | P1 | `quote_signature` | extend | — |
| QUO05 Quotes closed won | P1 | deal/merchant created from the quote | extend | assumption: `deals.link-quote` |
| QUO06 Closed lost or expired | P1 | decline event, `valid_until` | extend | — |
| QUO07 Quote-to-close rate | P1 | derived | extend | — |
| QUO08 Quote value | P1 | revision totals, recurring vs one-time lines | extend | — |
| QUO09 Discount given | P2 | list vs price per line (`quotes/pricing.py`) | extend | — |
| QUO10 Time to approval | P2 | event timestamps | extend | — |
| QUO11 Time to close | P1 | event timestamps | extend | — |
| QUO12 Open quote ageing | P1 | age bands over open requests | extend | — |
| QUO13 Module mix | P2 | line items | extend | — |
| QUO14 Partner-sourced share | P1 | quote ↔ deal ↔ organization | extend | — |
| **Payments (PAY)** | | | | `payments.merchant_payment` (contract, charged, variance, status), `subscription.mrr`; finance-only |
| PAY01 Billed | P1 | `contract_amount` (assumption: billed = contract) | extend | — |
| PAY02 Charged | P1 | `charged_amount` | extend | — |
| PAY03 Leakage | P1 | `variance` or billed − charged | extend | — |
| PAY04 Margin | P2 | no cost-to-serve data | blocked | — |
| PAY05 Recurring revenue MRR/ARR by module | P1 | `subscription.mrr` (total only; no per-module split) | extend | by module blocked; print total |
| PAY06 Revenue churn | P1 | `merchant_churn.mrr_at_churn`, `churned_on` vs opening MRR | extend | opening MRR = sum of current mrr of merchants active at month start (approximation; no mrr history) |
| PAY07 Net revenue retention | P2 | needs 12 months of MRR history; only current `mrr` stored | blocked | — |
| PAY08 Failed and overdue payments | P1 | `merchant_payment.status` free text ("Paused", "Not live yet") | extend | assumption: status values include unpaid states |
| PAY09 Unpaid accounts | P1 | same | extend | marked "live today" in the PRD |
| PAY10 Credits and discounts | P2 | nothing | blocked | — |
| PAY11 Contract vs billed | P1 | `merchant_service` vs `merchant_payment.package_type` | extend | — |
| PAY12 Churn-risk flags | P2 | combination rule | build new | PFR09 score |
| PAY13 Payment volume | P2 | nothing | blocked | — |
| **Ops & Delivery (OPS07–OPS17)** | | | | `ops.ticket`, `ticket_event`, SLA columns, `ops/reports.py` |
| OPS07 Tickets opened and closed, backlog | P1 | `created_at`, `completed_at`, status | extend | — |
| OPS08 Ticket ageing | P1 | age bands over open tickets | extend | — |
| OPS09 SLA compliance, breaches | P1 | `resolution_due_at`, `completed_at`, `ops/sla.py` | extend | — |
| OPS10 First response time | P2 | `first_response_at − created_at` | extend | — |
| OPS11 On-time delivery | P1 | `completed_at ≤ due_date` | extend | — |
| OPS12 Workload per person | P1 | `GET /ops/reports` team report (`ops/reports.py:52`) | reuse | team-lead only |
| OPS13 Availability | P2 | `ops.app_setting` availability snapshot (`ops/availability.py`) | extend | team-lead only |
| OPS14 Meeting coverage | P2 | `ops.meeting` date + merchant | extend | date only |
| OPS15 Change hit rate | P2 | no change log | blocked | — |
| OPS16 Open issues by severity and age | P1 | `/issues` derived at read time; SLA notices in `ops.notification` | extend | assumption: count the derived issues; no age without storage |
| OPS17 Reopened tickets | P2 | `ticket_event` DONE → other status | extend | — |
| **Reporting Engine (REP02–REP12)** | | | | our own tables |
| REP02 Reports by status | P1 | `GET /report-gen/status` counts | extend | per month |
| REP03 On-time delivery | P1 | `sent_at` vs window (report day per merchant) | build new | needs `report_gen_merchant_settings.report_day` (Phase 2) |
| REP04 Reports held | P1 | draft with `missing` containing sales reason | build new | "held" = draft whose Sales section is not supplied; no new status |
| REP05 Manual edits per report | P2 | count `report_gen_audit.action = 'edit'` | extend | — |
| REP06 Time to send | P2 | `sent_at − period_end` | extend | — |
| REP07 Corrections reissued | P2 | re-approval after sent | build new | new transition `sent → draft (correction)`; P2 |
| REP08 Report engagement | P2 | no open/download tracking | blocked | — |
| REP09 Report coverage | P1 | sent ÷ active merchants | extend | — |
| REP10 Data freshness at generation | P1 | `report_gen_report.data_through` | reuse | — |
| REP11 Portfolio roll-up | P1 | sum over snapshots | extend | — |
| REP12 Merchant health score | P2 | weights not agreed | blocked | — |
| **Merchants & Data Quality (DQ)** | | | | |
| DQ01 Profile completeness | P1 | `merchant.profile_completion_pct` | reuse | — |
| DQ02 Missing fields | P1 | `GET /merchants/{id}/alerts`, completeness calculator | extend | — |
| DQ03 Connection status with last sync | P1 | `seo_site.last_gsc_date`, `ads_account.last_synced_at`, `gbp_location.last_synced_at`, Fathom/Teams settings | extend | sales feed and Meta always "not connected" |
| DQ04 Report-ready merchants | P1 | `package_switch()` vs links per merchant | build new | derived in our module |
| DQ05 Stale profile data | P2 | `merchant_menu.updated_at`, location hours updated_at | extend | assumption |
| DQ06 Conflicting data | P1 | linking engine name/host/phone comparison (`linking/engine.py:170-210`) | extend | same logic as GBP17 |
| DQ07 Service package | P1 | `merchant_service` + `catalog.service` | reuse | — |
| DQ08 Corrections pending | P2 | nothing records data-fix items (`access_item` is access, not fixes) | blocked | — |
| **Search and blogs health (SEO23–SEO30)** | | | | |
| SEO23 Search Console coverage | P1 | merchants with SEO service and a `seo_site.gsc_property` with data | extend | — |
| SEO24 Merchants without search data, reason, days | P1 | `seo_site` without property / `sync_error` | extend | "live today" |
| SEO25 Blogs delivered vs contracted | P1 | published ÷ `entitlement.qty_per_period` | extend | — |
| SEO26 Open audit issues by age | P1 | `seo_finding` open, `created_at` | extend | — |
| SEO27 Fix backlog | P2 | `seo_finding` state transitions, `closed_at` | extend | — |
| SEO28 Click decline alert > 20% MoM | P1 | `gsc_window` month vs month | extend | daily refresh: compute from stored daily rows |
| SEO29 Content health | P2 | `seo_crawl_issue` duplicates/stray URLs | extend | — |
| SEO30 Data freshness | P1 | `seo_site.last_synced_at`, `last_crawl_at` | extend | — |
| **Website health (WEB14–WEB19)** | | | | |
| WEB14 Sites created, published, live | P1 | `profiling.website.status` lifecycle | extend | — |
| WEB15 Time to publish | P2 | website `created_at` → live timestamp | extend | assumption that the live transition is timestamped |
| WEB16 Tracking connected | P1 | live sites with `seo_site.ga4_property` | extend | order-link tagging not tracked |
| WEB17 Menu freshness | P2 | nothing links site menu to profile menu | blocked | — |
| WEB18 Uptime incidents | P2 | nothing | blocked | — |
| WEB19 Edit request turnaround | P2 | `ops.ticket` type WEBSITE: `created_at` → `completed_at` | extend | — |
| **Business Profile health (GBP13–GBP18)** | | | | |
| GBP13 Verified profiles | P1 | `gbp_location.verification` | extend | — |
| GBP14 Suspended or unverified | P1 | `open_status`, `verification`, `updated_at` | extend | — |
| GBP15 Low-completeness locations | P1 | `profile.pct(profile_fields) < 70` | extend | threshold proposed |
| GBP16 Action decline alert | P1 | `aggregate()` month vs month | extend | — |
| GBP17 Information mismatch | P1 | listing fields vs `profiling.location` (linking engine comparisons) | extend | — |
| GBP18 Sync freshness | P1 | `gbp_location.last_synced_at` | extend | — |
| **Ads health (ADS16–ADS21)** | | | | |
| ADS16 Accounts connected | P1 | `ads_account.merchant_id` ÷ merchants "with ads in scope" | extend | scope undefined; assumption: `merchant.google_ads_budget` or `ads_paid_by` set |
| ADS17 Conversion tracking health | P1 | spend > 0 and orders = 0 over the month | extend | "live today" |
| ADS18 Budget alignment ± 20% | P1 | `calc.Budget` mismatch alert (`ads/calc.py:217-271`) | reuse | tolerance setting `ADS_BUDGET_TOLERANCE_PCT` |
| ADS19 Wasted spend | P2 | search terms not synced | blocked | — |
| ADS20 Ad policy issues | P2 | `google_status`, `verification`, `sync_error` | extend | disapproved ads not read |
| ADS21 Portfolio ad totals | P1 | `GET /ads/portfolio` (`ads/reports.py`) | reuse | — |
| **Messaging health (ESM15–ESM20)** | | | | |
| ESM15 Campaign active rate | P1 | no module | blocked | — |
| ESM16 Dormant lists | P1 | no module | blocked | — |
| ESM17 Tracking gap flag | P1 | no module | blocked | "live today" by hand |
| ESM18 Baseline comparison | P1 | no module | blocked | — |
| ESM19 Deliverability | P2 | no module | blocked | — |
| ESM20 Messaging spend vs allowance | P2 | no module | blocked | — |
| **Reviews health (REV12–REV15)** | | | | |
| REV12 Unanswered negative reviews by age | P1 | `gbp_review.star_rating ≤ 3 and not has_reply` | extend | — |
| REV13 Rating drop alert ≥ 0.2 | P1 | monthly mean of `star_rating` | extend | — |
| REV14 Low-rating merchants < 4.0 | P2 | `gbp_location.rating_average` | extend | — |
| REV15 Program adoption | P2 | `merchant_service` Review Management / Google Review Badge | extend | — |
| **Rewards health (RWD12–RWD15)** | | | | |
| RWD12 Programs live | P1 | `merchant_service` Rewards ACTIVE ÷ eligible (package $299) | extend | proxy until the module exists |
| RWD13 Rollout stage | P1 | `delivery_item.status` for Rewards | extend | proxy |
| RWD14 Zero-member programs | P1 | needs member counts | blocked | — |
| RWD15 Member benchmark | P2 | needs member counts | blocked | — |
| **Sales health (SAL15–SAL18)** | | | | |
| SAL15 Sales data coverage | P1 | days with data in `report_gen_sales_month` ÷ days | build new | with the sales upload |
| SAL16 Low-sales flag | P1 | needs sales + agreed floor | blocked | — |
| SAL17 Refund alert | P1 | needs sales | blocked | — |
| SAL18 Portfolio sales totals | P1 | needs sales | blocked | — |

### PRD B metric totals

| Status | Count (118) |
|---|---|
| reuse | 6 |
| extend | 81 |
| build new | 8 |
| blocked | 23 |

## 5. Roadmap and prototype items that are requirements too

| Item | Source | Where it comes from in the code | Status | Notes |
|---|---|---|---|---|
| Status flow Generating → Ready for approval → Needs changes → Approved → Sent → Failed | roadmap Phase 1 | `service.py` `generating → draft → edited → approved → sent / failed / deleted` | reuse | "Ready for approval" = draft, "Needs changes" = edited (the reviewer edits in place; no reject state); prototype "Due" = no row, "Held" = draft with sales missing |
| Pre-approval view showing included and hidden sections | roadmap Phase 1 | `snapshot.sections[*].included`; review page renders included only | extend | add a "Sections" chip row (included / hidden) in `review-page.tsx` |
| Ad revenue labelled | roadmap | tag `modelled` | reuse | word "modelled" per PRD A, not "Estimated" |
| Sales by monthly CSV upload as a stopgap | roadmap Phase 1 | nothing; pattern `merchant_profiling/payments_import.py` | build new | Phase 2 in this plan (see blueprint) |
| Live sales feed, channel mix, per-day, outlier flags | roadmap Phase 2 | nothing | blocked | integration project; "backend portal must be connected" (Zainab's edit) |
| Next-month targets | roadmap Phase 2 | `narrative.recommendations()` has a `target` per recommendation | reuse | numeric targets per metric need the sales source |
| 3-month report | roadmap Phase 2 | `TEMPLATES` has `multi_month` | extend | MFR12 |
| Per-merchant report day and scheduler | roadmap Phase 2 | `report_gen_merchant_settings.report_day` exists; no job | build new | `report-gen` job + cron row |
| Link Ads and SEO accounts to merchants (9 accounts, 23 sites) | roadmap Phase 0 | `GET/POST /merchants/{id}/links` (`linking/connector.py:117-205`), Data setup | reuse | data clean-up on the hosted DB, needs a named owner |
| Recipients, CC, report day, service flags on the merchant record | roadmap Phase 0 | `report_gen_merchant_settings` table (no routes) | extend | Phase 2 routes + panel; `profiling.merchant` untouched |
| Generate all due | prototype RH-REP-10 | nothing; `report_gen_run` table | build new | Phase 1 job |
| PDF / DOCX buttons from the frozen snapshot | prototype | nothing | build new | Phase 1 PDF, Phase 2 DOCX |
| Preview as merchant (hide IDs) | prototype RH-REP-08 | `GET /report-gen/reports/{id}/preview` strips recipients and edit marks | extend | print page outside the shell |
| Reports Hub pages: Dashboard, Restaurants, Compare, Customers, Alerts, Catalogue | Hub PRD v1.1 / prototype | none; Customers needs a customer id on orders | blocked | out of the 4-week MVP; Customers is blocked on the sales feed |
