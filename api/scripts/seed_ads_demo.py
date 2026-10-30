"""Sample Google Ads data, so Modules → Ads can be used before Google Ads is
connected.

    python -m scripts.seed_ads_demo            # load the sample accounts
    python -m scripts.seed_ads_demo --reset    # delete the samples, then load again
    python -m scripts.seed_ads_demo --remove   # delete the samples only

Marked source = DEMO; every page shows a "Sample data" badge while they exist
and the first real sync deletes them. Deterministic: 25 restaurants with 400
days of daily figures, assets, sitelinks and promotions, plus the cases the
pages must handle — budget mismatches, paused campaigns, verification
required/failed, a sync issue, an archived account and unmapped accounts.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt

from app.db.session import SessionLocal
from app.modules.ads.demo import DemoRefused, load, remove


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--remove", action="store_true")
    args = ap.parse_args()
    async with SessionLocal() as db:
        if args.remove or args.reset:
            print(f"Removed {await remove(db)} sample accounts.")
            if args.remove:
                return
        try:
            t = await load(db, dt.date.today())
        except DemoRefused as exc:
            raise SystemExit(str(exc))
        print(f"Loaded {t['accounts']} sample accounts, {t['campaigns']} campaigns, {t['days']:,} campaign-days. Open Modules → Ads.")


if __name__ == "__main__":
    asyncio.run(main())
