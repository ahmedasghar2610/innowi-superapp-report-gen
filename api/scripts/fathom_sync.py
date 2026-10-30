"""Pull new Fathom meetings now — same as Ops CRM → Meetings → "Sync from
Fathom". Handy for a scheduled job (e.g. every 15 minutes) when the API isn't
reachable from the internet for the webhook.

    python -m scripts.fathom_sync
"""
from __future__ import annotations

import asyncio

from app.db.session import SessionLocal
from app.modules.ops.fathom import FathomError, FathomNotConfigured, sync_meetings


async def main() -> int:
    async with SessionLocal() as db:
        try:
            r = await sync_meetings(db)
        except (FathomNotConfigured, FathomError) as exc:
            print(f"Fathom sync failed: {exc}")
            return 1
    print(f"Fathom: {r['fetched']} meetings fetched, {r['added']} new, {r['updated']} updated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
