"""One document model, rendered twice.

`document()` turns an approved snapshot payload into a flat list of blocks —
cover, headings, paragraphs, cards, tables, captions — and `pdf.py` and
`docx.py` only draw those blocks. Every number, label, "not supplied" reason
and "modelled" tag is therefore worded once, so the PDF and the DOCX say the
same thing (MFR10).

Three rules this file enforces for both renderers:

  * the whitelist runs first. `document()` calls the same
    `whitelist.assert_clean()` the assembler and the service call, so a bug
    here can never print a blocked field (hard rule 13, MFR07);
  * section order is read from the payload's own `sectionOrder`, never from a
    list kept here, so the export cannot reorder the PRD shape (MFR02);
  * a figure the assembler could not supply prints "Not supplied — <reason>"
    and an attributed figure prints its `tracked` / `modelled` tag. Nothing is
    blanked, zeroed or dropped (MFR04, MFR05).

Nothing here reads the clock: every date and time printed comes out of the
frozen snapshot, which is what makes both exports byte-stable (MFR10).
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Optional

from app.modules.report_gen import whitelist

PREPARED_BY = "Innowi Inc."
FOOTER = "innowi.com · (510) 588-7102 · info@innowi.com"
NOT_SUPPLIED = "Not supplied"
EMPTY = "—"
TAGS = {"modelled": "modelled", "tracked": "tracked"}
TAG_NOTE = {
    "modelled": "Modelled: worked out from tracked activity and the average ticket on file, not a figure taken from the till.",
    "tracked": "Tracked: counted by the platform that served the activity.",
}


# -------------------------------------------------------------- formatting ----
def long_date(value: Any) -> str:
    """"September 30, 2026". Built from the parts, never with %-d / %#d: that
    format is platform-specific and crashes on Windows."""
    d = as_date(value)
    if d is None:
        return EMPTY
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def as_date(value: Any) -> Optional[dt.date]:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str) and value:
        try:
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def money(v: Optional[float]) -> str:
    if v is None:
        return EMPTY
    return f"${v:,.0f}" if float(v).is_integer() else f"${v:,.2f}"


def number(v: Optional[float]) -> str:
    if v is None:
        return EMPTY
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.1f}"


def percent(v: Optional[float]) -> str:
    """The payload keeps rates as fractions (0.048); the document prints 4.8%."""
    return EMPTY if v is None else f"{v * 100:,.1f}%"


def multiple(v: Optional[float]) -> str:
    return EMPTY if v is None else f"{v:,.1f}×"


def decimal1(v: Optional[float]) -> str:
    return EMPTY if v is None else f"{v:,.1f}"


_UNIT: dict[str, Any] = {"usd": money, "pct": percent, "multiple": multiple, "position": decimal1, "ratio": decimal1,
                         "count": number, "table": number}


def unit_text(value: Optional[float], unit: Optional[str]) -> str:
    return _UNIT.get(unit or "count", number)(value)


def change_text(change: Optional[float]) -> str:
    """"+20%" / "-14%" on the month before. Hyphen-minus, not U+2212: the PDF's
    base fonts cannot encode the typographic minus sign."""
    if change is None:
        return EMPTY
    return f"{'+' if change >= 0 else '-'}{abs(change) * 100:,.0f}%"


def not_supplied_text(reason_text: Optional[str]) -> str:
    """MFR04: the heading stays, the figure says why it is absent — never a zero."""
    return f"{NOT_SUPPLIED} — {reason_text}" if reason_text else NOT_SUPPLIED


def metric_label(m: dict) -> str:
    """The figure's name, with its attribution tag where it has one (MFR05)."""
    tag = TAGS.get(str(m.get("tag") or ""))
    return f"{m['label']} ({tag})" if tag else str(m.get("label") or m.get("id") or "")


def metric_value(m: dict) -> str:
    if m.get("value") is None:
        return not_supplied_text(m.get("reasonText"))
    if m.get("unit") == "table":
        # The figure is a row count; the rows themselves follow as a table.
        return f"{number(m['value'])} shown below"
    return unit_text(m["value"], m.get("unit"))


