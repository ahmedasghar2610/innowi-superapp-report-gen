"""
Seeds the quote builder's price list from Innowi's price sheet
(app/modules/quotes/price_sheet.py).

Insert-only: a SKU that already exists is left exactly as it is, so prices
edited in the Super App are never overwritten by a deploy. New SKUs added to
the sheet module are inserted on the next run.

    python -m scripts.seed_quotes             # add missing SKUs
    python -m scripts.seed_quotes --dry-run   # report, write nothing
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.quotes import PriceItem
from app.modules.quotes.price_sheet import PRICE_SHEET


async def main(dry_run: bool = False) -> int:
    async with SessionLocal() as db:
        existing = set((await db.execute(select(PriceItem.sku))).scalars())
        added = 0
        for order, item in enumerate(PRICE_SHEET):
            if item["sku"] in existing:
                continue
            added += 1
            if dry_run:
                print(f"would add {item['sku']}: {item['name']}")
                continue
            db.add(PriceItem(
                sku=item["sku"], name=item["name"], description=item.get("description"), note=item.get("note"),
                section=item["section"], kind=item["kind"], unit_label=item.get("unit_label"),
                monthly_price=item.get("monthly_price"), purchase_price=item.get("purchase_price"),
                lease_price=item.get("lease_price"), is_station=item.get("is_station", False), bundled_in_sku=item.get("bundled_in_sku"),
                selectable=item.get("selectable", True), max_qty=item.get("max_qty", 20), sort_order=(order + 1) * 10,
            ))
        if not dry_run:
            await db.commit()
    print(f"Quote price list: {added} added, {len(existing)} already present.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    raise SystemExit(asyncio.run(main(parser.parse_args().dry_run)))
