"""Run an SEO sync (Search Console, GA4, page checks, PageSpeed, tracked keywords)
from the command line — for a nightly schedule or to watch one run.

    python -m scripts.seo_sync          # sync now, print progress
    python -m scripts.seo_sync --quiet  # for schedulers: one summary line

Same code as "Refresh data" in SEO → Connections (modules/seo/sync.py). The API
also syncs every day by itself (SEO_AUTO_SYNC). Exits 1 when the run failed.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.session import SessionLocal
from app.modules.seo import sync


async def main() -> int:
    ap = argparse.ArgumentParser(description="Sync SEO data now.")
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
            f"SEO sync {run.status}: {run.sites} sites ({run.sites_failed} failed), {run.gsc_days} Search Console days, "
            f"{run.pages_checked} pages checked." + (f" {run.error}" if run.error else "")
        )
        return 1 if run.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
