"""Words from the month's numbers. Pure: no database, no AI, no estimates.

Headline cards (REP01), the executive summary, default recommendations with an
owner and a next-month target (MFR09) and the bottom line are written from the
assembled sections only. Everything here is a starting point the reviewer can
rewrite before approval; the Ads module's n8n commentary is never reused."""
from __future__ import annotations

from typing import Optional

from app.modules.report_gen.assemble import find_metric
from app.modules.report_gen.periods import Period


def _pct(v: Optional[float]) -> str:
    if v is None:
        return ""
    sign = "+" if v >= 0 else "−"
    return f"{sign}{abs(v) * 100:.0f}%"


def _money(v: Optional[float]) -> str:
    return "—" if v is None else f"${v:,.0f}"


def _num(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.1f}"


def _card(m: Optional[dict], section: str, *, label: Optional[str] = None) -> dict:
    if m is None:
        return {"section": section, "id": None, "label": label or "", "value": None, "change": None, "unit": "count", "tag": None, "reason": None, "reasonText": None}
    return {"section": section, "id": m["id"], "label": label or m["label"], "value": m["value"], "change": m["change"], "unit": m["unit"],
            "tag": m.get("tag"), "reason": m.get("reason"), "reasonText": m.get("reasonText")}


def headline(sections: dict[str, dict]) -> list[dict]:
    """Four headline cards: gross sales, orders, organic clicks, CTR — then one per live module (REP01)."""
    sales, search, ads = sections.get("sales"), sections.get("search"), sections.get("ads")
    cards = [
        _card(find_metric(sales, "SAL01"), "sales", label="Gross sales"),
        _card(find_metric(sales, "SAL03"), "sales", label="Orders"),
        _card(find_metric(search, "SEO01"), "search", label="Organic clicks"),
        _card(find_metric(search, "SEO03"), "search", label="Click-through rate"),
    ]
    if ads and ads["included"]:
        cards.append(_card(find_metric(ads, "ADS09") or find_metric(ads, "ADS01"), "ads", label="Return on ad spend"))
    blogs = sections.get("blogs")
    if blogs and blogs["included"]:
        cards.append(_card(find_metric(blogs, "SEO16"), "blogs", label="Blog clicks"))
    return cards


def summary(merchant: dict, period: Period, prev: Period, sections: dict[str, dict]) -> list[str]:
    out: list[str] = []
    search = sections.get("search")
    if search and search["included"]:
        clicks, impr, ctr, pos = (find_metric(search, i) for i in ("SEO01", "SEO02", "SEO03", "SEO04"))
        if clicks and clicks["value"] is not None:
            s = f"Google search brought {_num(clicks['value'])} visits in {period.label}"
            if clicks["change"] is not None:
                s += f", {_pct(clicks['change'])} on {prev.label}"
            s += f", from {_num(impr['value'])} appearances in results"
            if pos and pos["value"] is not None:
                s += f" at an average position of {pos['value']:.1f}"
            out.append(s + ".")
        else:
            out.append(f"Search figures for {period.label} are not supplied: {search['caption'] or 'no data.'}")
    ads = sections.get("ads")
    if ads and ads["included"]:
        spend, orders, cpo, roas = (find_metric(ads, i) for i in ("ADS01", "ADS06", "ADS08", "ADS09"))
        if spend and spend["value"] is not None:
            s = f"Google Ads spend of {_money(spend['value'])} tracked {_num(orders['value'])} orders"
            if cpo and cpo["value"] is not None:
                s += f" at {_money(cpo['value'])} per order"
            if roas and roas["value"] is not None:
                s += f", a modelled return of {roas['value']:.1f}× on spend"
            out.append(s + ".")
        else:
            out.append(f"Ads figures for {period.label} are not supplied: {ads['caption'] or 'no data.'}")
    blogs = sections.get("blogs")
    if blogs and blogs["included"]:
        published = find_metric(blogs, "SEO15")
        bclicks = find_metric(blogs, "SEO16")
        if published and published["value"]:
            s = f"{_num(published['value'])} blog post{'s' if published['value'] != 1 else ''} went live"
            if bclicks and bclicks["value"] is not None:
                s += f"; blog pages earned {_num(bclicks['value'])} search clicks"
            out.append(s + ".")
    pending = [s["title"] for s in sections.values() if s["included"] and s["metrics"] and all(m["value"] is None for m in s["metrics"])]
    if pending:
        out.append("Not supplied this month: " + ", ".join(pending) + ". Each section says what is needed.")
    return out[:6]


