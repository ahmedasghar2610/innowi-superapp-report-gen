"""Ads section (Google Ads, PRD A ADS01–ADS12) for one merchant and one month.

Reads the Ads module's tables through its own public helpers (read-only):
`ads.reports.campaign_totals` sums ads_daily_metric per campaign, `ads.calc`
holds the KPI formulas. Several active accounts are summed (file 11, decision 8)
and listed in the sources footer.

Attributed revenue is orders × the typed average ticket (`calc.kpis`), so it is
labelled "modelled" (MFR05) and the ticket used is stored with the figure: the
Ads module keeps only the current ticket, never its history."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount, AdsCampaign
from app.modules.ads import calc
from app.modules.ads import reports as ads_reports
from app.modules.report_gen.assemble import Ctx, metric, not_supplied, section, through_month

READS = {
    "marketing.ads_account": ("id", "name", "merchant_id", "state", "source", "ticket_total_sales", "ticket_order_count", "ticket_updated_at", "last_metrics_date"),
    "marketing.ads_campaign": ("id", "account_id", "name", "status"),
    "marketing.ads_daily_metric": ("campaign_id", "date", "cost", "impressions", "clicks", "calls", "directions", "website", "orders", "menu"),
}


def _r(v: Optional[float], nd: int = 2) -> Optional[float]:
    return None if v is None else round(v, nd)


def _n(v: float) -> float:
    """Conversions can be fractional (attribution): one decimal, drop .0."""
    r = round(v, 1)
    return int(r) if r == int(r) else r


def compute(accounts: list[dict], campaigns: list[dict], cur: dict[str, calc.Totals], prev: dict[str, calc.Totals],
            budget: Optional[float], *, period_end: Optional[dt.date] = None) -> dict:
    """Pure. accounts: [{id, name, ticketSales, ticketOrders, ticketUpdatedAt, lastMetricsDate}];
    campaigns: [{id, accountId, name, status}]; cur / prev: campaign id → Totals."""
    if not accounts:
        return section("ads", metrics=[not_supplied(id, label, "ads_not_linked", unit) for id, label, unit in _IDS], note="No Google Ads account is linked to this merchant.")

    by_acc: dict[str, list[dict]] = {}
    for c in campaigns:
        by_acc.setdefault(c["accountId"], []).append(c)

    total_cur, total_prev = calc.Totals(), calc.Totals()
    revenue_cur: Optional[float] = 0.0
    revenue_prev: Optional[float] = 0.0
    tickets: list[dict] = []
    for a in accounts:
        camps = by_acc.get(a["id"], [])
        t_cur = calc.sum_totals(cur.get(c["id"], calc.Totals()) for c in camps)
        t_prev = calc.sum_totals(prev.get(c["id"], calc.Totals()) for c in camps)
        total_cur.add(t_cur)
        total_prev.add(t_prev)
        ticket = calc.avg_ticket(a.get("ticketSales"), a.get("ticketOrders"))
        tickets.append({"account": a["name"], "avgTicket": _r(ticket), "asOf": a.get("ticketUpdatedAt")})
        if ticket is None:
            revenue_cur = revenue_prev = None
        elif revenue_cur is not None:
            revenue_cur += t_cur.orders * ticket
            revenue_prev += t_prev.orders * ticket

    if not total_cur.has_data:
        return section("ads", metrics=[not_supplied(id, label, "no_data_in_period", unit) for id, label, unit in _IDS],
                       note="No Google Ads data was recorded for this month.", sources=[f"Google Ads · {a['name']}" for a in accounts])

    c, p = total_cur, total_prev
    ctr = c.clicks / c.impressions if c.impressions else None
    ctr_p = p.clicks / p.impressions if p.impressions else None
    cpc = c.cost / c.clicks if c.clicks else None
    cpc_p = p.cost / p.clicks if p.clicks else None
    cpo = c.cost / c.orders if c.orders else None
    cpo_p = p.cost / p.orders if p.orders else None
    roas = revenue_cur / c.cost if revenue_cur is not None and c.cost else None
    roas_p = revenue_prev / p.cost if revenue_prev is not None and p.cost else None

    metrics = [
        metric("ADS01", "Spend", _r(c.cost), _r(p.cost), unit="usd"),
        metric("ADS02", "Impressions", int(round(c.impressions)), int(round(p.impressions))),
        metric("ADS03", "Clicks", int(round(c.clicks)), int(round(p.clicks))),
        metric("ADS04", "Click-through rate", _r(ctr, 4), _r(ctr_p, 4), unit="pct"),
        metric("ADS05", "Average cost per click", _r(cpc), _r(cpc_p), unit="usd"),
        metric("ADS06", "Orders from ads", _n(c.orders), _n(p.orders), tag="tracked"),
        metric("ADS07", "Attributed ad revenue", _r(revenue_cur), _r(revenue_prev), unit="usd", tag="modelled",
               reason=None if revenue_cur is not None else "ticket_not_set"),
        metric("ADS08", "Cost per order", _r(cpo), _r(cpo_p), unit="usd", reason=None if cpo is not None else "no_data_in_period"),
        metric("ADS09", "Return on ad spend", _r(roas), _r(roas_p), unit="multiple", tag="modelled",
               reason=None if roas is not None else ("ticket_not_set" if revenue_cur is None else "no_data_in_period")),
        metric("ADS11", "Budget pacing", _r(c.cost / budget, 4) if budget else None, None, unit="pct",
               reason=None if budget else "budget_not_set"),
    ]
    rows = []
    for cp in campaigns:
        t = cur.get(cp["id"])
        if not t or not t.has_data or t.cost <= 0:
            continue
        acc = next((a for a in accounts if a["id"] == cp["accountId"]), None)
        ticket = calc.avg_ticket(acc.get("ticketSales"), acc.get("ticketOrders")) if acc else None
        k = calc.kpis(t, ticket)
        rows.append({"campaign": cp["name"], "spend": _r(t.cost), "clicks": int(round(t.clicks)), "orders": _n(t.orders), "roas": _r(k.roas)})
    rows.sort(key=lambda r: -(r["spend"] or 0))
    tables = {
        "topCampaigns": rows[:5],
        "actions": [{"action": "Calls", "value": _n(c.calls), "prev": _n(p.calls)},
                    {"action": "Directions", "value": _n(c.directions), "prev": _n(p.directions)},
                    {"action": "Website clicks", "value": _n(c.website), "prev": _n(p.website)},
                    {"action": "Menu views", "value": _n(c.menu), "prev": _n(p.menu)}],
        "tickets": tickets,
    }
    # Capped at the month end: the sync keeps running after the month closes.
    through = through_month(max((a["lastMetricsDate"] for a in accounts if a.get("lastMetricsDate")), default=None), period_end)
    note = "Attributed revenue is modelled: tracked orders × the average ticket entered for the account." if revenue_cur is not None else None
    return section("ads", metrics=metrics, tables=tables, note=note, data_through=through,
                   sources=[f"Google Ads · {a['name']}" for a in accounts])


_IDS = (
    ("ADS01", "Spend", "usd"), ("ADS02", "Impressions", "count"), ("ADS03", "Clicks", "count"), ("ADS04", "Click-through rate", "pct"),
    ("ADS05", "Average cost per click", "usd"), ("ADS06", "Orders from ads", "count"), ("ADS07", "Attributed ad revenue", "usd"),
    ("ADS08", "Cost per order", "usd"), ("ADS09", "Return on ad spend", "multiple"), ("ADS11", "Budget pacing", "pct"),
)


async def build(db: AsyncSession, ctx: Ctx) -> dict:
    rows = (await db.execute(select(AdsAccount.id, AdsAccount.name, AdsAccount.ticket_total_sales, AdsAccount.ticket_order_count,
                                    AdsAccount.ticket_updated_at, AdsAccount.last_metrics_date)
                             .where(AdsAccount.merchant_id == ctx.merchant_id, AdsAccount.state == "active", AdsAccount.source != "DEMO")
                             .order_by(AdsAccount.name))).all()
    accounts = [{"id": r.id, "name": r.name, "ticketSales": float(r.ticket_total_sales) if r.ticket_total_sales is not None else None,
                 "ticketOrders": r.ticket_order_count, "ticketUpdatedAt": r.ticket_updated_at.date().isoformat() if r.ticket_updated_at else None,
                 "lastMetricsDate": r.last_metrics_date} for r in rows]
    if not accounts:
        return compute([], [], {}, {}, ctx.merchant.get("googleAdsBudget"))
    camp_rows = (await db.execute(select(AdsCampaign.id, AdsCampaign.account_id, AdsCampaign.name, AdsCampaign.status)
                                  .where(AdsCampaign.account_id.in_([a["id"] for a in accounts])))).all()
    campaigns = [{"id": r.id, "accountId": r.account_id, "name": r.name, "status": r.status} for r in camp_rows]
    ids = [c["id"] for c in campaigns]
    cur = await ads_reports.campaign_totals(db, ctx.period.start, ctx.period.end, ids)
    prev = await ads_reports.campaign_totals(db, ctx.prev.start, ctx.prev.end, ids)
    return compute(accounts, campaigns, cur, prev, ctx.merchant.get("googleAdsBudget"), period_end=ctx.period.end)
