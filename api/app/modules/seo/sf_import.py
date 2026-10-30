"""Import a Screaming Frog crawl (desktop exports) into one site.

Reads a folder of Screaming Frog CSV exports:

    internal_all.csv                Internal tab → All → Export          (required)
    issues_overview_report.csv      Reports → Issues Overview            (required; root or issues_reports/)
    issues_reports/*.csv            Bulk Export → Issues → All           (sample URLs per issue)
    orphan_pages.csv, redirect_chains.csv, validation_errors_*.csv       (optional, anywhere in the folder)

and stores it in marketing.seo_crawl / seo_crawl_issue / seo_crawl_page. Only
these three tables are written — the synced Search Console / page-check data
is never touched — so `remove()` restores the previous state exactly.

Columns are read by name, so newer Screaming Frog versions that add columns
still import; a missing column just leaves that field empty.
"""
from __future__ import annotations

import collections
import csv
import datetime as dt
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.common import cuid
from app.models.seo import SeoCrawl, SeoCrawlIssue, SeoCrawlPage, SeoSite, utcnow
from app.modules.seo import sf_extras
from app.modules.seo.crawl import host_of

SAMPLE_ROWS = 50
csv.field_size_limit(10_000_000)


class ImportProblem(Exception):
    """Something the person running the import has to fix (wrong folder, unknown site…)."""


# ----------------------------------------------------------------- reading ---


