"""Sections whose source is not connected yet. Every P1 metric of the segment is
returned as "not supplied" with the reason, so the heading and a one-line note
stay in the report (MFR04) and a live adapter can replace this file's output
without changing the report layout."""
from __future__ import annotations

from app.modules.report_gen.assemble import REASONS, not_supplied, section

# P1 metric ids and labels per segment (PRD A appendix).
P1: dict[str, tuple[tuple[str, str, str], ...]] = {
    "sales": (
        ("SAL01", "Gross sales", "usd"), ("SAL02", "Net sales", "usd"), ("SAL03", "Orders", "count"),
        ("SAL04", "Average order value", "usd"), ("SAL05", "Sales per day", "usd"), ("SAL06", "Channel mix", "table"),
        ("SAL07", "Online share of sales", "pct"), ("SAL09", "Discounts", "usd"), ("SAL10", "Refunds", "usd"),
        ("SAL11", "Tips", "usd"), ("SAL13", "Amount collected", "usd"), ("SAL14", "Period comparison", "pct"),
    ),
    "website": (
        ("WEB01", "Website visits", "count"), ("WEB03", "Traffic by source", "table"), ("WEB07", "Order-button clicks", "count"),
        ("WEB08", "Website orders", "count"), ("WEB09", "Website conversion rate", "pct"), ("WEB10", "Website revenue", "usd"),
    ),
    "gbp": (
        ("GBP01", "Profile views", "count"), ("GBP03", "Calls", "count"), ("GBP04", "Direction requests", "count"),
        ("GBP05", "Website clicks", "count"), ("GBP07", "Total actions", "count"), ("GBP11", "Profile completeness", "pct"),
        ("GBP12", "By location", "table"),
    ),
    "email_sms": (
        ("ESM01", "Messages sent", "count"), ("ESM03", "Open rate", "pct"), ("ESM04", "Click rate", "pct"),
        ("ESM06", "Orders attributed", "count"), ("ESM07", "Revenue attributed", "usd"), ("ESM08", "Messaging cost", "usd"),
        ("ESM09", "Campaign results", "table"), ("ESM11", "Customer list size", "count"),
    ),
    "rewards": (
        ("RWD01", "Members enrolled", "count"), ("RWD02", "Active members", "count"), ("RWD05", "Points redeemed", "count"),
        ("RWD07", "Member revenue", "usd"), ("RWD09", "Repeat rate", "pct"),
    ),
    "reviews": (
        ("REV01", "New reviews", "count"), ("REV02", "Total reviews and average rating", "count"), ("REV04", "Rating trend", "ratio"),
        ("REV06", "Response rate", "pct"), ("REV10", "Reviews by location", "table"),
    ),
    "ops": (
        ("OPS01", "Work completed", "count"), ("OPS02", "Changes made", "table"), ("OPS04", "Deliverables", "table"),
        ("OPS05", "Next month plan", "table"),
    ),
}


def build(key: str, reason: str, *, included: bool = True) -> dict:
    if reason not in REASONS:
        raise ValueError(f"unknown reason code {reason!r}")
    metrics = [not_supplied(id, label, reason, unit) for id, label, unit in P1[key]]
    return section(key, included=included, metrics=metrics, note=REASONS[reason])
