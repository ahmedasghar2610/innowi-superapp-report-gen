"""Website section — WEB01 only (PRD A, Phase P1).

WEB01 "Website visits" is the merchant's whole-site session count for the
month, from `marketing.seo_ga4_daily.sessions`. That column is all-channel, not
organic: `seo.sync` asks GA4 for `sessions` split by
`sessionDefaultChannelGroup` and `google.parse_ga4_daily` adds every channel
row into `sessions`, keeping only the "Organic Search" rows in
`organic_sessions`. So WEB01 (all traffic) and SEO01 (search clicks) are
genuinely different figures from the same sync, and this adapter reads the
all-channel one that `assemble/seo.py` never touches.

Scope: WEB01 is the only figure computed here. WEB03 and WEB07–WEB10 have no
stored source yet (traffic-by-source is not kept per channel, and the order and
revenue figures need the sales feed), so they stay "not supplied" with a reason
exactly as the stub left them (MFR04).

A stored zero is a real zero: the sync writes a 0 row for every day GA4 reports
no visits, precisely so a tracking gap is visible. Missing *rows* therefore mean
missing data, and this adapter counts rows before it trusts a sum.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import SeoGa4Daily, SeoSite
from app.modules.report_gen.assemble import REASONS, Ctx, metric, not_supplied, section, stub, through_month

READS = {
    "marketing.seo_site": ("id", "name", "domain", "merchant_id", "ga4_property", "source", "status", "last_ga4_date"),
    "marketing.seo_ga4_daily": ("site_id", "date", "sessions"),
}

ALL_TRAFFIC_NOTE = ("Website visits counts every visit to the site, from any source — search, maps, ads, social or a typed "
                    "address. The Search section counts search visits only, so its figure is smaller.")


def compute(sites: list[dict], cur: Optional[int], prev: Optional[int], *, data_through: Optional[dt.date] = None) -> dict:
    """Pure. sites: [{id, name, domain, ga4Property, lastGa4Date}] — the merchant's
    active, non-demo sites. cur / prev: sessions in this month and the month before,
    or None where GA4 stored no day at all for that month."""
    linked = [s for s in sites if s.get("ga4Property")]
    if not linked:
        # No analytics property on any site: exactly what the stub said before,
        # same reason code, so nothing about the section changes.
        return stub.build("website", "website_analytics_not_connected")
    metrics = [metric("WEB01", "Website visits", cur, prev)]
    # Every other P1 figure of the segment keeps its heading and its reason. The id
    # list comes from stub.P1 so there is one place that knows the segment's figures.
    metrics += [not_supplied(i, label, "website_metric_not_collected", unit) for i, label, unit in stub.P1["website"] if i != "WEB01"]
    return section("website", metrics=metrics, note=ALL_TRAFFIC_NOTE if cur is not None else REASONS["no_data_in_period"],
                   data_through=data_through, sources=[f"Google Analytics · {s['domain']}" for s in linked])


async def _sessions(db: AsyncSession, site_ids: list[str], start: dt.date, end: dt.date) -> Optional[int]:
    """Sessions summed over the window, or None when GA4 stored no day in it."""
    row = (await db.execute(select(func.count(), func.coalesce(func.sum(SeoGa4Daily.sessions), 0))
                            .where(SeoGa4Daily.site_id.in_(site_ids), SeoGa4Daily.date.between(start, end)))).first()
    days, total = (int(row[0]), int(row[1])) if row else (0, 0)
    return total if days else None


async def build(db: AsyncSession, ctx: Ctx) -> dict:
    rows = (await db.execute(select(SeoSite.id, SeoSite.name, SeoSite.domain, SeoSite.ga4_property, SeoSite.last_ga4_date)
                             .where(SeoSite.merchant_id == ctx.merchant_id, SeoSite.status == "active", SeoSite.source != "DEMO")
                             .order_by(SeoSite.name))).all()
    sites = [{"id": r.id, "name": r.name, "domain": r.domain, "ga4Property": r.ga4_property, "lastGa4Date": r.last_ga4_date} for r in rows]
    ga4_ids = [s["id"] for s in sites if s["ga4Property"]]
    if not ga4_ids:
        return compute(sites, None, None)
    p, q = ctx.period, ctx.prev
    cur = await _sessions(db, ga4_ids, p.start, p.end)
    prev = await _sessions(db, ga4_ids, q.start, q.end)
    # Capped at the month end: the sync keeps running after the month closes.
    through = through_month(max((s["lastGa4Date"] for s in sites if s["ga4Property"] and s["lastGa4Date"]), default=None), p.end)
    return compute(sites, cur, prev, data_through=through)


__all__ = ["READS", "compute", "build", "ALL_TRAFFIC_NOTE"]
