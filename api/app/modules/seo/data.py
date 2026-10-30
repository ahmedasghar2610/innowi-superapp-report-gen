"""Read a site's stored numbers into SiteFacts, and refresh its scorecard and
findings from them. Used by the sync and by the sample data alike."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount, AdsCampaign, AdsDailyMetric
from app.models.gbp import GbpLocation
from app.models.seo import (
    SeoCrawl, SeoCrawlIssue, SeoCrawlPage, SeoGa4Daily, SeoGscDaily, SeoGscPage, SeoGscQuery, SeoKeyword, SeoPage, SeoSite, utcnow,
)
from app.modules.gbp import profile as gbp_profile
from app.modules.seo import findings, rules, scoring
from app.modules.seo.crawl import canonical_offsite, host_of
from app.modules.seo.facts import CrawlFacts, CrawlIssueFacts, CrawlPageFacts, KeywordFacts, LocalFacts, PageFacts, PaidFacts, SiteFacts

WINDOW = 28


def month_start(d: dt.date) -> dt.date:
    return d.replace(day=1)


def prev_month(d: dt.date) -> dt.date:
    return (d.replace(day=1) - dt.timedelta(days=1)).replace(day=1)


def month_end(m: dt.date) -> dt.date:
    nxt = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return nxt - dt.timedelta(days=1)


async def gsc_window(db: AsyncSession, site_id: str, start: dt.date, end: dt.date) -> dict:
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(SeoGscDaily.clicks), 0),
                func.coalesce(func.sum(SeoGscDaily.impressions), 0),
                func.sum(SeoGscDaily.position * SeoGscDaily.impressions),
            ).where(SeoGscDaily.site_id == site_id, SeoGscDaily.date.between(start, end))
        )
    ).one()
    clicks, impr, pos_w = int(row[0]), int(row[1]), row[2]
    return {"clicks": clicks, "impressions": impr, "position": (float(pos_w) / impr) if impr and pos_w is not None else None}


async def ga4_window(db: AsyncSession, site_id: str, start: dt.date, end: dt.date) -> dict:
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(SeoGa4Daily.sessions), 0),
                func.coalesce(func.sum(SeoGa4Daily.users), 0),
                func.coalesce(func.sum(SeoGa4Daily.key_events), 0),
                func.coalesce(func.sum(SeoGa4Daily.organic_sessions), 0),
                func.coalesce(func.sum(SeoGa4Daily.organic_key_events), 0),
                func.coalesce(func.sum(SeoGa4Daily.engaged_sessions), 0),
            ).where(SeoGa4Daily.site_id == site_id, SeoGa4Daily.date.between(start, end))
        )
    ).one()
    return {"sessions": int(row[0]), "users": int(row[1]), "keyEvents": float(row[2]), "organicSessions": int(row[3]),
            "organicKeyEvents": float(row[4]), "engagedSessions": int(row[5])}


async def latest_month(db: AsyncSession, model, site_id: str, before: Optional[dt.date] = None) -> Optional[dt.date]:
    """Newest month stored for a site, preferring complete months (< `before`)."""
    q = select(func.max(model.month)).where(model.site_id == site_id)
    if before:
        m = (await db.execute(q.where(model.month < before))).scalar_one_or_none()
        if m:
            return m
    return (await db.execute(q)).scalar_one_or_none()


async def page_month_clicks(db: AsyncSession, site: SeoSite) -> dict[str, tuple[int, int]]:
    if not site.last_gsc_date:
        return {}
    m = await latest_month(db, SeoGscPage, site.id, month_start(site.last_gsc_date))
    if not m:
        return {}
    rows = (await db.execute(select(SeoGscPage.page, SeoGscPage.clicks, SeoGscPage.impressions).where(SeoGscPage.site_id == site.id, SeoGscPage.month == m))).all()
    return {r[0]: (int(r[1]), int(r[2])) for r in rows}


async def site_facts(db: AsyncSession, site: SeoSite, today: dt.date, psi_configured: bool = True) -> SiteFacts:
    f = SiteFacts(domain=site.domain, name=site.name, today=today, psi_configured=psi_configured)

    # ---- Search Console ----
    f.has_gsc = bool(site.gsc_property)
    f.gsc_error = site.sync_error if site.gsc_property and site.sync_error else None
    page_clicks: dict[str, tuple[int, int]] = {}
    if f.has_gsc and site.last_gsc_date:
        end = site.last_gsc_date
        f.gsc_through = end
        cur = await gsc_window(db, site.id, end - dt.timedelta(days=WINDOW - 1), end)
        prev = await gsc_window(db, site.id, end - dt.timedelta(days=2 * WINDOW - 1), end - dt.timedelta(days=WINDOW))
        f.clicks_28, f.impr_28, f.position_28 = cur["clicks"], cur["impressions"], cur["position"]
        f.clicks_prev_28, f.impr_prev_28 = prev["clicks"], prev["impressions"]
        page_clicks = await page_month_clicks(db, site)
        f.pages_with_impr = sum(1 for c, i in page_clicks.values() if i > 0)
        qm = await latest_month(db, SeoGscQuery, site.id, month_start(end))
        if qm:
            f.queries = int((await db.execute(select(func.count()).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == qm, SeoGscQuery.impressions > 0))).scalar_one())

    # ---- GA4 ----
    f.has_ga4 = bool(site.ga4_property)
    if f.has_ga4 and site.last_ga4_date:
        end = site.last_ga4_date
        f.ga4_through = end
        cur = await ga4_window(db, site.id, end - dt.timedelta(days=WINDOW - 1), end)
        prev = await ga4_window(db, site.id, end - dt.timedelta(days=2 * WINDOW - 1), end - dt.timedelta(days=WINDOW))
        f.sessions_28, f.key_events_28 = cur["sessions"], cur["keyEvents"]
        f.sessions_prev_28, f.key_events_prev_28 = prev["sessions"], prev["keyEvents"]
        last_pos = (await db.execute(select(func.max(SeoGa4Daily.date)).where(SeoGa4Daily.site_id == site.id, SeoGa4Daily.sessions > 0))).scalar_one_or_none()
        if last_pos is None:
            f.ga4_zero_tail_days = WINDOW
            gap_start = end - dt.timedelta(days=WINDOW - 1)
        else:
            f.ga4_zero_tail_days = max(0, (end - last_pos).days)
            gap_start = last_pos + dt.timedelta(days=1)
        if f.ga4_zero_tail_days and site.last_gsc_date:
            gap_end = min(end, site.last_gsc_date)
            if gap_end >= gap_start:
                f.clicks_during_zero_tail = (await gsc_window(db, site.id, gap_start, gap_end))["clicks"]

    # ---- pages ----
    for p in (await db.execute(select(SeoPage).where(SeoPage.site_id == site.id))).scalars():
        c, i = page_clicks.get(p.url, (0, 0))
        f.pages.append(page_facts(p, site.domain, c, i))

    # ---- keywords ----
    # Average Google position from Search Console, last complete month vs the month before.
    kws = (await db.execute(select(SeoKeyword.keyword).where(SeoKeyword.site_id == site.id, SeoKeyword.active.is_(True)))).scalars().all()
    if kws and (m := await keyword_month(db, site)):
        pos = await keyword_positions(db, site.id, kws, m)
        for k in kws:
            r = pos[k.lower()]
            if r["position"] is not None or r["previous"] is not None:
                f.keywords.append(KeywordFacts(keyword=k, position=_rank(r["position"]), previous=_rank(r["previous"]),
                                               has_previous=r["hasPrevious"], checked_at=month_end(m)))

    # ---- local / paid ----
    if site.gbp_location_id and (loc := await db.get(GbpLocation, site.gbp_location_id)):
        f.local = local_facts(loc, site.domain)
    if site.ads_account_id and (acc := await db.get(AdsAccount, site.ads_account_id)):
        f.paid = await paid_facts(db, acc, today)
    f.crawl = await crawl_facts(db, site.id)
    return f


async def crawl_facts(db: AsyncSession, site_id: str) -> Optional[CrawlFacts]:
    """The site's newest Screaming Frog crawl, with its issues and per-URL issue lists."""
    c = (await db.execute(
        select(SeoCrawl).where(SeoCrawl.site_id == site_id).order_by(SeoCrawl.crawled_at.desc().nullslast(), SeoCrawl.imported_at.desc()).limit(1)
    )).scalar_one_or_none()
    if not c:
        return None
    issues = [
        CrawlIssueFacts(key=i.key, name=i.name, issue_type=i.issue_type, priority=i.priority, urls=i.urls, description=i.description,
                        how_to_fix=i.how_to_fix, sample=[r.get("url") for r in (i.sample or []) if isinstance(r, dict) and r.get("url")])
        for i in (await db.execute(select(SeoCrawlIssue).where(SeoCrawlIssue.crawl_id == c.id))).scalars()
    ]
    rows = (await db.execute(select(SeoCrawlPage.url, SeoCrawlPage.content_type, SeoCrawlPage.status_code, SeoCrawlPage.indexable, SeoCrawlPage.issues)
                             .where(SeoCrawlPage.crawl_id == c.id))).all()
    pages = [CrawlPageFacts(url=r.url, is_html=(r.content_type or "").startswith("text/html"), status_code=r.status_code,
                            indexable=r.indexable, issues=list(r.issues or [])) for r in rows]
    when = c.crawled_at or c.imported_at
    return CrawlFacts(crawl_id=c.id, crawled_on=when.date(), totals=c.totals or {}, issues=issues, pages=pages)