def recommendations(sections: dict[str, dict]) -> list[dict]:
    """Only what the data supports (MFR09); each with an owner and a next-month target."""
    recs: list[dict] = []
    search = sections.get("search")
    if search and search["included"]:
        branded = (search.get("tables") or {}).get("branded")
        clicks = find_metric(search, "SEO01")
        if branded and branded.get("brandedShare") is not None and branded["brandedShare"] >= 0.8:
            recs.append({"action": "Add pages for cuisine and neighbourhood searches to grow non-branded visits",
                         "why": f"{branded['brandedShare'] * 100:.0f}% of tracked clicks come from people already searching the restaurant's name.",
                         "owner": "Innowi SEO", "target": "Non-branded clicks up 10% next month"})
        issues = (search.get("tables") or {}).get("issues") or {}
        if issues.get("openCount"):
            recs.append({"action": f"Close the {issues['openCount']} open site audit issue{'s' if issues['openCount'] != 1 else ''}",
                         "why": "Open technical issues hold back rankings for every page.", "owner": "Innowi SEO",
                         "target": f"{max(1, min(issues['openCount'], 3))} fixed next month"})
        if clicks and clicks["change"] is not None and clicks["change"] <= -0.2:
            recs.append({"action": "Review the pages that lost search traffic and refresh their content",
                         "why": f"Organic clicks fell {_pct(clicks['change'])} on the prior month.", "owner": "Innowi SEO",
                         "target": "Back to the prior month's clicks"})
    ads = sections.get("ads")
    if ads and ads["included"]:
        roas, budget, ticket = find_metric(ads, "ADS09"), find_metric(ads, "ADS11"), find_metric(ads, "ADS07")
        if roas and roas["value"] is not None and roas["value"] < 1:
            recs.append({"action": "Narrow ad targeting to the campaigns that bring orders", "why": f"Modelled return was {roas['value']:.1f}× — below break-even.",
                         "owner": "Innowi Ads", "target": "Return above 1.0× next month"})
        if ticket and ticket["value"] is None and ticket.get("reason") == "ticket_not_set":
            recs.append({"action": "Enter the average ticket for the ads account so revenue and return can be shown",
                         "why": "Without it the report cannot model revenue from tracked orders.", "owner": "Innowi Ads", "target": "Entered before the next report"})
        if budget and budget["value"] is None and budget.get("reason") == "budget_not_set":
            recs.append({"action": "Record the agreed monthly ad budget on the merchant profile", "why": "Budget pacing cannot be shown without it.",
                         "owner": "Account manager", "target": "Recorded before the next report"})
    blogs = sections.get("blogs")
    if blogs and blogs["included"]:
        published = find_metric(blogs, "SEO15")
        if published and published["value"] == 0:
            recs.append({"action": "Publish at least two blog posts on menu items or local events", "why": "No post went live this month.",
                         "owner": "Innowi content", "target": "2 posts next month"})
    sales = sections.get("sales")
    if sales and sales["included"] and sales["metrics"] and all(m["value"] is None for m in sales["metrics"]):
        recs.append({"action": "Connect the sales feed so sales, orders and channel mix appear in the report",
                     "why": "The Sales section is not supplied until the feed is connected.", "owner": "Innowi", "target": "Connected before the next report"})
    return recs[:6]


def bottom_line(period: Period, sections: dict[str, dict]) -> str:
    live = [s["title"] for s in sections.values() if s["included"] and any(m["value"] is not None for m in s["metrics"])]
    pending = [s["title"] for s in sections.values() if s["included"] and s["metrics"] and all(m["value"] is None for m in s["metrics"])]
    parts = []
    if live:
        parts.append(f"{period.label} figures cover {', '.join(live)}.")
    if pending:
        parts.append(f"{', '.join(pending)}: not supplied this month.")
    return " ".join(parts) or f"No figures were available for {period.label}."
