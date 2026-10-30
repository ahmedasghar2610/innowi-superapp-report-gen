"""
One-time sync for visually edited websites.

Pages saved by an earlier version could hold visual edits that never reached
the form or the merchant Profile — typically a Profile field (hours, phone…)
changed in the /admin editor while those fields were read-only, or text edited
before the page's first save. This runs every edited site through the normal
save logic once: those edits are written back (Profile fields to the merchant
Profile, everything else to the form answers) and the pages re-stamped.

Safe to run more than once — a site with nothing pending is left as it is.
Sites edited before form syncing existed (no data-bind in their pages) are
skipped; they need "Rebuild from form" once.

Run from the API folder:
    python -m scripts.sync_edited_pages            # apply
    python -m scripts.sync_edited_pages --dry-run  # only report
"""
from __future__ import annotations

import asyncio
import copy
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.website import Website
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.websites import binding
from app.modules.websites.editor import apply_editor_save
from app.modules.websites.merchant_link import profile_values
from app.modules.websites.service import MERCHANT_OPTS


async def main(dry_run: bool) -> None:
    async with SessionLocal() as db:
        sites = (await db.execute(select(Website).options(*MERCHANT_OPTS).where(Website.editor_content.is_not(None)))).scalars().all()
        touched = 0
        for site in sites:
            content = site.editor_content or {}
            if not content.get("pages"):
                continue  # never edited in /admin (JSON null)
            if not binding.has_bindings(content):
                print(f"  skip  /{site.slug:<28} edited before syncing existed — use 'Rebuild from form' once")
                continue
            before_values = copy.deepcopy(site.values or {})
            before_profile = profile_values(site.merchant) if site.merchant else {}
            _pages, profile_changed = apply_editor_save(site, content.get("pages") or {}, content.get("site") or {})
            after_profile = profile_values(site.merchant) if site.merchant else {}
            form_changed = site.values != before_values
            if not profile_changed and not form_changed:
                print(f"  ok    /{site.slug:<28} nothing pending")
                continue
            touched += 1
            for k in profile_changed:
                print(f"  sync  /{site.slug:<28} Profile {k}: {before_profile.get(k)!r} -> {after_profile.get(k)!r}")
            if form_changed:
                print(f"  sync  /{site.slug:<28} form answers updated from the page")
            if profile_changed and site.merchant:
                await db.flush()
        if dry_run:
            await db.rollback()
            print(f"[sync-edited-pages] dry run — {touched} site(s) would change; nothing saved.")
            return
        await db.commit()
        for site in sites:
            if site.merchant_id:
                await refresh_completion_cache(db, site.merchant_id)
        print(f"[sync-edited-pages] done — {touched} site(s) synced.")


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