def _rank(v: Optional[float]) -> Optional[int]:
    return max(1, round(v)) if v is not None else None


async def keyword_month(db: AsyncSession, site: SeoSite) -> Optional[dt.date]:
    """The month keyword positions are read from: the newest complete Search Console month."""
    if not site.last_gsc_date:
        return None
    return await latest_month(db, SeoGscQuery, site.id, month_start(site.last_gsc_date))


async def keyword_positions(db: AsyncSession, site_id: str, keywords: list[str], month: dt.date,
                            compare: Optional[dt.date] = None) -> dict[str, dict]:
    """Search Console figures for each keyword (matched case-insensitively) in `month` and in
    `compare` (default: the month before). position None = no impressions that month."""
    compare = compare or prev_month(month)
    want = {k.lower() for k in keywords}
    rows = (await db.execute(select(SeoGscQuery).where(
        SeoGscQuery.site_id == site_id, SeoGscQuery.month.in_([month, compare]), func.lower(SeoGscQuery.query).in_(want),
    ))).scalars().all()
    got: dict[tuple, SeoGscQuery] = {(r.query.lower(), r.month): r for r in rows}
    prev_stored = bool((await db.execute(select(SeoGscQuery.month).where(SeoGscQuery.site_id == site_id, SeoGscQuery.month == compare).limit(1))).scalar_one_or_none())
    out = {}
    for k in want:
        cur, before = got.get((k, month)), got.get((k, compare))
        out[k] = {
            "position": round(cur.position, 1) if cur and cur.position is not None else None,
            "clicks": cur.clicks if cur else 0, "impressions": cur.impressions if cur else 0,
            "previous": round(before.position, 1) if before and before.position is not None else None,
            "prevClicks": before.clicks if before else 0, "hasPrevious": prev_stored,
        }
    return out


