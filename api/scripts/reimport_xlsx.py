"""
Port of prisma/reimport-xlsx.ts. Wipes every merchant (and everything Postgres
cascades from it) and every account manager, then reloads the workbook from
scratch and recomputes completeness — in one process, three phases:

    1. RESET     delete all merchants (cascades to locations, contacts,
                 subscription, brand profile/assets, keywords, competitors,
                 catering, access items, field verifications, merchant
                 services, documents, delivery, baselines, promotions,
                 scorecard, opportunities) and all account managers.
    2. IMPORT    scripts/import_xlsx.py — exactly the normal importer.
    3. BACKFILL  scripts/backfill_completeness.py — recompute the cached
                 percent for every re-created merchant.

What survives, on purpose:
    - auth.user / refresh tokens      you stay logged in
    - catalog (packages/services)     seeded reference data the import needs
    - audit.audit_log                 append-only history; old rows keep their
                                       (now dangling) merchant ids as a record
    - uploaded files in STORAGE_DIR   unless --purge-files is given. Uploads
                                       are not in the workbook, so a reset
                                       orphans them; keep them if you plan to
                                       re-attach, purge them for a clean slate.

The importer alone is already idempotent (it matches on Merchant ID / code).
Use THIS when you want rows removed from the sheet to disappear, or after
hand-edits you want to throw away.

Usage:
    python -m scripts.reimport_xlsx "Merchant_Profile_System.xlsx" [--purge-files]
    (or set XLSX_PATH)
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.profiling import AccountManager, Merchant


def _count_files(directory: Path) -> int:
    if not directory.exists():
        return 0
    return sum(1 for p in directory.rglob("*") if p.is_file())


async def reset(purge_files: bool, storage_dir: Path) -> None:
    async with SessionLocal() as db:
        before = (await db.execute(Merchant.__table__.select())).all()
        before_count = len(before)

        m_result = await db.execute(delete(Merchant))
        am_result = await db.execute(delete(AccountManager))
        await db.commit()

        m_count = m_result.rowcount if m_result.rowcount is not None else 0
        am_count = am_result.rowcount if am_result.rowcount is not None else 0
        print(
            f"RESET    removed {m_count} of {before_count} merchants "
            f"(and every owned row) and {am_count} account managers"
        )

    if purge_files:
        n = _count_files(storage_dir)
        try:
            shutil.rmtree(storage_dir)
        except FileNotFoundError:
            pass
        print(f"RESET    purged {n} uploaded file(s) from {storage_dir}")
    else:
        n = _count_files(storage_dir)
        if n > 0:
            print(
                f"RESET    kept {n} uploaded file(s) in {storage_dir} — now "
                f"orphaned (no rows point at them). Add --purge-files to remove them."
            )


async def main() -> None:
    args = sys.argv[1:]
    purge_files = "--purge-files" in args
    xlsx_arg = next((a for a in args if not a.startswith("--")), None)
    xlsx_path = xlsx_arg or os.environ.get("XLSX_PATH", "Merchant_Profile_System.xlsx")
    storage_dir = Path(os.environ.get("STORAGE_DIR", "./storage")).resolve()

    print(f"Workbook: {xlsx_path}")
    await reset(purge_files, storage_dir)

    print("\nIMPORT   import_xlsx.py", xlsx_path)
    sys.argv = ["import_xlsx.py", xlsx_path]
    from scripts import import_xlsx

    await import_xlsx.main()

    print("\nBACKFILL backfill_completeness.py")
    from scripts import backfill_completeness

    sys.argv = ["backfill_completeness.py"]
    await backfill_completeness.main()

    print("\nDone. Merchants reloaded from the workbook and scored.")


if __name__ == "__main__":
    asyncio.run(main())
