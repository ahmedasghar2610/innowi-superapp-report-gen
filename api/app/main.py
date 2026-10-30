"""FastAPI app factory. Mirrors src/main.ts: global /api/v1 prefix, Swagger at
/api/docs, uniform error handling, bearer auth scheme.

Also carries two things ported from the standalone website-api service, both of
which the whole API needs rather than just that module: browser CORS (the Super
App calls this from the browser, cross-origin) and a `/health` liveness probe.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from app.common.errors import register_exception_handlers
from app.common.security.headers import SecurityHeadersMiddleware
from app.config import get_settings, validate_environment
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import auth_router, users_router
from app.modules.ads.router import callback_router as ads_callback_router, merchant_router as ads_merchant_router, router as ads_router
from app.modules.catalog.router import router as catalog_router
from app.modules.gbp.router import callback_router as gbp_callback_router, merchant_router as gbp_merchant_router, router as gbp_router
from app.modules.merchant_profiling.router import router as merchant_profiling_router
from app.modules.partner_contacts.router import router as partner_contacts_router
from app.modules.partner_leads.public_router import router as partner_leads_public_router
from app.modules.partner_leads.router import router as partner_leads_router
from app.modules.invitations.router import admin_router as invitations_router, public_router as invitations_public_router
from app.modules.quotes.public_router import router as quotes_public_router
from app.modules.quotes.router import router as quotes_router
from app.modules.assistant.router import router as assistant_router
from app.modules.roadmap.router import router as roadmap_router
from app.modules.requests.router import router as requests_router
from app.modules.churn.router import router as churn_router
from app.modules.deals.router import deals_router, organizations_router
from app.modules.salesforce.router import router as sales_router
from app.modules.ops.library import router as ops_library_router
from app.modules.ops.ticket_extras import router as ops_ticket_extras_router
from app.modules.ops.ticket_more import router as ops_ticket_more_router
from app.modules.ops.meetings import router as ops_meetings_router, webhook_router as fathom_webhook_router
from app.modules.ops.reports import router as ops_reports_router
from app.modules.ops.router import router as ops_router
from app.modules.ops.teams_router import router as ops_teams_router
from app.modules.ops.availability import flow_router as teams_flow_router, router as ops_availability_router
from app.modules.seo.router import callback_router as seo_callback_router, merchant_router as seo_merchant_router, router as seo_router
from app.modules.seo.blog_router import router as seo_blogs_router
from app.modules.seo.crawler_router import helper_router as seo_crawler_helper_router, router as seo_crawler_router
from app.modules.linking.router import router as data_setup_router  # Settings → Integrations → Data setup
from app.modules.linking.connector_router import merchant_router as connector_merchant_router, settings_router as connector_settings_router
from app.modules.settings.router import router as settings_router
from app.modules.jobs.router import router as jobs_router
from app.modules.report_gen.router import router as report_gen_router  # Merchant Reports (behind REPORT_GEN_ENABLED)
from app.modules.websites.editor import router as website_editor_router
from app.modules.websites.router import router as websites_router


logger = logging.getLogger("Startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Daily Google Business Profile sync (off with GBP_AUTO_SYNC=false).
    from app.modules.gbp import scheduler as gbp_scheduler

    task = gbp_scheduler.start()
    # Daily Google Ads sync (off with ADS_AUTO_SYNC=false).
    from app.modules.ads import scheduler as ads_scheduler

    ads_task = ads_scheduler.start()
    # SLA at-risk / breached alerts every 5 minutes (off with OPS_SLA_ALERTS=false).
    from app.modules.ops import alerts as ops_alerts

    alerts_task = ops_alerts.start()
    # Daily SEO sync (off with SEO_AUTO_SYNC=false).
    from app.modules.seo import scheduler as seo_scheduler

    seo_task = seo_scheduler.start()
    # Blog Impact refresh at the times saved on its tab (checked every 15 minutes).
    from app.modules.seo import blog_schedule

    blog_task = blog_schedule.start()
    yield
    for t in (task, ads_task, alerts_task, seo_task, blog_task):
        if t:
            t.cancel()


def create_app() -> FastAPI:
    settings = get_settings()

    # Fail loudly on a misconfigured deploy (placeholder JWT secrets, CORS
    # wildcard in production, ...). Development gets warnings; production
    # refuses to boot rather than run with a guessable secret.
    problems = validate_environment(settings)
    if problems:
        for problem in problems:
            logger.warning("Environment configuration: %s", problem)
        if settings.is_production:
            raise RuntimeError("Refusing to start in production: " + "; ".join(problems))

    app = FastAPI(
        title="Innowi Super App API",
        description="Merchant Profiling + Website Intake + GBP reporting + Google Ads reporting + SEO + Ops CRM (tickets, reports, library) + Auth/RBAC — JWT bearer auth, Admin/Marketing Manager/Marketing Executive roles",
        version="0.1.0",
        docs_url=None,  # custom-mounted below at /api/docs
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # The Super App calls this API straight from the browser, which is a
    # cross-origin request (different port/host). Without these headers it
    # fails as a bare "Network Error" even though the URL works in curl.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Security response headers on every response (nosniff, no framing,
    # referrer policy, CSP, no-store for /api/*, HSTS when served over TLS).
    # Registered after CORS, which makes it the outer layer: the headers are
    # appended to every response, including CORS preflight answers.
    app.add_middleware(SecurityHeadersMiddleware, hsts=settings.ENABLE_HSTS)

    register_exception_handlers(app)

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(auth_router)
    api_v1.include_router(users_router)
    api_v1.include_router(audit_router)
    api_v1.include_router(catalog_router)
    api_v1.include_router(merchant_profiling_router)
    api_v1.include_router(websites_router)
    api_v1.include_router(website_editor_router)
    api_v1.include_router(partner_leads_router)
    api_v1.include_router(partner_leads_public_router)
    api_v1.include_router(partner_contacts_router)
    api_v1.include_router(invitations_router)
    api_v1.include_router(invitations_public_router)
    api_v1.include_router(sales_router)
    api_v1.include_router(quotes_router)
    api_v1.include_router(quotes_public_router)
    api_v1.include_router(assistant_router)
    api_v1.include_router(roadmap_router)
    api_v1.include_router(requests_router)
    api_v1.include_router(churn_router)
    api_v1.include_router(organizations_router)
    api_v1.include_router(deals_router)
    # Reports first: its /ops/tickets/export must win over /ops/tickets/{key}.
    api_v1.include_router(ops_reports_router)
    api_v1.include_router(ops_meetings_router)
    api_v1.include_router(ops_ticket_extras_router)
    api_v1.include_router(ops_ticket_more_router)
    api_v1.include_router(ops_teams_router)
    api_v1.include_router(ops_availability_router)
    api_v1.include_router(teams_flow_router)
    api_v1.include_router(ops_router)
    api_v1.include_router(ops_library_router)
    api_v1.include_router(settings_router)
    api_v1.include_router(fathom_webhook_router)
    api_v1.include_router(gbp_router)
    api_v1.include_router(gbp_merchant_router)
    api_v1.include_router(gbp_callback_router)
    api_v1.include_router(ads_router)
    api_v1.include_router(ads_merchant_router)
    api_v1.include_router(ads_callback_router)
    api_v1.include_router(seo_blogs_router)
    api_v1.include_router(seo_crawler_helper_router)
    api_v1.include_router(seo_crawler_router)
    api_v1.include_router(seo_router)
    api_v1.include_router(seo_merchant_router)
    api_v1.include_router(seo_callback_router)
    api_v1.include_router(data_setup_router)
    api_v1.include_router(connector_settings_router)
    api_v1.include_router(connector_merchant_router)
    api_v1.include_router(report_gen_router)
    api_v1.include_router(jobs_router)
    app.include_router(api_v1)

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
        schema["components"]["securitySchemes"] = {
            "access-token": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
        }
        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi

    from fastapi.openapi.docs import get_swagger_ui_html

    @app.get("/api/docs", include_in_schema=False)
    async def swagger_ui():
        return get_swagger_ui_html(openapi_url="/api/openapi.json", title="Innowi Super App API — Swagger UI")

    @app.get("/health", tags=["Meta"], summary="Liveness probe")
    async def health() -> dict[str, str]:
        """Unauthenticated, no database round-trip — for load balancers and Docker."""
        return {"status": "ok", "service": "innowi-superapp-api"}

    return app


app = create_app()
