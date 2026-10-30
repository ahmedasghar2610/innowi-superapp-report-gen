"""
Transfers the standalone `website-api` service's records into this database.

Two sources, in order of preference:

1. **The bundled snapshot** — `scripts/data/websites_seed.json`, exported from
   that service's SQLite file. This is the default, so the seed works on any
   machine (CI, a fresh container, a colleague's laptop) without the old
   project checked out next to this one.

2. **A live SQLite file** — `--from-sqlite <path>` reads `website_api.db`
   directly, for when that service has been written to since the snapshot was
   taken. `--from-sqlite` also rewrites the snapshot unless `--no-write-snapshot`
   is passed, so the export stays current.

Records keep their original `web_…` ids and slugs: the Super App's frontend
holds the ids and the public site template resolves pages by slug, so changing
either would orphan a published site.

Idempotent by default — a slug that already exists is left alone.

    python -m scripts.seed_websites                    # add what's missing
    python -m scripts.seed_websites --update           # also refresh existing records
    python -m scripts.seed_websites --reset            # delete every website first
    python -m scripts.seed_websites --from-sqlite ../website-api/website_api.db
    python -m scripts.seed_websites --dry-run          # report, write nothing
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select

from app.schemas.website import normalise_status
from app.db.session import SessionLocal
from app.models.website import Website
from app.modules.websites.service import slugify, summarise, unique_slug

SNAPSHOT = Path(__file__).resolve().parent / "data" / "websites_seed.json"

#: Where the standalone service kept its database, relative to this repo.
DEFAULT_SQLITE = Path(__file__).resolve().parent.parent.parent / "website-api" / "website_api.db"


# ---------------------------------------------------------------- sources

def from_snapshot(path: Path = SNAPSHOT) -> list[dict[str, Any]]:
    if not path.is_file():
        print(f"No snapshot at {path} — nothing to seed.")
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return list(payload.get("websites", []))


def from_sqlite(path: Path) -> list[dict[str, Any]]:
    """Read the standalone service's SQLite table directly."""
    if not path.is_file():
        raise SystemExit(f"No SQLite database at {path}")

    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT id, slug, name, status, values_json, notes FROM websites ORDER BY created_at"
        ).fetchall()
    finally:
        con.close()

    out: list[dict[str, Any]] = []
    for row in rows:
        record = dict(row)
        try:
            values = json.loads(record.get("values_json") or "{}")
        except json.JSONDecodeError as exc:
            print(f"Skipped {record.get('id')}: unreadable values_json ({exc})")
            continue
        out.append(
            {
                "id": record["id"],
                # Pre-slug databases may not have one; derive it as the service did.
                "slug": record.get("slug") or slugify(record.get("name") or "site"),
                "status": normalise_status(record.get("status") or "in_creation"),
                "notes": record.get("notes") or "",
                "values": values,
            }
        )
    return out


def write_snapshot(records: list[dict[str, Any]], path: Path = SNAPSHOT) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_comment": (
            "Snapshot of the standalone website-api service's SQLite database "
            "(website_api.db). Loaded by scripts/seed_websites.py. "
            "name/tagline/contactEmail are intentionally absent: the server derives "
            "them from values.business.* on every write."
        ),
        "source": "website-api/website_api.db",
        "websites": records,
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Refreshed the snapshot at {path} ({len(records)} record(s)).")


# ------------------------------------------------------------------ seed

async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="Delete every website before seeding.")
    parser.add_argument("--update", action="store_true", help="Refresh records that already exist.")
    parser.add_argument(
        "--from-sqlite",
        nargs="?",
        const=str(DEFAULT_SQLITE),
        metavar="PATH",
        help=f"Read the standalone service's SQLite file instead of the snapshot (default {DEFAULT_SQLITE}).",
    )
    parser.add_argument("--no-write-snapshot", action="store_true", help="With --from-sqlite, don't rewrite the snapshot.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change; write nothing.")
    args = parser.parse_args()

    if args.from_sqlite:
        records = from_sqlite(Path(args.from_sqlite).expanduser())
        print(f"Read {len(records)} record(s) from {args.from_sqlite}.")
        if records and not args.no_write_snapshot and not args.dry_run:
            write_snapshot(records)
    else:
        records = from_snapshot()
        print(f"Read {len(records)} record(s) from {SNAPSHOT.name}.")

    if not records:
        return

    created = updated = skipped = 0

    async with SessionLocal() as db:
        if args.reset:
            if args.dry_run:
                total = await db.scalar(select(Website.id).limit(1))
                print("Would delete every existing website." if total else "Nothing to delete.")
            else:
                result = await db.execute(delete(Website))
                await db.commit()
                print(f"Removed {result.rowcount} existing website(s).")

        for record in records:
            values = record.get("values") or {}
            summary = summarise(values)
            slug = record.get("slug") or summary["name"]

            existing = await db.scalar(select(Website).where(Website.slug == slug))
            if existing is None and record.get("id"):
                # Same record under a different slug — match on the id it was
                # created with so a re-slugged site isn't imported twice.
                existing = await db.get(Website, record["id"])

            if existing is not None and not args.update:
                print(f"Skipped /{slug} — already present (use --update to refresh).")
                skipped += 1
                continue

            if args.dry_run:
                print(f"Would {'update' if existing else 'create'} /{slug} ({summary['name']}).")
                updated += bool(existing)
                created += not existing
                continue

            if existing is not None:
                existing.values = values
                existing.status = record.get("status") or existing.status
                existing.notes = record.get("notes") or ""
                for column, value in summary.items():
                    setattr(existing, column, value)
                print(f"Updated /{existing.slug} ({existing.name}).")
                updated += 1
                continue

            fields: dict[str, Any] = {
                "slug": await unique_slug(db, slug),
                "status": normalise_status(record.get("status") or "in_creation"),
                "values": values,
                "notes": record.get("notes") or "",
                **summary,
            }
            # Keep the original id when the source has one — the Super App's
            # frontend holds it. Omit the key entirely otherwise so the
            # column default generates a fresh `web_…`.
            if record.get("id"):
                fields["id"] = record["id"]

            website = Website(**fields)
            db.add(website)
            print(f"Created /{website.slug} ({summary['name']}, {website.status}).")
            created += 1

        if not args.dry_run:
            await db.commit()

    verb = "Would seed" if args.dry_run else "Seeded"
    print(f"{verb}: {created} created, {updated} updated, {skipped} left alone.")


if __name__ == "__main__":
    asyncio.run(main())
