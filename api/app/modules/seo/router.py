"""SEO — Marketing → SEO.

    GET    /seo/status                        connection, keys, sites, last sync (everyone)
    POST   /seo/connect · DELETE /seo/connection    Google sign-in for Search Console + GA4 (seo.manage)
    POST   /seo/sync · GET /seo/sync-runs     "Refresh data" (seo.manage) / history
    POST   /seo/sample-data · DELETE          60 sample sites (seo.manage)
    GET    /seo/overview                      SEO Command: every site, worst first
    GET    /seo/watchdog                      live alert feed (open findings)
    GET    /seo/sites                         sites + settings (Connections)
    POST   /seo/sites                         add a site by hand (seo.manage)
    GET    /seo/sites/{id}                    client scorecard
    PATCH  /seo/sites/{id}                    links, package, owner, cadence, recipients (seo.manage)
    DELETE /seo/sites/{id}                    a site added by hand (seo.manage)
    GET    /seo/sites/{id}/pages              pages (read-only)
    GET    /seo/sites/{id}/keywords · POST · DELETE /seo/keywords/{id}   tracked keywords (seo.manage)
    POST   /seo/sites/{id}/rescore            recompute scorecard + findings now (seo.manage)
    POST   /seo/sites/{id}/pagespeed          measure PageSpeed now (seo.manage)
    GET    /seo/link-options?q=               merchants / GBP listings / Ads accounts / owners / GA4 properties
    GET    /seo/findings                      Intelligence
    PATCH  /seo/findings/{id}                 move along the workflow, owner, note (everyone)
    GET    /seo/reports/center?days=          Reports Center
    POST   /seo/sites/{id}/reports            assemble a report for a period
    GET    /seo/reports/{id}                  report preview
    POST   /seo/reports/{id}/sign-off         (seo.approve)
    PATCH  /seo/reports/{id}/next-steps       "What happens next", until signed (seo.manage)
    PATCH  /seo/reports/{id}/summary          executive summary / per-section paragraphs, until signed (seo.manage)
    POST   /seo/reports/{id}/send             (seo.approve; Gmail as the connected Google account, needs gmail.send)
    POST   /seo/email/test                    (seo.approve) one test e-mail through the same setup
    GET    /seo/kpis · PATCH /seo/kpis/{key} · POST /seo/kpis · DELETE /seo/kpis/{key}   KPI Studio
    GET    /seo/compare?ids=a,b,c             2–4 sites side by side
    GET    /merchants/{merchantId}/seo        sites linked to a merchant
    GET    /integrations/seo/callback         Google → us after consent (no login; signed state)

Read-only towards Google and the client websites.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common import jobs
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.config import get_settings
from app.db.session import get_db
from app.models.ads import AdsAccount
from app.models.auth import User
from app.models.enums import Role, UserStatus
from app.models.gbp import GbpLocation
from app.models.profiling import Merchant
from app.models.seo import SeoFinding, SeoKeyword, SeoKpi, SeoReport, SeoSite, SeoSyncRun, utcnow
from app.modules.ads import connection as ads_connection
from app.modules.gbp import connection as gbp_connection
from app.modules.seo import catalog, client_reports, connection, crawl, crawl_views, data, google, pagespeed, recipients, sync, views
from app.modules.seo import findings as wf
from app.modules.seo import kpis as kpi_mod

logger = logging.getLogger("SEO")

router = APIRouter(prefix="/seo", tags=["SEO"], dependencies=[Depends(require_capability("seo.view"))])
merchant_router = APIRouter(tags=["SEO"], dependencies=[Depends(require_capability("seo.view"))])
callback_router = APIRouter(prefix="/integrations/seo", tags=["Integrations"])
_manage = Depends(require_capability("seo.manage"))
_approve = Depends(require_capability("seo.approve"))


def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30.0))


def _run_dto(run: Optional[SeoSyncRun]) -> Optional[dict]:
    if not run:
        return None
    return {
        "id": run.id, "trigger": run.trigger, "status": run.status, "startedAt": run.started_at.isoformat(),
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None, "sites": run.sites, "sitesFailed": run.sites_failed,
        "gscDays": run.gsc_days, "pagesChecked": run.pages_checked, "error": run.error,
    }


def _auto_sync() -> dict:
    from app.modules.seo import scheduler

    s = get_settings()
    return {"enabled": s.SEO_AUTO_SYNC, "hour": s.SEO_AUTO_SYNC_HOUR, "timezone": s.SEO_TIMEZONE,
            "nextAt": scheduler.next_slot(utcnow(), s.SEO_AUTO_SYNC_HOUR, s.SEO_TIMEZONE).isoformat() if s.SEO_AUTO_SYNC else None}


async def sources(db: AsyncSession) -> list[dict]:
    """Status pills: where each kind of data comes from and whether it's flowing."""
    s = get_settings()
    conn = await connection.current(db)
    g = connection.granted(conn)
    demo = (await sync.counts(db)).get("DEMO", 0)
    err = bool(conn and conn.status == "error")

    def st(ok: bool) -> str:
        return "error" if err else "connected" if ok else "pending"

    gbp_n = int((await db.execute(select(func.count()).select_from(SeoSite).where(SeoSite.gbp_location_id.isnot(None)))).scalar_one())
    ads_n = int((await db.execute(select(func.count()).select_from(SeoSite).where(SeoSite.ads_account_id.isnot(None)))).scalar_one())
    from app.models.seo import SeoCrawl
    crawls = int((await db.execute(select(func.count(func.distinct(SeoCrawl.site_id))))).scalar_one())

    async def module_state(mod, linked: int) -> tuple[str, str]:
        """GBP / Ads pills follow that module's own Google connection (Settings → Integrations),
        not how many SEO sites are linked to it — that count goes in the tooltip."""
        c = await mod.current(db)
        sites = f"{linked} SEO site{'s' if linked != 1 else ''} linked"
        if c and c.status == "error":
            return "error", f"Needs reconnect in Settings → Integrations · {sites}"
        if c:
            return "connected", f"Connected as {c.google_email or 'Google account'} · {sites}"
        if linked:  # sample listings / accounts linked to sample sites
            return "sample", sites
        return "pending", "Not connected — Settings → Integrations"

    gbp_state, gbp_detail = await module_state(gbp_connection, gbp_n)
    ads_state, ads_detail = await module_state(ads_connection, ads_n)
    return [
        {"key": "gsc", "label": "Search Console", "state": "sample" if demo and not conn else st(bool(conn and g["searchConsole"]))},
        {"key": "ga4", "label": "GA4", "state": "sample" if demo and not conn else st(bool(conn and g["analytics"]))},
        {"key": "pagespeed", "label": "PageSpeed", "state": "connected" if s.PAGESPEED_API_KEY else "pending"},
        {"key": "gbp", "label": "GBP", "state": gbp_state, "detail": gbp_detail},
        {"key": "ads", "label": "Ads", "state": ads_state, "detail": ads_detail},
        {"key": "screamingfrog", "label": "Screaming Frog", "state": "connected" if crawls else "pending",
         "detail": f"{crawls} site{'s' if crawls != 1 else ''} with an imported crawl" if crawls else "No crawl imported yet — scripts/seo_import_sf.py"},
    ]


