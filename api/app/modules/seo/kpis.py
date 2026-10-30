"""KPI Studio: the KPI registry (targets editable, config-driven) and, where
our data allows, each KPI's current portfolio value. KPIs whose source is on
hold or not measured say so instead of showing a number."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gbp import GbpDailyMetric
from app.models.seo import SeoFinding, SeoKeyword, SeoKpi, SeoPage, SeoReport, SeoSite, utcnow
from app.modules.seo import catalog, data, views

PILLAR_KPI = {"K1-CP": "cp", "K1-WS": "ws", "K1-AU": "au", "K1-RT": "rt", "K1-LS": "ls", "K1-PA": "pa"}
ON_HOLD = {"K2-GATE": "Publishing gates are on hold", "K3-CAD": "Publishing queue is on hold",
           "K4-ROI": "Ordering conversion feed is on hold", "K2-A11Y": "Accessibility crawl is on hold"}


async def ensure_defaults(db: AsyncSession) -> None:
    have = set((await db.execute(select(SeoKpi.key))).scalars())
    added = False
    for i, k in enumerate(catalog.DEFAULT_KPIS):
        if k["key"] not in have:
            db.add(SeoKpi(key=k["key"], set_no=k["set"], name=k["name"], grader=k["grader"], target=k["target"], source=k["source"], status="proposed", sort=i))
            added = True
    if added:
        await db.commit()


def _v(text: str, n: Optional[int] = None, tone: str = "neutral") -> dict:
    return {"text": text, "n": n, "tone": tone}


async def current_values(db: AsyncSession) -> dict[str, dict]:
    sites = (await db.execute(select(SeoSite))).scalars().all()
    out: dict[str, dict] = {}
    for key, pk in PILLAR_KPI.items():
        scores = [x for x in (((s.pillars or {}).get("pillars") or {}).get(pk, {}).get("score") for s in sites) if x is not None]
        if scores:
            avg = round(sum(scores) / len(scores))
            out[key] = _v(f"avg {avg} ({catalog.grade(avg)}) · {len(scores)} sites", avg)
    for key, text in ON_HOLD.items():
        out[key] = _v(text, tone="hold")

    now = utcnow()
    open_ = (await db.execute(select(SeoFinding).where(SeoFinding.state.in_(("detected", "recommended"))))).scalars().all()
    late = {sev: sum(1 for f in open_ if f.severity == sev and now - f.detected_at > dt.timedelta(hours=catalog.SLA_HOURS[sev])) for sev in catalog.SEVERITIES}
    out["K1-SLA"] = _v(f"{late['S1']} S1 · {late['S2']} S2 · {late['S3']} S3 past SLA", sum(late.values()), "warning" if late["S1"] else "neutral")
    out["K4-SLA"] = _v(f"{late['S1']} S1 past 24h", late["S1"], "warning" if late["S1"] else "ok")

    c = dict((await db.execute(select(SeoPage.cwv, func.count()).where(SeoPage.cwv.in_(("pass", "fail"))).group_by(SeoPage.cwv))).all())
    if c:
        pct = round(c.get("pass", 0) / (c.get("pass", 0) + c.get("fail", 0)) * 100)
        out["K2-CWV"] = _v(f"{pct}% of measured URLs pass", pct, "ok" if pct >= 75 else "warning")

    reps = (await db.execute(select(SeoReport))).scalars().all()
    if reps:
        auto = sum(1 for r in reps if r.generated_by_id is None)
        pct = round(auto / len(reps) * 100)
        out["K2-AUTOREP"] = _v(f"{pct}% assembled automatically ({auto} of {len(reps)})", pct, "ok" if pct == 100 else "neutral")
        start, end, due = views.next_period("monthly", dt.date.today())
        monthly = [r for r in reps if r.period_start == start and r.period_end == end]
        if monthly:
            on_time = sum(1 for r in monthly if r.sent_at and r.sent_at.date() <= due)
            out["K3-REP"] = _v(f"{on_time} of {len(monthly)} sent by the 3rd", on_time)

    # Tracked keywords: Search Console average position, last full month vs three months earlier.
    better = worse = 0
    for site in sites:
        kws = (await db.execute(select(SeoKeyword.keyword).where(SeoKeyword.site_id == site.id, SeoKeyword.active.is_(True)))).scalars().all()
        m = await data.keyword_month(db, site) if kws else None
        if not m:
            continue
        m3 = data.prev_month(data.prev_month(data.prev_month(m)))
        for r in (await data.keyword_positions(db, site.id, kws, m, m3)).values():
            if r["position"] is None and r["previous"] is None:
                continue
            a, b = r["previous"] or 101, r["position"] or 101
            better += b < a
            worse += b > a
    if better or worse:
        out["K3-VIS"] = _v(f"{better} keywords up · {worse} down (≈3 months)", better - worse, "ok" if better >= worse else "warning")

    loc_ids = [s.gbp_location_id for s in sites if s.gbp_location_id]
    if loc_ids:
        end = (await db.execute(select(func.max(GbpDailyMetric.date)).where(GbpDailyMetric.location_id.in_(loc_ids)))).scalar_one_or_none()
        if end:
            act = GbpDailyMetric.call_clicks + GbpDailyMetric.direction_requests + GbpDailyMetric.website_clicks
            cur = (await db.execute(select(func.coalesce(func.sum(act), 0)).where(GbpDailyMetric.location_id.in_(loc_ids), GbpDailyMetric.date > end - dt.timedelta(days=30)))).scalar_one()
            prev = (await db.execute(select(func.coalesce(func.sum(act), 0)).where(GbpDailyMetric.location_id.in_(loc_ids), GbpDailyMetric.date.between(end - dt.timedelta(days=59), end - dt.timedelta(days=30))))).scalar_one()
            ch = views.change(float(cur), float(prev))
            out["K3-GBP"] = _v(f"{int(cur):,} actions (30 days){f' · {ch * 100:+.0f}% vs previous' if ch is not None else ''}", int(cur), "ok" if (ch or 0) >= 0 else "warning")
    ls = [x for x in (((s.pillars or {}).get("pillars") or {}).get("ls", {}).get("score") for s in sites) if x is not None]
    if ls:
        out["K3-LOC"] = _v(f"{sum(1 for x in ls if x >= 70)} of {len(ls)} at B or better", sum(1 for x in ls if x >= 70))
    s299 = [s for s in sites if s.package == "299"]
    if s299:
        full = sum(1 for s in s299 if (s.pillars or {}).get("pillarsScored") == 6 and (s.health or 0) >= 70)
        out["K4-FULL"] = _v(f"{full} of {len(s299)} $299 sites: all 6 pillars, B or better", full)
    return out


async def listing(db: AsyncSession) -> dict:
    await ensure_defaults(db)
    rows = (await db.execute(select(SeoKpi).order_by(SeoKpi.set_no, SeoKpi.sort, SeoKpi.key))).scalars().all()
    cur = await current_values(db)
    return {
        "sets": [{"set": n, "label": label, "note": catalog.KPI_SET_NOTES[n],
                  "kpis": [{"key": k.key, "name": k.name, "grader": k.grader, "target": k.target, "source": k.source, "status": k.status,
                            "custom": k.custom, "current": cur.get(k.key)} for k in rows if k.set_no == n]}
                 for n, label in catalog.KPI_SETS.items()],
        "graders": catalog.GRADERS,
        "statuses": catalog.KPI_STATUSES,
    }
