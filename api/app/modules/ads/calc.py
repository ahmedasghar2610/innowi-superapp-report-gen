"""Google Ads calculations — the n8n workflow's logic, as pure functions.

Everything the old "Google Ads Reporting" n8n workflow computed (and the
prototype dashboard adds) lives here, with no database or network access, so
it is unit-tested directly (tests/test_ads_calc.py).

Ported from n8n (node "ProcessMetricsAndGenerateAnalysis"):
    avg ticket   = Total Sales ÷ No of Orders            (the account list inputs)
    revenue      = orders × avg ticket
    cost/order   = spend ÷ orders                         (None — "Not available" — when 0 orders)
    ROAS         = revenue ÷ spend
    ROI          = (revenue − spend) ÷ spend × 100
    ROAS status  ≥4 Excellent · ≥2.5 Good · ≥1 Break-even · <1 Unprofitable
    analysis     the "Analysis & Future Actions" sentence (same rules and wording)

Fixed on the way (n8n/Sheet bugs, see the Google Ads n8n current-state notes):
    - MonthlyReport ROAS used (revenue − spend) ÷ spend, i.e. ROI ÷ 100.
    - cost/order and ROAS were 0 instead of "not available" with 0 orders / 0 spend.
    - "Call volume was healthy (0 calls)".
    - weeks were 1–7, 8–14, 15–21, 22–28 and days 29–31 were never reported;
      week 4 now runs to the end of the month.
    - orders/calls… were truncated to whole numbers; Google reports fractions.

Added from the prototype: budget panel (projected spend, variance, Budget
Mismatch at ±10 %), restaurant status, alerts.
"""
from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass, field
from typing import Iterable, Optional

METRICS = ("cost", "impressions", "clicks", "calls", "directions", "website", "orders", "menu")


# ------------------------------------------------------------ totals ----
@dataclass
class Totals:
    """Summed metrics for a campaign / account / portfolio over a period."""

    cost: float = 0.0
    impressions: float = 0.0
    clicks: float = 0.0
    calls: float = 0.0
    directions: float = 0.0
    website: float = 0.0
    orders: float = 0.0
    menu: float = 0.0
    days: int = 0  # campaign-days with a row (0 → no data at all in the period)

    @property
    def has_data(self) -> bool:
        return self.days > 0

    def add(self, other: "Totals") -> "Totals":
        for m in METRICS:
            setattr(self, m, getattr(self, m) + getattr(other, m))
        self.days += other.days
        return self

    @classmethod
    def of(cls, row: dict) -> "Totals":
        return cls(**{m: float(row.get(m) or 0) for m in METRICS}, days=int(row.get("days") or 0))

    def dto(self) -> dict:
        return {
            "spend": round(self.cost, 2),
            "impressions": int(round(self.impressions)),
            "clicks": int(round(self.clicks)),
            "calls": _num(self.calls),
            "directions": _num(self.directions),
            "website": _num(self.website),
            "orders": _num(self.orders),
            "menu": _num(self.menu),
        }


def sum_totals(items: Iterable[Totals]) -> Totals:
    out = Totals()
    for t in items:
        out.add(t)
    return out


def _num(v: float) -> float:
    """Conversions can be fractional (attribution); keep one decimal, drop .0."""
    r = round(v, 1)
    return int(r) if r == int(r) else r


# ------------------------------------------------------------- KPIs ----
def avg_ticket(total_sales: Optional[float], order_count: Optional[float]) -> Optional[float]:
    """The sheet's Total Sales ÷ No of Orders. None when either is missing or 0."""
    if not total_sales or not order_count:
        return None
    return float(total_sales) / float(order_count)


@dataclass
class Kpis:
    revenue: Optional[float]
    cost_per_order: Optional[float]
    roi: Optional[float]
    roas: Optional[float]

    def dto(self) -> dict:
        r = lambda v: None if v is None else round(v, 2)  # noqa: E731
        return {"revenue": r(self.revenue), "costPerOrder": r(self.cost_per_order), "roi": r(self.roi), "roas": r(self.roas)}


def kpis(t: Totals, ticket: Optional[float]) -> Kpis:
    revenue = t.orders * ticket if ticket is not None else None
    cpo = t.cost / t.orders if t.orders > 0 else None
    if t.cost > 0 and revenue is not None:
        roas = revenue / t.cost
        roi = (revenue - t.cost) / t.cost * 100
    else:
        roas = roi = None
    return Kpis(revenue=revenue, cost_per_order=cpo, roi=roi, roas=roas)


# n8n "ROAS Status"
ROAS_BANDS = (
    (4.0, "excellent", "Excellent (≥ 4x)"),
    (2.5, "good", "Good (≥ 2.5x)"),
    (1.0, "breakeven", "Break-even (≥ 1x)"),
    (float("-inf"), "unprofitable", "Unprofitable (< 1x)"),
)


