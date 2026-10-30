"""Measure PageSpeed Insights now (mobile score + Core Web Vitals) and update the scorecards.

    python -m scripts.seo_run_pagespeed                       # every active real site
    python -m scripts.seo_run_pagespeed --site orderkabobfusion.com
    python -m scripts.seo_run_pagespeed --site orderkabobfusion.com --site beaniecafeny.com

Same as the "Check speed" button on a site page. Needs PAGESPEED_API_KEY in the
API's .env. Measures up to SEO_PSI_PAGES_PER_SITE pages per site (home page first,
then the pages the sync has already checked). Sample (DEMO) sites are skipped.
Read-only, so it also runs while test mode is on. The daily sync keeps them
fresh afterwards (every SEO_PSI_REFRESH_DAYS).
"""
from __future__ import annotations

import argparse
import asyncio
import sys

import httpx
from sqlalchemy import func, select

from app.config import get_settings
from app.db.session import SessionLocal
from app.models.seo import SeoSite
from app.modules.seo import data, pagespeed
from app.modules.seo.crawl import host_of


async def main() -> int:
    ap = argparse.ArgumentParser(description="Run PageSpeed Insights now.")
    ap.add_argument("--site", action="append", help="domain (repeatable); default: every active real site")
    args = ap.parse_args()
    if not pagespeed.configured():
        print("PAGESPEED_API_KEY isn't set in the API's .env (or SEO_PSI_PAGES_PER_SITE is 0).")
        return 1
    print(f"PageSpeed: up to {get_settings().SEO_PSI_PAGES_PER_SITE} pages per site (mobile).")
    failed = 0
    async with SessionLocal() as db, httpx.AsyncClient(follow_redirects=True) as http:
        q = select(SeoSite).where(SeoSite.source != "DEMO")
        if args.site:
            q = q.where(func.lower(SeoSite.domain).in_([host_of(d) for d in args.site]))
        else:
            q = q.where(SeoSite.status == "active")
        sites = (await db.execute(q.order_by(SeoSite.domain))).scalars().all()
        if not sites:
            print("No matching SEO sites." + (" Check the domain(s) in SEO → Site settings." if args.site else ""))
            return 1
        for s in sites:
            res = await pagespeed.run_site(db, s, http, force=True)
            await data.recompute(db, s, psi_configured=True)
            await db.commit()
            print(f"  {s.domain}: {res['checked']} page(s) measured" + (f" — {'; '.join(res['errors'])}" if res["errors"] else "") + f" · health {s.health if s.health is not None else '—'}")
            failed += bool(res["errors"]) and not res["checked"]
    return 1 if failed == len(sites) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
