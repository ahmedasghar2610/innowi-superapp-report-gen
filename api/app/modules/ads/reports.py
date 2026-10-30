"""Google Ads reports built from the local tables (never live Google calls).

Periods are inclusive calendar days. The default "report period" is the
previous calendar month (what the n8n monthly run produced). Budget figures
always describe one calendar month — the month the period ends in — and are
shown separately from the performance period (as in the prototype).
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.ads import AdsAccount, AdsAsset, AdsCampaign, AdsDailyMetric, METRIC_COLUMNS, utcnow
from app.models.boundary import Promotion
from app.models.gbp import GbpLocation
from app.models.profiling import Contact, Merchant
from app.modules.ads import calc

MAX_RANGE_DAYS = 1100


@dataclass
class Period:
    start: dt.date
    end: dt.date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def dto(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "days": self.days}


def parse_date(v: Optional[str]) -> Optional[dt.date]:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(v)
    except ValueError:
        raise ValueError(f"'{v}' is not a date (YYYY-MM-DD)")


def report_month(today: dt.date) -> Period:
    """The previous calendar month — the n8n "MonthlyReport" period."""
    first_this = today.replace(day=1)
    last_prev = first_this - dt.timedelta(days=1)
    return Period(last_prev.replace(day=1), last_prev)


def resolve_period(start: Optional[str], end: Optional[str], today: Optional[dt.date] = None) -> Period:
    s, e = parse_date(start), parse_date(end)
    if not s and not e:
        return report_month(today or dt.date.today())
    s = s or e
    e = e or s
    if s > e:
        raise ValueError("The start date is after the end date.")
    if (e - s).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"Pick a period of at most {MAX_RANGE_DAYS} days.")
    return Period(s, e)


def _shift_months(d: dt.date, months: int) -> dt.date:
    """First day of the month `months` before d's month."""
    idx = d.year * 12 + (d.month - 1) - months
    return dt.date(idx // 12, idx % 12 + 1, 1)


def previous_period(p: Period) -> Period:
    """The period a report is compared with ("vs previous period").

    - whole calendar months (e.g. the report month, or Jan–Mar) → the same
      number of whole months right before;
    - month to date (the 1st → a day in the same month) → the same days of the
      previous month (Oct 1–23 → Sep 1–23, cut to the month's length);
    - anything else (last 7 days, a week, a custom range) → the same number of
      days right before.
    """
    last_of_end = calc.month_bounds(p.end.year, p.end.month)[1]
    if p.start.day == 1 and p.end == last_of_end:
        months = (p.end.year - p.start.year) * 12 + p.end.month - p.start.month + 1
        return Period(_shift_months(p.start, months), p.start - dt.timedelta(days=1))
    if p.start.day == 1 and (p.start.year, p.start.month) == (p.end.year, p.end.month):
        s = _shift_months(p.start, 1)
        e_last = calc.month_bounds(s.year, s.month)[1]
        return Period(s, min(s.replace(day=min(p.end.day, e_last.day)), e_last))
    return Period(p.start - dt.timedelta(days=p.days), p.start - dt.timedelta(days=1))


def compare_period(period: Period, compare: Optional[str]) -> Optional[Period]:
    """`compare`: "previous" → previous_period; "none" / empty → no comparison."""
    if not compare or compare == "none":
        return None
    if compare == "previous":
        return previous_period(period)
    raise ValueError(f"'{compare}' isn't a comparison (use previous or none).")


def summary(t: calc.Totals, ticket: Optional[float]) -> dict:
    """The comparable numbers of one period (a row's or a campaign's `previous`)."""
    k = calc.kpis(t, ticket)
    return {"hasData": t.has_data, "metrics": t.dto(), **k.dto(), "roasStatus": calc.roas_status(k.roas, t.cost)}


def parse_month(v: Optional[str], default: dt.date) -> tuple[int, int]:
    if not v:
        return default.year, default.month
    m = re.fullmatch(r"(\d{4})-(\d{2})", v)
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise ValueError(f"'{v}' is not a month (YYYY-MM)")
    return int(m.group(1)), int(m.group(2))


async def data_through(db: AsyncSession) -> Optional[dt.date]:
    return (await db.execute(select(func.max(AdsDailyMetric.date)))).scalar_one_or_none()


async def campaign_totals(db: AsyncSession, start: dt.date, end: dt.date, campaign_ids: Optional[list[str]] = None) -> dict[str, calc.Totals]:
    cols = [func.coalesce(func.sum(getattr(AdsDailyMetric, c)), 0).label(c) for c in METRIC_COLUMNS]
    stmt = (
        select(AdsDailyMetric.campaign_id, func.count().label("days"), *cols)
        .where(AdsDailyMetric.date >= start, AdsDailyMetric.date <= end)
        .group_by(AdsDailyMetric.campaign_id)
    )
    if campaign_ids is not None:
        if not campaign_ids:
            return {}
        stmt = stmt.where(AdsDailyMetric.campaign_id.in_(campaign_ids))
    return {r["campaign_id"]: calc.Totals.of(dict(r)) for r in (await db.execute(stmt)).mappings()}


# ------------------------------------------------------------ context ----
@dataclass
class Ctx:
    """Everything one or many account rows need, loaded in a few queries."""

    accounts: list[AdsAccount]
    campaigns: dict[str, list[AdsCampaign]]
    merchants: dict[str, Merchant]
    gbp: dict[str, list[GbpLocation]]
    period_totals: dict[str, calc.Totals]
    mtd_totals: dict[str, calc.Totals]
    period: Period
    compare: Optional[Period]
    prev_totals: Optional[dict[str, calc.Totals]]
    budget_month: tuple[dt.date, dt.date]
    budget_through: Optional[dt.date]
    through: Optional[dt.date]


async def load_ctx(db: AsyncSession, accounts: list[AdsAccount], period: Period, compare: Optional[Period] = None) -> Ctx:
    ids = [a.id for a in accounts]
    camps = list((await db.execute(select(AdsCampaign).where(AdsCampaign.account_id.in_(ids)).order_by(AdsCampaign.name))).scalars()) if ids else []
    by_acc: dict[str, list[AdsCampaign]] = {}
    for c in camps:
        by_acc.setdefault(c.account_id, []).append(c)
    mids = sorted({a.merchant_id for a in accounts if a.merchant_id})
    merchants = (
        {m.id: m for m in (await db.execute(select(Merchant).where(Merchant.id.in_(mids)).options(selectinload(Merchant.locations), selectinload(Merchant.contacts)))).scalars()}
        if mids
        else {}
    )
    gbp: dict[str, list[GbpLocation]] = {}
    if mids:
        for loc in (await db.execute(select(GbpLocation).where(GbpLocation.merchant_id.in_(mids)))).scalars():
            gbp.setdefault(loc.merchant_id, []).append(loc)
    camp_ids = [c.id for c in camps]
    through = await data_through(db)
    m_start, m_end = calc.month_bounds(period.end.year, period.end.month)
    b_through = min(m_end, through) if through else None
    return Ctx(
        accounts=accounts,
        campaigns=by_acc,
        merchants=merchants,
        gbp=gbp,
        period_totals=await campaign_totals(db, period.start, period.end, camp_ids),
        mtd_totals=await campaign_totals(db, m_start, b_through, camp_ids) if b_through and b_through >= m_start else {},
        period=period,
        compare=compare,
        prev_totals=await campaign_totals(db, compare.start, compare.end, camp_ids) if compare else None,
        budget_month=(m_start, m_end),
        budget_through=b_through,
        through=through,
    )


def _primary_location(m: Merchant):
    locs = list(m.locations or [])
    return next((l for l in locs if l.is_primary), locs[0] if locs else None)


def profile_values(acc: AdsAccount, m: Optional[Merchant]) -> dict:
    """Values the prototype labels "Source: Client Profiling"."""
    if m:
        loc = _primary_location(m)
        contacts = sorted(m.contacts or [], key=lambda c: 0 if c.role.value == "OWNER" else 1)
        phone = next((c.phone for c in contacts if c.phone), None)
        address = ", ".join(x for x in [loc.address, loc.city, " ".join(y for y in [loc.state, loc.zip] if y)] if x) if loc else None
        return {
            "approvedBudget": float(m.google_ads_budget) if m.google_ads_budget is not None else None,
            "adsPaidBy": m.ads_paid_by,
            "address": address or None,
            "city": loc.city if loc else None,
            "phone": phone,
        }
    if is_demo_mapped(acc):
        d = acc.demo_profile or {}
        return {k: d.get(k) for k in ("approvedBudget", "adsPaidBy", "address", "city", "phone")}
    return {"approvedBudget": None, "adsPaidBy": None, "address": None, "city": None, "phone": None}


def is_demo_mapped(acc: AdsAccount) -> bool:
    return acc.source == "DEMO" and bool((acc.demo_profile or {}).get("mapped"))


def account_row(acc: AdsAccount, ctx: Ctx, now: Optional[dt.datetime] = None) -> dict:
    s = get_settings()
    now = now or utcnow()
    camps = ctx.campaigns.get(acc.id, [])
    statuses = [c.status for c in camps]
    totals = calc.sum_totals(ctx.period_totals.get(c.id, calc.Totals()) for c in camps)
    mtd = calc.sum_totals(ctx.mtd_totals.get(c.id, calc.Totals()) for c in camps)
    ticket = calc.avg_ticket(acc.ticket_total_sales, acc.ticket_order_count)
    k = calc.kpis(totals, ticket)
    m = ctx.merchants.get(acc.merchant_id) if acc.merchant_id else None
    prof = profile_values(acc, m)
    r_status = calc.restaurant_status(statuses, acc.state)
    budget = calc.Budget(
        month_start=ctx.budget_month[0],
        month_end=ctx.budget_month[1],
        approved=prof["approvedBudget"],
        all_daily=sum(float(c.daily_budget or 0) for c in camps if c.status != "REMOVED"),
        active_daily=sum(float(c.daily_budget or 0) for c in camps if c.status == "ENABLED"),
        mtd_spend=mtd.cost,
        through=ctx.budget_through,
        tolerance_pct=s.ADS_BUDGET_TOLERANCE_PCT,
    )
    if acc.source == "DEMO":  # sample data never goes stale
        sync = "issue" if acc.sync_error else "ok"
    else:
        sync = calc.sync_state(acc.last_synced_at, acc.sync_error, now, s.ADS_STALE_HOURS)
    alerts = calc.alerts(
        budget=budget, restaurant_status_=r_status, verification=acc.verification, verification_message=acc.verification_message,
        sync=sync, sync_error=acc.sync_error,
    )
    live = [c for c in camps if c.status != "REMOVED"]
    return {
        "id": acc.id,
        "customerId": calc.format_customer_id(acc.customer_id),
        "name": acc.name,
        "merchant": {"id": m.id, "name": m.restaurant_name} if m else (
            {"id": None, "name": acc.name} if is_demo_mapped(acc) else None
        ),
        "source": acc.source,
        "isDemo": acc.source == "DEMO",
        "state": acc.state,
        "restaurantStatus": r_status,
        "campaignSummary": calc.campaign_summary(statuses),
        "campaignCounts": {"active": sum(1 for c in live if c.status == "ENABLED"), "paused": sum(1 for c in live if c.status != "ENABLED")},
        "approvedMonthly": prof["approvedBudget"],
        "adsPaidBy": prof["adsPaidBy"],
        "googleDailyBudget": round(budget.active_daily, 2),
        "city": prof["city"],
        "hasData": totals.has_data,
        "metrics": totals.dto(),
        "avgTicket": None if ticket is None else round(ticket, 2),
        **k.dto(),
        "roasStatus": calc.roas_status(k.roas, totals.cost),
        "verification": acc.verification,
        "syncState": sync,
        "lastSyncedAt": acc.last_synced_at.isoformat() if acc.last_synced_at else None,
        "budgetStatus": budget.status,
        "alerts": alerts,
        **(
            {"previous": summary(calc.sum_totals(ctx.prev_totals.get(c.id, calc.Totals()) for c in camps), ticket)}
            if ctx.prev_totals is not None
            else {}
        ),
        "_budget": budget,
        "_profile": prof,
        "_totals": totals,
    }


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


# ----------------------------------------------------------- portfolio ----
async def portfolio(db: AsyncSession, start: Optional[str], end: Optional[str], compare: Optional[str] = None) -> dict:
    period = resolve_period(start, end)
    cmp = compare_period(period, compare)
    accounts = list((await db.execute(select(AdsAccount).where(AdsAccount.state != "ignored").order_by(AdsAccount.name))).scalars())
    ctx = await load_ctx(db, accounts, period, cmp)
    rows = [account_row(a, ctx) for a in accounts]
    live = [r for r in rows if r["state"] == "active"]
    counts = {
        "all": len(live),
        "active": sum(1 for r in live if r["restaurantStatus"] == "active"),
        "paused": sum(1 for r in live if r["restaurantStatus"] in ("paused", "no_campaigns")),
        "budgetMismatch": sum(1 for r in live if any(a["type"] == "budget_mismatch" for a in r["alerts"])),
        "verificationRequired": sum(1 for r in live if any(a["type"] == "verification_required" for a in r["alerts"])),
        "syncIssue": sum(1 for r in live if r["syncState"] == "issue"),
        "archived": sum(1 for r in rows if r["state"] == "archived"),
        "unlinked": sum(1 for r in live if not r["merchant"]),
    }
    return {
        "period": period.dto(),
        "comparePeriod": cmp.dto() if cmp else None,
        "reportPeriod": report_month(dt.date.today()).dto(),
        "budgetMonth": ctx.budget_month[0].strftime("%Y-%m"),
        "dataThrough": ctx.through.isoformat() if ctx.through else None,
        "counts": counts,
        "rows": [_public(r) for r in rows],
    }


# -------------------------------------------------------------- detail ----
async def account_detail(db: AsyncSession, acc: AdsAccount, start: Optional[str], end: Optional[str], compare: Optional[str] = None) -> dict:
    period = resolve_period(start, end)
    cmp = compare_period(period, compare)
    ctx = await load_ctx(db, [acc], period, cmp)
    row = account_row(acc, ctx)
    budget: calc.Budget = row["_budget"]
    prof = row["_profile"]
    camps = ctx.campaigns.get(acc.id, [])
    ticket = calc.avg_ticket(acc.ticket_total_sales, acc.ticket_order_count)
    campaigns = []
    for c in camps:
        t = ctx.period_totals.get(c.id, calc.Totals())
        prev = ctx.prev_totals.get(c.id, calc.Totals()) if ctx.prev_totals is not None else None
        if c.status == "REMOVED" and t.cost == 0 and t.impressions == 0 and not (prev and prev.cost):
            continue
        k = calc.kpis(t, ticket)
        campaigns.append(
            {
                "id": c.id,
                "googleId": c.google_campaign_id,
                "name": c.name,
                "status": c.status,
                "channelType": c.channel_type,
                "dailyBudget": float(c.daily_budget) if c.daily_budget is not None else None,
                "startDate": c.start_date.isoformat() if c.start_date else None,
                "endDate": c.end_date.isoformat() if c.end_date else None,
                "hasData": t.has_data,
                "metrics": t.dto(),
                **k.dto(),
                "roasStatus": calc.roas_status(k.roas, t.cost),
                "analysis": calc.analysis_text(t, k, "period") if t.has_data else None,
                **({"previous": summary(prev, ticket)} if prev is not None else {}),
            }
        )
    asset_counts = dict(
        (await db.execute(select(AdsAsset.kind, func.count()).where(AdsAsset.account_id == acc.id, AdsAsset.status != "REMOVED").group_by(AdsAsset.kind))).all()
    )
    promos = 0
    m = ctx.merchants.get(acc.merchant_id) if acc.merchant_id else None
    if m:
        promos = (await db.execute(select(func.count()).select_from(Promotion).where(Promotion.merchant_id == m.id))).scalar_one()
    gbp_locs = ctx.gbp.get(acc.merchant_id or "", [])
    totals: calc.Totals = row["_totals"]
    k = calc.kpis(totals, ticket)
    return {
        **_public(row),
        "period": period.dto(),
        "comparePeriod": cmp.dto() if cmp else None,
        "dataThrough": ctx.through.isoformat() if ctx.through else None,
        "address": prof["address"],
        "phone": prof["phone"],
        "gbp": {"connected": bool(gbp_locs), "listings": [{"id": l.id, "title": l.title, "city": l.city} for l in gbp_locs]},
        "verificationMessage": acc.verification_message,
        "verificationDeadline": acc.verification_deadline.isoformat() if acc.verification_deadline else None,
        "syncError": acc.sync_error,
        "syncWarning": acc.sync_warning,
        "currencyCode": acc.currency_code,
        "ticketInputs": {
            "totalSales": float(acc.ticket_total_sales) if acc.ticket_total_sales is not None else None,
            "orderCount": acc.ticket_order_count,
            "updatedAt": acc.ticket_updated_at.isoformat() if acc.ticket_updated_at else None,
        },
        "analysis": calc.analysis_text(totals, k, "period") if totals.has_data else None,
        "budget": budget.dto(),
        "campaigns": campaigns,
        "tabCounts": {
            "campaigns": len(campaigns),
            "assets": sum(asset_counts.values()),
            "offers": promos + asset_counts.get("promotion", 0),
            "sitelinks": asset_counts.get("sitelink", 0),
        },
    }


# --------------------------------------------------------------- trend ----
TREND_FIELDS = ("spend", "impressions", "clicks", "calls", "directions", "website", "menu", "orders", "revenue")


async def _daily(db: AsyncSession, campaign_ids: list[str], p: Period, through: Optional[dt.date], ticket: Optional[float]) -> list[dict]:
    """One point per calendar day of `p`. A synced day without a row means no
    activity (Google sends no row for a day with no impressions) → 0; a day
    after the last synced day is unknown → null (a gap in the chart)."""
    by_day: dict[dt.date, calc.Totals] = {}
    if campaign_ids:
        cols = [func.coalesce(func.sum(getattr(AdsDailyMetric, c)), 0).label(c) for c in METRIC_COLUMNS]
        stmt = (
            select(AdsDailyMetric.date, func.count().label("days"), *cols)
            .where(AdsDailyMetric.campaign_id.in_(campaign_ids), AdsDailyMetric.date >= p.start, AdsDailyMetric.date <= p.end)
            .group_by(AdsDailyMetric.date)
        )
        by_day = {r["date"]: calc.Totals.of(dict(r)) for r in (await db.execute(stmt)).mappings()}
    out = []
    for i in range(p.days):
        d = p.start + dt.timedelta(days=i)
        if through is None or d > through:
            out.append({"date": d.isoformat(), **{f: None for f in TREND_FIELDS}})
            continue
        t = by_day.get(d, calc.Totals())
        m = t.dto()
        out.append({"date": d.isoformat(), **m, "revenue": None if ticket is None else round(t.orders * ticket, 2)})
    return out


async def trend(
    db: AsyncSession, acc: AdsAccount, start: Optional[str], end: Optional[str], campaign_id: Optional[str] = None, compare: Optional[str] = None
) -> dict:
    """Daily spend, actions, orders and revenue for one account (or one of its
    campaigns), plus the comparison period's days (aligned by position)."""
    period = resolve_period(start, end)
    cmp = compare_period(period, compare)
    camps = list((await db.execute(select(AdsCampaign).where(AdsCampaign.account_id == acc.id).order_by(AdsCampaign.name))).scalars())
    if campaign_id:
        if not any(c.id == campaign_id for c in camps):
            raise ValueError("That campaign isn't part of this account.")
        ids = [campaign_id]
    else:
        ids = [c.id for c in camps]
    through = acc.last_metrics_date or await data_through(db)
    ticket = calc.avg_ticket(acc.ticket_total_sales, acc.ticket_order_count)
    used = set()
    if camps:
        used = set(
            (
                await db.execute(
                    select(AdsDailyMetric.campaign_id).where(AdsDailyMetric.campaign_id.in_([c.id for c in camps])).group_by(AdsDailyMetric.campaign_id)
                )
            ).scalars()
        )
    return {
        "period": period.dto(),
        "comparePeriod": cmp.dto() if cmp else None,
        "dataThrough": through.isoformat() if through else None,
        "avgTicket": None if ticket is None else round(ticket, 2),
        "campaignId": campaign_id,
        # campaigns that ever had data (removed ones with history included), for the picker
        "campaigns": [{"id": c.id, "name": c.name, "status": c.status} for c in camps if c.id in used or c.status != "REMOVED"],
        "days": await _daily(db, ids, period, through, ticket),
        "previousDays": await _daily(db, ids, cmp, through, ticket) if cmp else None,
    }


# -------------------------------------------------------------- assets ----
async def assets(db: AsyncSession, acc: AdsAccount) -> dict:
    rows = list(
        (await db.execute(select(AdsAsset).where(AdsAsset.account_id == acc.id).order_by(AdsAsset.field_type, AdsAsset.text, AdsAsset.google_asset_id))).scalars()
    )
    names = {c.id: c.name for c in (await db.execute(select(AdsCampaign).where(AdsCampaign.account_id == acc.id))).scalars()}
    return {
        "data": [
            {
                "id": a.id,
                "googleId": a.google_asset_id,
                "campaignId": a.campaign_id,
                "campaignName": names.get(a.campaign_id) if a.campaign_id else None,
                "level": "campaign" if a.campaign_id else "account",
                "fieldType": a.field_type,
                "kind": a.kind,
                "status": a.status,
                "name": a.name,
                "text": a.text,
                "imageUrl": a.image_url,
                "width": a.width,
                "height": a.height,
                "details": a.details or {},
                "syncedAt": a.synced_at.isoformat(),
            }
            for a in rows
        ]
    }


async def offers(db: AsyncSession, acc: AdsAccount) -> dict:
    """Client offers (Profiling → Promotions) next to the Google Ads promotion
    assets — shown side by side for manual review, never auto-compared."""
    client: list[dict] = []
    if acc.merchant_id:
        for p in (await db.execute(select(Promotion).where(Promotion.merchant_id == acc.merchant_id).order_by(Promotion.start_date.desc().nullslast()))).scalars():
            client.append(
                {
                    "id": p.id,
                    "name": p.promo_name,
                    "offerType": p.offer_type,
                    "offerValue": p.offer_value,
                    "code": p.promo_code,
                    "channels": p.channels,
                    "status": p.status.value if p.status else None,
                    "startDate": p.start_date.date().isoformat() if p.start_date else None,
                    "endDate": p.end_date.date().isoformat() if p.end_date else None,
                    "notes": p.notes,
                }
            )
    google = [a for a in (await assets(db, acc))["data"] if a["kind"] == "promotion"]
    return {"merchantLinked": bool(acc.merchant_id), "client": client, "google": google}


# ------------------------------------------------------------ breakdown ----
async def breakdown(db: AsyncSession, acc: AdsAccount, month: Optional[str]) -> dict:
    """The sheet's per-restaurant tab: Week 01–04 × campaign, each with the
    n8n analysis sentence, plus the month (MonthlyReport) rows."""
    today = dt.date.today()
    y, mo = parse_month(month, report_month(today).start)
    m_start, m_end = calc.month_bounds(y, mo)
    camps = list((await db.execute(select(AdsCampaign).where(AdsCampaign.account_id == acc.id).order_by(AdsCampaign.name))).scalars())
    ids = [c.id for c in camps]
    ticket = calc.avg_ticket(acc.ticket_total_sales, acc.ticket_order_count)

    def line(t: calc.Totals, period_word: str) -> dict:
        k = calc.kpis(t, ticket)
        return {
            "hasData": t.has_data,
            "metrics": t.dto(),
            "avgTicket": None if ticket is None else round(ticket, 2),
            **k.dto(),
            "roasStatus": calc.roas_status(k.roas, t.cost),
            "analysis": calc.analysis_text(t, k, period_word) if t.has_data else None,
        }

    month_tot = await campaign_totals(db, m_start, m_end, ids)
    weeks = []
    for label, ws, we in calc.weeks_of_month(y, mo):
        tots = await campaign_totals(db, ws, we, ids)
        weeks.append((label, ws, we, tots))
    rows = []
    for c in camps:
        mt = month_tot.get(c.id, calc.Totals())
        # n8n skipped campaigns with 0 impressions; keep that rule per month.
        if not mt.has_data or mt.impressions == 0:
            continue
        rows.append(
            {
                "campaign": {"id": c.id, "name": c.name, "status": c.status, "channelType": c.channel_type},
                "weeks": [{"label": label, "start": ws.isoformat(), "end": we.isoformat(), **line(t.get(c.id, calc.Totals()), "week")} for label, ws, we, t in weeks],
                "month": line(mt, "month"),
            }
        )
    first = (
        await db.execute(select(func.min(AdsDailyMetric.date)).join(AdsCampaign, AdsCampaign.id == AdsDailyMetric.campaign_id).where(AdsCampaign.account_id == acc.id))
    ).scalar_one_or_none()
    months = []
    if first:
        cur = dt.date(today.year, today.month, 1)
        while cur >= first.replace(day=1) and len(months) < 36:
            months.append(cur.strftime("%Y-%m"))
            cur = (cur - dt.timedelta(days=1)).replace(day=1)
    total = calc.sum_totals(month_tot.get(c.id, calc.Totals()) for c in camps)
    return {
        "month": f"{y:04d}-{mo:02d}",
        "monthStart": m_start.isoformat(),
        "monthEnd": m_end.isoformat(),
        "weeks": [{"label": label, "start": ws.isoformat(), "end": we.isoformat()} for label, ws, we, _ in weeks],
        "rows": rows,
        "total": line(total, "month"),
        "months": months,
    }


async def monthly_report(db: AsyncSession, month: Optional[str]) -> dict:
    """The sheet's MonthlyReport tab: one row per account × campaign."""
    y, mo = parse_month(month, report_month(dt.date.today()).start)
    m_start, m_end = calc.month_bounds(y, mo)
    accounts = list((await db.execute(select(AdsAccount).where(AdsAccount.state != "ignored").order_by(AdsAccount.name))).scalars())
    camps = list((await db.execute(select(AdsCampaign).where(AdsCampaign.account_id.in_([a.id for a in accounts])).order_by(AdsCampaign.name))).scalars()) if accounts else []
    tots = await campaign_totals(db, m_start, m_end, [c.id for c in camps])
    by_acc: dict[str, list[AdsCampaign]] = {}
    for c in camps:
        by_acc.setdefault(c.account_id, []).append(c)
    rows = []
    for a in accounts:
        ticket = calc.avg_ticket(a.ticket_total_sales, a.ticket_order_count)
        for c in by_acc.get(a.id, []):
            t = tots.get(c.id)
            if not t or t.impressions == 0:
                continue
            k = calc.kpis(t, ticket)
            rows.append(
                {
                    "accountId": a.id,
                    "accountName": a.name,
                    "customerId": calc.format_customer_id(a.customer_id),
                    "campaignName": c.name,
                    "metrics": t.dto(),
                    "avgTicket": None if ticket is None else round(ticket, 2),
                    **k.dto(),
                    "roasStatus": calc.roas_status(k.roas, t.cost),
                    "analysis": calc.analysis_text(t, k, "month"),
                }
            )
    return {"month": f"{y:04d}-{mo:02d}", "monthStart": m_start.isoformat(), "monthEnd": m_end.isoformat(), "rows": rows}


# ------------------------------------------------------------- unmapped ----
_STOP = {"the", "and", "restaurant", "grill", "kitchen", "cafe", "food", "halal", "authentic", "llc", "inc", "co", "pmax", "campaign"}


def tokens(v: Optional[str]) -> set[str]:
    return {t for t in re.sub(r"[^a-z0-9 ]", " ", (v or "").lower()).split() if len(t) > 2 and t not in _STOP}


def norm_name(v: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (v or "").lower())


async def merchant_suggestions(db: AsyncSession, name: str, limit: int = 5) -> list[dict]:
    """Merchants whose name looks like this Google Ads account's name."""
    words = tokens(name)
    if not words:
        return []
    filters = [func.lower(Merchant.restaurant_name).like(f"%{w}%") for w in list(words)[:6]]
    cands = list((await db.execute(select(Merchant).options(selectinload(Merchant.locations)).where(or_(*filters)).limit(60))).scalars())
    out = []
    for m in cands:
        mw = tokens(m.restaurant_name)
        if not mw:
            continue
        if norm_name(m.restaurant_name) == norm_name(name):
            score, reason = 100, "Same name"
        else:
            overlap = len(words & mw) / max(1, len(words | mw))
            score = int(80 * overlap)
            reason = "Similar name" if overlap < 0.99 else "Same name words"
            extra = (words | mw) - (words & mw)
            if extra and overlap >= 0.3:
                reason = "Similar name, different suffix" if len(words) != len(mw) else reason
        if score >= 25:
            city = next((l.city for l in m.locations or [] if l.is_primary), None) or next((l.city for l in m.locations or []), None)
            out.append({"merchantId": m.id, "name": m.restaurant_name, "city": city, "score": score, "reason": reason})
    out.sort(key=lambda s: -s["score"])
    return out[:limit]


async def unmapped(db: AsyncSession) -> dict:
    accounts = list(
        (await db.execute(select(AdsAccount).where(AdsAccount.merchant_id.is_(None), AdsAccount.state != "ignored").order_by(AdsAccount.name))).scalars()
    )
    accounts = [a for a in accounts if not is_demo_mapped(a)]
    through = await data_through(db) or dt.date.today()
    start = through - dt.timedelta(days=29)
    camps = list((await db.execute(select(AdsCampaign).where(AdsCampaign.account_id.in_([a.id for a in accounts])))).scalars()) if accounts else []
    tots = await campaign_totals(db, start, through, [c.id for c in camps])
    by_acc: dict[str, list[AdsCampaign]] = {}
    for c in camps:
        by_acc.setdefault(c.account_id, []).append(c)
    rows = []
    for a in accounts:
        cs = by_acc.get(a.id, [])
        spend = sum(tots[c.id].cost for c in cs if c.id in tots)
        sug = await merchant_suggestions(db, a.name, 1)
        best = sug[0] if sug and sug[0]["score"] >= 40 else None
        rows.append(
            {
                "id": a.id,
                "customerId": calc.format_customer_id(a.customer_id),
                "name": a.name,
                "source": a.source,
                "state": a.state,
                "campaigns": sum(1 for c in cs if c.status != "REMOVED"),
                "estMonthlySpend": round(spend, 2),
                "mappingStatus": "needs_review" if best else "unmapped",
                "suggestion": best,
                "lastSeen": (a.last_metrics_date.isoformat() if a.last_metrics_date else (a.last_synced_at.date().isoformat() if a.last_synced_at else None)),
                "hasTicket": calc.avg_ticket(a.ticket_total_sales, a.ticket_order_count) is not None,
            }
        )
    return {
        "spendWindow": {"start": start.isoformat(), "end": through.isoformat()},
        "summary": {
            "total": len(rows),
            "needsReview": sum(1 for r in rows if r["mappingStatus"] == "needs_review"),
            "noMatch": sum(1 for r in rows if r["mappingStatus"] == "unmapped"),
            "monthlySpend": round(sum(r["estMonthlySpend"] for r in rows), 2),
        },
        "rows": rows,
    }


async def merchant_accounts(db: AsyncSession, merchant_id: str) -> dict:
    accounts = list((await db.execute(select(AdsAccount).where(AdsAccount.merchant_id == merchant_id).order_by(AdsAccount.name))).scalars())
    through = await data_through(db) or dt.date.today()
    period = Period(through - dt.timedelta(days=29), through)
    ctx = await load_ctx(db, accounts, period)
    return {"period": period.dto(), "data": [_public(account_row(a, ctx)) for a in accounts]}
