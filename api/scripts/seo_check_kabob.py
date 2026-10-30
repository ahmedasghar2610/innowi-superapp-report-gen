"""Diagnose why a site page doesn't show crawl data.   python -m scripts.seo_check_kabob [domain-part]"""
import asyncio
import sys

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models.seo import SeoCrawl, SeoSite


async def main():
    part = (sys.argv[1] if len(sys.argv) > 1 else "kabob").lower()
    async with SessionLocal() as db:
        sites = (await db.execute(select(SeoSite).where(func.lower(SeoSite.domain).like(f"%{part}%") | func.lower(SeoSite.name).like(f"%{part}%")))).scalars().all()
        if not sites:
            print(f"No SEO site matching '{part}'.")
        for s in sites:
            print(f"SITE {s.name} | domain={s.domain} | id={s.id} | source={s.source} | gbp_linked={bool(s.gbp_location_id)}")
            crawls = (await db.execute(select(SeoCrawl).where(SeoCrawl.site_id == s.id).order_by(SeoCrawl.imported_at.desc()))).scalars().all()
            print(f"  crawls imported: {len(crawls)}")
            for c in crawls[:3]:
                t = c.totals or {}
                nap = t.get("nap") or {}
                print(f"  - imported {c.imported_at:%Y-%m-%d %H:%M} | pages {t.get('html')} | linkMetrics={'yes' if t.get('linkMetrics') else 'no'}"
                      f" | phones={[p['value'] for p in nap.get('phones', [])]} | hours found={len(nap.get('hours', []))}")
            print(f"  open this page: http://localhost:3001/web/seo/sites/{s.id}")


asyncio.run(main())
