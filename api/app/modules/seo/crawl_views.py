"""Read side of imported Screaming Frog crawls (see sf_import.py)."""
from __future__ import annotations

from typing import Optional

from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import SeoCrawl, SeoCrawlIssue, SeoCrawlPage, SeoSite
from app.modules.seo.views import iso

PRIORITY_ORDER = {"High": 0, "Medium": 1, "Low": 2}

# Site sections (a read-only breakdown of the crawl by part of the site; it doesn't change any score).
SECTIONS = [
    ("home", "Home"), ("menu", "Menu"), ("info", "Ordering & info"), ("location", "Location pages"), ("blog", "Blog & articles"),
    ("other", "Other pages"),
]
INFO_WORDS = {"order", "order-online", "online-ordering", "catering", "contact", "contact-us", "about", "about-us", "hours",
              "faq", "faqs", "reservations", "reserve", "book", "gift-cards", "delivery", "pickup", "locations-hours"}
MENU_FOLDERS = {"menu", "our-menu", "food-menu", "menu-item", "menu-items", "menus", "dish", "dishes", "item", "items",
                "product", "products", "meals", "shop", "food"}
LOCATION_FOLDERS = {"locations", "location", "areas", "area", "service-area", "service-areas", "neighborhoods", "near-me"}
THIN_WORDS = 150  # same threshold as the app's own thin-content check


def section_of(url: str) -> str:
    from urllib.parse import urlparse

    from app.modules.seo.crawl import page_type

    t = page_type(url)
    if t == "home":
        return "home"
    segs = [x.lower() for x in (urlparse(url).path or "/").strip("/").split("/") if x]
    # Folder first: /menu-item/best-in-new-york-…/ is a menu page even though its slug looks like an area page.
    if segs and segs[0] in MENU_FOLDERS:
        return "menu"
    if segs and (segs[0] in INFO_WORDS or segs[-1] in INFO_WORDS):
        return "info"
    if segs and (segs[0] in LOCATION_FOLDERS or segs[0].startswith("service-area")):
        return "location"
    if t in ("hub", "category", "dish"):
        return "menu"
    if t in ("geo", "combo"):
        return "location"
    if t == "blog":
        return "blog"
    # WordPress posts often sit at the root: a long, sentence-like slug is an article.
    if segs and len(segs[-1].split("-")) >= 5:
        return "blog"
    return "other"


def sections(issues: list, pages: list) -> list[dict]:
    """Per section of the site: pages, broken, blocked from Google, pages with errors, average words and the most
    widespread problem. Same error/warning rules as the Audits pillar (scoring.crawl_page_counts)."""
    meta = {i.key: i for i in issues}
    counted = lambda k: k in meta and not (meta[k].priority == "Low" and meta[k].issue_type != "Issue")  # noqa: E731
    groups: dict[str, list] = {k: [] for k, _ in SECTIONS}
    for p in pages:
        if (p.content_type or "").startswith("text/html") or (p.status_code or 0) >= 400:
            groups[section_of(p.url)].append(p)
    out = []
    for key, label in SECTIONS:
        ps = groups[key]
        if not ps:
            continue
        ok = [p for p in ps if p.status_code == 200]
        words = [p.word_count for p in ok if p.word_count is not None]
        errors = sum(1 for p in ps if (p.status_code or 0) >= 400 or any(meta[k].issue_type == "Issue" for k in p.issues if k in meta))
        tally: dict[str, int] = {}
        for p in ps:
            for k in p.issues:
                if counted(k):
                    tally[k] = tally.get(k, 0) + 1
        top = max(tally.items(), key=lambda kv: (kv[1], -PRIORITY_ORDER.get(meta[kv[0]].priority, 3))) if tally else None
        avg = round(sum(words) / len(words)) if words else None
        out.append({
            "key": key, "label": label, "pages": len(ps), "broken": sum(1 for p in ps if (p.status_code or 0) >= 400),
            "blocked": sum(1 for p in ok if p.indexable is False), "withErrors": errors,
            "clean": round((len(ps) - errors) / len(ps) * 100), "avgWords": avg, "thin": avg is not None and avg < THIN_WORDS,
            "examples": [p.path for p in ps[:3]],
            "topIssue": {"key": top[0], "name": meta[top[0]].name, "priority": meta[top[0]].priority, "pages": top[1]} if top else None,
        })
    return out
TYPE_ORDER = {"Issue": 0, "Warning": 1, "Opportunity": 2}


def _crawl_ref(c: SeoCrawl) -> dict:
    return {"id": c.id, "source": c.source, "crawledAt": iso(c.crawled_at), "importedAt": iso(c.imported_at), "totals": c.totals or {}}


async def latest(db: AsyncSession, site: SeoSite) -> Optional[SeoCrawl]:
    return (
        await db.execute(
            select(SeoCrawl).where(SeoCrawl.site_id == site.id).order_by(SeoCrawl.crawled_at.desc().nullslast(), SeoCrawl.imported_at.desc()).limit(1)
        )
    ).scalar_one_or_none()


