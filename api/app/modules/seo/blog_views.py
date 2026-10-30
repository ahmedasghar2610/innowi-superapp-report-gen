"""Blog Impact page data, read from the tables modules/seo/blogs.py fills.

Impact numbers use final Search Console days only (up to the site's
gsc_final_through); Google's fresh numbers appear only in the early-signals
card and the post table's "fresh" figures, labelled provisional.

`country`: "all" (every country) or "us" (US searches / visitors only). In US
mode the site-wide comparisons (share of organic clicks, the weekly "rest of
the site", organic sessions before vs after) use the site's US totals stored by
the blog job, not seo_gsc_daily / seo_ga4_daily (which count every country).
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import (
    SeoBlogGa4Daily,
    SeoBlogGscDaily,
    SeoBlogGscHourly,
    SeoBlogPost,
    SeoBlogQuery,
    SeoBlogSiteDaily,
    SeoBlogState,
    SeoGa4Daily,
    SeoGscDaily,
    SeoSite,
    utcnow,
)
from app.modules.seo import blogs

WEEKS = 12
EARLY_DAYS = 10
BEFORE_AFTER_MAX = 90


def _iso(v) -> Optional[str]:
    return v.isoformat() if v else None


def _pct(cur: float, prev: float) -> Optional[float]:
    if not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def end_day(state: Optional[SeoBlogState], now: Optional[dt.datetime] = None) -> dt.date:
    """Last final Search Console day (impact windows end here)."""
    if state and state.gsc_final_through:
        return state.gsc_final_through
    return blogs.gsc_today(now) - dt.timedelta(days=3)


async def site_list(db: AsyncSession) -> list[dict]:
    """Sites for the picker: those with a Search Console property, with their post counts."""
    counts = dict((await db.execute(
        select(SeoBlogPost.site_id, func.count()).where(SeoBlogPost.live.is_(True)).group_by(SeoBlogPost.site_id)
    )).all())
    states = {s.site_id: s for s in (await db.execute(select(SeoBlogState))).scalars()}
    sites = (await db.execute(select(SeoSite).where(SeoSite.source != "DEMO", SeoSite.gsc_property.is_not(None)).order_by(SeoSite.name))).scalars()
    out = []
    for s in sites:
        st = states.get(s.id)
        out.append({"id": s.id, "name": s.name, "domain": s.domain, "status": s.status, "posts": int(counts.get(s.id, 0)),
                    "checkedAt": _iso(st.checked_at) if st else None})
    out.sort(key=lambda x: (-x["posts"], x["name"].lower()))
    return out


async def impact(db: AsyncSession, site: SeoSite, days: int = 28, now: Optional[dt.datetime] = None, country: str = "all") -> dict:
    now = now or utcnow()
    scope = "us" if country == "us" else "all"
    us = scope == "us"
    state = await db.get(SeoBlogState, site.id)
    end = end_day(state, now)
    cur_start = end - dt.timedelta(days=days - 1)
    prev_end = cur_start - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=days - 1)
    today = blogs.gsc_today(now)

    posts = list((await db.execute(select(SeoBlogPost).where(SeoBlogPost.site_id == site.id, SeoBlogPost.live.is_(True)))).scalars())
    ids = [p.id for p in posts]

    # ---- Search Console per post, final days ----
    gsc_rows = (await db.execute(
        select(SeoBlogGscDaily.post_id, SeoBlogGscDaily.date, SeoBlogGscDaily.clicks, SeoBlogGscDaily.impressions,
               SeoBlogGscDaily.position, SeoBlogGscDaily.is_final)
        .where(SeoBlogGscDaily.post_id.in_(ids), SeoBlogGscDaily.scope == scope,
               SeoBlogGscDaily.date >= min(prev_start, end - dt.timedelta(weeks=WEEKS)))
    )).all() if ids else []
    per_post: dict[str, dict] = defaultdict(lambda: {"clicks": 0, "impressions": 0, "posw": 0.0, "freshClicks": 0, "freshImpressions": 0})
    totals = {"cur": [0, 0], "prev": [0, 0]}
    blog_by_day: dict[dt.date, int] = defaultdict(int)
    for pid, d, c, i, pos, final in gsc_rows:
        if not final:
            per_post[pid]["freshClicks"] += c
            per_post[pid]["freshImpressions"] += i
            continue
        blog_by_day[d] += c
        if cur_start <= d <= end:
            pp = per_post[pid]
            pp["clicks"] += c
            pp["impressions"] += i
            pp["posw"] += (pos or 0) * i
            totals["cur"][0] += c
            totals["cur"][1] += i
        elif prev_start <= d <= prev_end:
            totals["prev"][0] += c
            totals["prev"][1] += i

    # ---- GA4 per post ----
    ga_rows = (await db.execute(
        select(SeoBlogGa4Daily.post_id, SeoBlogGa4Daily.date, SeoBlogGa4Daily.sessions, SeoBlogGa4Daily.organic_sessions,
               SeoBlogGa4Daily.order_clicks)
        .where(SeoBlogGa4Daily.post_id.in_(ids), SeoBlogGa4Daily.scope == scope, SeoBlogGa4Daily.date >= prev_start)
    )).all() if ids else []
    ga_end = today - dt.timedelta(days=1)
    ga_cur_start = ga_end - dt.timedelta(days=days - 1)
    ga_prev_start = ga_cur_start - dt.timedelta(days=days)
    ga_post: dict[str, dict] = defaultdict(lambda: {"sessions": 0, "organicSessions": 0, "orderClicks": 0})
    orders = {"cur": 0, "prev": 0}
    for pid, d, sess, org, oc in ga_rows:
        if ga_cur_start <= d <= ga_end:
            g = ga_post[pid]
            g["sessions"] += sess
            g["organicSessions"] += org
            g["orderClicks"] += oc
            orders["cur"] += oc
        elif ga_prev_start <= d < ga_cur_start:
            orders["prev"] += oc

    # ---- site totals (share of organic clicks) ----
    async def site_clicks(a: dt.date, b: dt.date) -> int:
        if us:
            return int((await db.execute(select(func.coalesce(func.sum(SeoBlogSiteDaily.clicks), 0))
                                         .where(SeoBlogSiteDaily.site_id == site.id, SeoBlogSiteDaily.scope == "us",
                                                SeoBlogSiteDaily.date >= a, SeoBlogSiteDaily.date <= b))).scalar_one())
        return int((await db.execute(select(func.coalesce(func.sum(SeoGscDaily.clicks), 0))
                                     .where(SeoGscDaily.site_id == site.id, SeoGscDaily.date >= a, SeoGscDaily.date <= b))).scalar_one())

    site_cur, site_prev = await site_clicks(cur_start, end), await site_clicks(prev_start, prev_end)

    # ---- top search term per post (latest month with data) ----
    top_q: dict[str, str] = {}
    if ids:
        q_rows = (await db.execute(
            select(SeoBlogQuery.post_id, SeoBlogQuery.month, SeoBlogQuery.query, SeoBlogQuery.impressions)
            .where(SeoBlogQuery.post_id.in_(ids), SeoBlogQuery.scope == scope)
            .order_by(SeoBlogQuery.month.desc(), SeoBlogQuery.impressions.desc())
        )).all()
        for pid, _m, q, _i in q_rows:
            top_q.setdefault(pid, q)

    # ---- posts table ----
    rows = []
    for p in posts:
        pp, g = per_post[p.id], ga_post[p.id]
        dti = (p.indexed_on - p.published_on).days if (p.indexed_on and p.published_on and p.indexed_on >= p.published_on) else None
        rows.append({
            "id": p.id, "url": p.url, "path": urlparse(p.url).path or "/", "title": p.title, "publishedOn": _iso(p.published_on),
            "source": p.source, "indexVerdict": p.index_verdict, "coverageState": p.coverage_state,
            "indexed": p.index_verdict == "PASS" or bool(p.indexed_on), "indexedOn": _iso(p.indexed_on), "daysToIndex": dti,
            "lastCrawlAt": _iso(p.google_last_crawl_at), "inspectedAt": _iso(p.inspected_at),
            "clicks": pp["clicks"], "impressions": pp["impressions"],
            "ctr": round(pp["clicks"] / pp["impressions"] * 100, 1) if pp["impressions"] else None,
            "position": round(pp["posw"] / pp["impressions"], 1) if pp["impressions"] else None,
            "freshClicks": pp["freshClicks"], "freshImpressions": pp["freshImpressions"],
            "topQuery": top_q.get(p.id), **g,
        })
    rows.sort(key=lambda r: (-r["clicks"], -r["impressions"], r["publishedOn"] or ""), reverse=False)

    # ---- KPI tiles ----
    dtis = [r["daysToIndex"] for r in rows if r["daysToIndex"] is not None]
    month_start = today.replace(day=1)
    kpis = {
        "postsLive": len(posts),
        "postsThisMonth": sum(1 for p in posts if p.published_on and p.published_on >= month_start),
        "postsIndexed": sum(1 for r in rows if r["indexed"]),
        "avgDaysToIndex": round(sum(dtis) / len(dtis), 1) if dtis else None,
        "clicks": totals["cur"][0], "clicksPrev": totals["prev"][0], "clicksChangePct": _pct(totals["cur"][0], totals["prev"][0]),
        "impressions": totals["cur"][1], "impressionsPrev": totals["prev"][1], "impressionsChangePct": _pct(totals["cur"][1], totals["prev"][1]),
        "shareOfOrganicClicks": round(totals["cur"][0] / site_cur * 100, 1) if site_cur else None,
        "shareOfOrganicClicksPrev": round(totals["prev"][0] / site_prev * 100, 1) if site_prev else None,
        "orderClicks": orders["cur"], "orderClicksPrev": orders["prev"],
    }

    # ---- weekly chart: blog clicks vs the rest of the site ----
    if us:
        site_daily = {d: c or 0 for d, c in (await db.execute(
            select(SeoBlogSiteDaily.date, SeoBlogSiteDaily.clicks).where(
                SeoBlogSiteDaily.site_id == site.id, SeoBlogSiteDaily.scope == "us",
                SeoBlogSiteDaily.date > end - dt.timedelta(weeks=WEEKS), SeoBlogSiteDaily.date <= end)
        )).all()}
    else:
        site_daily = dict((await db.execute(
            select(SeoGscDaily.date, SeoGscDaily.clicks).where(SeoGscDaily.site_id == site.id, SeoGscDaily.date > end - dt.timedelta(weeks=WEEKS),
                                                             SeoGscDaily.date <= end)
        )).all())
    weeks = []
    for w in range(WEEKS - 1, -1, -1):
        w_end = end - dt.timedelta(days=7 * w)
        w_start = w_end - dt.timedelta(days=6)
        blog_c = sum(v for d, v in blog_by_day.items() if w_start <= d <= w_end)
        site_c = sum(v for d, v in site_daily.items() if w_start <= d <= w_end)
        weeks.append({"start": w_start.isoformat(), "end": w_end.isoformat(), "blogClicks": blog_c, "otherClicks": max(site_c - blog_c, 0),
                      "published": sum(1 for p in posts if p.published_on and w_start <= p.published_on <= w_end)})

    # ---- before vs after the first post ----
    before_after = await _before_after(db, site, posts, end, scope, state)

    # ---- early signals: posts from the last 10 days (hourly, provisional) ----
    early = []
    young = [p for p in posts if p.published_on and p.published_on >= today - dt.timedelta(days=EARLY_DAYS)]
    if young:
        h_rows = (await db.execute(select(SeoBlogGscHourly.post_id, SeoBlogGscHourly.hour, SeoBlogGscHourly.impressions, SeoBlogGscHourly.clicks)
                                   .where(SeoBlogGscHourly.post_id.in_([p.id for p in young]), SeoBlogGscHourly.scope == scope))).all()
        by_post: dict[str, dict[dt.date, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        for pid, hour, imp, clk in h_rows:
            cell = by_post[pid][hour.astimezone(blogs.GSC_TZ).date()]
            cell[0] += imp
            cell[1] += clk
        for p in sorted(young, key=lambda x: x.published_on, reverse=True):
            series = []
            for k in range(EARLY_DAYS - 1, -1, -1):
                d = today - dt.timedelta(days=k)
                series.append({"date": d.isoformat(), "impressions": by_post[p.id][d][0] if d in by_post[p.id] else 0})
            early.append({"id": p.id, "title": p.title, "url": p.url, "publishedOn": _iso(p.published_on),
                          "lastCrawlAt": _iso(p.google_last_crawl_at), "indexed": p.index_verdict == "PASS" or bool(p.indexed_on),
                          "daysToIndex": (p.indexed_on - p.published_on).days if p.indexed_on and p.indexed_on >= p.published_on else None,
                          "impressions": sum(v[0] for v in by_post[p.id].values()), "clicks": sum(v[1] for v in by_post[p.id].values()),
                          "series": series})

    return {
        "site": {"id": site.id, "name": site.name, "domain": site.domain, "hasGa4": bool(site.ga4_property)},
        "country": scope,
        # US mode before the first refresh that fetched US numbers (right after the update): say so instead of showing zeros.
        "countryReady": not us or (bool(posts) and all(p.us_gsc_final_through for p in posts)) or (not posts and bool(state and state.us_site_through)),
        "freshness": {
            "checkedAt": _iso(state.checked_at) if state else None,
            "changedAt": _iso(state.changed_at) if state else None,
            "finalThrough": _iso(state.gsc_final_through) if state else None,
            "freshThroughHour": _iso(state.gsc_first_incomplete_hour) if state else None,
            "ga4Through": _iso(max((getattr(p, blogs.ga4_through_attr(scope)) for p in posts if getattr(p, blogs.ga4_through_attr(scope))),
                                   default=None)),
            "discoveredOn": _iso(state.discovered_on) if state else None,
            "error": state.last_error if state else None, "warning": state.last_warning if state else None,
            "brandTerms": list(state.brand_terms or []) if state else blogs.default_brand_terms(site),
        },
        "window": {"days": days, "start": cur_start.isoformat(), "end": end.isoformat(), "prevStart": prev_start.isoformat(),
                   "prevEnd": prev_end.isoformat(), "ga4Start": ga_cur_start.isoformat(), "ga4End": ga_end.isoformat()},
        "kpis": kpis, "weeks": weeks, "beforeAfter": before_after, "early": early, "posts": rows,
    }


async def _before_after(db: AsyncSession, site: SeoSite, posts: list[SeoBlogPost], end: dt.date, scope: str = "all",
                        state: Optional[SeoBlogState] = None) -> Optional[dict]:
    """Equal windows: just before the first post went live, and the latest one (final days)."""
    firsts = [p.published_on for p in posts if p.published_on]
    if not firsts:
        return None
    first = min(firsts)
    us = scope == "us"
    earliest = (await db.execute(select(func.min(SeoBlogSiteDaily.date)).where(SeoBlogSiteDaily.site_id == site.id,
                                                                               SeoBlogSiteDaily.scope == scope))).scalar_one()
    if us and not (state and state.us_nonbrand_through):
        earliest = None  # US rows can exist (site totals) before the US non-brand history is in
    if not earliest:
        return {"firstPostOn": first.isoformat(), "available": False, "reason": "Non-brand history is still being fetched."}
    length = min(BEFORE_AFTER_MAX, (first - earliest).days, (end - first).days + 1)
    if length < 14:
        return {"firstPostOn": first.isoformat(), "available": False,
                "reason": "Needs at least 14 days of data on both sides of the first post."}
    b_start, b_end = first - dt.timedelta(days=length), first - dt.timedelta(days=1)
    a_start, a_end = end - dt.timedelta(days=length - 1), end

    async def nonbrand(a: dt.date, b: dt.date) -> tuple[int, int]:
        r = (await db.execute(select(func.coalesce(func.sum(SeoBlogSiteDaily.nonbrand_clicks), 0), func.coalesce(func.sum(SeoBlogSiteDaily.nonbrand_impressions), 0))
                              .where(SeoBlogSiteDaily.site_id == site.id, SeoBlogSiteDaily.scope == scope,
                                     SeoBlogSiteDaily.date >= a, SeoBlogSiteDaily.date <= b))).one()
        return int(r[0]), int(r[1])

    async def organic(a: dt.date, b: dt.date) -> Optional[int]:
        if us:
            r = (await db.execute(select(func.count(SeoBlogSiteDaily.organic_sessions), func.coalesce(func.sum(SeoBlogSiteDaily.organic_sessions), 0))
                                  .where(SeoBlogSiteDaily.site_id == site.id, SeoBlogSiteDaily.scope == "us",
                                         SeoBlogSiteDaily.date >= a, SeoBlogSiteDaily.date <= b))).one()
            return int(r[1]) if r[0] else None
        r = (await db.execute(select(func.count(), func.coalesce(func.sum(SeoGa4Daily.organic_sessions), 0))
                              .where(SeoGa4Daily.site_id == site.id, SeoGa4Daily.date >= a, SeoGa4Daily.date <= b))).one()
        return int(r[1]) if r[0] else None

    (bc, bi), (ac, ai) = await nonbrand(b_start, b_end), await nonbrand(a_start, a_end)
    bo, ao = await organic(b_start, b_end), await organic(a_start, a_end)
    metrics = [
        {"key": "nonbrandClicks", "label": "Non-brand organic clicks", "before": bc, "after": ac, "changePct": _pct(ac, bc)},
        {"key": "nonbrandImpressions", "label": "Non-brand impressions", "before": bi, "after": ai, "changePct": _pct(ai, bi)},
    ]
    if bo is not None and ao is not None:
        metrics.append({"key": "organicSessions", "label": "Organic sessions (GA4)", "before": bo, "after": ao, "changePct": _pct(ao, bo)})
    return {"firstPostOn": first.isoformat(), "available": True, "days": length,
            "before": {"start": b_start.isoformat(), "end": b_end.isoformat()}, "after": {"start": a_start.isoformat(), "end": a_end.isoformat()},
            "metrics": metrics}
