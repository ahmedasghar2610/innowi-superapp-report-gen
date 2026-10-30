"""Run a Google Business Profile sync from the command line — for a nightly
schedule (Windows Task Scheduler / cron) or to watch one run.

    python -m scripts.gbp_sync          # sync now, print progress
    python -m scripts.gbp_sync --quiet  # for schedulers: one summary line

Same code as "Sync now" on the GBP page (modules/gbp/sync.py). Exits 1 when the
run failed, so a scheduler can alert on it. Suggested schedule: once a day,
early morning — Google publishes each day's numbers 2–5 days late, so more
often adds nothing.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.session import SessionLocal
from app.modules.gbp import sync


async def main() -> int:
    ap = argparse.ArgumentParser(description="Sync Google Business Profile data now.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    async with SessionLocal() as db:
        try:
            run = await sync.create_run(db, "schedule", None)
        except sync.SyncBusy as exc:
            print(exc)
            return 0
        run = await sync.run_sync(db, run.id, progress=None if args.quiet else print)
        print(
            f"GBP sync {run.status}: {run.locations} listings ({run.locations_failed} failed), "
            f"{run.metric_days} metric days, {run.reviews} reviews." + (f" {run.error}" if run.error else "")
        )
        return 1 if run.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
