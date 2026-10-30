"""The n8n workflow's Google Ads logic, ported to modules/ads/calc.py.

Expected values come from the real "Automation - Google Ads Results" sheet the
n8n workflow filled (September 2026), so the port is checked against what the
team sees today — and the sheet's known bugs are checked as fixed.
"""
from __future__ import annotations

import datetime as dt

from app.modules.ads import calc

CASA_TICKET = calc.avg_ticket(6835, 155)  # "GBP Dashboard": Total Sales 6835, No of Orders 155


def test_avg_ticket_matches_sheet():
    assert round(CASA_TICKET, 2) == 44.1  # sheet: 44.1
    assert calc.avg_ticket(None, 155) is None
    assert calc.avg_ticket(6835, 0) is None


def test_casa_villa_week_01_matches_sheet():
    # Sheet row: Week 01 Casa Villa - PMAX · 23.02 · 14170 · 0 · 293 · 10 · 3 · 33 · 7.67 · 44.1 · 132.3 · 474.72 · 5.75
    w = calc.Totals(cost=23.02, impressions=14170, calls=0, directions=293, website=10, orders=3, menu=33, days=7)
    k = calc.kpis(w, CASA_TICKET)
    assert round(k.cost_per_order, 2) == 7.67
    assert round(k.revenue, 1) == 132.3
    assert round(k.roas, 2) == 5.75
    # n8n rounded the ticket to 2 dp before multiplying (474.72); unrounded gives 474.68.
    assert abs(k.roi - 474.72) < 0.1
    text = calc.analysis_text(w, k)
    assert text.startswith("Strong performance: 5.75x ROAS with 3 orders ($132.29 rev) at $7.67/order.")
    # Sheet said "Call volume was healthy (0 calls)" — fixed.
    assert "No calls this week." in text and "healthy (0 calls)" not in text
    assert calc.roas_status(k.roas, w.cost)["key"] == "excellent"


def test_analysis_rules_match_n8n():
    ticket = 43.4  # Punjabi Tandoor Norwalk
    near = calc.Totals(cost=52.79, impressions=3856, calls=7, directions=47, website=2, orders=1, menu=64, days=7)
    assert calc.analysis_text(near, calc.kpis(near, ticket)).startswith("Near break-even (0.82x ROAS). Ad spend was $52.79 against $43.40 revenue.")
    prof = calc.Totals(cost=74.92, impressions=16620, calls=10, directions=86, website=7, orders=4, menu=44, days=7)
    assert calc.analysis_text(prof, calc.kpis(prof, 42.92)).startswith("Profitable week: 2.29x ROAS generating 4 orders at $18.73 CPO.")
    assert calc.analysis_text(prof, calc.kpis(prof, 42.92), "month").startswith("Profitable month:")
    local = calc.Totals(cost=19.09, impressions=2200, calls=0, directions=25, website=4, orders=0, menu=3, days=7)
    assert calc.analysis_text(local, calc.kpis(local, 35.68)) == (
        "High local intent generated (0 calls, 25 directions, 4 visits) despite 0 direct online orders. Brand awareness & foot traffic positive."
    )
    low = calc.Totals(cost=28.75, impressions=5570, days=7)
    assert calc.analysis_text(low, calc.kpis(low, 54.11)).startswith("Spent $28.75 across 5,570 impressions with low engagement.")
    bad = calc.Totals(cost=100, impressions=900, orders=1, days=7)
    assert calc.analysis_text(bad, calc.kpis(bad, 30)).startswith("Sub-optimal return (0.3x ROAS).")
    none = calc.Totals(cost=0, impressions=10, days=7)
    assert calc.analysis_text(none, calc.kpis(none, 30)).startswith("No ad spend recorded")
    # No ticket entered: n8n said "Sub-optimal (0x)"; now it says what's missing.
    assert "average ticket size" in calc.analysis_text(prof, calc.kpis(prof, None))


def test_monthly_roas_bug_fixed():
    # MonthlyReport Casa Villa: spend 100.56, orders 6 → sheet ROAS 1.63 (= ROI/100). Correct ROAS is 2.63.
    m = calc.Totals(cost=100.56, impressions=50100, orders=6, days=30)
    k = calc.kpis(m, CASA_TICKET)
    assert round(k.roas, 2) == 2.63
    assert round(k.roi, 2) == 163.11
    # Zero revenue: sheet ROAS -1.0 / CPO blank → ROAS 0, ROI -100, CPO not available.
    z = calc.kpis(calc.Totals(cost=195.35, impressions=12321, orders=0, days=30), 38.87)
    assert z.roas == 0 and z.roi == -100 and z.cost_per_order is None


