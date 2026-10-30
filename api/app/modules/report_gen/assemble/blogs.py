"""Blogs section (PRD A SEO15, SEO16, SEO18) for one merchant and one month.

Posts come from seo_blog_post; their search figures from seo_blog_gsc_daily,
summed for the calendar month over final days only (scope "all"). The Blog
Impact tab shows rolling windows; this is the month sum the report needs."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import SeoBlogGscDaily, SeoBlogPost
from app.modules.report_gen.assemble import Ctx, metric, not_supplied, section

READS = {
    "marketing.seo_blog_post": ("id", "site_id", "url", "title", "published_on", "live"),
    "marketing.seo_blog_gsc_daily": ("post_id", "date", "scope", "clicks", "impressions", "is_final"),
}

_IDS = (("SEO15", "Blogs published", "count"), ("SEO16", "Blog impressions and clicks", "count"), ("SEO18", "Top posts", "table"))


def compute(posts: list[dict], month_stats: dict[str, dict], prev_stats: dict[str, dict], period_start: dt.date, period_end: dt.date,
            site_clicks: Optional[int], final_through: Optional[dt.date]) -> dict:
    """Pure. posts: [{id, title, url, publishedOn}]; month_stats / prev_stats: post id → {clicks, impressions}."""
    if not posts:
        return section("blogs", metrics=[not_supplied(i, l, "no_blog_posts", u) for i, l, u in _IDS], note="No blog posts were found on this website.")
    published = [p for p in posts if p.get("publishedOn") and period_start <= p["publishedOn"] <= period_end]
    clicks = sum(s["clicks"] for s in month_stats.values())
    impressions = sum(s["impressions"] for s in month_stats.values())
    clicks_prev = sum(s["clicks"] for s in prev_stats.values())
    impressions_prev = sum(s["impressions"] for s in prev_stats.values())
    top = sorted(({"title": p.get("title") or p["url"], "url": p["url"], "clicks": month_stats.get(p["id"], {}).get("clicks", 0),
                   "impressions": month_stats.get(p["id"], {}).get("impressions", 0)} for p in posts if p["id"] in month_stats),
                 key=lambda r: (-r["clicks"], -r["impressions"]))[:5]
    share = round(clicks / site_clicks, 4) if site_clicks else None
    metrics = [
        metric("SEO15", "Blogs published", len(published), None),
        metric("SEO16", "Blog impressions and clicks", clicks if month_stats else None, clicks_prev if prev_stats else None,
               reason=None if month_stats else "no_data_in_period"),
        metric("SEO18", "Top posts", len(top) if top else None, None, unit="table", reason=None if top else "no_data_in_period"),
    ]
    tables = {
        "published": [{"title": p.get("title") or p["url"], "url": p["url"], "publishedOn": p["publishedOn"].isoformat()} for p in published],
        "topPosts": top,
        "totals": {"clicks": clicks, "impressions": impressions, "prevClicks": clicks_prev, "prevImpressions": impressions_prev,
                   "shareOfSiteClicks": share, "planned": None, "plannedReason": "blog_plan_not_recorded"},
    }
    note = "Planned posts are not recorded yet, so published posts are shown without a target."
    return section("blogs", metrics=metrics, tables=tables, note=note, data_through=final_through, sources=["Search Console · blog pages"])


async def build(db: AsyncSession, ctx: Ctx) -> dict:
    if not ctx.seo_site_ids:
        return compute([], {}, {}, ctx.period.start, ctx.period.end, None, None)
    rows = (await db.execute(select(SeoBlogPost.id, SeoBlogPost.title, SeoBlogPost.url, SeoBlogPost.published_on)
                             .where(SeoBlogPost.site_id.in_(ctx.seo_site_ids), SeoBlogPost.live.is_(True)))).all()
    posts = [{"id": r.id, "title": r.title, "url": r.url, "publishedOn": r.published_on} for r in rows]
    if not posts:
        return compute([], {}, {}, ctx.period.start, ctx.period.end, None, None)
    ids = [p["id"] for p in posts]

    async def stats(start: dt.date, end: dt.date) -> dict[str, dict]:
        r = (await db.execute(select(SeoBlogGscDaily.post_id, func.sum(SeoBlogGscDaily.clicks), func.sum(SeoBlogGscDaily.impressions))
                              .where(SeoBlogGscDaily.post_id.in_(ids), SeoBlogGscDaily.scope == "all", SeoBlogGscDaily.is_final.is_(True),
                                     SeoBlogGscDaily.date.between(start, end)).group_by(SeoBlogGscDaily.post_id))).all()
        return {pid: {"clicks": int(c), "impressions": int(i)} for pid, c, i in r}

    final_through = (await db.execute(select(func.max(SeoBlogGscDaily.date)).where(
        SeoBlogGscDaily.post_id.in_(ids), SeoBlogGscDaily.scope == "all", SeoBlogGscDaily.is_final.is_(True)))).scalar_one_or_none()
    return compute(posts, await stats(ctx.period.start, ctx.period.end), await stats(ctx.prev.start, ctx.prev.end),
                   ctx.period.start, ctx.period.end, None, final_through)
