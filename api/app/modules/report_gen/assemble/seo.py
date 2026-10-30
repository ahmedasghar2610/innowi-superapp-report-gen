"""Search section (PRD A SEO01–SEO09, SEO14) for one merchant and one month.

Reads the SEO module's tables (column selects only) and its public helpers:
`seo.data.gsc_window` for month totals with the impression-weighted position,
`seo.report_v2.branded_split` for the branded / generic split (tracked queries
only: Search Console gives the top 1,000 per month). Several active sites are
summed; the search-term tables are merged across them."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import SeoFinding, SeoGscPage, SeoGscQuery, SeoGscSplit, SeoSite
from app.modules.report_gen.assemble import Ctx, metric, not_supplied, section
from app.modules.seo import data as seo_data
from app.modules.seo import report_v2

READS = {
    "marketing.seo_site": ("id", "name", "domain", "merchant_id", "gsc_property", "source", "status", "last_gsc_date"),
    "marketing.seo_gsc_daily": ("site_id", "date", "clicks", "impressions", "position"),
    "marketing.seo_gsc_query": ("site_id", "month", "query", "clicks", "impressions", "position"),
    "marketing.seo_gsc_page": ("site_id", "month", "page", "clicks", "impressions", "position"),
    "marketing.seo_gsc_split": ("site_id", "month", "dimension", "key", "clicks", "impressions", "position"),
    "marketing.seo_finding": ("site_id", "severity", "title", "state", "outcome", "closed_at"),
}

_IDS = (
    ("SEO01", "Organic clicks", "count"), ("SEO02", "Impressions", "count"), ("SEO03", "Click-through rate", "pct"),
    ("SEO04", "Average position", "position"), ("SEO05", "Branded vs non-branded clicks", "count"), ("SEO06", "Top queries", "table"),
    ("SEO07", "Local and near-me queries", "table"), ("SEO08", "Top pages", "table"), ("SEO09", "Device split", "table"),
    ("SEO14", "Fixes completed", "count"),
)
LOCAL_WORDS = ("near me", "nearby", "near by", "close to me", "open now", "delivery", "takeout", "take out")


def _r(v: Optional[float], nd: int = 2) -> Optional[float]:
    return None if v is None else round(v, nd)


def _sum_windows(windows: list[dict]) -> dict:
    clicks = sum(w["clicks"] for w in windows)
    impr = sum(w["impressions"] for w in windows)
    pos_w = sum(w["position"] * w["impressions"] for w in windows if w["position"] is not None)
    return {"clicks": clicks, "impressions": impr, "position": (pos_w / impr) if impr and pos_w else None}


def is_local(query: str, city: Optional[str]) -> bool:
    q = query.lower()
    return any(w in q for w in LOCAL_WORDS) or bool(city and city.lower() in q)


def compute(sites: list[dict], cur: dict, prev: dict, queries: list[dict], prev_queries: list[dict], pages: list[dict],
            devices_cur: list[dict], devices_prev: list[dict], fixed: int, fixed_prev: int, open_count: int,
            city: Optional[str], merchant_name: str) -> dict:
    """Pure. sites: [{id, name, domain, gscProperty, lastGscDate}]; cur / prev: summed windows
    {clicks, impressions, position}; queries / pages: this month's rows; devices: split rows."""
    if not sites:
        return section("search", metrics=[not_supplied(i, l, "seo_not_linked", u) for i, l, u in _IDS], note="No website is linked to this merchant for search data.")
    if not any(s.get("gscProperty") for s in sites):
        return section("search", metrics=[not_supplied(i, l, "gsc_not_connected", u) for i, l, u in _IDS],
                       note="Search Console is not connected for this website.", sources=[f"Search Console · {s['domain']}" for s in sites])
    if not cur["impressions"] and not cur["clicks"]:
        return section("search", metrics=[not_supplied(i, l, "no_data_in_period", u) for i, l, u in _IDS],
                       note="No Search Console data was recorded for this month.", sources=[f"Search Console · {s['domain']}" for s in sites])

    ctr = cur["clicks"] / cur["impressions"] if cur["impressions"] else None
    ctr_p = prev["clicks"] / prev["impressions"] if prev["impressions"] else None
    name = merchant_name or sites[0]["name"]
    domain = sites[0]["domain"]
    split = report_v2.branded_split([{"query": q["query"], "clicks": q["clicks"], "impressions": q["impressions"]} for q in queries], name, domain) if queries else None
    split_p = report_v2.branded_split([{"query": q["query"], "clicks": q["clicks"], "impressions": q["impressions"]} for q in prev_queries], name, domain) if prev_queries else None
    prev_by_q = {q["query"]: q for q in prev_queries}
    top_queries = [{"query": q["query"], "clicks": q["clicks"], "impressions": q["impressions"], "position": _r(q["position"]),
                    "prevClicks": prev_by_q.get(q["query"], {}).get("clicks")} for q in sorted(queries, key=lambda q: (-q["clicks"], -q["impressions"]))[:10]]
    local = [{"query": q["query"], "clicks": q["clicks"], "impressions": q["impressions"], "position": _r(q["position"])}
             for q in sorted((q for q in queries if is_local(q["query"], city)), key=lambda q: (-q["impressions"], -q["clicks"]))[:10]]
    top_pages = [{"page": p["page"], "clicks": p["clicks"], "impressions": p["impressions"], "position": _r(p["position"])}
                 for p in sorted(pages, key=lambda p: (-p["clicks"], -p["impressions"]))[:10]]
    devices = report_v2.device_rows(devices_cur, devices_prev) if devices_cur else []
    tracked_share = (split["trackedClicks"] / cur["clicks"]) if split and cur["clicks"] else None

    metrics = [
        metric("SEO01", "Organic clicks", cur["clicks"], prev["clicks"]),
        metric("SEO02", "Impressions", cur["impressions"], prev["impressions"]),
        metric("SEO03", "Click-through rate", _r(ctr, 4), _r(ctr_p, 4), unit="pct"),
        metric("SEO04", "Average position", _r(cur["position"]), _r(prev["position"]), unit="position"),
        metric("SEO05", "Branded vs non-branded clicks", split["branded"]["clicks"] if split else None,
               split_p["branded"]["clicks"] if split_p else None, reason=None if split else "no_queries_stored"),
        metric("SEO06", "Top queries", len(top_queries) if queries else None, None, unit="table", reason=None if queries else "no_queries_stored"),
        metric("SEO07", "Local and near-me queries", len(local) if queries else None, None, unit="table", reason=None if queries else "no_queries_stored"),
        metric("SEO08", "Top pages", len(top_pages) if pages else None, None, unit="table", reason=None if pages else "no_queries_stored"),
        metric("SEO09", "Device split", len(devices) if devices else None, None, unit="table", reason=None if devices else "no_queries_stored"),
        metric("SEO14", "Fixes completed", fixed, fixed_prev),
    ]
    tables = {
        "topQueries": top_queries, "localQueries": local, "topPages": top_pages, "devices": devices,
        "branded": ({"branded": split["branded"], "generic": split["generic"], "brandedShare": split["brandedShare"],
                     "trackedClicks": split["trackedClicks"], "trackedShareOfClicks": _r(tracked_share, 4)} if split else None),
        "issues": {"openCount": open_count, "fixedThisMonth": fixed},
    }
    through = max((s["lastGscDate"] for s in sites if s.get("lastGscDate")), default=None)
    note = None
    if split:
        note = f"Branded share covers tracked search terms ({split['trackedClicks']} of {cur['clicks']} clicks)."
    return section("search", metrics=metrics, tables=tables, note=note, data_through=through,
                   sources=[f"Search Console · {s['domain']}" for s in sites if s.get("gscProperty")])