async def overview(db: AsyncSession, site: SeoSite) -> dict:
    c = await latest(db, site)
    history = (
        await db.execute(select(SeoCrawl).where(SeoCrawl.site_id == site.id).order_by(SeoCrawl.crawled_at.desc().nullslast()).limit(12))
    ).scalars().all()
    if not c:
        return {"crawl": None, "issues": [], "history": [], "sections": []}
    issues = (await db.execute(select(SeoCrawlIssue).where(SeoCrawlIssue.crawl_id == c.id))).scalars().all()
    prev = next((h for h in history if h.id != c.id), None)
    prev_counts: dict[str, int] = {}
    if prev:
        prev_counts = dict((await db.execute(select(SeoCrawlIssue.key, SeoCrawlIssue.urls).where(SeoCrawlIssue.crawl_id == prev.id))).all())
    rows = sorted(issues, key=lambda i: (i.urls == 0, PRIORITY_ORDER.get(i.priority, 3), TYPE_ORDER.get(i.issue_type, 3), -i.urls))
    page_rows = (await db.execute(
        select(SeoCrawlPage).where(SeoCrawlPage.crawl_id == c.id).order_by(SeoCrawlPage.crawl_depth.asc().nullslast(), SeoCrawlPage.path)
    )).scalars().all()
    return {
        "crawl": _crawl_ref(c),
        "sections": sections(issues, page_rows),
        "issues": [
            {"key": i.key, "name": i.name, "type": i.issue_type, "priority": i.priority, "urls": i.urls, "pct": i.pct,
             "description": i.description, "howToFix": i.how_to_fix, "helpUrl": i.help_url, "sample": i.sample, "linksSample": i.links_sample,
             "prevUrls": prev_counts.get(i.key) if prev else None}
            for i in rows
        ],
        "history": [{"id": h.id, "crawledAt": iso(h.crawled_at), "urls": (h.totals or {}).get("urls"), "issueTypes": (h.totals or {}).get("issueTypes")} for h in history],
    }


async def pages(db: AsyncSession, site: SeoSite, q: str, issue: str, kind: str, sort: str, offset: int, limit: int) -> dict:
    c = await latest(db, site)
    if not c:
        return {"total": 0, "rows": [], "issueNames": {}}
    cond = [SeoCrawlPage.crawl_id == c.id]
    if kind == "html":
        cond.append(SeoCrawlPage.content_type.like("text/html%"))
    elif kind == "nonindexable":
        cond += [SeoCrawlPage.content_type.like("text/html%"), SeoCrawlPage.indexable.is_(False)]
    elif kind == "errors":
        cond.append(or_(SeoCrawlPage.status_code >= 300, SeoCrawlPage.status_code == 0))
    if q.strip():
        like = f"%{q.strip().lower()}%"
        cond.append(or_(func.lower(SeoCrawlPage.url).like(like), func.lower(SeoCrawlPage.title).like(like), func.lower(SeoCrawlPage.h1).like(like)))
    if issue:
        cond.append(cast(SeoCrawlPage.issues, Text).like(f'%"{issue}"%'))
    order = {
        "depth": SeoCrawlPage.crawl_depth.asc().nullslast(), "words": SeoCrawlPage.word_count.asc().nullslast(),
        "inlinks": SeoCrawlPage.unique_inlinks.desc().nullslast(), "issues": func.jsonb_array_length(SeoCrawlPage.issues).desc(),
        "response": SeoCrawlPage.response_ms.desc().nullslast(),
    }.get(sort, SeoCrawlPage.link_score.desc().nullslast())
    total = (await db.execute(select(func.count()).select_from(SeoCrawlPage).where(*cond))).scalar_one()
    rows = (await db.execute(select(SeoCrawlPage).where(*cond).order_by(order, SeoCrawlPage.url).offset(offset).limit(limit))).scalars().all()
    names = dict((await db.execute(select(SeoCrawlIssue.key, SeoCrawlIssue.name).where(SeoCrawlIssue.crawl_id == c.id))).all())
    return {
        "total": total,
        "issueNames": names,
        "rows": [
            {"url": p.url, "path": p.path, "contentType": p.content_type, "statusCode": p.status_code, "indexable": p.indexable,
             "indexabilityStatus": p.indexability_status, "title": p.title, "titleLength": p.title_length, "metaDescription": p.meta_description,
             "metaLength": p.meta_length, "h1": p.h1, "canonical": p.canonical, "wordCount": p.word_count, "readability": p.readability,
             "crawlDepth": p.crawl_depth, "inlinks": p.unique_inlinks, "outlinks": p.outlinks, "externalOutlinks": p.external_outlinks,
             "linkScore": p.link_score, "responseMs": p.response_ms, "sizeBytes": p.size_bytes, "redirectUrl": p.redirect_url, "issues": p.issues}
            for p in rows
        ],
    }
