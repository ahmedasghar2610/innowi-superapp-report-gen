"""Sample SEO data, so Marketing → SEO can be used before Search Console and
GA4 are connected.

    python -m scripts.seed_seo_demo            # load 60 sample sites
    python -m scripts.seed_seo_demo --reset    # delete the samples, then load again
    python -m scripts.seed_seo_demo --remove   # delete the samples only

Load the GBP and Ads samples first (seed_gbp_demo, seed_ads_demo) and the
sample sites link to them, so the Local SEO and Paid pillars fill in. The
samples are marked source = DEMO; the first real sync deletes them.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt

from app.db.session import SessionLocal
from app.modules.seo.demo import DemoRefused, load, remove


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--reset", action="store_true", help="delete the sample sites first, then load them again")
    ap.add_argument("--remove", action="store_true", help="delete the sample sites and stop")
    args = ap.parse_args()
    async with SessionLocal() as db:
        if args.remove or args.reset:
            print(f"Removed {await remove(db)} sample sites.")
            if args.remove:
                return
        try:
            t = await load(db, dt.date.today())
        except DemoRefused as exc:
            raise SystemExit(str(exc))
        print(f"Loaded {t['sites']} sample sites: {t['gscDays']:,} Search Console days, {t['pages']} pages, {t['keywords']} tracked keywords. Open Marketing → SEO.")


if __name__ == "__main__":
    asyncio.run(main())