def test_kpis_not_available():
    k = calc.kpis(calc.Totals(cost=0, orders=0, days=1), 40)
    assert k.roas is None and k.roi is None and k.cost_per_order is None and k.revenue == 0
    assert calc.roas_status(None, 0) == {"key": "na", "label": "N/A"}


def test_roas_status_bands():
    key = lambda r: calc.roas_status(r, 10)["key"]  # noqa: E731
    assert [key(x) for x in (4.0, 3.99, 2.5, 2.49, 1.0, 0.99, 0)] == ["excellent", "good", "good", "breakeven", "breakeven", "unprofitable", "unprofitable"]


def test_weeks_cover_whole_month():
    sep = calc.weeks_of_month(2026, 9)
    assert [(w[0], w[1].day, w[2].day) for w in sep] == [("Week 01", 1, 7), ("Week 02", 8, 14), ("Week 03", 15, 21), ("Week 04", 22, 30)]
    assert calc.weeks_of_month(2026, 2)[3][2] == dt.date(2026, 2, 28)
    assert calc.weeks_of_month(2026, 1)[3][2] == dt.date(2026, 1, 31)


def test_budget_panel_matches_prototype():
    july = calc.month_bounds(2026, 7)
    harbor = calc.Budget(*july, approved=1860, all_daily=60, active_daily=60, mtd_spend=1792.30, through=dt.date(2026, 7, 31))
    assert (harbor.projected, harbor.variance, harbor.variance_pct, harbor.status) == (1860, 0, 0, "on_track")
    assert round(harbor.remaining, 2) == 67.70
    smoke = calc.Budget(*july, approved=1350, all_daily=45, active_daily=45, mtd_spend=1381.81, through=dt.date(2026, 7, 31))
    assert smoke.projected == 1395 and round(smoke.variance_pct, 1) == 3.3 and smoke.status == "on_track"
    pier = calc.Budget(*july, approved=660, all_daily=30, active_daily=30, mtd_spend=924, through=dt.date(2026, 7, 31))
    assert pier.status == "mismatch"
    assert calc.budget_mismatch_detail(pier, "active").startswith("Projected monthly spend is more than 10% above")
    paused = calc.Budget(*july, approved=450, all_daily=15, active_daily=0, mtd_spend=0, through=dt.date(2026, 7, 31))
    assert paused.status == "mismatch" and "paused" in calc.budget_mismatch_detail(paused, "paused")
    mid = calc.Budget(*july, approved=900, all_daily=30, active_daily=30, mtd_spend=300, through=dt.date(2026, 7, 10))
    assert mid.projected_pace == 300 + 30 * 21
    assert calc.Budget(*july, approved=None, all_daily=1, active_daily=1, mtd_spend=0, through=None).status == "no_budget"


def test_status_alerts_and_ids():
    assert calc.restaurant_status(["ENABLED", "PAUSED"], "active") == "active"
    assert calc.restaurant_status(["PAUSED", "REMOVED"], "active") == "paused"
    assert calc.restaurant_status([], "active") == "no_campaigns"
    assert calc.restaurant_status(["ENABLED"], "archived") == "archived"
    assert calc.campaign_summary(["ENABLED", "ENABLED", "PAUSED", "REMOVED"]) == "2 active · 1 paused"
    now = dt.datetime(2026, 10, 7, tzinfo=dt.timezone.utc)
    assert calc.sync_state(now - dt.timedelta(hours=3), None, now, 48) == "ok"
    assert calc.sync_state(now - dt.timedelta(hours=74), None, now, 48) == "issue"
    assert calc.sync_state(now, "boom", now, 48) == "issue"
    july = calc.month_bounds(2026, 7)
    b = calc.Budget(*july, approved=660, all_daily=30, active_daily=30, mtd_spend=0, through=None)
    al = calc.alerts(budget=b, restaurant_status_="active", verification="failed", verification_message=None, sync="issue", sync_error=None)
    assert [a["type"] for a in al] == ["budget_mismatch", "verification_required", "sync_issue"]
    assert calc.clean_customer_id(2840308978.0) == "2840308978"
    assert calc.clean_customer_id("284-030-8978") == "2840308978"
    assert calc.format_customer_id("2840308978") == "284-030-8978"