# ================================================================ status ====
@router.get("/status")
async def status(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    s = get_settings()
    conn = await connection.current(db)
    is_running = bool(await sync.running(db))  # first: closes a refresh left behind by a restart, so lastRun shows it failed
    runs = await sync.last_runs(db, 1)
    counts = await sync.counts(db)
    by = await db.get(User, conn.connected_by_id) if conn and conn.connected_by_id else None
    email = await client_reports.email_status(db)
    return {
        "missingEnv": connection.missing_env(),
        "redirectUri": s.SEO_OAUTH_REDIRECT_URI,
        "connected": bool(conn and conn.status == "connected"),
        "connection": {
            "email": conn.google_email, "status": conn.status, "error": conn.last_error, "connectedAt": conn.connected_at.isoformat(),
            "connectedBy": views.name_of(by), "lastSyncAt": conn.last_sync_at.isoformat() if conn.last_sync_at else None,
            "scopes": connection.granted(conn), "ga4Properties": len(conn.ga4_properties or []),
        } if conn else None,
        "keys": {"pagespeed": bool(s.PAGESPEED_API_KEY), "email": email["configured"]},
        "email": email,
        "lastRun": _run_dto(runs[0] if runs else None),
        "running": is_running,
        "sites": {"google": counts.get("GOOGLE", 0), "manual": counts.get("MANUAL", 0), "demo": counts.get("DEMO", 0)},
        "dataThrough": views.iso(await views.through(db)),
        "canManage": user.can("seo.manage"),
        "canApprove": user.can("seo.approve"),
        "autoSync": _auto_sync(),
        "sources": await sources(db),
    }


@router.post("/sample-data", dependencies=[_manage])
async def load_sample_data(db: AsyncSession = Depends(get_db)):
    from app.modules.seo import demo

    try:
        return await demo.load(db, dt.date.today())
    except demo.DemoRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/sample-data", dependencies=[_manage])
async def remove_sample_data(db: AsyncSession = Depends(get_db)):
    from app.modules.seo import demo

    return {"removed": await demo.remove(db)}


@router.post("/connect", dependencies=[_manage])
async def connect(returnTo: str = Query("seo", pattern="^(seo|settings)$"), user: AuthenticatedUser = Depends(get_current_user)):
    try:
        return {"url": connection.connect_url(user.id, returnTo)}
    except connection.NotConfigured as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/connection", status_code=204, dependencies=[_manage])
async def disconnect(db: AsyncSession = Depends(get_db)):
    async with _http() as http:
        await connection.disconnect(db, http)


@router.post("/sync", dependencies=[_manage])
async def start_sync(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    conn = await connection.current(db)
    manual = int((await db.execute(select(func.count()).select_from(SeoSite).where(SeoSite.source == "MANUAL"))).scalar_one())
    if not conn and not manual:
        raise HTTPException(status_code=409, detail="Connect Search Console & GA4 first, or add a site by hand.")
    if conn and connection.missing_env():
        raise HTTPException(status_code=409, detail="Add " + ", ".join(connection.missing_env()) + " to the API's settings (environment variables) and redeploy it.")
    try:
        run = await sync.create_run(db, "manual", user.id)
    except sync.SyncBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await sync.start_background(run.id)
    if jobs.inline():  # the sync already ran inside this request
        await db.refresh(run)
    return _run_dto(run)


@router.get("/sync-runs")
async def sync_runs(limit: int = Query(10, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    return {"data": [_run_dto(r) for r in await sync.last_runs(db, limit)]}


# =============================================================== command ====
@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db)):
    return await views.overview(db, await sources(db))


@router.get("/watchdog")
async def watchdog(limit: int = Query(40, ge=1, le=200), db: AsyncSession = Depends(get_db)):
    return await views.watchdog(db, limit)


# ================================================================= sites ====
async def _site(db: AsyncSession, site_id: str) -> SeoSite:
    site = await db.get(SeoSite, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


def _site_row(s: SeoSite, users: dict, merchants: dict, locs: dict, accs: dict, contacts: dict) -> dict:
    from_merchant = contacts.get(s.merchant_id, []) if s.merchant_id else []
    return {
        **views.site_ref(s), "homeUrl": s.home_url, "source": s.source, "isDemo": s.source == "DEMO", "status": s.status,
        "segment": s.segment, "package": s.package, "reportCadence": s.report_cadence, "reportRecipients": s.report_recipients or [],
        "merchantRecipients": from_merchant, "allRecipients": recipients.merged(from_merchant, s.report_recipients),
        "owner": views.user_ref(users.get(s.owner_id)), "gscProperty": s.gsc_property, "gscPermission": s.gsc_permission,
        "ga4Property": s.ga4_property, "ga4Name": s.ga4_name,
        "merchant": {"id": s.merchant_id, "name": merchants[s.merchant_id].restaurant_name} if s.merchant_id in merchants else None,
        "gbpLocation": {"id": s.gbp_location_id, "title": locs[s.gbp_location_id].title} if s.gbp_location_id in locs else None,
        "adsAccount": {"id": s.ads_account_id, "name": accs[s.ads_account_id].name} if s.ads_account_id in accs else None,
        "syncState": views.sync_state(s), "syncError": s.sync_error, "syncWarning": s.sync_warning, "lastSyncedAt": views.iso(s.last_synced_at),
    }


@router.get("/sites")
async def list_sites(db: AsyncSession = Depends(get_db)):
    sites = (await db.execute(select(SeoSite).order_by(SeoSite.name))).scalars().all()
    users = await views.users_by_id(db, [s.owner_id for s in sites])

    async def by_id(model, ids):
        ids = [i for i in ids if i]
        return {x.id: x for x in (await db.execute(select(model).where(model.id.in_(ids)))).scalars()} if ids else {}

    merchants = await by_id(Merchant, [s.merchant_id for s in sites])
    locs = await by_id(GbpLocation, [s.gbp_location_id for s in sites])
    accs = await by_id(AdsAccount, [s.ads_account_id for s in sites])
    contacts = await recipients.merchant_contacts(db, [s.merchant_id for s in sites])
    return {"data": [_site_row(s, users, merchants, locs, accs, contacts) for s in sites], "packages": catalog.PACKAGES,
            "segments": catalog.SEGMENTS, "cadences": catalog.CADENCES}


class NewSiteInput(BaseModel):
    model_config = {"extra": "forbid"}
    domain: str = Field(min_length=3, max_length=253)
    name: Optional[str] = Field(default=None, max_length=300)


@router.post("/sites", status_code=201, dependencies=[_manage])
@audited(entity_type="SeoSite")
async def add_site(dto: NewSiteInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    dom = crawl.normalize_domain(dto.domain)
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", dom or ""):
        raise HTTPException(status_code=400, detail="Enter a domain like primocafe.com")
    if (await db.execute(select(SeoSite.id).where(SeoSite.domain == dom))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"{dom} is already tracked.")
    s = SeoSite(source="MANUAL", name=(dto.name or dom).strip(), domain=dom, home_url=f"https://{dom}/")
    db.add(s)
    await data.link_by_domain(db, s)
    await db.commit()
    return {"id": s.id, "domain": s.domain, "name": s.name}


async def _read_site(id: str, db: AsyncSession) -> Optional[dict]:
    s = await db.get(SeoSite, id)
    if not s:
        return None
    return {"id": s.id, "name": s.name, "domain": s.domain, "merchantId": s.merchant_id, "gbpLocationId": s.gbp_location_id,
            "adsAccountId": s.ads_account_id, "package": s.package, "segment": s.segment, "ownerId": s.owner_id,
            "reportCadence": s.report_cadence, "reportRecipients": s.report_recipients, "status": s.status, "ga4Property": s.ga4_property}


class SiteInput(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(default=None, min_length=1, max_length=300)
    merchantId: Optional[str] = None
    gbpLocationId: Optional[str] = None
    adsAccountId: Optional[str] = None
    ga4Property: Optional[str] = Field(default=None, max_length=60)
    package: Optional[Literal["normal", "199", "299", "internal"]] = None
    segment: Optional[str] = Field(default=None, max_length=40)
    ownerId: Optional[str] = None
    reportCadence: Optional[Literal["biweekly", "monthly", "quarterly"]] = None
    reportRecipients: Optional[list[EmailStr]] = Field(default=None, max_length=10)
    status: Optional[Literal["active", "paused"]] = None


@router.patch("/sites/{site_id}", dependencies=[_manage])
@audited(entity_type="SeoSite", id_param="site_id", read=_read_site, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def update_site(site_id: str, dto: SiteInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    s = await _site(db, site_id)
    sent = dto.model_fields_set
    if "name" in sent and dto.name:
        s.name = dto.name.strip()
    for field, model, attr in (("merchantId", Merchant, "merchant_id"), ("gbpLocationId", GbpLocation, "gbp_location_id"), ("adsAccountId", AdsAccount, "ads_account_id")):
        if field in sent:
            v = getattr(dto, field)
            if v and not await db.get(model, v):
                raise HTTPException(status_code=404, detail=f"{field[:-2]} not found")
            setattr(s, attr, v or None)
    if "ga4Property" in sent:
        if dto.ga4Property and not re.fullmatch(r"properties/\d+", dto.ga4Property):
            raise HTTPException(status_code=400, detail="GA4 property looks like properties/123456789")
        s.ga4_property = dto.ga4Property or None
        conn = await connection.current(db)
        s.ga4_name = next((g["name"] for g in (conn.ga4_properties if conn else []) if g["property"] == dto.ga4Property), None)
        if s.source != "DEMO":
            s.last_ga4_date = None  # re-read history from the new property
    if "ownerId" in sent:
        if dto.ownerId and not await db.get(User, dto.ownerId):
            raise HTTPException(status_code=404, detail="Owner not found")
        s.owner_id = dto.ownerId or None
    for field, attr in (("package", "package"), ("segment", "segment"), ("reportCadence", "report_cadence"), ("status", "status")):
        if field in sent and getattr(dto, field):
            setattr(s, attr, getattr(dto, field))
    if "reportRecipients" in sent:
        s.report_recipients = [str(e).lower() for e in (dto.reportRecipients or [])]
    if sent & {"merchantId", "gbpLocationId", "adsAccountId"}:
        if not ("name" in sent and dto.name):
            await data.auto_name(db, s)
        await data.recompute(db, s, psi_configured=bool(get_settings().PAGESPEED_API_KEY))
    await db.commit()
    return await _read_site(s.id, db)


@router.delete("/sites/{site_id}", status_code=204, dependencies=[_manage])
@audited(entity_type="SeoSite", id_param="site_id", read=_read_site)
async def delete_site(site_id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    s = await _site(db, site_id)
    if s.source != "MANUAL":
        raise HTTPException(status_code=409, detail="Only sites added by hand can be removed; Search Console sites come back with the next sync. Pause it instead.")
    await db.delete(s)
    await db.commit()


@router.get("/sites/{site_id}")
async def site_detail(site_id: str, db: AsyncSession = Depends(get_db)):
    return await views.site_detail(db, await _site(db, site_id))


@router.get("/sites/{site_id}/pages")
async def site_pages(site_id: str, db: AsyncSession = Depends(get_db)):
    return await views.site_pages(db, await _site(db, site_id))


@router.get("/sites/{site_id}/crawl")
async def site_crawl(site_id: str, db: AsyncSession = Depends(get_db)):
    """Newest imported Screaming Frog crawl: totals, issues (with samples), recent crawl history."""
    return await crawl_views.overview(db, await _site(db, site_id))


@router.get("/sites/{site_id}/crawl/pages")
async def site_crawl_pages(
    site_id: str,
    q: str = Query("", max_length=200),
    issue: str = Query("", max_length=120),
    kind: str = Query("html", pattern="^(html|all|nonindexable|errors)$"),
    sort: str = Query("score", pattern="^(score|depth|words|inlinks|issues|response)$"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    return await crawl_views.pages(db, await _site(db, site_id), q, issue, kind, sort, offset, limit)


@router.post("/sites/{site_id}/rescore", dependencies=[_manage])
async def rescore(site_id: str, db: AsyncSession = Depends(get_db)):
    s = await _site(db, site_id)
    out = await data.recompute(db, s, psi_configured=bool(get_settings().PAGESPEED_API_KEY))
    await db.commit()
    return {"health": s.health, "findings": out["findings"]}


@router.post("/sites/{site_id}/pagespeed", dependencies=[_manage])
async def run_pagespeed(site_id: str, db: AsyncSession = Depends(get_db)):
    """Measure the site's checked pages with PageSpeed Insights now (mobile score + Core Web Vitals),
    then recompute the scorecard. Read-only public API."""
    s = await _site(db, site_id)
    if not pagespeed.configured():
        raise HTTPException(status_code=409, detail="Add PAGESPEED_API_KEY to the API's .env and restart it.")
    async with _http() as http:
        res = await pagespeed.run_site(db, s, http, force=True)
    out = await data.recompute(db, s, psi_configured=True)
    await db.commit()
    return {**res, "health": s.health, "findings": out["findings"]}


# ============================================================== keywords ====
class KeywordInput(BaseModel):
    model_config = {"extra": "forbid"}
    keyword: str = Field(min_length=2, max_length=300)
    location: Optional[str] = Field(default=None, max_length=200)


@router.get("/sites/{site_id}/keywords")
async def list_keywords(site_id: str, db: AsyncSession = Depends(get_db)):
    kw = await views.keyword_rows(db, await _site(db, site_id))
    return {"data": kw["rows"], "month": kw["month"], "prevMonth": kw["prevMonth"]}


@router.post("/sites/{site_id}/keywords", status_code=201, dependencies=[_manage])
async def add_keyword(site_id: str, dto: KeywordInput, db: AsyncSession = Depends(get_db)):
    s = await _site(db, site_id)
    kw = dto.keyword.strip().lower()
    if (await db.execute(select(SeoKeyword.id).where(SeoKeyword.site_id == s.id, SeoKeyword.keyword == kw))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already tracked.")
    k = SeoKeyword(site_id=s.id, keyword=kw, source="manual", location=(dto.location or None))
    db.add(k)
    await db.commit()
    return {"id": k.id, "keyword": k.keyword}


@router.delete("/keywords/{keyword_id}", status_code=204, dependencies=[_manage])
async def delete_keyword(keyword_id: str, db: AsyncSession = Depends(get_db)):
    k = await db.get(SeoKeyword, keyword_id)
    if not k:
        raise HTTPException(status_code=404, detail="Keyword not found")
    await db.delete(k)
    await db.commit()


@router.get("/link-options")
async def link_options(q: str = Query("", max_length=100), db: AsyncSession = Depends(get_db)):
    like = f"%{q.strip().lower()}%"
    merchants = (await db.execute(select(Merchant).where(func.lower(Merchant.restaurant_name).like(like)).order_by(Merchant.restaurant_name).limit(12))).scalars().all()
    locs = (await db.execute(select(GbpLocation).where(or_(func.lower(GbpLocation.title).like(like), func.lower(GbpLocation.website_url).like(like))).order_by(GbpLocation.title).limit(12))).scalars().all()
    accs = (await db.execute(select(AdsAccount).where(func.lower(AdsAccount.name).like(like), AdsAccount.state == "active").order_by(AdsAccount.name).limit(12))).scalars().all()
    staff = (await db.execute(select(User).where(User.status == UserStatus.ACTIVE, User.role != Role.SUPER_ADMIN).order_by(User.first_name, User.email))).scalars().all()
    conn = await connection.current(db)
    return {
        "merchants": [{"id": m.id, "name": m.restaurant_name} for m in merchants],
        "gbpLocations": [{"id": l.id, "title": l.title, "city": l.city, "isDemo": l.source == "DEMO"} for l in locs],
        "adsAccounts": [{"id": a.id, "name": a.name, "isDemo": a.source == "DEMO"} for a in accs],
        "owners": [{"id": u.id, "name": views.name_of(u)} for u in staff],
        "ga4Properties": [{"property": g["property"], "name": g["name"], "account": g.get("account"), "hosts": g.get("hosts", [])} for g in (conn.ga4_properties if conn else [])],
    }


# ========================================================== intelligence ====
@router.get("/findings")
async def list_findings(
    severity: Optional[Literal["S1", "S2", "S3"]] = None,
    group: Optional[Literal["needs_decision", "in_flight", "awaiting_verification", "closed"]] = None,
    team: Optional[str] = None,
    owner: Optional[str] = None,
    siteId: Optional[str] = None,
    q: Optional[str] = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    return await views.finding_list(db, severity=severity, group=group, team=team, owner=owner, site_id=siteId, q=q)


class FindingInput(BaseModel):
    model_config = {"extra": "forbid"}
    state: Optional[Literal["recommended", "task_created", "in_progress", "awaiting_verification", "closed"]] = None
    outcome: Optional[Literal["fixed", "dismissed"]] = None
    ownerId: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=2000)


async def _read_finding(id: str, db: AsyncSession) -> Optional[dict]:
    f = await db.get(SeoFinding, id)
    if not f:
        return None
    s = await db.get(SeoSite, f.site_id)
    return {"id": f.id, "site": s.domain if s else None, "title": f.title, "state": f.state, "outcome": f.outcome, "ownerId": f.owner_id,
            "merchantId": s.merchant_id if s else None}


STATE_LABELS = {"task_created": "Task created", "in_progress": "In progress", "awaiting_verification": "Marked fixed — awaiting verification",
                "recommended": "Reopened"}


@router.patch("/findings/{finding_id}")
@audited(entity_type="SeoFinding", id_param="finding_id", read=_read_finding, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def update_finding(finding_id: str, dto: FindingInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    f = await db.get(SeoFinding, finding_id)
    if not f:
        raise HTTPException(status_code=404, detail="Finding not found")
    now = utcnow()
    sent = dto.model_fields_set
    me = views.name_of(await db.get(User, user.id))
    if "ownerId" in sent:
        if dto.ownerId and not await db.get(User, dto.ownerId):
            raise HTTPException(status_code=404, detail="Owner not found")
        f.owner_id = dto.ownerId or None
    if dto.state and dto.state != f.state:
        if dto.state not in wf.TRANSITIONS.get(f.state, ()):
            raise HTTPException(status_code=409, detail=f"Can't move a finding from {f.state.replace('_', ' ')} to {dto.state.replace('_', ' ')}.")
        if dto.state == "closed":
            if f.state != "awaiting_verification" and dto.outcome != "dismissed":
                raise HTTPException(status_code=409, detail="Mark it fixed first; the next sync verifies it. To close without a fix, dismiss it.")
            f.outcome = dto.outcome or "fixed"
            f.closed_at = now
            label = "Dismissed" if f.outcome == "dismissed" else "Verified and closed"
        else:
            f.outcome, f.closed_at = None, None
            label = STATE_LABELS[dto.state]
        if dto.state == "task_created" and not f.owner_id:
            f.owner_id = user.id
        f.note = wf.note_line(f.note, f"{label} by {me}" + (f": {dto.note.strip()}" if dto.note and dto.note.strip() else ""), now)
        f.state = dto.state
    elif dto.note and dto.note.strip():
        f.note = wf.note_line(f.note, f"{me}: {dto.note.strip()}", now)
    await db.commit()
    site = await db.get(SeoSite, f.site_id)
    return views.finding_dto(f, site, await views.users_by_id(db, [f.owner_id]))


# =============================================================== reports ====
@router.get("/reports/center")
async def reports_center(days: int = Query(90, ge=7, le=365), db: AsyncSession = Depends(get_db)):
    return {**await views.reports_center(db, days), "emailConfigured": await client_reports.email_configured(db)}


class GenerateInput(BaseModel):
    model_config = {"extra": "forbid"}
    periodStart: Optional[dt.date] = None
    periodEnd: Optional[dt.date] = None


async def _report_dto(db: AsyncSession, r: SeoReport) -> dict:
    users = await views.users_by_id(db, [r.generated_by_id, r.signed_by_id])
    site = await db.get(SeoSite, r.site_id)
    return {
        **views.report_ref(r), "site": views.site_ref(site) if site else None, "snapshot": r.snapshot,
        "generatedBy": views.user_ref(users.get(r.generated_by_id)), "signedBy": views.user_ref(users.get(r.signed_by_id)),
        "recipients": r.recipients or [],
        **({"defaultRecipients": (rec := await recipients.for_site(db, site))["all"], "recipientSources": {"fromMerchant": rec["fromMerchant"], "manual": rec["manual"]}}
           if site else {"defaultRecipients": [], "recipientSources": {"fromMerchant": [], "manual": []}}),
        "emailConfigured": await client_reports.email_configured(db),
    }


async def _read_report(id: str, db: AsyncSession) -> Optional[dict]:
    r = await db.get(SeoReport, id)
    if not r:
        return None
    s = await db.get(SeoSite, r.site_id)
    return {"id": r.id, "site": s.domain if s else None, "period": f"{r.period_start}..{r.period_end}", "status": r.status,
            "recipients": r.recipients, "merchantId": s.merchant_id if s else None}


@router.post("/sites/{site_id}/reports", status_code=201)
async def generate_report(site_id: str, dto: GenerateInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    s = await _site(db, site_id)
    if dto.periodStart and dto.periodEnd:
        start, end = dto.periodStart, dto.periodEnd
    else:
        start, end, _ = views.next_period(s.report_cadence, dt.date.today())
    try:
        r = await client_reports.generate(db, s, start, end, user.id)
    except client_reports.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r)


@router.get("/reports/{report_id}")
async def get_report(report_id: str, db: AsyncSession = Depends(get_db)):
    r = await db.get(SeoReport, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    return await _report_dto(db, r)


@router.post("/reports/{report_id}/sign-off", dependencies=[_approve])
@audited(entity_type="SeoReport", id_param="report_id", read=_read_report, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def sign_off(report_id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    r = await db.get(SeoReport, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        await client_reports.sign_off(db, r, user.id)
    except client_reports.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r)


class SummaryInput(BaseModel):
    model_config = {"extra": "forbid"}
    paragraphs: list[str] = Field(max_length=6)
    section: Optional[str] = None  # one of report_v2.NOTE_SECTIONS → the paragraph under that table; omitted → executive summary


@router.patch("/reports/{report_id}/summary", dependencies=[_manage])
@audited(entity_type="SeoReport", id_param="report_id", read=_read_report, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def edit_summary(report_id: str, dto: SummaryInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """Executive summary of a new-format report — the analyst can rewrite it until it is signed off."""
    r = await db.get(SeoReport, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    if any(len(x) > 2000 for x in dto.paragraphs):
        raise HTTPException(status_code=400, detail="Keep each paragraph under 2,000 characters.")
    try:
        await client_reports.update_summary(db, r, dto.paragraphs, dto.section)
    except client_reports.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r)


class NextStepsInput(BaseModel):
    model_config = {"extra": "forbid"}
    nextSteps: list[str] = Field(max_length=6)


@router.patch("/reports/{report_id}/next-steps", dependencies=[_manage])
@audited(entity_type="SeoReport", id_param="report_id", read=_read_report, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def edit_next_steps(report_id: str, dto: NextStepsInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """'What happens next' — editable until the report is signed off."""
    r = await db.get(SeoReport, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    if any(len(x) > 400 for x in dto.nextSteps):
        raise HTTPException(status_code=400, detail="Keep each step under 400 characters.")
    try:
        await client_reports.update_next_steps(db, r, dto.nextSteps)
    except client_reports.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r)


class SendInput(BaseModel):
    model_config = {"extra": "forbid"}
    recipients: list[EmailStr] = Field(min_length=1, max_length=10)


@router.post("/reports/{report_id}/send", dependencies=[_approve])
@audited(entity_type="SeoReport", id_param="report_id", read=_read_report, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def send_report(report_id: str, dto: SendInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    r = await db.get(SeoReport, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        await client_reports.send(db, r, [str(e).lower() for e in dto.recipients])
    except client_reports.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r)


class TestEmailInput(BaseModel):
    model_config = {"extra": "forbid"}
    to: Optional[EmailStr] = None


@router.post("/email/test", dependencies=[_approve])
async def test_email(dto: TestEmailInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """Send one test e-mail (to the signed-in user unless `to` is given) from the connected Google account."""
    to = str(dto.to or user.email).lower()
    try:
        sender = await client_reports.send_test(db, to)
    except client_reports.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"sentTo": to, "from": sender}


# ================================================================== KPIs ====
@router.get("/kpis")
async def list_kpis(db: AsyncSession = Depends(get_db)):
    return await kpi_mod.listing(db)


class KpiInput(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    target: Optional[str] = Field(default=None, min_length=1, max_length=120)
    status: Optional[Literal["proposed", "active", "retired"]] = None


class NewKpiInput(BaseModel):
    model_config = {"extra": "forbid"}
    set: int = Field(ge=1, le=4)
    name: str = Field(min_length=2, max_length=200)
    grader: Literal["score", "band", "sla", "gate", "trend"]
    target: str = Field(min_length=1, max_length=120)
    source: str = Field(min_length=1, max_length=80)


async def _read_kpi(key: str, db: AsyncSession) -> Optional[dict]:
    k = await db.get(SeoKpi, key)
    return {"key": k.key, "name": k.name, "target": k.target, "status": k.status} if k else None


@router.patch("/kpis/{key}", dependencies=[_manage])
@audited(entity_type="SeoKpi", id_param="key", read=_read_kpi)
async def update_kpi(key: str, dto: KpiInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    k = await db.get(SeoKpi, key)
    if not k:
        raise HTTPException(status_code=404, detail="KPI not found")
    if dto.name and k.custom:
        k.name = dto.name.strip()
    if dto.target:
        k.target = dto.target.strip()
    if dto.status:
        k.status = dto.status
    k.updated_by_id = user.id
    await db.commit()
    return await _read_kpi(key, db)


@router.post("/kpis", status_code=201, dependencies=[_manage])
@audited(entity_type="SeoKpi")
async def add_kpi(dto: NewKpiInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await kpi_mod.ensure_defaults(db)
    n = int((await db.execute(select(func.count()).where(SeoKpi.custom.is_(True), SeoKpi.set_no == dto.set))).scalar_one()) + 1
    key = f"K{dto.set}-C{n}"
    while await db.get(SeoKpi, key):
        n += 1
        key = f"K{dto.set}-C{n}"
    db.add(SeoKpi(key=key, set_no=dto.set, name=dto.name.strip(), grader=dto.grader, target=dto.target.strip(), source=dto.source.strip(),
                  status="proposed", sort=1000 + n, custom=True, updated_by_id=user.id))
    await db.commit()
    return await _read_kpi(key, db)


@router.delete("/kpis/{key}", status_code=204, dependencies=[_manage])
@audited(entity_type="SeoKpi", id_param="key", read=_read_kpi)
async def delete_kpi(key: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    k = await db.get(SeoKpi, key)
    if not k:
        raise HTTPException(status_code=404, detail="KPI not found")
    if not k.custom:
        raise HTTPException(status_code=409, detail="Built-in KPIs can't be deleted; retire them instead.")
    await db.delete(k)
    await db.commit()


# =============================================================== compare ====
@router.get("/compare")
async def compare(ids: str = Query(..., description="2–4 site ids, comma-separated"), db: AsyncSession = Depends(get_db)):
    wanted = [i for i in dict.fromkeys(x.strip() for x in ids.split(",")) if i]
    if not 2 <= len(wanted) <= 4:
        raise HTTPException(status_code=400, detail="Pick 2 to 4 sites to compare.")
    sites = (await db.execute(select(SeoSite).where(SeoSite.id.in_(wanted)))).scalars().all()
    if len(sites) != len(wanted):
        raise HTTPException(status_code=404, detail="Site not found")
    order = {sid: i for i, sid in enumerate(wanted)}
    return await views.compare(db, sorted(sites, key=lambda s: order[s.id]))


# ============================================================== merchant ====
@merchant_router.get("/merchants/{merchant_id}/seo")
async def merchant_sites(merchant_id: str, db: AsyncSession = Depends(get_db)):
    sites = (await db.execute(select(SeoSite).where(SeoSite.merchant_id == merchant_id).order_by(SeoSite.name))).scalars().all()
    opened = await views.open_counts(db)
    return {"data": [{**views.site_ref(s), "health": s.health, "grade": catalog.grade(s.health), "pillars": views.pillar_scores(s),
                      "open": opened.get(s.id, {"S1": 0, "S2": 0, "S3": 0}), "isDemo": s.source == "DEMO"} for s in sites]}


# ============================================================== callback ====
@callback_router.get("/callback", include_in_schema=False)
async def oauth_callback(db: AsyncSession = Depends(get_db), code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    ret = connection.state_return(state or "")
    if error:
        return RedirectResponse(connection.return_url(ret, seo="error", reason="Google sign-in was cancelled." if error == "access_denied" else f"Google said: {error}"))
    user_id = connection.read_state(state or "")
    if not user_id or not code:
        return RedirectResponse(connection.return_url(ret, seo="error", reason="The sign-in link expired. Click Connect again."))
    u = await db.get(User, user_id)
    from app.common.capabilities import has_capability

    if not u or not has_capability(u.role.value, "seo.manage", u.granted_capabilities or ()):
        return RedirectResponse(connection.return_url(ret, seo="error", reason="Only managers can connect Search Console & GA4."))
    try:
        async with _http() as http:
            await connection.finish(db, http, code, user_id)
        # Inline (serverless) the first sync is left to the scheduler or "Sync now":
        # it can take longer than this redirect may wait.
        if not jobs.inline():
            run = await sync.create_run(db, "connect", user_id)
            await sync.start_background(run.id)
    except connection.NotConfigured as exc:
        return RedirectResponse(connection.return_url(ret, seo="error", reason=str(exc)))
    except google.GoogleError as exc:
        logger.warning("SEO connect failed: %s", exc)
        return RedirectResponse(connection.return_url(ret, seo="error", reason=exc.friendly))
    except sync.SyncBusy:
        pass
    return RedirectResponse(connection.return_url(ret, seo="connected"))