def roas_status(roas: Optional[float], cost: float) -> dict:
    if cost <= 0 or roas is None:
        return {"key": "na", "label": "N/A"}
    for floor, key, label in ROAS_BANDS:
        if round(roas, 2) >= floor:
            return {"key": key, "label": label}
    return {"key": "na", "label": "N/A"}  # pragma: no cover


def _money(v: Optional[float]) -> str:
    return "—" if v is None else f"${v:,.2f}"


def _n(v: float) -> str:
    r = round(v, 1)
    return f"{int(r):,}" if r == int(r) else f"{r:,}"


def analysis_text(t: Totals, k: Kpis, period: str = "week") -> str:
    """The sheet's "Analysis & Future Actions" — n8n's rules and wording.

    `period` is "week" for the weekly rows (as in the sheet), "month" or
    "period" elsewhere."""
    cost, orders = round(t.cost, 2), t.orders
    calls, dirs, web, imps = t.calls, t.directions, t.website, t.impressions
    if cost == 0:
        return "No ad spend recorded for this period. Check campaign activation and budget."
    if orders > 0:
        if k.roas is None:
            return (
                f"{_n(orders)} orders at {_money(k.cost_per_order)}/order. Revenue, ROI and ROAS can't be calculated "
                "until the average ticket size (total sales and orders) is entered for this account."
            )
        roas = round(k.roas, 2)
        if roas >= 3.0:
            call_part = f"Call volume was healthy ({_n(calls)} calls)." if calls > 0 else "No calls this " + period + "."
            return (
                f"Strong performance: {roas}x ROAS with {_n(orders)} orders ({_money(k.revenue)} rev) at "
                f"{_money(k.cost_per_order)}/order. {call_part} Recommend scaling daily budget."
            )
        if roas >= 1.5:
            label = "Profitable " + period
            return (
                f"{label[0].upper() + label[1:]}: {roas}x ROAS generating {_n(orders)} orders at {_money(k.cost_per_order)} CPO. "
                f"Directions ({_n(dirs)}) and calls ({_n(calls)}) driving foot traffic. Maintain active bids."
            )
        if roas >= 0.8:
            return (
                f"Near break-even ({roas}x ROAS). Ad spend was {_money(cost)} against {_money(k.revenue)} revenue. "
                f"High interaction ({_n(web)} visits, {_n(calls)} calls). Optimize location bid adjustments."
            )
        return (
            f"Sub-optimal return ({roas}x ROAS). High Cost/Order ({_money(k.cost_per_order)}). Generated {_n(imps)} "
            "impressions but low conversion. Review search term exclusions and asset extensions."
        )
    if calls > 0 or dirs > 0:
        return (
            f"High local intent generated ({_n(calls)} calls, {_n(dirs)} directions, {_n(web)} visits) despite 0 direct "
            "online orders. Brand awareness & foot traffic positive."
        )
    return (
        f"Spent {_money(cost)} across {_n(imps)} impressions with low engagement. Recommend testing new ad headlines "
        "and refining geo-fencing radius."
    )


# ------------------------------------------------------------- weeks ----
def month_bounds(year: int, month: int) -> tuple[dt.date, dt.date]:
    return dt.date(year, month, 1), dt.date(year, month, calendar.monthrange(year, month)[1])


def weeks_of_month(year: int, month: int) -> list[tuple[str, dt.date, dt.date]]:
    """The sheet's Week 01–04: 1–7, 8–14, 15–21 and 22 → last day of the month
    (n8n stopped at the 28th, so the 29th–31st were never reported)."""
    first, last = month_bounds(year, month)
    starts = (1, 8, 15, 22)
    out = []
    for i, s in enumerate(starts):
        start = first.replace(day=s)
        end = first.replace(day=starts[i + 1] - 1) if i < 3 else last
        out.append((f"Week {i + 1:02d}", start, end))
    return out


