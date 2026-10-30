"""Screaming Frog crawler endpoints (modules/seo/crawler.py).

`helper_router`: called by helper.py on a PC with Screaming Frog — no user,
the X-Crawler-Key header is the only credential.
`router`: the SEO pages and Settings → Integrations (signed-in users).
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.seo import SeoCrawlerKey, SeoCrawlJob, SeoSite, utcnow
from app.modules.seo import crawler

helper_router = APIRouter(prefix="/seo/crawler", tags=["SEO crawler helper"])
router = APIRouter(prefix="/seo/crawler", tags=["SEO"], dependencies=[Depends(require_capability("seo.view"))])
_manage = Depends(require_capability("seo.manage"))


def _bad(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


# ============================================================ helper ====


async def helper_key(
    db: AsyncSession = Depends(get_db),
    x_crawler_key: Optional[str] = Header(None),
    x_crawler_name: Optional[str] = Header(None),
    x_crawler_version: Optional[str] = Header(None),
) -> SeoCrawlerKey:
    k = await crawler.key_for(db, x_crawler_key)
    if not k:
        raise HTTPException(status_code=401, detail="Unknown or revoked crawler key. Create one in Settings → Integrations → Screaming Frog crawler.")
    crawler.seen(k, x_crawler_name, x_crawler_version)
    await db.commit()
    return k


@helper_router.get("/ping")
async def ping(k: SeoCrawlerKey = Depends(helper_key), db: AsyncSession = Depends(get_db)):
    st = await crawler.status(db)
    return {"ok": True, "key": k.name, "message": f"Hello {k.helper_name or k.name} — {st['queued']} crawl(s) waiting."}


@helper_router.get("/next")
async def next_job(k: SeoCrawlerKey = Depends(helper_key), db: AsyncSession = Depends(get_db)):
    got = await crawler.claim(db, k)
    if not got:
        return {"job": None}
    job, site = got
    return {"job": {"id": job.id, "domain": site.domain, "url": job.url, "siteName": site.name}}


class StatusInput(BaseModel):
    status: Literal["running", "failed"]
    message: Optional[str] = Field(None, max_length=4000)


@helper_router.post("/jobs/{job_id}/status")
async def job_status(job_id: str, dto: StatusInput, k: SeoCrawlerKey = Depends(helper_key), db: AsyncSession = Depends(get_db)):
    try:
        job = await crawler.report(db, k, job_id, dto.status, dto.message)
    except crawler.CrawlerError as exc:
        raise _bad(exc)
    return {"ok": True, "status": job.status}


@helper_router.post("/jobs/{job_id}/result")
async def job_result(
    job_id: str,
    request: Request,
    k: SeoCrawlerKey = Depends(helper_key),
    db: AsyncSession = Depends(get_db),
    x_crawl_duration: Optional[int] = Header(None),
):
    """Body: the Screaming Frog export folder as a zip (Content-Type: application/zip). Accepted at once;
    the crawl is saved and the site rescored right after ("saving" → "done" / "failed" on the SEO pages)."""
    blob = await request.body()
    try:
        return await crawler.receive(db, k, job_id, blob, x_crawl_duration)
    except crawler.CrawlerError as exc:
        raise _bad(exc)


# ============================================================== users ====


@router.get("/status")
async def crawler_status(db: AsyncSession = Depends(get_db)):
    return await crawler.status(db)


class CrawlInput(BaseModel):
    model_config = {"extra": "forbid"}
    siteIds: Optional[list[str]] = Field(None, max_length=500, description="Sites to crawl; omit (or all=true) for every active site")
    all: bool = False


@router.post("/crawl", dependencies=[_manage])
async def crawl(dto: CrawlInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """Queue Screaming Frog crawls. "Crawl all sites" = every active, non-sample site."""
    q = select(SeoSite).where(SeoSite.source != "DEMO").order_by(SeoSite.name)
    if dto.siteIds and not dto.all:
        q = q.where(SeoSite.id.in_(dto.siteIds))
    else:
        q = q.where(SeoSite.status == "active")
    sites = list((await db.execute(q)).scalars())
    if dto.siteIds and not dto.all and len(sites) != len(set(dto.siteIds)):
        raise HTTPException(status_code=404, detail="Site not found")
    return await crawler.queue(db, sites, user.id)


@router.post("/jobs/{job_id}/cancel", dependencies=[_manage])
async def cancel_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(SeoCrawlJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Crawl job not found")
    try:
        await crawler.cancel(db, job)
    except crawler.CrawlerError as exc:
        raise _bad(exc)
    return crawler.job_dto(job, await db.get(SeoSite, job.site_id))


@router.get("/keys", dependencies=[_manage])
async def keys(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SeoCrawlerKey).order_by(SeoCrawlerKey.revoked_at.is_not(None), SeoCrawlerKey.created_at.desc()))).scalars()
    return {"data": [crawler.key_dto(k) for k in rows]}


class KeyInput(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(..., min_length=1, max_length=80)


@router.post("/keys", status_code=201, dependencies=[_manage])
async def create_key(dto: KeyInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """The key is in this answer only — it can't be shown again."""
    try:
        row, key = await crawler.create_key(db, dto.name, user.id)
    except crawler.CrawlerError as exc:
        raise _bad(exc)
    return {**crawler.key_dto(row), "key": key}


@router.delete("/keys/{key_id}", dependencies=[_manage])
async def revoke_key(key_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(SeoCrawlerKey, key_id)
    if not row:
        raise HTTPException(status_code=404, detail="Crawler key not found")
    if not row.revoked_at:
        row.revoked_at = utcnow()
        await db.commit()
    return crawler.key_dto(row)