async def ranking_counts(db: AsyncSession, site: SeoSite) -> Optional[dict]:
    """How many different searches the site showed up for (and in the top 10), month vs month before."""
    m = await keyword_month(db, site)
    if not m:
        return None
    pm = prev_month(m)

    async def count(month: dt.date, top10: bool = False) -> int:
        q = select(func.count()).select_from(SeoGscQuery).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == month, SeoGscQuery.impressions > 0)
        if top10:
            q = q.where(SeoGscQuery.position <= 10)
        return int((await db.execute(q)).scalar_one())

    prev_has = bool((await db.execute(select(SeoGscQuery.month).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == pm).limit(1))).scalar_one_or_none())
    return {"month": m.isoformat(), "prevMonth": pm.isoformat(), "kw": await count(m), "top10": await count(m, True),
            "kwPrev": await count(pm) if prev_has else None, "top10Prev": await count(pm, True) if prev_has else None}


def page_facts(p: SeoPage, domain: str, clicks: int = 0, impressions: int = 0) -> PageFacts:
    return PageFacts(
        url=p.url, path=p.url.split(domain, 1)[-1] or "/", page_type=p.page_type, status_code=p.status_code,
        crawl_error=p.crawl_error, checked=p.last_crawl_at is not None, title=p.title, meta_description=p.meta_description,
        h1_count=p.h1_count, noindex=p.noindex, canonical=p.canonical, canonical_offsite=canonical_offsite(p.canonical, domain),
        word_count=p.word_count, img_total=p.img_total, img_with_alt=p.img_with_alt, schema_types=list(p.schema_types or []),
        index_verdict=p.index_verdict, coverage_state=p.coverage_state, psi_score=p.psi_score, cwv=p.cwv,
        clicks=clicks, impressions=impressions,
    )


