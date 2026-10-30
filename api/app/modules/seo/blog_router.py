"""SEO → Blog Impact.

    GET    /seo/blogs/status                 schedule, last run, whether one is running (everyone)
    PUT    /seo/blogs/schedule               auto refresh on/off and its times (seo.manage)
    POST   /seo/blogs/refresh                "Refresh now" (seo.manage)
    GET    /seo/blogs/runs                   recent runs
    GET    /seo/blogs/sites                  sites with their post counts (site picker)
    GET    /seo/blogs/sites/{id}?days=28     the Blog Impact page for one site
    PUT    /seo/blogs/sites/{id}/brand-terms the restaurant's own name(s), left out of "non-brand" (seo.manage)

Read-only towards Google and the websites. Kept apart from the main SEO
router (modules/seo/router.py) on purpose.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.seo import SeoBlogRun, SeoBlogState, SeoSite, utcnow
from app.modules.seo import blog_schedule, blog_views, blogs, connection

router = APIRouter(prefix="/seo/blogs", tags=["SEO"], dependencies=[Depends(require_capability("seo.view"))])
_manage = Depends(require_capability("seo.manage"))


def run_dto(run: Optional[SeoBlogRun]) -> Optional[dict]:
    if not run:
        return None
    return {"id": run.id, "trigger": run.trigger, "status": run.status, "startedAt": run.started_at.isoformat(),
            "finishedAt": run.finished_at.isoformat() if run.finished_at else None, "sites": run.sites,
            "sitesUnchanged": run.sites_unchanged, "sitesFailed": run.sites_failed, "rows": run.rows, "error": run.error}


class ScheduleInput(BaseModel):
    enabled: bool
    times: list[str] = Field(default_factory=list, max_length=20)


class BrandTermsInput(BaseModel):
    terms: list[str] = Field(default_factory=list, max_length=10)


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    sched = await blog_schedule.get(db)
    await db.commit()
    conn = await connection.current(db)
    running = await blogs.running(db)
    total = None
    if running:
        from sqlalchemy import func, select

        total = int((await db.execute(select(func.count()).select_from(blogs.eligible_sites().subquery()))).scalar_one())
    return {"schedule": blog_schedule.dto(sched), "lastRun": run_dto(running or await blogs.last_run(db)), "running": bool(running),
            "sitesTotal": total, "connected": bool(conn and conn.status == "connected"), "inline": jobs.inline()}


@router.put("/schedule", dependencies=[_manage])
async def save_schedule(dto: ScheduleInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    try:
        times = blog_schedule.clean_times(dto.times)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if dto.enabled and not times:
        raise HTTPException(status_code=400, detail="Add at least one time, or switch auto refresh off.")
    sched = await blog_schedule.get(db)
    sched.enabled, sched.times, sched.updated_by_id, sched.updated_at = dto.enabled, times, user.id, utcnow()
    await db.commit()
    return blog_schedule.dto(sched)


@router.post("/refresh", dependencies=[_manage])
async def refresh(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    conn = await connection.current(db)
    if not conn:
        raise HTTPException(status_code=409, detail="Connect Search Console & GA4 first (SEO → Connections).")
    if connection.missing_env():
        raise HTTPException(status_code=409, detail="Add " + ", ".join(connection.missing_env()) + " to the API's settings (environment variables) and redeploy it.")
    try:
        run = await blogs.create_run(db, "manual", user.id)
    except blogs.RunBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await blogs.start(run.id)
    if jobs.inline():  # it already ran inside this request
        await db.refresh(run)
    return run_dto(run)


@router.get("/runs")
async def runs(limit: int = Query(10, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select

    rows = (await db.execute(select(SeoBlogRun).order_by(SeoBlogRun.started_at.desc()).limit(limit))).scalars().all()
    return {"data": [run_dto(r) for r in rows]}


@router.get("/sites")
async def sites(db: AsyncSession = Depends(get_db)):
    return {"data": await blog_views.site_list(db)}


async def _site(db: AsyncSession, site_id: str) -> SeoSite:
    s = await db.get(SeoSite, site_id)
    if not s:
        raise HTTPException(status_code=404, detail="Site not found")
    return s


@router.get("/sites/{site_id}")
async def site_impact(
    site_id: str,
    days: int = Query(28, ge=7, le=180),
    country: Literal["all", "us"] = Query("all", description="all: every country; us: searches and visits from the United States only"),
    db: AsyncSession = Depends(get_db),
):
    return await blog_views.impact(db, await _site(db, site_id), days, country=country)


@router.put("/sites/{site_id}/brand-terms", dependencies=[_manage])
async def brand_terms(site_id: str, dto: BrandTermsInput, db: AsyncSession = Depends(get_db)):
    site = await _site(db, site_id)
    terms = []
    for t in dto.terms:
        t = " ".join((t or "").lower().split())[:60]
        if len(t) >= 2 and t not in terms:
            terms.append(t)
    if len(terms) > 5:
        raise HTTPException(status_code=400, detail="At most 5 brand terms (Search Console takes 5 filters at a time).")
    state = await db.get(SeoBlogState, site.id)
    if not state:
        state = SeoBlogState(site_id=site.id, brand_terms=terms)
        db.add(state)
    if list(state.brand_terms or []) != terms:
        state.brand_terms = terms
        await blogs.reset_nonbrand(db, site.id)  # non-brand history is fetched again with the new terms
    await db.commit()
    return {"brandTerms": terms}
