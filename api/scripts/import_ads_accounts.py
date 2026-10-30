"""Import the account list from the old Google Sheet into the Ads module.

    python -m scripts.import_ads_accounts "Automation - Google Ads Results.xlsx"

Reads the "GBP Dashboard" tab (ACCOUNT NAME, CUSTOMER ID, MANAGER ID, Total
Sales, No of Orders, STATUS): creates the accounts, fills the average-ticket
inputs and links each to a merchant when exactly one merchant has the same
name. Safe to run again (matches on customer ID). The same import is on the
Ads → Unmapped page ("Import from sheet").
"""
from __future__ import annotations

import asyncio
import sys

from app.db.session import SessionLocal
from app.modules.ads.importer import ImportError_, import_accounts


async def main(path: str) -> None:
    with open(path, "rb") as fh:
        data = fh.read()
    async with SessionLocal() as db:
        try:
            r = await import_accounts(db, data)
        except ImportError_ as exc:
            raise SystemExit(str(exc))
    for row in r["rows"]:
        print(f"  {row['action']:8} {row['customerId']}  {row['name']}" + ("  → linked" if row["linkedMerchantId"] else ""))
    print(f"{r['created']} created, {r['updated']} updated, {r['linked']} linked to a merchant.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    asyncio.run(main(sys.argv[1]))
