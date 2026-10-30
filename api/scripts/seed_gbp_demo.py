"""Sample Google Business Profile data, so Web & Search → GBP can be used
before Google approves Business Profile API access.

    python -m scripts.seed_gbp_demo            # load 150 sample listings
    python -m scripts.seed_gbp_demo --reset    # delete the samples, then load again
    python -m scripts.seed_gbp_demo --remove   # delete the samples only

The samples go into the same tables the real sync fills, marked
source = DEMO, and every page shows a "Sample data" badge while they exist.
The first real sync deletes them automatically. Generated the same way as the
GBP prototype (deterministic, so every run gives the same data): 150
restaurants across Bay Area / Central Valley cities with daily numbers from
the day each was "added", reviews, posts, offers, monthly search terms, and
the edge cases the reports have to handle — sync failures, delayed data,
listings that need verification, temporarily closed listings, zero-call
periods and listings that stopped posting.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt

from app.db.session import SessionLocal
from app.modules.gbp.demo import DemoRefused, load, remove


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--reset", action="store_true", help="delete the sample listings first, then load them again")
    ap.add_argument("--remove", action="store_true", help="delete the sample listings and stop")
    args = ap.parse_args()
    async with SessionLocal() as db:
        if args.remove or args.reset:
            print(f"Removed {await remove(db)} sample listings.")
            if args.remove:
                return
        try:
            t = await load(db, dt.date.today())
        except DemoRefused as exc:
            raise SystemExit(str(exc))
        print(
            f"Loaded {t['listings']} sample listings: {t['days']:,} days of metrics, {t['reviews']:,} reviews, "
            f"{t['posts']} posts/offers, {t['keywords']} search terms. Open Web & Search → GBP."
        )


if __name__ == "__main__":
    asyncio.run(main())