# ------------------------------------------------------- generic table cells ----
# Column headings for the adapters' table keys. Anything not listed is turned
# into words from its camelCase name, so a new adapter needs no change here.
COLUMNS: dict[str, str] = {
    "query": "Search term", "clicks": "Clicks", "impressions": "Impressions", "position": "Position",
    "prevClicks": "Clicks last month", "prevImpressions": "Impressions last month", "prevPosition": "Position last month",
    "prevCtr": "Click-through rate last month", "page": "Page", "device": "Device",
    "campaign": "Campaign", "spend": "Spend", "orders": "Orders", "roas": "Return on ad spend (modelled)",
    "account": "Account", "avgTicket": "Average ticket", "asOf": "As of", "action": "Action", "value": "This month",
    "prev": "Last month", "title": "Title", "url": "Address", "publishedOn": "Published", "openCount": "Open issues",
    "fixedThisMonth": "Fixed this month", "brandedShare": "Branded share of clicks", "trackedClicks": "Clicks in tracked terms",
    "trackedShareOfClicks": "Tracked share of clicks", "shareOfSiteClicks": "Share of all site clicks", "planned": "Planned",
    "ctr": "Click-through rate", "share": "Share",
}
# Keys whose value is money, a rate or a multiple whatever the table it sits in.
_MONEY_KEYS = ("spend", "cost", "revenue", "budget", "avgticket", "ticket")
_RATE_KEYS = ("share", "rate", "ctr")


def column_label(key: str) -> str:
    if key in COLUMNS:
        return COLUMNS[key]
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(key)).replace("_", " ").strip()
    return words[:1].upper() + words[1:]


def cell_text(key: str, value: Any) -> str:
    """One table cell. The key decides the unit, so the adapters' plain numbers
    print as money, a rate or a multiple exactly as the figures above do."""
    if value is None:
        return EMPTY
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, str):
        return long_date(value) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else value
    if not isinstance(value, (int, float)):
        return str(value)
    k = str(key).lower()
    if "roas" in k:
        return multiple(value)
    if "position" in k:
        return decimal1(value)
    if any(x in k for x in _RATE_KEYS):
        return percent(value)
    if any(x in k for x in _MONEY_KEYS):
        return money(value)
    return number(value)


def flat_label(key: str) -> str:
    """"branded ctr" → "Branded click-through rate": the nesting in words, then the
    leaf's own column heading, so a nested table reads like a flat one."""
    head, _, leaf = str(key).rpartition(" ")
    return column_label(leaf) if not head else f"{column_label(head)} {column_label(leaf).lower()}"


def _flatten(d: dict, prefix: str = "") -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    for k, v in d.items():
        if isinstance(v, dict):
            out.extend(_flatten(v, f"{prefix}{k} "))
            continue
        out.append((f"{prefix}{k}", v))
    return out


def table_block(name: str, data: Any) -> Optional[dict]:
    """A named adapter table as a block: rows of dicts become a grid, a plain
    dict becomes a field / value list. Empty tables are left out."""
    if not data:
        return None
    title = column_label(name)
    if isinstance(data, list):
        rows = [r for r in data if isinstance(r, dict)]
        if not rows:
            return None
        keys: list[str] = []
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        head = [column_label(k) for k in keys]
        body = [[cell_text(k, r.get(k)) for k in keys] for r in rows]
        numeric = [i for i, k in enumerate(keys) if all(isinstance(r.get(k), (int, float)) or r.get(k) is None for r in rows)]
        return {"type": "table", "title": title, "head": head, "rows": body, "numeric": numeric}
    if isinstance(data, dict):
        pairs = [(k, v) for k, v in _flatten(data) if not str(k).lower().endswith("reason")]
        if not pairs:
            return None
        return {"type": "table", "title": title, "head": ["Figure", "Value"],
                "rows": [[flat_label(k), cell_text(k.rpartition(" ")[2], v)] for k, v in pairs],
                "numeric": [1]}
    return None


