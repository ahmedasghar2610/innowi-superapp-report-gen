"""Import a Screaming Frog crawl (desktop CSV exports) into one SEO site.

    python -m scripts.seo_import_sf --folder "C:\\Users\\HP\\Desktop\\Innowi\\Super_app\\screamingfrog"
    python -m scripts.seo_import_sf --folder <folder> --dry-run          # read + summarise, write nothing
    python -m scripts.seo_import_sf --folder <folder> --site beaniecafeny.com   # if the domain differs
    python -m scripts.seo_import_sf --remove beaniecafeny.com            # undo: delete this site's imported crawls

The site is found from the crawled domain (it must already exist in SEO → Site
settings). Each import adds a new crawl; the site page shows the newest one.
After an import or --remove the site's scorecard and findings are recomputed at
once: a crawl newer than 90 days scores the Audits pillar and raises crawl
findings (modules/seo/scoring.py, rules.py). --remove takes the crawls out and
recomputes, so the scores go back to the app's own page checks.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from app.db.session import SessionLocal
from app.modules.seo import data, pagespeed, sf_import


async def rescore(db, site) -> None:
    before = site.health
    out = await data.recompute(db, site, psi_configured=pagespeed.configured())
    await db.commit()
    au = (site.pillars or {}).get("pillars", {}).get("au", {})
    c = out["findings"]
    print(f"Scorecard updated: health {before if before is not None else '—'} → {site.health if site.health is not None else '—'}"
          f" · Audits {au.get('score', '—')} · findings {c['new']} new, {c['resolved'] + c['verified']} closed.")


async def main() -> int:
    ap = argparse.ArgumentParser(description="Import a Screaming Frog crawl into an SEO site.")
    ap.add_argument("--folder", help="Folder with internal_all.csv, issues_overview_report.csv and issues_reports/")
    ap.add_argument("--site", help="Site domain to import into (default: the crawled domain)")
    ap.add_argument("--dry-run", action="store_true", help="Read and summarise only; write nothing")
    ap.add_argument("--remove", metavar="DOMAIN", help="Delete every imported crawl of this site")
    args = ap.parse_args()

    try:
        async with SessionLocal() as db:
            if args.remove:
                site = await sf_import.find_site(db, args.remove)
                n = await sf_import.remove(db, site)
                print(f"Removed {n} imported crawl(s) from {site.domain}.")
                await rescore(db, site)
                return 0
            if not args.folder:
                ap.error("--folder is required (or --remove DOMAIN)")
            folder = Path(args.folder).expanduser()
            parsed = sf_import.parse(folder)
            t = parsed.totals
            print(f"Crawl of {parsed.domain} · {parsed.crawled_at:%Y-%m-%d %H:%M} UTC" if parsed.crawled_at else f"Crawl of {parsed.domain}")
            print(f"  {t['urls']} URLs ({t['html']} HTML · {t['indexable']} indexable · {t['nonIndexable']} non-indexable)")
            print(f"  status codes {t['statuses']} · avg {t['avgWords']} words · avg response {t['avgResponseMs']} ms")
            print(f"  {t['issuesWithUrls']} issue types with URLs {t['issueTypes']} · {parsed.files} issue files matched")
            if parsed.unmatched_files:
                print(f"  not matched to an overview row (ignored): {', '.join(parsed.unmatched_files)}")
            site = await sf_import.find_site(db, args.site or parsed.domain)
            if args.dry_run:
                print(f"Dry run — would import into {site.name} ({site.domain}). Nothing written.")
                return 0
            crawl = await sf_import.store(db, site, parsed, str(folder))
            print(f"Imported into {site.name} ({site.domain}) — crawl {crawl.id}.")
            await rescore(db, site)
            print(f"Undo with: python -m scripts.seo_import_sf --remove {site.domain}")
            return 0
    except sf_import.ImportProblem as exc:
        print(f"Can't import: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