async def build(db: AsyncSession, ctx: Ctx) -> dict:
    rows = (await db.execute(select(SeoSite.id, SeoSite.name, SeoSite.domain, SeoSite.gsc_property, SeoSite.last_gsc_date)
                             .where(SeoSite.merchant_id == ctx.merchant_id, SeoSite.status == "active", SeoSite.source != "DEMO")
                             .order_by(SeoSite.name))).all()
    sites = [{"id": r.id, "name": r.name, "domain": r.domain, "gscProperty": r.gsc_property, "lastGscDate": r.last_gsc_date} for r in rows]
    gsc_ids = [s["id"] for s in sites if s["gscProperty"]]
    if not gsc_ids:
        return compute(sites, {"clicks": 0, "impressions": 0, "position": None}, {"clicks": 0, "impressions": 0, "position": None},
                       [], [], [], [], [], 0, 0, 0, ctx.merchant.get("city"), ctx.merchant["name"])
    p, q = ctx.period, ctx.prev
    cur = _sum_windows([await seo_data.gsc_window(db, sid, p.start, p.end) for sid in gsc_ids])
    prev = _sum_windows([await seo_data.gsc_window(db, sid, q.start, q.end) for sid in gsc_ids])

    async def month_queries(month: dt.date) -> list[dict]:
        r = (await db.execute(select(SeoGscQuery.query, func.sum(SeoGscQuery.clicks), func.sum(SeoGscQuery.impressions),
                                     func.max(SeoGscQuery.position))
                              .where(SeoGscQuery.site_id.in_(gsc_ids), SeoGscQuery.month == month)
                              .group_by(SeoGscQuery.query).order_by(func.sum(SeoGscQuery.clicks).desc(), func.sum(SeoGscQuery.impressions).desc())
                              .limit(1000))).all()
        return [{"query": a, "clicks": int(b), "impressions": int(c), "position": float(d) if d is not None else None} for a, b, c, d in r]

    queries = await month_queries(p.start)
    prev_queries = await month_queries(q.start)
    page_rows = (await db.execute(select(SeoGscPage.page, func.sum(SeoGscPage.clicks), func.sum(SeoGscPage.impressions), func.max(SeoGscPage.position))
                                  .where(SeoGscPage.site_id.in_(gsc_ids), SeoGscPage.month == p.start)
                                  .group_by(SeoGscPage.page).order_by(func.sum(SeoGscPage.clicks).desc()).limit(50))).all()
    pages = [{"page": a, "clicks": int(b), "impressions": int(c), "position": float(d) if d is not None else None} for a, b, c, d in page_rows]

    async def devices(month: dt.date) -> list[dict]:
        r = (await db.execute(select(SeoGscSplit.key, func.sum(SeoGscSplit.clicks), func.sum(SeoGscSplit.impressions), func.max(SeoGscSplit.position))
                              .where(SeoGscSplit.site_id.in_(gsc_ids), SeoGscSplit.month == month, SeoGscSplit.dimension == "device")
                              .group_by(SeoGscSplit.key))).all()
        return [{"key": a, "clicks": int(b), "impressions": int(c), "position": float(d) if d is not None else None} for a, b, c, d in r]

    t0 = dt.datetime.combine(p.start, dt.time.min, tzinfo=dt.timezone.utc)
    t1 = dt.datetime.combine(p.end, dt.time.max, tzinfo=dt.timezone.utc)
    u0 = dt.datetime.combine(q.start, dt.time.min, tzinfo=dt.timezone.utc)
    u1 = dt.datetime.combine(q.end, dt.time.max, tzinfo=dt.timezone.utc)
    site_ids = [s["id"] for s in sites]

    async def fixed_between(a: dt.datetime, b: dt.datetime) -> int:
        return int((await db.execute(select(func.count()).select_from(SeoFinding).where(
            SeoFinding.site_id.in_(site_ids), SeoFinding.state == "closed", SeoFinding.outcome.in_(("fixed", "resolved")),
            SeoFinding.closed_at.between(a, b)))).scalar_one())

    fixed = await fixed_between(t0, t1)
    fixed_prev = await fixed_between(u0, u1)
    open_count = int((await db.execute(select(func.count()).select_from(SeoFinding).where(
        SeoFinding.site_id.in_(site_ids), SeoFinding.state != "closed"))).scalar_one())
    return compute(sites, cur, prev, queries, prev_queries, pages, await devices(p.start), await devices(q.start),
                   fixed, fixed_prev, open_count, ctx.merchant.get("city"), ctx.merchant["name"])