# ---------------------------------------------------------- document model ----
def _metric_table(sec: dict, period_label: str, prev_label: str) -> dict:
    rows = []
    for m in sec.get("metrics") or []:
        rows.append([metric_label(m), metric_value(m), unit_text(m.get("prev"), m.get("unit")) if m.get("prev") is not None else EMPTY,
                     change_text(m.get("change"))])
    return {"type": "table", "title": None, "head": ["Figure", period_label, prev_label, "Change"], "rows": rows, "numeric": [1, 2, 3]}


def _snapshot(payload: dict, period_label: str, prev_label: str) -> list[dict]:
    """The snapshot table: the headline figures with the month before and the change."""
    sections = payload.get("sections") or {}
    rows = []
    for card in payload.get("headline") or []:
        sec = sections.get(card.get("section")) or {}
        prev = next((m.get("prev") for m in sec.get("metrics") or [] if m.get("id") == card.get("id")), None)
        note = TAGS.get(str(card.get("tag") or ""), "")
        rows.append([
            card.get("label") or "",
            not_supplied_text(card.get("reasonText")) if card.get("value") is None else unit_text(card.get("value"), card.get("unit")),
            unit_text(prev, card.get("unit")) if prev is not None else EMPTY,
            change_text(card.get("change")),
            note,
        ])
    if not rows:
        return []
    return [{"type": "heading", "level": 2, "text": "Snapshot"},
            {"type": "table", "title": None, "head": ["Figure", period_label, prev_label, "Change", "Basis"], "rows": rows, "numeric": [1, 2, 3]}]


def _missing_rollup(payload: dict) -> list[dict]:
    """Every "not supplied" figure once more, grouped by section and reason, so the
    merchant can see at a glance what is pending and why (MFR04)."""
    sections = payload.get("sections") or {}
    groups: dict[tuple[str, str], list[str]] = {}
    for item in payload.get("missing") or []:
        sec = sections.get(item.get("section")) or {}
        label = next((metric_label(m) for m in sec.get("metrics") or [] if m.get("id") == item.get("id")), item.get("id") or "")
        groups.setdefault((str(sec.get("title") or item.get("section") or ""), str(item.get("text") or item.get("reason") or "")), []).append(label)
    if not groups:
        return []
    rows = [[title, ", ".join(labels), reason] for (title, reason), labels in groups.items()]
    return [{"type": "heading", "level": 2, "text": "Not supplied this month"},
            {"type": "paragraph", "text": "These figures are not in this report. Each line says what is needed; none of them is shown as zero."},
            {"type": "table", "title": None, "head": ["Section", "Figures", "Why"], "rows": rows, "numeric": []}]