# ------------------------------------------------------------ budget ----
@dataclass
class Budget:
    month_start: dt.date
    month_end: dt.date
    approved: Optional[float]
    all_daily: float  # every campaign's daily budget, whatever its status
    active_daily: float  # daily budgets of ENABLED campaigns only
    mtd_spend: float
    through: Optional[dt.date]  # last day included in mtd_spend
    tolerance_pct: float = 10.0
    remaining: Optional[float] = field(init=False)
    projected: float = field(init=False)
    projected_pace: float = field(init=False)
    variance: Optional[float] = field(init=False)
    variance_pct: Optional[float] = field(init=False)
    status: str = field(init=False)  # on_track | mismatch | no_budget

    def __post_init__(self) -> None:
        days = (self.month_end - self.month_start).days + 1
        self.projected = self.active_daily * days
        if self.through is None or self.through < self.month_start:
            left = days
        elif self.through >= self.month_end:
            left = 0
        else:
            left = (self.month_end - self.through).days
        self.projected_pace = self.mtd_spend + self.active_daily * left
        if self.approved is None or self.approved <= 0:
            self.remaining = self.variance = self.variance_pct = None
            self.status = "no_budget"
            return
        self.remaining = self.approved - self.mtd_spend
        self.variance = self.projected - self.approved
        self.variance_pct = self.variance / self.approved * 100
        self.status = "mismatch" if abs(round(self.variance_pct, 1)) > self.tolerance_pct else "on_track"

    def dto(self) -> dict:
        r = lambda v: None if v is None else round(v, 2)  # noqa: E731
        return {
            "month": self.month_start.strftime("%Y-%m"),
            "monthStart": self.month_start.isoformat(),
            "monthEnd": self.month_end.isoformat(),
            "approvedMonthly": r(self.approved),
            "googleDailyBudget": r(self.all_daily),
            "combinedDailyBudget": r(self.active_daily),
            "monthToDateSpend": r(self.mtd_spend),
            "spendThrough": self.through.isoformat() if self.through else None,
            "remaining": r(self.remaining),
            "projectedMonthly": r(self.projected),
            "projectedAtPace": r(self.projected_pace),
            "variance": r(self.variance),
            "variancePct": None if self.variance_pct is None else round(self.variance_pct, 1),
            "status": self.status,
            "tolerancePct": self.tolerance_pct,
        }


def budget_mismatch_detail(b: Budget, restaurant_status: str) -> str:
    if b.active_daily == 0 and restaurant_status != "active":
        return "Campaigns are paused, so no spend is projected against the approved monthly budget."
    if (b.variance or 0) > 0:
        return f"Projected monthly spend is more than {b.tolerance_pct:g}% above the approved budget."
    return f"Projected monthly spend is more than {b.tolerance_pct:g}% below the approved budget."


# ----------------------------------------------------- status & alerts ----
def restaurant_status(campaign_statuses: list[str], account_state: str) -> str:
    """archived | active (≥1 enabled campaign) | paused (campaigns, none enabled) | no_campaigns"""
    if account_state == "archived":
        return "archived"
    live = [s for s in campaign_statuses if s != "REMOVED"]
    if any(s == "ENABLED" for s in live):
        return "active"
    return "paused" if live else "no_campaigns"


def campaign_summary(campaign_statuses: list[str]) -> str:
    live = [s for s in campaign_statuses if s != "REMOVED"]
    a = sum(1 for s in live if s == "ENABLED")
    p = len(live) - a
    parts = ([f"{a} active"] if a else []) + ([f"{p} paused"] if p else [])
    return " · ".join(parts) if parts else "No campaigns"


def sync_state(last_synced_at: Optional[dt.datetime], sync_error: Optional[str], now: dt.datetime, stale_hours: int) -> str:
    """ok | issue | never"""
    if sync_error:
        return "issue"
    if last_synced_at is None:
        return "never"
    return "issue" if now - last_synced_at > dt.timedelta(hours=stale_hours) else "ok"


def alerts(
    *,
    budget: Optional[Budget],
    restaurant_status_: str,
    verification: str,
    verification_message: Optional[str],
    sync: str,
    sync_error: Optional[str],
) -> list[dict]:
    """The prototype's three alerts, in its order: Budget Mismatch (warn),
    Verification Required (alert), Sync Issue (alert)."""
    out: list[dict] = []
    if budget is not None and budget.status == "mismatch":
        out.append({"type": "budget_mismatch", "label": "Budget Mismatch", "severity": "warn",
                    "detail": budget_mismatch_detail(budget, restaurant_status_)})
    if verification in ("required", "failed"):
        detail = verification_message or (
            "Verification failed. Resubmit documentation to Google." if verification == "failed" else "Google requires verification for this account."
        )
        out.append({"type": "verification_required", "label": "Verification Required", "severity": "alert", "detail": detail})
    if sync == "issue":
        out.append({"type": "sync_issue", "label": "Sync Issue", "severity": "alert",
                    "detail": sync_error or "Data has not synced successfully from Google Ads recently."})
    return out


def format_customer_id(digits: Optional[str]) -> str:
    d = "".join(ch for ch in (digits or "") if ch.isdigit())
    return f"{d[:3]}-{d[3:6]}-{d[6:]}" if len(d) == 10 else d


def clean_customer_id(v: object) -> str:
    """"284-030-8978", 2840308978.0 (the sheet stores ids as numbers) → "2840308978"."""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return "".join(ch for ch in str(v or "") if ch.isdigit())