def local_facts(loc: GbpLocation, domain: str) -> LocalFacts:
    fields = loc.profile_fields or gbp_profile.compute(loc)
    site_host = host_of(loc.website_url) if loc.website_url else ""
    return LocalFacts(
        title=loc.title, profile_pct=gbp_profile.pct(fields), verification=loc.verification, open_status=loc.open_status,
        rating=loc.rating_average, reviews=loc.review_count, phone=loc.phone, website_url=loc.website_url,
        hours_set=bool(loc.regular_hours), categories_set=bool(loc.primary_category),
        website_matches=bool(site_host) and (site_host == domain or site_host.endswith("." + domain)),
        street=loc.address_line, regular_hours=list(loc.regular_hours or []),
    )


async def paid_facts(db: AsyncSession, acc: AdsAccount, today: dt.date) -> PaidFacts:
    active = int((await db.execute(select(func.count()).where(AdsCampaign.account_id == acc.id, AdsCampaign.status == "ENABLED"))).scalar_one())
    spend = (
        await db.execute(
            select(func.coalesce(func.sum(AdsDailyMetric.cost), 0))
            .join(AdsCampaign, AdsCampaign.id == AdsDailyMetric.campaign_id)
            .where(AdsCampaign.account_id == acc.id, AdsDailyMetric.date > today - dt.timedelta(days=30))
        )
    ).scalar_one()
    return PaidFacts(name=acc.name, state=acc.state, active_campaigns=active, spend_30d=float(spend or 0),
                     verification=acc.verification, sync_error=acc.sync_error)


async def recompute(db: AsyncSession, site: SeoSite, today: Optional[dt.date] = None, psi_configured: bool = True,
                    now: Optional[dt.datetime] = None) -> dict:
    """Refresh the cached scorecard and the findings of one site. Caller commits."""
    today = today or dt.date.today()
    f = await site_facts(db, site, today, psi_configured)
    sc = scoring.score(f)
    site.health = sc["health"]
    site.pillars = sc
    site.scored_at = now or utcnow()
    counts = await findings.apply(db, site.id, rules.evaluate(f), now or utcnow())
    return {"score": sc, "findings": counts}


async def link_by_domain(db: AsyncSession, site: SeoSite) -> None:
    """Fill empty merchant / GBP listing / Ads account links from the domain.
    Never overwrites a link someone set by hand."""
    from app.models.profiling import Merchant

    dom = site.domain
    like = f"%{dom}%"
    if not site.merchant_id:
        for m in (await db.execute(select(Merchant).where(func.lower(Merchant.website_url).like(like)).limit(5))).scalars():
            if host_of(m.website_url or "") == dom:
                site.merchant_id = m.id
                break
    if not site.gbp_location_id:
        loc = None
        if site.merchant_id:
            loc = (await db.execute(select(GbpLocation).where(GbpLocation.merchant_id == site.merchant_id).order_by(GbpLocation.title).limit(1))).scalar_one_or_none()
        if not loc:
            for cand in (await db.execute(select(GbpLocation).where(func.lower(GbpLocation.website_url).like(like)).limit(10))).scalars():
                if host_of(cand.website_url or "") == dom:
                    loc = cand
                    break
        if loc:
            site.gbp_location_id = loc.id
    if not site.ads_account_id and site.merchant_id:
        acc = (await db.execute(select(AdsAccount).where(AdsAccount.merchant_id == site.merchant_id, AdsAccount.state == "active").limit(1))).scalar_one_or_none()
        if acc:
            site.ads_account_id = acc.id
    await auto_name(db, site)


def has_auto_name(site: SeoSite) -> bool:
    """True while the site still carries the name Search Console gave it (its domain)."""
    n = (site.name or "").strip().lower()
    return not n or n in (site.domain, f"www.{site.domain}") or host_of(n) == site.domain


async def auto_name(db: AsyncSession, site: SeoSite) -> None:
    """Give a site that only has its domain as a name a real one: the linked merchant's name,
    else the linked GBP listing's title. A name someone typed is never replaced."""
    if not has_auto_name(site):
        return
    from app.models.profiling import Merchant

    name = None
    if site.merchant_id:
        name = (await db.execute(select(Merchant.restaurant_name).where(Merchant.id == site.merchant_id))).scalar_one_or_none()
    if not name and site.gbp_location_id:
        name = (await db.execute(select(GbpLocation.title).where(GbpLocation.id == site.gbp_location_id))).scalar_one_or_none()
    if name and name.strip():
        site.name = name.strip()[:200]