def document(payload: dict) -> list[dict]:
    """The blocks of one merchant report, in PRD A order (MFR02).

    `payload` is an approved snapshot. The whitelist scan runs before a single
    block is built: whatever the renderers do, a blocked field never reaches a
    merchant-facing document (MFR07, hard rule 13).
    """
    whitelist.assert_clean(payload)

    merchant = payload.get("merchant") or {}
    period = payload.get("period") or {}
    previous = payload.get("previous") or {}
    period_label = str(period.get("label") or "This month")
    prev_label = str(previous.get("label") or "Last month")
    sections = payload.get("sections") or {}
    notes = payload.get("sectionNotes") or {}
    where = ", ".join(x for x in (merchant.get("city"), merchant.get("state")) if x)

    blocks: list[dict] = [{
        "type": "cover",
        "brand": "innowi",
        "title": f"{merchant.get('name') or 'Merchant'} — marketing report",
        "period": period_label,
        "lines": [x for x in (where, merchant.get("website"), f"Prepared by {PREPARED_BY}",
                              f"Report prepared {long_date(payload.get('generatedAt'))}" if payload.get("generatedAt") else None) if x],
    }]

    blocks.append({"type": "heading", "level": 2, "text": "Executive summary"})
    cards = [{"label": c.get("label") or "", "value": not_supplied_text(c.get("reasonText")) if c.get("value") is None else unit_text(c.get("value"), c.get("unit")),
              "change": change_text(c.get("change")) if c.get("change") is not None else "", "supplied": c.get("value") is not None}
             for c in payload.get("headline") or []]
    if cards:
        blocks.append({"type": "cards", "cards": cards})
    for para in payload.get("summary") or []:
        blocks.append({"type": "paragraph", "text": str(para)})
    if payload.get("bottomLine"):
        blocks.append({"type": "lead", "text": str(payload["bottomLine"])})

    blocks.extend(_snapshot(payload, period_label, prev_label))

    # MFR02: the assembler's order, read from the payload itself — never a list kept here.
    order = list(payload.get("sectionOrder") or sections.keys())
    for key in order:
        sec = sections.get(key)
        if not sec or not sec.get("included"):
            continue  # MFR01: a service the merchant has not taken gets no section at all
        blocks.append({"type": "heading", "level": 2, "text": str(sec.get("title") or key)})
        if sec.get("caption"):
            blocks.append({"type": "note", "text": str(sec["caption"])})
        if notes.get(key):
            blocks.append({"type": "paragraph", "text": str(notes[key])})
        if sec.get("metrics"):
            blocks.append(_metric_table(sec, period_label, prev_label))
            for tag in sorted({str(m.get("tag")) for m in sec["metrics"] if m.get("tag") in TAG_NOTE}):
                blocks.append({"type": "note", "text": TAG_NOTE[tag]})
        for name, data in (sec.get("tables") or {}).items():
            block = table_block(name, data)
            if block:
                blocks.append(block)
        if sec.get("dataThrough"):
            blocks.append({"type": "note", "text": f"Data through {long_date(sec['dataThrough'])}."})

    recs = payload.get("recommendations") or []
    if recs:
        blocks.append({"type": "heading", "level": 2, "text": "What we recommend"})
        blocks.append({"type": "table", "title": None, "head": ["Action", "Why", "Owner", "Target next month"],
                       "rows": [[str(r.get("action") or ""), str(r.get("why") or ""), str(r.get("owner") or ""), str(r.get("target") or "")] for r in recs],
                       "numeric": []})

    if payload.get("bottomLine"):
        blocks.append({"type": "heading", "level": 2, "text": "The bottom line"})
        blocks.append({"type": "paragraph", "text": str(payload["bottomLine"])})

    blocks.extend(_missing_rollup(payload))

    sources = payload.get("sources") or []
    blocks.append({"type": "heading", "level": 2, "text": "Where these figures come from"})
    blocks.append({"type": "note", "text": "; ".join(str(s) for s in sources) if sources else "No external source supplied figures this month."})
    blocks.append({"type": "note", "text": FOOTER})
    return blocks


def slug(text: Any) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return out or "report"


def filename(payload: dict, kind: str) -> str:
    """innowi-report-gaters-restaurant-2026-09.pdf — stable for a given snapshot."""
    merchant = (payload.get("merchant") or {}).get("name")
    month = (payload.get("period") or {}).get("month") or ""
    return f"innowi-report-{slug(merchant)}{('-' + month) if month else ''}.{kind}"


def title(payload: dict) -> str:
    merchant = (payload.get("merchant") or {}).get("name") or "Merchant"
    period = (payload.get("period") or {}).get("label") or ""
    return f"{merchant} — marketing report{(' · ' + period) if period else ''}"


__all__ = ["document", "filename", "title", "long_date", "money", "number", "percent", "multiple", "change_text", "metric_label",
           "metric_value", "not_supplied_text", "table_block", "cell_text", "column_label", "NOT_SUPPLIED", "EMPTY", "TAGS",
           "TAG_NOTE", "PREPARED_BY", "FOOTER"]
