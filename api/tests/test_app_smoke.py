"""App-level smoke tests: the app builds, OpenAPI generates, docs render, and
every endpoint from docs/API_REFERENCE.md's index is present. No live DB
required — these only exercise route registration and schema generation."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EXPECTED_ENDPOINTS = [
    ("POST", "/api/v1/merchants"), ("GET", "/api/v1/merchants"), ("GET", "/api/v1/merchants/{id}"),
    ("PATCH", "/api/v1/merchants/{id}"), ("DELETE", "/api/v1/merchants/{id}"),
    ("GET", "/api/v1/merchants/{id}/profile"), ("GET", "/api/v1/merchants/{id}/fields"),
    ("PATCH", "/api/v1/merchants/{id}/fields/{key}"),
    ("GET", "/api/v1/merchants/{merchant_id}/contacts"), ("POST", "/api/v1/merchants/{merchant_id}/contacts"),
    ("PATCH", "/api/v1/contacts/{id}"), ("DELETE", "/api/v1/contacts/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/locations"), ("POST", "/api/v1/merchants/{merchant_id}/locations"),
    ("PATCH", "/api/v1/locations/{id}"), ("DELETE", "/api/v1/locations/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/services"), ("POST", "/api/v1/merchants/{merchant_id}/services"),
    ("PATCH", "/api/v1/services/{id}"), ("DELETE", "/api/v1/services/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/documents"), ("POST", "/api/v1/merchants/{merchant_id}/documents"),
    ("PATCH", "/api/v1/documents/{id}"), ("DELETE", "/api/v1/documents/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/connections"), ("POST", "/api/v1/merchants/{merchant_id}/connections"),
    ("PATCH", "/api/v1/connections/{id}"), ("DELETE", "/api/v1/connections/{id}"),
    ("GET", "/api/v1/packages"), ("GET", "/api/v1/packages/{code}"), ("GET", "/api/v1/packages/{code}/entitlements"),
    ("GET", "/api/v1/services"), ("GET", "/api/v1/services/{id}"), ("GET", "/api/v1/entitlements"),
    ("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/refresh"), ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/auth/logout-all"), ("GET", "/api/v1/auth/me"), ("POST", "/api/v1/auth/change-password"),
    ("POST", "/api/v1/users"), ("GET", "/api/v1/users"), ("GET", "/api/v1/users/{id}"),
    ("PATCH", "/api/v1/users/{id}"), ("DELETE", "/api/v1/users/{id}"),
    ("GET", "/api/v1/audit-logs"), ("GET", "/api/v1/merchants/{id}/history"),
    ("GET", "/api/v1/merchants/{id}/completeness"), ("GET", "/api/v1/merchants/{id}/alerts"),
    ("GET", "/api/v1/merchants/{merchant_id}/keywords"), ("POST", "/api/v1/merchants/{merchant_id}/keywords"),
    ("PATCH", "/api/v1/keywords/{id}"), ("DELETE", "/api/v1/keywords/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/competitors"), ("POST", "/api/v1/merchants/{merchant_id}/competitors"),
    ("PATCH", "/api/v1/competitors/{id}"), ("DELETE", "/api/v1/competitors/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/brand-profile"), ("PATCH", "/api/v1/merchants/{merchant_id}/brand-profile"),
    ("GET", "/api/v1/merchants/{merchant_id}/catering-profile"), ("PATCH", "/api/v1/merchants/{merchant_id}/catering-profile"),
    ("GET", "/api/v1/account-managers"), ("GET", "/api/v1/account-managers/{id}"),
    ("POST", "/api/v1/account-managers"), ("PATCH", "/api/v1/account-managers/{id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/subscription"), ("PATCH", "/api/v1/merchants/{merchant_id}/subscription"),
    ("GET", "/api/v1/profiling/data-quality"),
    ("GET", "/api/v1/merchants/{merchant_id}/promotions"), ("POST", "/api/v1/merchants/{merchant_id}/promotions"),
    ("PATCH", "/api/v1/promotions/{id}"), ("DELETE", "/api/v1/promotions/{id}"), ("POST", "/api/v1/merchants/{id}/fields/{key}/attest"),
    ("POST", "/api/v1/merchants/{merchant_id}/documents/upload"), ("GET", "/api/v1/documents/{id}/download"),
    ("GET", "/api/v1/merchants/{merchant_id}/brand-assets"), ("POST", "/api/v1/merchants/{merchant_id}/brand-assets/upload"),
    ("PATCH", "/api/v1/brand-assets/{id}"), ("DELETE", "/api/v1/brand-assets/{id}"),
    ("GET", "/api/v1/brand-assets/{id}/download"),
    ("GET", "/api/v1/merchants/{merchant_id}/menu"), ("POST", "/api/v1/merchants/{merchant_id}/menu/extract"),
    # Merchants → Import from XLS / CSV, and menus across merchants (2026-10-23)
    ("POST", "/api/v1/merchants/import"), ("GET", "/api/v1/merchant-menus"), ("POST", "/api/v1/merchant-menus/check"),
    ("POST", "/api/v1/merchant-menus/fetch"), ("PUT", "/api/v1/merchant-menus/{merchant_id}/link"),
    # Merchants → Payments: the monthly revenue report (2026-10-23)
    ("POST", "/api/v1/merchant-payments/import"), ("GET", "/api/v1/merchants/{merchant_id}/payments"),
    ("POST", "/api/v1/merchants/{merchant_id}/payments"), ("PATCH", "/api/v1/merchant-payments/{payment_id}"),
    ("DELETE", "/api/v1/merchant-payments/{payment_id}"),
    # Merchant connector: settings + each merchant's SEO / Ads / GBP links (2026-10-23)
    ("GET", "/api/v1/settings/connector"), ("PUT", "/api/v1/settings/connector"), ("POST", "/api/v1/merchants/connect"),
    ("GET", "/api/v1/merchants/{merchant_id}/links"), ("GET", "/api/v1/merchants/{merchant_id}/links/search"),
    ("POST", "/api/v1/merchants/{merchant_id}/links"), ("DELETE", "/api/v1/merchants/{merchant_id}/links/{module}/{entity_id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/menu/export"),
    # Websites — ported from the standalone website-api service.
    ("GET", "/api/v1/websites"), ("POST", "/api/v1/websites"), ("GET", "/api/v1/websites/{key}"),
    ("PATCH", "/api/v1/websites/{key}"), ("DELETE", "/api/v1/websites/{key}"),
    ("POST", "/api/v1/websites/import-docx"), ("POST", "/api/v1/websites/assets"),
    ("GET", "/api/v1/websites/assets/{key}"),
    ("POST", "/api/v1/websites/{key}/admin/login"), ("GET", "/api/v1/websites/{key}/admin/session"),
    ("GET", "/api/v1/websites/{key}/content"), ("PUT", "/api/v1/websites/{key}/content"),
    ("DELETE", "/api/v1/websites/{key}/content"), ("POST", "/api/v1/websites/{key}/content/assets"),
    # Website <-> Merchant link (modules/websites/merchant_link.py)
    ("GET", "/api/v1/websites/{key}/merchant-suggestions"), ("GET", "/api/v1/websites/{key}/link-preview"),
    ("POST", "/api/v1/websites/{key}/link"), ("DELETE", "/api/v1/websites/{key}/link"),
    ("POST", "/api/v1/websites/{key}/merchant"),
    ("GET", "/api/v1/merchants/{merchant_id}/websites"), ("GET", "/api/v1/merchants/{merchant_id}/website-prefill"),
    ("POST", "/api/v1/websites/{key}/preview-link"),
    # Partner leads (modules/partner_leads) — applications from partners.innowi.com
    ("GET", "/api/v1/partner-leads"), ("GET", "/api/v1/partner-leads/summary"), ("GET", "/api/v1/partner-leads/team"),
    ("PATCH", "/api/v1/partner-leads/team/{email}"), ("POST", "/api/v1/public/partner-leads/action"),
    ("GET", "/api/v1/partner-leads/{id}"), ("PATCH", "/api/v1/partner-leads/{id}"),
    ("POST", "/api/v1/partner-leads/{id}/notes"),
    # Partner network (contacts): app/modules/partner_contacts
    ("GET", "/api/v1/partner-contacts"), ("GET", "/api/v1/partner-contacts/summary"),
    ("GET", "/api/v1/partner-contacts/{id}"), ("POST", "/api/v1/partner-contacts"),
    ("PATCH", "/api/v1/partner-contacts/{id}"), ("POST", "/api/v1/partner-contacts/{id}/promote"),
    # Quote builder: staff (16) + public restaurant page (6).
    ("GET", "/api/v1/quotes/price-list"), ("POST", "/api/v1/quotes/price-list"), ("PATCH", "/api/v1/quotes/price-list/{id}"),
    ("GET", "/api/v1/quotes/sections"), ("GET", "/api/v1/quotes/summary"),
    ("GET", "/api/v1/quotes/links"), ("POST", "/api/v1/quotes/links"), ("GET", "/api/v1/quotes/links/{id}"),
    ("PATCH", "/api/v1/quotes/links/{id}"), ("POST", "/api/v1/quotes/links/{id}/revoke"),
    ("POST", "/api/v1/quotes/links/{id}/new-url"), ("POST", "/api/v1/quotes/links/{id}/price"),
    ("GET", "/api/v1/quotes/requests"), ("GET", "/api/v1/quotes/requests/{id}"), ("PATCH", "/api/v1/quotes/requests/{id}"),
    ("GET", "/api/v1/quotes/requests/{id}/pdf"),
    ("GET", "/api/v1/public/quotes/{token}"), ("POST", "/api/v1/public/quotes/{token}/price"),
    ("POST", "/api/v1/public/quotes/{token}/requests"), ("GET", "/api/v1/public/quotes/{token}/requests/{id}"),
    ("POST", "/api/v1/public/quotes/{token}/requests/{id}/sign"), ("GET", "/api/v1/public/quotes/{token}/requests/{id}/pdf"),
    ("POST", "/api/v1/public/quotes/{token}/requests/{id}/decline"),
    ("POST", "/api/v1/quotes/requests/{id}/revise"), ("POST", "/api/v1/quotes/requests/{id}/countersign"),
    # AI assistant (modules/assistant)
    ("GET", "/api/v1/assistant/status"), ("GET", "/api/v1/assistant/chats"), ("GET", "/api/v1/assistant/chats/{chat_id}"),
    ("PATCH", "/api/v1/assistant/chats/{chat_id}"), ("DELETE", "/api/v1/assistant/chats/{chat_id}"),
    ("POST", "/api/v1/assistant/chat"),
    ("GET", "/api/v1/assistant/actions/{action_id}"), ("POST", "/api/v1/assistant/actions/{action_id}/confirm"), ("POST", "/api/v1/assistant/actions/{action_id}/cancel"),
    ("DELETE", "/api/v1/partner-leads/{id}"),
    # Roadmap (modules/roadmap)
    ("GET", "/api/v1/roadmap"), ("POST", "/api/v1/roadmap/phases"), ("PATCH", "/api/v1/roadmap/phases/{phase_id}"),
    ("DELETE", "/api/v1/roadmap/phases/{phase_id}"), ("POST", "/api/v1/roadmap/items"),
    ("PATCH", "/api/v1/roadmap/items/{item_id}"), ("DELETE", "/api/v1/roadmap/items/{item_id}"),
    # Team requests (modules/requests)
    ("GET", "/api/v1/requests"), ("POST", "/api/v1/requests"), ("GET", "/api/v1/requests/{ref}"),
    ("PATCH", "/api/v1/requests/{ref}"), ("POST", "/api/v1/requests/{ref}/vote"), ("DELETE", "/api/v1/requests/{ref}/vote"),
    ("POST", "/api/v1/requests/{ref}/comments"), ("POST", "/api/v1/requests/{ref}/status"),
    ("POST", "/api/v1/requests/{ref}/approve"),
    # Churned accounts (modules/churn)
    ("GET", "/api/v1/churn"), ("GET", "/api/v1/churn/summary"), ("POST", "/api/v1/churn/import"),
    ("GET", "/api/v1/churn/{merchant_id}"), ("POST", "/api/v1/churn/{merchant_id}"),
    ("PATCH", "/api/v1/churn/{merchant_id}"), ("POST", "/api/v1/churn/{merchant_id}/notes"),
    # The spine: organizations + deals (modules/deals)
    ("GET", "/api/v1/organizations"), ("POST", "/api/v1/organizations"), ("GET", "/api/v1/organizations/{org_id}"),
    ("PATCH", "/api/v1/organizations/{org_id}"), ("POST", "/api/v1/organizations/{org_id}/contacts"),
    ("PATCH", "/api/v1/organizations/{org_id}/contacts/{contact_id}"),
    ("DELETE", "/api/v1/organizations/{org_id}/contacts/{contact_id}"),
    # The partner ladder (2026-10-27): bulk assignment, an ISO's agents, notes, lead/card -> organization.
    ("POST", "/api/v1/organizations/assign"), ("GET", "/api/v1/organizations/links"),
    ("POST", "/api/v1/organizations/from-lead/{lead_id}"), ("POST", "/api/v1/organizations/from-card/{contact_id}"),
    ("POST", "/api/v1/organizations/{org_id}/agents"), ("POST", "/api/v1/organizations/{org_id}/notes"),
    ("GET", "/api/v1/deals"), ("GET", "/api/v1/deals/board"), ("GET", "/api/v1/deals/merchant-search"),
    ("POST", "/api/v1/deals"), ("GET", "/api/v1/deals/{deal_id}"),
    ("PATCH", "/api/v1/deals/{deal_id}"), ("POST", "/api/v1/deals/{deal_id}/notes"), ("POST", "/api/v1/deals/{deal_id}/link-quote"),
    # Invitations (modules/invitations)
    ("POST", "/api/v1/invitations"), ("GET", "/api/v1/invitations"), ("POST", "/api/v1/invitations/{id}/resend"),
    ("DELETE", "/api/v1/invitations/{id}"), ("GET", "/api/v1/auth/invitations/{token}"),
    ("POST", "/api/v1/auth/invitations/accept"),
    # Liveness probe, outside the versioned prefix.
    ("GET", "/health"),
    # Sales module (Salesforce copy). POST /sales/sync/cron is deliberately
    # left out of the OpenAPI document (scheduler-only, token-protected).
    ("GET", "/api/v1/sales/me"),
    ("GET", "/api/v1/sales/summary"),
    ("GET", "/api/v1/sales/insights"),
    ("GET", "/api/v1/sales/pipeline"),
    ("GET", "/api/v1/sales/deals"),
    ("GET", "/api/v1/sales/deals/{deal_id}"),
    ("GET", "/api/v1/sales/customers"),
    ("GET", "/api/v1/sales/customers/{account_id}"),
    ("GET", "/api/v1/sales/visits"),
    ("GET", "/api/v1/sales/visit-types"),
    ("GET", "/api/v1/sales/cases"), ("GET", "/api/v1/sales/cases/insights"),
    ("GET", "/api/v1/sales/owners"),
    ("GET", "/api/v1/sales/team"),
    ("GET", "/api/v1/sales/people"),
    ("POST", "/api/v1/sales/people/{sf_user_id}/login"),
    ("PUT", "/api/v1/sales/people/{sf_user_id}/link"),
    ("DELETE", "/api/v1/sales/people/{sf_user_id}/link"),
    ("GET", "/api/v1/sales/sync"),
    ("POST", "/api/v1/sales/sync/run"),
    # Ops CRM tickets (modules/ops/router.py)
    ("GET", "/api/v1/ops/catalog"), ("GET", "/api/v1/ops/people"),
    ("GET", "/api/v1/ops/projects"), ("POST", "/api/v1/ops/projects"),
    ("GET", "/api/v1/ops/tickets"), ("POST", "/api/v1/ops/tickets"), ("GET", "/api/v1/ops/tickets/counts"),
    ("GET", "/api/v1/ops/tickets/{key}"), ("PATCH", "/api/v1/ops/tickets/{key}"), ("DELETE", "/api/v1/ops/tickets/{key}"),
    ("POST", "/api/v1/ops/tickets/{key}/subtasks"), ("PATCH", "/api/v1/ops/subtasks/{subtask_id}"),
    ("DELETE", "/api/v1/ops/subtasks/{subtask_id}"),
    ("GET", "/api/v1/ops/tickets/{key}/activity"), ("POST", "/api/v1/ops/tickets/{key}/comments"),
    # Ops CRM reports (modules/ops/reports.py) and library + vault (modules/ops/library.py)
    ("GET", "/api/v1/ops/reports"), ("GET", "/api/v1/ops/tickets/export"),
    ("GET", "/api/v1/ops/library"), ("POST", "/api/v1/ops/library"), ("GET", "/api/v1/ops/library/{page_id}"),
    ("PATCH", "/api/v1/ops/library/{page_id}"), ("DELETE", "/api/v1/ops/library/{page_id}"),
    ("GET", "/api/v1/ops/library/{page_id}/versions"),
    ("GET", "/api/v1/ops/credentials"), ("POST", "/api/v1/ops/credentials"),
    ("PATCH", "/api/v1/ops/credentials/{cred_id}"), ("DELETE", "/api/v1/ops/credentials/{cred_id}"),
    ("POST", "/api/v1/ops/credentials/{cred_id}/reveal"), ("GET", "/api/v1/ops/credentials/log"),
    # Settings
    ("PATCH", "/api/v1/ops/projects/{project_id}"), ("POST", "/api/v1/users/{id}/reset-password"),
    ("GET", "/api/v1/settings/me"), ("PATCH", "/api/v1/settings/me"),
    ("GET", "/api/v1/settings/me/sessions"), ("DELETE", "/api/v1/settings/me/sessions/{session_id}"),
    ("GET", "/api/v1/settings/workspace"), ("PUT", "/api/v1/settings/workspace"),
    ("GET", "/api/v1/settings/sla"), ("PUT", "/api/v1/settings/sla"), ("DELETE", "/api/v1/settings/sla"),
    ("GET", "/api/v1/settings/integrations"),
    # Meetings (Fathom)
    ("GET", "/api/v1/ops/meetings"), ("GET", "/api/v1/ops/meetings/status"), ("POST", "/api/v1/ops/meetings/sync"),
    ("GET", "/api/v1/ops/meetings/{meeting_id}"), ("PATCH", "/api/v1/ops/meetings/{meeting_id}"),
    ("DELETE", "/api/v1/ops/meetings/{meeting_id}"),
    ("POST", "/api/v1/ops/meetings/{meeting_id}/actions/{action_id}/dismiss"),
    ("POST", "/api/v1/ops/meetings/{meeting_id}/actions/{action_id}/reopen"),
    ("POST", "/api/v1/integrations/fathom/webhook"),
    # Ticket attachments, watchers, notifications
    ("GET", "/api/v1/ops/tickets/{key}/attachments"), ("POST", "/api/v1/ops/tickets/{key}/attachments"),
    ("GET", "/api/v1/ops/attachments/{attachment_id}/download"), ("DELETE", "/api/v1/ops/attachments/{attachment_id}"),
    ("POST", "/api/v1/ops/tickets/{key}/watchers"), ("DELETE", "/api/v1/ops/tickets/{key}/watchers/{user_id}"),
    ("GET", "/api/v1/ops/notifications"), ("POST", "/api/v1/ops/notifications/read"),
    # Library links, saved views, catch-up
    ("POST", "/api/v1/ops/tickets/{key}/library"), ("DELETE", "/api/v1/ops/tickets/{key}/library/{page_id}"),
    ("GET", "/api/v1/ops/views"), ("POST", "/api/v1/ops/views"), ("DELETE", "/api/v1/ops/views/{view_id}"),
    ("GET", "/api/v1/ops/catch-up"), ("POST", "/api/v1/ops/catch-up/dismiss"), ("GET", "/api/v1/ops/handover"),
    ("GET", "/api/v1/ops/teams/status"), ("POST", "/api/v1/ops/teams/test"), ("POST", "/api/v1/ops/teams/digest"),
    ("POST", "/api/v1/ops/teams/meeting"), ("GET", "/api/v1/ops/teams/availability"),
    ("GET", "/api/v1/ops/teams/calendar"),
    # Google Business Profile reporting (/integrations/gbp/callback is a
    # browser redirect target and is left out of the OpenAPI document)
    ("GET", "/api/v1/gbp/status"), ("POST", "/api/v1/gbp/connect"), ("DELETE", "/api/v1/gbp/connection"),
    ("POST", "/api/v1/gbp/sync"), ("GET", "/api/v1/gbp/sync-runs"), ("GET", "/api/v1/gbp/overview"),
    ("GET", "/api/v1/gbp/locations/{location_id}/report"),
    ("GET", "/api/v1/gbp/locations/{location_id}/notes"), ("POST", "/api/v1/gbp/locations/{location_id}/notes"),
    ("PATCH", "/api/v1/gbp/notes/{note_id}"), ("DELETE", "/api/v1/gbp/notes/{note_id}"),
    ("GET", "/api/v1/gbp/locations/{location_id}/merchant-suggestions"),
    ("PUT", "/api/v1/gbp/locations/{location_id}/merchant"), ("DELETE", "/api/v1/gbp/locations/{location_id}/merchant"),
    ("GET", "/api/v1/merchants/{merchant_id}/gbp"),
    ("POST", "/api/v1/gbp/sample-data"), ("DELETE", "/api/v1/gbp/sample-data"),
    # Google Ads reporting (/integrations/google-ads/callback is a browser
    # redirect target, not in the OpenAPI document).
    ("GET", "/api/v1/ads/status"), ("POST", "/api/v1/ads/connect"), ("DELETE", "/api/v1/ads/connection"),
    ("POST", "/api/v1/ads/sync"), ("GET", "/api/v1/ads/sync-runs"),
    ("POST", "/api/v1/ads/sample-data"), ("DELETE", "/api/v1/ads/sample-data"),
    ("GET", "/api/v1/ads/portfolio"), ("GET", "/api/v1/ads/monthly-report"), ("GET", "/api/v1/ads/unmapped"),
    ("GET", "/api/v1/ads/accounts"), ("POST", "/api/v1/ads/accounts"), ("POST", "/api/v1/ads/accounts/import"),
    ("GET", "/api/v1/ads/accounts/{account_id}"), ("PATCH", "/api/v1/ads/accounts/{account_id}"),
    ("GET", "/api/v1/ads/accounts/{account_id}/assets"), ("GET", "/api/v1/ads/accounts/{account_id}/offers"),
    ("GET", "/api/v1/ads/accounts/{account_id}/breakdown"),
    ("GET", "/api/v1/ads/accounts/{account_id}/trend"),
    ("GET", "/api/v1/ads/accounts/{account_id}/merchant-suggestions"),
    ("PUT", "/api/v1/ads/accounts/{account_id}/merchant"), ("DELETE", "/api/v1/ads/accounts/{account_id}/merchant"),
    ("GET", "/api/v1/ads/accounts/{account_id}/comments"), ("POST", "/api/v1/ads/accounts/{account_id}/comments"),
    ("PATCH", "/api/v1/ads/comments/{comment_id}"), ("DELETE", "/api/v1/ads/comments/{comment_id}"),
    ("GET", "/api/v1/merchants/{merchant_id}/ads"),
    # SEO (modules/seo)
    ("GET", "/api/v1/seo/status"), ("POST", "/api/v1/seo/connect"), ("DELETE", "/api/v1/seo/connection"),
    ("POST", "/api/v1/seo/sync"), ("GET", "/api/v1/seo/sync-runs"),
    ("POST", "/api/v1/seo/sample-data"), ("DELETE", "/api/v1/seo/sample-data"),
    ("GET", "/api/v1/seo/overview"), ("GET", "/api/v1/seo/watchdog"),
    ("GET", "/api/v1/seo/sites"), ("POST", "/api/v1/seo/sites"),
    ("GET", "/api/v1/seo/sites/{site_id}"), ("PATCH", "/api/v1/seo/sites/{site_id}"), ("DELETE", "/api/v1/seo/sites/{site_id}"),
    ("GET", "/api/v1/seo/sites/{site_id}/pages"), ("POST", "/api/v1/seo/sites/{site_id}/rescore"), ("POST", "/api/v1/seo/sites/{site_id}/pagespeed"),
    ("GET", "/api/v1/seo/sites/{site_id}/crawl"), ("GET", "/api/v1/seo/sites/{site_id}/crawl/pages"),
    ("GET", "/api/v1/settings/data-setup/status"), ("POST", "/api/v1/settings/data-setup/refresh"),
    ("GET", "/api/v1/settings/data-setup/plan"), ("POST", "/api/v1/settings/data-setup/apply"),
    ("POST", "/api/v1/settings/data-setup/undo"), ("GET", "/api/v1/settings/data-setup/coverage"),
    ("GET", "/api/v1/seo/sites/{site_id}/keywords"), ("POST", "/api/v1/seo/sites/{site_id}/keywords"),
    ("DELETE", "/api/v1/seo/keywords/{keyword_id}"), ("GET", "/api/v1/seo/link-options"),
    ("GET", "/api/v1/seo/findings"), ("PATCH", "/api/v1/seo/findings/{finding_id}"),
    ("GET", "/api/v1/seo/reports/center"), ("POST", "/api/v1/seo/sites/{site_id}/reports"),
    ("GET", "/api/v1/seo/reports/{report_id}"), ("POST", "/api/v1/seo/reports/{report_id}/sign-off"),
    ("POST", "/api/v1/seo/reports/{report_id}/send"), ("POST", "/api/v1/seo/email/test"), ("PATCH", "/api/v1/seo/reports/{report_id}/next-steps"), ("PATCH", "/api/v1/seo/reports/{report_id}/summary"),
    ("GET", "/api/v1/seo/kpis"), ("POST", "/api/v1/seo/kpis"), ("PATCH", "/api/v1/seo/kpis/{key}"), ("DELETE", "/api/v1/seo/kpis/{key}"),
    ("GET", "/api/v1/seo/compare"), ("GET", "/api/v1/merchants/{merchant_id}/seo"),
    # SEO → Blog Impact (modules/seo/blog_router.py)
    ("GET", "/api/v1/seo/blogs/status"), ("PUT", "/api/v1/seo/blogs/schedule"), ("POST", "/api/v1/seo/blogs/refresh"),
    ("GET", "/api/v1/seo/blogs/runs"), ("GET", "/api/v1/seo/blogs/sites"), ("GET", "/api/v1/seo/blogs/sites/{site_id}"),
    ("PUT", "/api/v1/seo/blogs/sites/{site_id}/brand-terms"),
    # Screaming Frog crawler: helper.py (key in X-Crawler-Key) + the SEO pages / Settings
    ("GET", "/api/v1/seo/crawler/ping"),
    ("GET", "/api/v1/seo/crawler/next"),
    ("POST", "/api/v1/seo/crawler/jobs/{job_id}/status"),
    ("POST", "/api/v1/seo/crawler/jobs/{job_id}/result"),
    ("GET", "/api/v1/seo/crawler/status"),
    ("POST", "/api/v1/seo/crawler/crawl"),
    ("POST", "/api/v1/seo/crawler/jobs/{job_id}/cancel"),
    ("GET", "/api/v1/seo/crawler/keys"),
    ("POST", "/api/v1/seo/crawler/keys"),
    ("DELETE", "/api/v1/seo/crawler/keys/{key_id}"),
    # Merchant Reports (modules/report_gen) — registered always, 404 until REPORT_GEN_ENABLED
    ("GET", "/api/v1/report-gen/status"), ("GET", "/api/v1/report-gen/queue"),
    ("POST", "/api/v1/report-gen/merchants/{merchant_id}/reports"),
    ("GET", "/api/v1/report-gen/reports/{report_id}"), ("PATCH", "/api/v1/report-gen/reports/{report_id}/text"),
    ("POST", "/api/v1/report-gen/reports/{report_id}/approve"), ("DELETE", "/api/v1/report-gen/reports/{report_id}"),
    ("POST", "/api/v1/report-gen/reports/{report_id}/send"), ("GET", "/api/v1/report-gen/reports/{report_id}/preview"),
    ("GET", "/api/v1/report-gen/reports/{report_id}/export.pdf"),
    ("GET", "/api/v1/report-gen/reports/{report_id}/export.docx"),
]


def test_openapi_schema_generates():
    r = client.get("/api/openapi.json")
    assert r.status_code == 200
    schema = r.json()
    assert len(schema["paths"]) > 0


def test_swagger_docs_render():
    r = client.get("/api/docs")
    assert r.status_code == 200
    assert "swagger" in r.text.lower()


def _registered_routes():
    """Every (METHOD, path) the app actually publishes.

    Read off the generated OpenAPI document rather than by walking
    `app.routes`: FastAPI >= 0.141 includes sub-routers lazily as
    `_IncludedRouter` wrappers and the inner APIRoute objects carry their
    *unprefixed* path, so a naive walk sees two routes and makes every
    assertion here vacuous. The OpenAPI document is also the contract clients
    actually consume, so asserting against it is the stronger check.
    """
    schema = app.openapi()
    return {
        (method.upper(), path)
        for path, operations in schema["paths"].items()
        for method in operations
    }


def test_all_reference_endpoints_present():
    registered = _registered_routes()

    # Guard against the walker silently going blind again.
    assert len(registered) > 50, f"route walker found only {len(registered)} routes"

    missing = [e for e in EXPECTED_ENDPOINTS if e not in registered]
    assert not missing, f"Missing endpoints: {missing}"
    # 80 from the NestJS reference surface + 14 websites + 7 merchant-link + preview link + /health
    # + 6 partner leads + 6 partner contacts + 6 invitations + 19 Sales module + 22 quote builder
    # + 6 assistant, + 7 roadmap, + 3 assistant actions + 1 partner-lead delete, + 7 churned accounts.
    # + 2 partner-team (2026-10-19) = 181, + 155 from the Ops CRM / settings / GBP / Google Ads / SEO / menu /
    # data-setup import (2026-10-19),
    # + 1 case analysis (2026-10-20) = 337,
    # + 3 quote negotiation (revise, countersign, public decline; accept became sign, 2026-10-21) = 340,
    # + 7 churned accounts = 347, + 9 from the SEO branch (Blog Impact 7, PageSpeed / reports 2, 2026-10-22) = 356,
    # + 5 merchant import / menus across merchants + 7 merchant connector (2026-10-23) = 368,
    # + 5 merchant payments (revenue report import, a merchant's months, add / edit / delete by hand) = 373,
    # + 1 Google Ads daily trend (2026-10-23) = 374,
    # + 15 spine (7 organizations + 8 deals, 2026-10-23) = 389,
    # + 9 team requests (submit, list, detail, edit, upvote / un-vote, comment, status, approve; 2026-10-24) = 398.
    # + 6 Ops CRM Teams (status, test, digest, meeting, availability, calendar; 2026-10-27) = 404,
    # + 10 Screaming Frog crawler (4 for helper.py, status / crawl / cancel, 3 key management; 2026-10-27) = 414,
    # + 6 partner ladder (assign, links, from-lead, from-card, agents, notes; 2026-10-27) = 420,
    # + 9 Merchant Reports (status, queue, generate, read, text, approve, delete, send, preview; 2026-10-30) = 429.
    # (/integrations/teams/* is for the Power Automate flow, left out of the OpenAPI document.)
    # /jobs/{job} and the OAuth callbacks are deliberately left out of the OpenAPI document.
    assert len(set(EXPECTED_ENDPOINTS)) == len(EXPECTED_ENDPOINTS) == 431

    # And nothing undocumented crept in beyond the reference surface.
    extra = sorted(r for r in registered if r not in set(EXPECTED_ENDPOINTS))
    assert not extra, f"Unexpected endpoints: {extra}"


def test_protected_route_requires_auth():
    r = client.get("/api/v1/merchants")
    assert r.status_code == 401


def test_login_route_is_public_and_validates_body():
    r = client.post("/api/v1/auth/login", json={})
    assert r.status_code == 400


def test_health_probe_is_public():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_website_write_routes_require_auth_but_read_by_slug_does_not():
    """The public site template fetches a page by slug with no token; every
    other operation on the resource is a staff action."""
    assert client.get("/api/v1/websites").status_code == 401
    assert client.post("/api/v1/websites", json={"values": {}}).status_code == 401
    assert client.patch("/api/v1/websites/primo-cafe", json={"notes": "x"}).status_code == 401
    assert client.delete("/api/v1/websites/primo-cafe").status_code == 401

    # The public read reaches the handler and then fails on the absent test
    # database — which is the point: it got past auth. raise_server_exceptions
    # is off so that failure comes back as a 500 rather than propagating.
    tolerant = TestClient(app, raise_server_exceptions=False)
    assert tolerant.get("/api/v1/websites/primo-cafe").status_code != 401


def test_public_website_route_carries_no_security_requirement():
    schema = app.openapi()
    op = schema["paths"]["/api/v1/websites/{key}"]["get"]
    assert not op.get("security"), "GET /websites/{key} must stay public"
    for method in ("post",):
        assert schema["paths"]["/api/v1/websites"][method].get("security"), "writes must be protected"
