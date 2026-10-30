"""
Port of prisma/backfill-completeness.ts. Recomputes and persists
Merchant.profile_completion_pct for every merchant, using the same snapshot
loader + calculator the API uses. Idempotent: only writes rows whose value
changed.

Usage: python -m scripts.backfill_completeness [--dry-run]
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.profiling import Merchant
from app.modules.merchant_profiling.completeness_service import compute_completeness


async def main() -> None:
    dry_run = "--dry-run" in sys.argv

    async with SessionLocal() as db:
        result = await db.execute(select(Merchant).order_by(Merchant.created_at.asc()))
        merchants = result.scalars().all()

        print(f"{'[dry-run] ' if dry_run else ''}Recomputing completeness for {len(merchants)} merchants...")

        changed = 0
        unchanged = 0
        deltas: list[tuple[str, object, int]] = []

        for m in merchants:
            result = await compute_completeness(db, m)
            percent = result.percent
            if percent == m.profile_completion_pct:
                unchanged += 1
                continue
            label = f"{m.merchant_code} {m.restaurant_name}" if m.merchant_code else m.restaurant_name
            deltas.append((label, m.profile_completion_pct, percent))
            if not dry_run:
                m.profile_completion_pct = percent
            changed += 1

        if not dry_run:
            await db.commit()

        for label, before, after in deltas:
            before_str = str(before) if before is not None else "—"
            print(f"  {label:<40} {before_str:>4} -> {after:>3}%")

        print(f"\n{'Would change' if dry_run else 'Changed'} {changed}, unchanged {unchanged}. Re-run: should report 0 changed.")


if __name__ == "__main__":
    asyncio.run(main())