def _read(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _key(text: str) -> str:
    """'Response Codes: Internal Redirection (3xx)' and 'response_codes_internal_redirection_(3xx)'
    → 'responsecodesinternalredirection3xx'. Screaming Frog's doubled 'images_images_…' prefix is folded."""
    return re.sub(r"[^a-z0-9]", "", text.lower()).replace("imagesimages", "images")


def _loose(key: str) -> str:
    """Fallback match where a configured number differs: 'Images: Over 100 kB' ↔ 'images_over_x_kb'.
    Only used when the exact key doesn't match (so H1 and H2 issues never mix)."""
    return re.sub(r"\d+|x(?=kb)", "#", key)


def _int(v) -> Optional[int]:
    try:
        return int(float(str(v).replace(",", ""))) if str(v).strip() not in ("", "-") else None
    except ValueError:
        return None


def _float(v) -> Optional[float]:
    try:
        return float(str(v).replace(",", "")) if str(v).strip() not in ("", "-") else None
    except ValueError:
        return None


def _s(v, n: Optional[int] = None) -> Optional[str]:
    v = (v or "").strip()
    if not v:
        return None
    return v[:n] if n else v


def _find(folder: Path, name: str) -> Optional[Path]:
    direct = folder / name
    if direct.exists():
        return direct
    hits = sorted(folder.rglob(name))
    return hits[0] if hits else None


def _url_of(row: dict) -> Optional[str]:
    return row.get("Address") or row.get("URL") or row.get("Source")


@dataclass
class Parsed:
    domain: str
    crawled_at: Optional[dt.datetime]
    pages: list[dict]
    issues: list[dict]
    totals: dict
    files: int = 0
    unmatched_files: list[str] = field(default_factory=list)


def parse(folder: Path, tz: Optional[str] = None) -> Parsed:
    folder = Path(folder)
    if not folder.is_dir():
        raise ImportProblem(f"Folder not found: {folder}")
    internal = _find(folder, "internal_all.csv")
    overview = _find(folder, "issues_overview_report.csv")
    if not internal:
        raise ImportProblem("internal_all.csv is missing (Internal tab → filter All → Export).")
    if not overview:
        raise ImportProblem("issues_overview_report.csv is missing (Reports → Issues Overview).")

    rows = _read(internal)
    if not rows or "Address" not in rows[0]:
        raise ImportProblem("internal_all.csv has no 'Address' column — is it the Internal → All export?")

    hosts = collections.Counter(host_of(r["Address"]) for r in rows if r.get("Address", "").startswith("http"))
    if not hosts:
        raise ImportProblem("internal_all.csv has no crawled URLs.")
    domain = hosts.most_common(1)[0][0]

    zone = ZoneInfo(tz or get_settings().SEO_TIMEZONE)
    stamps = []
    for r in rows:
        try:
            stamps.append(dt.datetime.strptime(r.get("Crawl Timestamp", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=zone))
        except ValueError:
            pass
    crawled_at = max(stamps).astimezone(dt.timezone.utc) if stamps else None

    # --- issues: overview rows + their bulk-export files ---------------------------
    issue_rows = _read(overview)
    issues: dict[str, dict] = {}
    for r in issue_rows:
        name = _s(r.get("Issue Name"))
        if not name:
            continue
        issues[_key(name)] = {
            "key": _key(name), "name": name[:200], "issue_type": _s(r.get("Issue Type"), 20) or "Issue",
            "priority": _s(r.get("Issue Priority"), 10) or "Low", "urls": _int(r.get("URLs")) or 0,
            "pct": _float(r.get("% of Total")), "description": _s(r.get("Description")),
            "how_to_fix": _s(r.get("How To Fix")), "help_url": _s(r.get("Help URL"), 500),
            "sample": [], "links_sample": [], "_urls": set(),
        }

    loose: dict[str, list[str]] = collections.defaultdict(list)
    for k in issues:
        loose[_loose(k)].append(k)

    skip = {"internal_all.csv", "issues_overview_report.csv", "orphan_pages.csv", "redirect_chains.csv", "link_metrics_all.csv", "custom_extraction_all.csv"}
    files = 0
    unmatched: list[str] = []
    for p in sorted(folder.rglob("*.csv")):
        if p.name in skip or p.name.startswith("validation_errors"):
            continue
        stem = p.stem
        is_links = stem.endswith("_inlinks")
        k = _key(stem[: -len("_inlinks")] if is_links else stem)
        it = issues.get(k)
        if not it and len(loose.get(_loose(k), [])) == 1:
            it = issues[loose[_loose(k)][0]]
        if not it:
            unmatched.append(p.name)
            continue
        files += 1
        data = _read(p)
        if is_links:
            it["links_sample"] = [
                {"source": r.get("Source"), "destination": r.get("Destination"), "anchor": r.get("Anchor") or r.get("Alt Text"),
                 "status": r.get("Status Code")}
                for r in data[:SAMPLE_ROWS]
            ]
        else:
            cols = [c for c in (data[0].keys() if data else []) if c not in ("Address", "URL", "Indexability", "Indexability Status", "Occurrences")][:4]
            it["sample"] = [{"url": _url_of(r), **{c: r.get(c) for c in cols}} for r in data[:SAMPLE_ROWS]]
            it["_urls"] = {u for u in (_url_of(r) for r in data) if u}

    # --- pages ---------------------------------------------------------------------
    by_url: dict[str, list[str]] = collections.defaultdict(list)
    for it in issues.values():
        for u in it["_urls"]:
            by_url[u].append(it["key"])

    order = {"High": 0, "Medium": 1, "Low": 2}
    kinds = {"Issue": 0, "Warning": 1, "Opportunity": 2}

    def rank(k: str) -> tuple:
        it = issues[k]
        return (order.get(it["priority"], 3), kinds.get(it["issue_type"], 3), k)

    pages = []
    for r in rows:
        url = r.get("Address")
        if not url:
            continue
        robots = ", ".join(x for x in (r.get("Meta Robots 1"), r.get("X-Robots-Tag 1")) if x) or None
        rt = _float(r.get("Response Time"))
        pages.append({
            "url": url[:2000], "path": (urlparse(url).path or "/")[:2000] + (f"?{urlparse(url).query}" if urlparse(url).query else ""),
            "content_type": _s((r.get("Content Type") or "").split(";")[0], 80),
            "status_code": _int(r.get("Status Code")),
            "indexable": (r.get("Indexability") == "Indexable") if r.get("Indexability") else None,
            "indexability_status": _s(r.get("Indexability Status"), 120),
            "title": _s(r.get("Title 1")), "title_length": _int(r.get("Title 1 Length")), "title_px": _int(r.get("Title 1 Pixel Width")),
            "meta_description": _s(r.get("Meta Description 1")), "meta_length": _int(r.get("Meta Description 1 Length")),
            "h1": _s(r.get("H1-1")), "h2": _s(r.get("H2-1")),
            "canonical": _s(r.get("Canonical Link Element 1"), 2000), "meta_robots": _s(robots, 200),
            "word_count": _int(r.get("Word Count")), "readability": _float(r.get("Flesch Reading Ease Score")),
            "crawl_depth": _int(r.get("Crawl Depth")), "inlinks": _int(r.get("Inlinks")), "unique_inlinks": _int(r.get("Unique Inlinks")),
            "outlinks": _int(r.get("Outlinks")), "external_outlinks": _int(r.get("External Outlinks")),
            "link_score": _float(r.get("Link Score")), "near_duplicates": _int(r.get("No. Near Duplicates")),
            "response_ms": int(rt * 1000) if rt is not None else None, "size_bytes": _int(r.get("Size (Bytes)")),
            "redirect_url": _s(r.get("Redirect URL"), 2000), "issues": sorted(set(by_url.get(url, [])), key=rank),
        })

    # --- totals --------------------------------------------------------------------
    html = [p for p in pages if (p["content_type"] or "").startswith("text/html")]
    ok_html = [p for p in html if p["status_code"] == 200]
    words = [p["word_count"] for p in ok_html if p["word_count"] is not None]
    resp = [p["response_ms"] for p in html if p["response_ms"] is not None]
    depth = collections.Counter(str(min(p["crawl_depth"], 5)) for p in ok_html if p["crawl_depth"] is not None)
    statuses = collections.Counter(str(p["status_code"] or 0) for p in pages)
    by_priority = collections.Counter(it["priority"] for it in issues.values() if it["urls"])

    def opt_count(name: str) -> Optional[int]:
        p = _find(folder, name)
        return len(_read(p)) if p else None

    schema_file = next(iter(sorted(folder.rglob("validation_errors*.csv"))), None)
    totals = {
        "urls": len(pages), "html": len(html), "indexable": sum(1 for p in html if p["indexable"]),
        "nonIndexable": sum(1 for p in html if p["indexable"] is False),
        "statuses": dict(statuses), "errors4xx": sum(1 for p in pages if 400 <= (p["status_code"] or 0) < 500),
        "errors5xx": sum(1 for p in pages if (p["status_code"] or 0) >= 500),
        "redirects": sum(1 for p in pages if 300 <= (p["status_code"] or 0) < 400),
        "avgWords": round(sum(words) / len(words)) if words else None,
        "avgResponseMs": round(sum(resp) / len(resp)) if resp else None,
        "depth": dict(sorted(depth.items())), "issueTypes": dict(by_priority),
        "issuesWithUrls": sum(1 for it in issues.values() if it["urls"]),
        "orphans": opt_count("orphan_pages.csv"), "redirectChains": opt_count("redirect_chains.csv"),
        "schemaErrors": len(_read(schema_file)) if schema_file else None,
        "nearDuplicatePages": sum(1 for p in ok_html if (p["near_duplicates"] or 0) > 0),
        # Optional exports (sf_extras): None when the folder doesn't have them.
        "linkMetrics": sf_extras.parse_link_metrics(folder, next((p["url"] for p in pages if p["path"] == "/"), None)),
        "nap": sf_extras.parse_nap(folder),
    }
    for it in issues.values():
        it.pop("_urls", None)
    return Parsed(domain=domain, crawled_at=crawled_at, pages=pages, issues=list(issues.values()), totals=totals,
                  files=files, unmatched_files=unmatched)


# ---------------------------------------------------------------- database ---


async def find_site(db: AsyncSession, domain: str) -> SeoSite:
    d = host_of(domain)
    site = (await db.execute(select(SeoSite).where(func.lower(SeoSite.domain) == d))).scalar_one_or_none()
    if not site:
        raise ImportProblem(f"No SEO site with the domain {d}. Add it in SEO → Site settings first, or pass --site <domain>.")
    return site


async def store(db: AsyncSession, site: SeoSite, parsed: Parsed, folder: str) -> SeoCrawl:
    crawl = SeoCrawl(id=cuid(), site_id=site.id, source="screaming_frog", crawled_at=parsed.crawled_at,
                     imported_at=utcnow(), folder=folder[:500], totals=parsed.totals)
    db.add(crawl)
    await db.flush()
    if parsed.issues:
        await db.execute(insert(SeoCrawlIssue), [{"id": cuid(), "crawl_id": crawl.id, **it} for it in parsed.issues])
    for i in range(0, len(parsed.pages), 500):
        await db.execute(insert(SeoCrawlPage), [{"id": cuid(), "crawl_id": crawl.id, **p} for p in parsed.pages[i : i + 500]])
    await db.commit()
    return crawl


async def remove(db: AsyncSession, site: SeoSite, crawl_id: Optional[str] = None) -> int:
    q = delete(SeoCrawl).where(SeoCrawl.site_id == site.id)
    if crawl_id:
        q = q.where(SeoCrawl.id == crawl_id)
    n = (await db.execute(q)).rowcount or 0  # issues and pages go with it (ON DELETE CASCADE)
    await db.commit()
    return n
