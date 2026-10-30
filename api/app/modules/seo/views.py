"""Read models for the SEO pages. Everything is computed from our tables
(never Google live), so a page load costs no API quota."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount
from app.models.auth import User
from app.models.gbp import GbpDailyMetric, GbpLocation
from app.models.profiling import Merchant
from app.models.seo import SeoFinding, SeoGa4Daily, SeoGscDaily, SeoGscPage, SeoGscQuery, SeoKeyword, SeoPage, SeoReport, SeoSite, utcnow
from app.modules.gbp import profile as gbp_profile
from app.modules.seo import catalog, data
from app.modules.seo import findings as wf
from app.modules.seo.crawl import host_of, page_type

WEEKS = 12


def name_of(u: Optional[User]) -> Optional[str]:
    if not u:
        return None
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def user_ref(u: Optional[User]) -> Optional[dict]:
    return {"id": u.id, "name": name_of(u)} if u else None


def iso(v) -> Optional[str]:
    return v.isoformat() if v else None


def change(cur: float, prev: float) -> Optional[float]:
    return None if not prev else round((cur - prev) / prev, 4)


def sync_state(site: SeoSite) -> str:
    if site.source == "DEMO":
        return "ok"
    if site.sync_error:
        return "issue"
    if not site.last_synced_at:
        return "never"
    return "issue" if utcnow() - site.last_synced_at > dt.timedelta(hours=48) else "ok"


async def users_by_id(db: AsyncSession, ids) -> dict[str, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars()}


async def through(db: AsyncSession) -> Optional[dt.date]:
    return (await db.execute(select(func.max(SeoSite.last_gsc_date)))).scalar_one_or_none()


async def window_totals(db: AsyncSession, model, cols: list[str], end: dt.date, days: int = 28) -> dict[str, dict]:
    """Per site: sums of `cols` over the last `days` up to `end` and the `days` before."""
    cur_start, prev_start = end - dt.timedelta(days=days - 1), end - dt.timedelta(days=2 * days - 1)
    sel = [model.site_id]
    for c in cols:
        col = getattr(model, c)
        sel.append(func.coalesce(func.sum(case((model.date >= cur_start, col), else_=0)), 0).label(c))
        sel.append(func.coalesce(func.sum(case((model.date < cur_start, col), else_=0)), 0).label(f"{c}_prev"))
    rows = (await db.execute(select(*sel).where(model.date.between(prev_start, end)).group_by(model.site_id))).mappings().all()
    return {r["site_id"]: dict(r) for r in rows}


async def weekly(db: AsyncSession, model, col: str, end: dt.date, site_ids: Optional[list[str]] = None, weeks: int = WEEKS) -> dict[str, list[int]]:
    """Per site: `weeks` weekly totals ending at `end` (oldest first)."""
    start = end - dt.timedelta(days=7 * weeks - 1)
    wk = func.floor((end - model.date) / 7)
    q = select(model.site_id, wk.label("w"), func.sum(getattr(model, col))).where(model.date.between(start, end))
    if site_ids is not None:
        q = q.where(model.site_id.in_(site_ids))
    out: dict[str, list[int]] = defaultdict(lambda: [0] * weeks)
    for sid, w, v in (await db.execute(q.group_by(model.site_id, wk))).all():
        i = weeks - 1 - int(w)
        if 0 <= i < weeks:
            out[sid][i] = int(v or 0)
    return out


async def open_counts(db: AsyncSession) -> dict[str, dict[str, int]]:
    rows = (await db.execute(select(SeoFinding.site_id, SeoFinding.severity, func.count()).where(SeoFinding.state != "closed").group_by(SeoFinding.site_id, SeoFinding.severity))).all()
    out: dict[str, dict[str, int]] = defaultdict(lambda: {"S1": 0, "S2": 0, "S3": 0})
    for sid, sev, n in rows:
        out[sid][sev] = n
    return out


def pillar_scores(site: SeoSite) -> dict:
    p = (site.pillars or {}).get("pillars") or {}
    return {k: (p.get(k) or {}).get("score") for k in catalog.PILLAR_KEYS}


def site_ref(site: SeoSite) -> dict:
    return {"id": site.id, "name": site.name, "domain": site.domain}


# ============================================================== command ====
async def overview(db: AsyncSession, status_sources: list[dict]) -> dict:
    sites = (await db.execute(select(SeoSite).order_by(SeoSite.name))).scalars().all()
    end = await through(db) or (dt.date.today() - dt.timedelta(days=3))
    gsc = await window_totals(db, SeoGscDaily, ["clicks", "impressions"], end)
    ga_end = (await db.execute(select(func.max(SeoSite.last_ga4_date)))).scalar_one_or_none() or end
    ga = await window_totals(db, SeoGa4Daily, ["sessions", "key_events"], ga_end)
    spark = await weekly(db, SeoGscDaily, "clicks", end)
    opened = await open_counts(db)
    users = await users_by_id(db, [s.owner_id for s in sites])
    mids = [s.merchant_id for s in sites if s.merchant_id]
    merchants = {m.id: m for m in (await db.execute(select(Merchant).where(Merchant.id.in_(mids)))).scalars()} if mids else {}
    overdue = int((await db.execute(select(func.count()).where(
        SeoFinding.state.in_(("detected", "recommended")), SeoFinding.severity == "S1", SeoFinding.detected_at < utcnow() - dt.timedelta(hours=24)
    ))).scalar_one())
    due = await reports_due(db, dt.date.today(), sites)
    broken_ids = set((await db.execute(select(SeoFinding.site_id).where(SeoFinding.code == "tracking_broken", SeoFinding.state != "closed"))).scalars())

    rows = []
    tracking_linked = tracking_ok = pending_conn = 0
    for s in sites:
        g = gsc.get(s.id, {})
        a = ga.get(s.id, {})
        oc = opened.get(s.id, {"S1": 0, "S2": 0, "S3": 0})
        pil = (s.pillars or {}).get("pillars") or {}
        tracking_bad = s.id in broken_ids
        if s.ga4_property:
            tracking_linked += 1
            tracking_ok += 0 if tracking_bad else 1
        if not s.gsc_property or not s.ga4_property:
            pending_conn += 1
        rows.append({
            **site_ref(s),
            "segment": s.segment, "package": s.package, "status": s.status, "source": s.source, "isDemo": s.source == "DEMO",
            "owner": user_ref(users.get(s.owner_id)),
            "merchant": {"id": s.merchant_id, "name": merchants[s.merchant_id].restaurant_name} if s.merchant_id in merchants else None,
            "health": s.health, "grade": catalog.grade(s.health), "pillars": pillar_scores(s),
            "localGrade": (pil.get("ls") or {}).get("grade"),
            "s1": oc["S1"], "s2": oc["S2"], "s3": oc["S3"], "crit": oc["S1"] + oc["S2"],
            "clicks": int(g.get("clicks", 0)),
            "clicksChange": change(g.get("clicks", 0), g.get("clicks_prev", 0)) if s.gsc_property else None,
            "sessions": int(a.get("sessions", 0)) if s.ga4_property else None,
            "spark": spark.get(s.id, [0] * WEEKS) if s.gsc_property else None,
            "auditedAt": iso(s.last_crawl_at),
            "gscLinked": bool(s.gsc_property), "ga4Linked": bool(s.ga4_property),
            "trackingBroken": tracking_bad if s.ga4_property else None,
            "syncState": sync_state(s),
        })
    scored = [r["health"] for r in rows if r["health"] is not None]
    return {
        "dataThrough": iso(end),
        "summary": {
            "sites": len(sites), "active": sum(1 for s in sites if s.status == "active"),
            "s1": sum(r["s1"] for r in rows), "s2": sum(r["s2"] for r in rows), "s3": sum(r["s3"] for r in rows),
            "s1Overdue": overdue,
            "tracking": {"linked": tracking_linked, "healthy": tracking_ok, "broken": tracking_linked - tracking_ok,
                         "pct": round(tracking_ok / tracking_linked * 100, 1) if tracking_linked else None},
            "pendingConnections": pending_conn,
            "reportsDue7": len([d for d in due if d["inDays"] <= 7]),
            "avgHealth": round(sum(scored) / len(scored)) if scored else None,
            "scored": len(scored),
        },
        "sources": status_sources,
        "pillarMeta": catalog.PILLARS,
        "rows": rows,
    }


async def watchdog(db: AsyncSession, limit: int = 40) -> dict:
    now = utcnow()
    sev_order = case((SeoFinding.severity == "S1", 1), (SeoFinding.severity == "S2", 2), else_=3)
    rows = (await db.execute(
        select(SeoFinding, SeoSite).join(SeoSite, SeoSite.id == SeoFinding.site_id).where(SeoFinding.state != "closed")
        .order_by(sev_order, SeoFinding.detected_at.desc()).limit(limit)
    )).all()
    counts = dict((await db.execute(select(SeoFinding.severity, func.count()).where(SeoFinding.state != "closed").group_by(SeoFinding.severity))).all())
    return {
        "counts": {k: counts.get(k, 0) for k in catalog.SEVERITIES},
        "data": [{"id": f.id, "severity": f.severity, "title": f.title, "detail": f.detail, "state": f.state, "site": site_ref(s),
                  "detectedAt": iso(f.detected_at), "overdue": wf.overdue(f, now), "team": f.team} for f, s in rows],
    }


# ============================================================ scorecard ====
async def site_detail(db: AsyncSession, site: SeoSite) -> dict:
    today = dt.date.today()
    end = site.last_gsc_date
    kpis: dict = {}
    if end:
        cur = await data.gsc_window(db, site.id, end - dt.timedelta(days=27), end)
        prev = await data.gsc_window(db, site.id, end - dt.timedelta(days=55), end - dt.timedelta(days=28))
        kpis.update({
            "clicks": cur["clicks"], "clicksPrev": prev["clicks"], "impressions": cur["impressions"], "impressionsPrev": prev["impressions"],
            "ctr": round(cur["clicks"] / cur["impressions"], 4) if cur["impressions"] else None,
            "ctrPrev": round(prev["clicks"] / prev["impressions"], 4) if prev["impressions"] else None,
            "position": round(cur["position"], 1) if cur["position"] else None,
            "positionPrev": round(prev["position"], 1) if prev["position"] else None,
        })
    if site.last_ga4_date:
        ge = site.last_ga4_date
        cur = await data.ga4_window(db, site.id, ge - dt.timedelta(days=27), ge)
        prev = await data.ga4_window(db, site.id, ge - dt.timedelta(days=55), ge - dt.timedelta(days=28))
        kpis.update({"sessions": cur["sessions"], "sessionsPrev": prev["sessions"], "organicSessions": cur["organicSessions"],
                     "organicSessionsPrev": prev["organicSessions"], "keyEvents": round(cur["keyEvents"]), "keyEventsPrev": round(prev["keyEvents"])})

    if rc := await data.ranking_counts(db, site):
        kpis.update({"rankingSearches": rc["kw"], "rankingSearchesPrev": rc["kwPrev"], "top10Searches": rc["top10"],
                     "top10SearchesPrev": rc["top10Prev"], "rankingMonth": rc["month"], "rankingPrevMonth": rc["prevMonth"]})

    clicks_w = (await weekly(db, SeoGscDaily, "clicks", end, [site.id])).get(site.id) if end else None
    sess_w = (await weekly(db, SeoGa4Daily, "sessions", site.last_ga4_date, [site.id])).get(site.id) if site.last_ga4_date else None

    fs = (await db.execute(select(SeoFinding).where(SeoFinding.site_id == site.id, SeoFinding.state != "closed"))).scalars().all()
    fs = sorted(fs, key=lambda f: (f.severity, -f.detected_at.timestamp()))
    owners = await users_by_id(db, [site.owner_id] + [f.owner_id for f in fs])

    links: dict = {"merchant": None, "gbpLocation": None, "adsAccount": None}
    if site.merchant_id and (m := await db.get(Merchant, site.merchant_id)):
        links["merchant"] = {"id": m.id, "name": m.restaurant_name}
    local = None
    if site.gbp_location_id and (loc := await db.get(GbpLocation, site.gbp_location_id)):
        links["gbpLocation"] = {"id": loc.id, "title": loc.title, "isDemo": loc.source == "DEMO"}
        local = await local_detail(db, loc, site.domain)
    if site.ads_account_id and (acc := await db.get(AdsAccount, site.ads_account_id)):
        links["adsAccount"] = {"id": acc.id, "name": acc.name}

    reports = (await db.execute(select(SeoReport).where(SeoReport.site_id == site.id).order_by(SeoReport.period_end.desc()).limit(6))).scalars().all()
    nxt = next_period(site.report_cadence, today)
    return {
        **site_ref(site),
        "homeUrl": site.home_url, "segment": site.segment, "package": site.package,
        "packageLabel": catalog.PACKAGES.get(site.package, {}).get("label", site.package),
        "status": site.status, "source": site.source, "isDemo": site.source == "DEMO",
        "owner": user_ref(owners.get(site.owner_id)), "reportCadence": site.report_cadence, "links": links,
        "gscProperty": site.gsc_property, "ga4Property": site.ga4_property, "ga4Name": site.ga4_name,
        "sync": {"state": sync_state(site), "lastSyncedAt": iso(site.last_synced_at), "error": site.sync_error, "warning": site.sync_warning,
                 "gscThrough": iso(site.last_gsc_date), "ga4Through": iso(site.last_ga4_date), "lastCrawlAt": iso(site.last_crawl_at),
                 "lastPsiAt": iso(site.last_psi_at)},
        "score": site.pillars or None, "health": site.health, "grade": catalog.grade(site.health), "pillarMeta": catalog.PILLARS,
        "kpis": kpis,
        "trend": {"weeks": WEEKS, "clicks": clicks_w, "sessions": sess_w, "end": iso(end or today)},
        "findings": [finding_dto(f, site, owners) for f in fs],
        "local": local,
        "queries": await top_queries(db, site),
        "topPages": await top_pages(db, site, 8),
        **{"keywords": (kw := await keyword_rows(db, site))["rows"], "keywordMonths": {"month": kw["month"], "prevMonth": kw["prevMonth"]}},
        "reports": [report_ref(r) for r in reports],
        "nextReport": {"periodStart": iso(nxt[0]), "periodEnd": iso(nxt[1]), "due": iso(nxt[2])},
        "placeholders": catalog.PLACEHOLDERS,
        "sfExtras": await sf_extras_detail(db, site, loc if site.gbp_location_id else None),
    }


async def sf_extras_detail(db: AsyncSession, site: SeoSite, loc: Optional[GbpLocation]) -> dict:
    """What the newest Screaming Frog crawl adds beyond the issue checks: link metrics (backlinks &
    authority) and the phone / address / hours the website shows, checked against the Google listing."""
    from app.models.seo import SeoCrawl
    from app.modules.seo import sf_extras

    c = (await db.execute(
        select(SeoCrawl).where(SeoCrawl.site_id == site.id).order_by(SeoCrawl.crawled_at.desc().nullslast(), SeoCrawl.imported_at.desc()).limit(1)
    )).scalar_one_or_none()
    t = (c.totals or {}) if c else {}
    nap = t.get("nap")
    return {
        "crawledAt": iso(c.crawled_at or c.imported_at) if c else None,
        "linkMetrics": t.get("linkMetrics"),
        "nap": nap,
        "napCheck": sf_extras.compare_nap(nap, loc.phone, loc.address_line, loc.regular_hours) if (nap is not None and loc) else None,
    }


async def local_detail(db: AsyncSession, loc: GbpLocation, domain: str) -> dict:
    lf = data.local_facts(loc, domain)
    end = loc.last_metrics_date
    actions = None
    if end:
        def tot(a, b):
            return select(
                func.coalesce(func.sum(GbpDailyMetric.call_clicks), 0), func.coalesce(func.sum(GbpDailyMetric.direction_requests), 0),
                func.coalesce(func.sum(GbpDailyMetric.website_clicks), 0),
            ).where(GbpDailyMetric.location_id == loc.id, GbpDailyMetric.date.between(a, b))
        c = (await db.execute(tot(end - dt.timedelta(days=27), end))).one()
        p = (await db.execute(tot(end - dt.timedelta(days=55), end - dt.timedelta(days=28)))).one()
        actions = {"calls": int(c[0]), "directions": int(c[1]), "website": int(c[2]), "callsPrev": int(p[0]), "directionsPrev": int(p[1]),
                   "websitePrev": int(p[2]), "through": iso(end)}
    fields = loc.profile_fields or gbp_profile.compute(loc)
    return {
        "locationId": loc.id, "title": loc.title, "profilePct": lf.profile_pct, "verification": lf.verification, "openStatus": lf.open_status,
        "rating": lf.rating, "reviews": lf.reviews, "websiteUrl": lf.website_url, "websiteMatches": lf.website_matches,
        "hoursSet": lf.hours_set, "categoriesSet": lf.categories_set, "missingFields": [f["label"] for f in fields if not f.get("done")],
        "actions": actions,
    }


async def top_queries(db: AsyncSession, site: SeoSite, limit: int = 10) -> dict:
    empty = {"month": None, "prevMonth": None, "rows": []}
    if not site.last_gsc_date:
        return empty
    m = await data.latest_month(db, SeoGscQuery, site.id, data.month_start(site.last_gsc_date))
    if not m:
        return empty
    pm = data.prev_month(m)
    cur = (await db.execute(select(SeoGscQuery).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == m)
                            .order_by(SeoGscQuery.clicks.desc(), SeoGscQuery.impressions.desc()).limit(limit))).scalars().all()
    prev = {q.query: q for q in (await db.execute(select(SeoGscQuery).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == pm,
                                                                             SeoGscQuery.query.in_([c.query for c in cur])))).scalars()} if cur else {}
    return {
        "month": iso(m), "prevMonth": iso(pm),
        "rows": [{"query": q.query, "clicks": q.clicks, "impressions": q.impressions, "position": round(q.position, 2) if q.position else None,
                  "prevClicks": prev[q.query].clicks if q.query in prev else None,
                  "prevPosition": round(prev[q.query].position, 2) if q.query in prev and prev[q.query].position else None} for q in cur],
    }


async def top_pages(db: AsyncSession, site: SeoSite, limit: int) -> list[dict]:
    if not site.last_gsc_date:
        return []
    m = await data.latest_month(db, SeoGscPage, site.id, data.month_start(site.last_gsc_date))
    if not m:
        return []
    rows = (await db.execute(select(SeoGscPage).where(SeoGscPage.site_id == site.id, SeoGscPage.month == m).order_by(SeoGscPage.clicks.desc()).limit(limit))).scalars().all()
    return [{"url": r.page, "path": r.page.split(site.domain, 1)[-1] or "/", "clicks": r.clicks, "impressions": r.impressions,
             "position": round(r.position, 1) if r.position else None} for r in rows]


async def keyword_rows(db: AsyncSession, site: SeoSite) -> dict:
    """Tracked keywords with their Search Console figures: last full month vs the month before."""
    kws = (await db.execute(select(SeoKeyword).where(SeoKeyword.site_id == site.id).order_by(SeoKeyword.created_at))).scalars().all()
    m = await data.keyword_month(db, site) if kws else None
    pos = await data.keyword_positions(db, site.id, [k.keyword for k in kws], m) if m else {}
    rows = []
    for k in kws:
        r = pos.get(k.keyword.lower()) or {}
        rows.append({
            "id": k.id, "keyword": k.keyword, "source": k.source, "active": k.active,
            "position": r.get("position"), "previous": r.get("previous"), "hasPrevious": bool(r.get("hasPrevious")),
            "clicks": r.get("clicks", 0), "prevClicks": r.get("prevClicks", 0), "impressions": r.get("impressions", 0),
        })
    return {"month": iso(m), "prevMonth": iso(data.prev_month(m)) if m else None, "rows": rows}


def finding_dto(f: SeoFinding, site: SeoSite, users: dict[str, User]) -> dict:
    return {
        "id": f.id, "site": site_ref(site), "code": f.code, "severity": f.severity, "team": f.team, "title": f.title,
        "detail": f.detail, "recommendation": f.recommendation, "confidence": f.confidence, "impact": f.impact, "effort": f.effort,
        "pageUrl": f.page_url, "evidence": f.evidence, "state": f.state, "outcome": f.outcome, "note": f.note,
        "owner": user_ref(users.get(f.owner_id)), "detectedAt": iso(f.detected_at), "lastSeenAt": iso(f.last_seen_at),
        "closedAt": iso(f.closed_at), "slaDue": iso(wf.sla_due(f)), "overdue": wf.overdue(f, utcnow()), "isDemo": site.source == "DEMO",
    }


# ================================================================ pages ====
async def site_pages(db: AsyncSession, site: SeoSite) -> dict:
    m = await data.latest_month(db, SeoGscPage, site.id, data.month_start(site.last_gsc_date)) if site.last_gsc_date else None
    gsc = {r.page: r for r in (await db.execute(select(SeoGscPage).where(SeoGscPage.site_id == site.id, SeoGscPage.month == m))).scalars()} if m else {}
    pages = {p.url: p for p in (await db.execute(select(SeoPage).where(SeoPage.site_id == site.id))).scalars()}
    rows = []
    for url in list(pages) + [u for u in gsc if u not in pages and host_of(u) == site.domain]:
        p, g = pages.get(url), gsc.get(url)
        rows.append({
            "url": url, "path": url.split(site.domain, 1)[-1] or "/", "type": p.page_type if p else page_type(url),
            "clicks": g.clicks if g else 0, "impressions": g.impressions if g else 0, "position": round(g.position, 1) if g and g.position else None,
            "checked": bool(p and p.last_crawl_at), "statusCode": p.status_code if p else None, "crawlError": p.crawl_error if p else None,
            "title": p.title if p else None, "titleLength": len(p.title) if p and p.title else None,
            "metaLength": len(p.meta_description) if p and p.meta_description else None,
            "metaDescription": p.meta_description if p else None, "canonical": p.canonical if p else None,
            "wordCount": p.word_count if p else None, "imgTotal": p.img_total if p else None, "imgWithAlt": p.img_with_alt if p else None,
            "h1Count": p.h1_count if p else None, "noindex": p.noindex if p else None, "schemaTypes": p.schema_types if p else [],
            "indexVerdict": p.index_verdict if p else None, "coverageState": p.coverage_state if p else None,
            "psiScore": p.psi_score if p else None, "lcpMs": p.lcp_ms if p else None, "cls": p.cls if p else None, "cwv": p.cwv if p else None,
            "issues": p.issues if p else [], "lastCrawlAt": iso(p.last_crawl_at) if p else None,
        })
    rows.sort(key=lambda r: (r["type"] != "home", -r["clicks"], -r["impressions"], r["path"]))
    types: dict[str, int] = defaultdict(int)
    for r in rows:
        types[r["type"]] += 1
    return {"site": site_ref(site), "month": iso(m), "isDemo": site.source == "DEMO", "types": dict(types), "rows": rows}


# ======================================================== intelligence ====
async def finding_list(db: AsyncSession, *, severity: Optional[str], group: Optional[str], team: Optional[str], owner: Optional[str],
                       site_id: Optional[str], q: Optional[str], limit: int = 300) -> dict:
    now = utcnow()
    base = select(SeoFinding, SeoSite).join(SeoSite, SeoSite.id == SeoFinding.site_id)
    if severity:
        base = base.where(SeoFinding.severity == severity)
    if team:
        base = base.where(SeoFinding.team == team)
    if owner == "none":
        base = base.where(SeoFinding.owner_id.is_(None))
    elif owner:
        base = base.where(SeoFinding.owner_id == owner)
    if site_id:
        base = base.where(SeoFinding.site_id == site_id)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(func.lower(SeoFinding.title).like(like) | func.lower(SeoSite.name).like(like) | func.lower(SeoSite.domain).like(like))
    week_ago = now - dt.timedelta(days=7)

    counts = {"needsDecision": 0, "inFlight": 0, "awaitingVerification": 0, "closed7d": 0}
    for state, closed_at in (await db.execute(base.with_only_columns(SeoFinding.state, SeoFinding.closed_at))).all():
        if state in catalog.STATE_GROUPS["needs_decision"]:
            counts["needsDecision"] += 1
        elif state in catalog.STATE_GROUPS["in_flight"]:
            counts["inFlight"] += 1
        elif state == "awaiting_verification":
            counts["awaitingVerification"] += 1
        elif state == "closed" and closed_at and closed_at >= week_ago:
            counts["closed7d"] += 1

    if group == "closed":
        base = base.where(SeoFinding.state == "closed", SeoFinding.closed_at >= week_ago)
    elif group in catalog.STATE_GROUPS:
        base = base.where(SeoFinding.state.in_(catalog.STATE_GROUPS[group]))
    else:
        base = base.where(SeoFinding.state != "closed")
    sev_order = case((SeoFinding.severity == "S1", 1), (SeoFinding.severity == "S2", 2), else_=3)
    rows = (await db.execute(base.order_by(sev_order, SeoFinding.detected_at.desc()).limit(limit))).all()
    total = int((await db.execute(base.with_only_columns(func.count()).order_by(None))).scalar_one())
    users = await users_by_id(db, [f.owner_id for f, _ in rows])
    return {"counts": counts, "total": total, "data": [finding_dto(f, s, users) for f, s in rows]}


# =============================================================== compare ====
async def compare(db: AsyncSession, sites: list[SeoSite]) -> dict:
    out = []
    opened = await open_counts(db)
    for s in sites:
        d = await site_detail(db, s)
        psi = [p.psi_score for p in (await db.execute(select(SeoPage).where(SeoPage.site_id == s.id))).scalars() if p.psi_score is not None]
        out.append({
            **site_ref(s), "package": s.package, "segment": s.segment, "isDemo": s.source == "DEMO", "health": s.health,
            "grade": catalog.grade(s.health), "pillars": pillar_scores(s), "kpis": d["kpis"], "trend": d["trend"],
            "open": opened.get(s.id, {"S1": 0, "S2": 0, "S3": 0}), "queries": d["queries"]["rows"][:5],
            "localGrade": ((s.pillars or {}).get("pillars") or {}).get("ls", {}).get("grade"),
            "psiAvg": round(sum(psi) / len(psi)) if psi else None,
        })
    return {"pillarMeta": catalog.PILLARS, "sites": out}


# =============================================================== reports ====
def next_period(cadence: str, today: dt.date) -> tuple[dt.date, dt.date, dt.date]:
    """(start, end, due) of the report the site owes now: the most recent
    period that has ended. Monthly → due the 3rd; bi-weekly (1–15, 16–end) →
    3 days after; quarterly → the 5th after the quarter."""
    if cadence == "biweekly":
        if today.day > 15:
            start, end = today.replace(day=1), today.replace(day=15)
        else:
            pm = data.prev_month(today)
            start, end = pm.replace(day=16), data.month_end(pm)
        return start, end, end + dt.timedelta(days=3)
    if cadence == "quarterly":
        q0 = dt.date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
        end = q0 - dt.timedelta(days=1)
        start = dt.date(end.year, 3 * ((end.month - 1) // 3) + 1, 1)
        return start, end, end + dt.timedelta(days=5)
    pm = data.prev_month(today)
    return pm, data.month_end(pm), data.month_end(pm) + dt.timedelta(days=3)


def report_ref(r: SeoReport) -> dict:
    return {"id": r.id, "status": r.status, "periodStart": iso(r.period_start), "periodEnd": iso(r.period_end), "cadence": r.cadence,
            "generatedAt": iso(r.generated_at), "signedAt": iso(r.signed_at), "sentAt": iso(r.sent_at), "error": r.error,
            "auto": r.generated_by_id is None, "label": (r.snapshot or {}).get("period", {}).get("label")}


async def reports_due(db: AsyncSession, today: dt.date, sites: Optional[list[SeoSite]] = None) -> list[dict]:
    """Sites whose latest finished period has no sent report yet."""
    sites = sites if sites is not None else (await db.execute(select(SeoSite).where(SeoSite.status == "active"))).scalars().all()
    reps = {(r.site_id, r.period_start, r.period_end): r for r in (await db.execute(select(SeoReport))).scalars()}
    out = []
    for s in sites:
        if s.status != "active":
            continue
        start, end, due = next_period(s.report_cadence, today)
        r = reps.get((s.id, start, end))
        if r and r.status == "sent":
            continue
        out.append({"siteId": s.id, "periodStart": start, "periodEnd": end, "due": due, "inDays": (due - today).days, "report": r})
    return out



async def crawl_errors(db: AsyncSession, today: dt.date) -> dict[str, dict]:
    """Per site, from its newest Screaming Frog crawl if it is recent: broken URLs (4xx/5xx) and redirect chains."""
    from app.models.seo import SeoCrawl
    from app.modules.seo.catalog import CRAWL_MAX_AGE_DAYS

    rows = (await db.execute(
        select(SeoCrawl.site_id, SeoCrawl.crawled_at, SeoCrawl.imported_at, SeoCrawl.totals)
        .distinct(SeoCrawl.site_id).order_by(SeoCrawl.site_id, SeoCrawl.crawled_at.desc().nullslast(), SeoCrawl.imported_at.desc())
    )).all()
    out = {}
    for r in rows:
        if (today - (r.crawled_at or r.imported_at).date()).days > CRAWL_MAX_AGE_DAYS:
            continue
        t = r.totals or {}
        out[r.site_id] = {"broken": int(t.get("errors4xx") or 0) + int(t.get("errors5xx") or 0), "chains": int(t.get("redirectChains") or 0)}
    return out

async def reports_center(db: AsyncSession, days: int) -> dict:
    today = dt.date.today()
    since = utcnow() - dt.timedelta(days=days)
    sites = (await db.execute(select(SeoSite).order_by(SeoSite.name))).scalars().all()
    reps = (await db.execute(select(SeoReport))).scalars().all()
    latest: dict[str, SeoReport] = {}
    for r in reps:
        cur = latest.get(r.site_id)
        if not cur or (r.period_end, r.generated_at) > (cur.period_end, cur.generated_at):
            latest[r.site_id] = r
    due = await reports_due(db, today, sites)

    end = await through(db) or (today - dt.timedelta(days=3))
    weeks = 13
    w = await weekly(db, SeoGscDaily, "clicks", end, [s.id for s in sites if s.gsc_property], weeks)
    packages = []
    for key in ("normal", "199", "299"):
        ids = [s.id for s in sites if s.package == key and s.gsc_property]
        series = [round(sum(w[i][k] for i in ids if i in w) / len(ids)) if ids else 0 for k in range(weeks)]
        last4, prev4 = sum(series[-4:]), sum(series[-8:-4])
        packages.append({"key": key, "label": catalog.PACKAGES[key]["label"], "reports": catalog.PACKAGES[key]["reports"],
                         "projects": sum(1 for s in sites if s.package == key), "series": series,
                         "avgClicks4w": round(last4 / 4) if ids else None, "change": change(last4, prev4) if ids else None})

    gsc = await window_totals(db, SeoGscDaily, ["clicks"], end)
    opened = await open_counts(db)
    crawls = await crawl_errors(db, today)

    def risk(s: SeoSite) -> int:
        oc = opened.get(s.id, {"S1": 0, "S2": 0, "S3": 0})
        ce = crawls.get(s.id, {})
        # Crawl findings are already in the open counts; this adds the size of the damage:
        # broken URLs on the site and redirect chains (each capped so one big site can't swamp the list).
        return (100 - (s.health or 50)) * 2 + oc["S1"] * 25 + oc["S2"] * 8 + oc["S3"] + min(ce.get("broken", 0), 10) * 3 + min(ce.get("chains", 0), 10)

    def ch(s: SeoSite) -> Optional[float]:
        g = gsc.get(s.id, {})
        return change(g.get("clicks", 0), g.get("clicks_prev", 0))

    scored = [s for s in sites if s.health is not None]
    risky = sorted(scored, key=risk, reverse=True)[:8]
    best = sorted(scored, key=lambda s: (s.health or 0, ch(s) or 0), reverse=True)[:8]

    def mini(s: SeoSite, extra: dict) -> dict:
        return {**site_ref(s), "package": s.package, "isDemo": s.source == "DEMO", "health": s.health, "grade": catalog.grade(s.health),
                "clicksChange": ch(s), **extra}

    from app.modules.seo import recipients as rcp

    contacts = await rcp.merchant_contacts(db, [s.merchant_id for s in sites])
    due_by_site = {d["siteId"]: d for d in due}
    projects = []
    for s in sites:
        d = due_by_site.get(s.id)
        lr = latest.get(s.id)
        projects.append({
            **site_ref(s), "package": s.package, "cadence": s.report_cadence, "status": s.status, "isDemo": s.source == "DEMO",
            "health": s.health, "grade": catalog.grade(s.health), "recipients": len(rcp.merged(contacts.get(s.merchant_id, []) if s.merchant_id else [], s.report_recipients)),
            "latest": report_ref(lr) if lr else None,
            "due": {"periodStart": iso(d["periodStart"]), "periodEnd": iso(d["periodEnd"]), "due": iso(d["due"]), "inDays": d["inDays"],
                    "reportId": d["report"].id if d["report"] else None, "reportStatus": d["report"].status if d["report"] else None} if d else None,
        })
    return {
        "days": days,
        "tiles": {"sent": sum(1 for r in reps if r.status == "sent" and r.sent_at and r.sent_at >= since),
                  "awaitingSignoff": sum(1 for r in reps if r.status == "awaiting_signoff"),
                  "signed": sum(1 for r in reps if r.status == "signed"), "failed": sum(1 for r in reps if r.status == "failed"),
                  "due7": sum(1 for d in due if d["inDays"] <= 7), "overdue": sum(1 for d in due if d["inDays"] < 0),
                  "autoAssembled": sum(1 for r in reps if r.generated_by_id is None), "total": len(reps)},
        "packages": packages,
        "topRisk": [mini(s, {"risk": risk(s), "open": opened.get(s.id, {"S1": 0, "S2": 0, "S3": 0}),
                             "brokenUrls": crawls.get(s.id, {}).get("broken")}) for s in risky],
        "topPerforming": [mini(s, {}) for s in best],
        "projects": projects,
    }
