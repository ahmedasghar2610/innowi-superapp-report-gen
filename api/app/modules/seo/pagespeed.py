"""PageSpeed Insights for one site: mobile performance score + Core Web Vitals per page.

Used by the SEO sync (pages not measured for SEO_PSI_REFRESH_DAYS) and by the
"Check speed" button / scripts/seo_run_pagespeed.py (`force`: measure now).
Read-only public Google API — only PAGESPEED_API_KEY is needed, no Google
connection, so it runs whenever the key is set.
"""
from __future__ import annotations

import asyncio
import datetime as dt
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.seo import SeoPage, SeoSite, utcnow
from app.modules.seo import crawl, google

CONCURRENT = 3  # PSI takes 10–30 s per page; a few at once keeps a button press short


def configured() -> bool:
    s = get_settings()
    return bool(s.PAGESPEED_API_KEY and s.SEO_PSI_PAGES_PER_SITE)


async def run_site(db: AsyncSession, site: SeoSite, http: httpx.AsyncClient, urls: Optional[list[str]] = None,
                   force: bool = False, pages: Optional[dict[str, SeoPage]] = None) -> dict:
    """Measure up to SEO_PSI_PAGES_PER_SITE pages of `site` (default: its checked pages, home first).
    Returns {"checked": n, "errors": [...]}. Caller commits."""
    s = get_settings()
    if not configured():
        return {"checked": 0, "errors": ["PAGESPEED_API_KEY isn't set in the API's .env."]}
    now = utcnow()
    if pages is None:  # the sync passes its own (not yet flushed) page rows
        pages = {p.url: p for p in (await db.execute(select(SeoPage).where(SeoPage.site_id == site.id))).scalars()}
    if urls is None:
        urls = [site.home_url] + sorted((u for u in pages if u != site.home_url), key=lambda u: (pages[u].page_type != "menu", u))
    if site.home_url in urls and site.home_url not in pages:  # never synced yet: measure the home page anyway
        p = SeoPage(site_id=site.id, url=site.home_url, page_type="home")
        db.add(p)
        pages[site.home_url] = p
    due = [pages[u] for u in urls if u in pages and not pages[u].crawl_error
           and (force or not pages[u].psi_at or now - pages[u].psi_at > dt.timedelta(days=s.SEO_PSI_REFRESH_DAYS))]
    due = due[: s.SEO_PSI_PAGES_PER_SITE]
    errors: list[str] = []
    sem = asyncio.Semaphore(CONCURRENT)

    async def one(p: SeoPage):
        async with sem:
            try:
                return p, google.parse_pagespeed(await google.pagespeed(http, p.url, s.PAGESPEED_API_KEY)), None
            except google.GoogleError as exc:
                return p, None, exc.friendly

    checked = 0
    for p, vals, err in await asyncio.gather(*(one(p) for p in due)):
        if err:
            errors.append(f"{crawl.host_of(p.url)}{p.url.split(site.domain, 1)[-1] or '/'}: {err}")
            continue
        for k, v in vals.items():
            setattr(p, k, v)
        p.psi_at = now
        site.last_psi_at = now
        checked += 1
    return {"checked": checked, "errors": errors}
