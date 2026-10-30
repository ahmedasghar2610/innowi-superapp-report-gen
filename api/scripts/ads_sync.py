"""Run a Google Ads sync from the command line — for a platform cron instead
of the in-API daily schedule (ADS_AUTO_SYNC=false), or to watch one run.

    python -m scripts.ads_sync          # sync now, print progress
    python -m scripts.ads_sync --quiet  # for schedulers: one summary line

Same code as "Refresh data" on the Ads page (modules/ads/sync.py). Exits 1
when the run failed, so a scheduler can alert on it.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.session import SessionLocal
from app.modules.ads import sync


async def main() -> int:
    ap = argparse.ArgumentParser(description="Sync Google Ads data now.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    async with SessionLocal() as db:
        try:
            run = await sync.create_run(db, "cli", None)
        except sync.SyncBusy as exc:
            print(exc)
            return 0
        run = await sync.run_sync(db, run.id, progress=None if args.quiet else print)
        print(
            f"Google Ads sync {run.status}: {run.accounts} accounts ({run.accounts_failed} failed, {run.new_accounts} new), "
            f"{run.metric_rows:,} campaign-days." + (f" {run.error}" if run.error else "")
        )
        return 1 if run.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
