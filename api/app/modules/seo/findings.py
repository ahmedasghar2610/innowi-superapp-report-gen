"""Findings workflow (Intelligence).

    detected / recommended  → needs a decision
    task_created / in_progress → in flight (an owner is working on it)
    awaiting_verification   → marked fixed; the next sync re-checks it — never skipped
    closed                  → outcome: fixed (verified) | resolved (cleared by itself) | dismissed

After every sync `apply()` reconciles the rule output with what's stored:

  • still detected   → evidence refreshed; if it was "awaiting verification"
                       it goes back to in progress ("still detected").
  • no longer detected → open + untouched → closed as resolved;
                       in flight → awaiting verification;
                       awaiting verification → closed as fixed (verified).
  • detected again after closing → reopened as a new detection, except a
    dismissal, which holds for DISMISS_DAYS.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import SeoFinding, utcnow
from app.modules.seo.catalog import OPEN_STATES, SLA_HOURS

DISMISS_DAYS = 30
UPDATABLE = ("code", "severity", "team", "title", "detail", "recommendation", "confidence", "impact", "effort", "page_url", "evidence")

# Manual moves allowed from the Intelligence page.
TRANSITIONS: dict[str, tuple[str, ...]] = {
    "detected": ("task_created", "closed"),
    "recommended": ("task_created", "closed"),
    "task_created": ("in_progress", "awaiting_verification", "recommended", "closed"),
    "in_progress": ("awaiting_verification", "task_created", "closed"),
    "awaiting_verification": ("closed", "in_progress"),
    "closed": ("recommended",),
}


def note_line(old: Optional[str], line: str, now: dt.datetime) -> str:
    stamp = now.strftime("%d %b %Y")
    return ((old + "\n") if old else "") + f"{stamp} · {line}"


async def apply(db: AsyncSession, site_id: str, specs: list[dict], now: Optional[dt.datetime] = None) -> dict:
    now = now or utcnow()
    existing = {f.fkey: f for f in (await db.execute(select(SeoFinding).where(SeoFinding.site_id == site_id))).scalars()}
    seen: set[str] = set()
    counts = {"new": 0, "updated": 0, "reopened": 0, "resolved": 0, "verified": 0}
    for spec in specs:
        key = spec["fkey"][:1100]
        if key in seen:
            continue
        seen.add(key)
        f = existing.get(key)
        if f is None:
            f = SeoFinding(site_id=site_id, fkey=key, state="recommended", detected_at=now, last_seen_at=now, **{k: spec[k] for k in UPDATABLE})
            db.add(f)
            counts["new"] += 1
            continue
        for k in UPDATABLE:
            setattr(f, k, spec[k])
        f.last_seen_at = now
        if f.state == "closed":
            if f.outcome == "dismissed" and f.closed_at and now - f.closed_at < dt.timedelta(days=DISMISS_DAYS):
                continue
            f.state, f.outcome, f.closed_at, f.detected_at = "recommended", None, None, now
            f.note = note_line(f.note, "Detected again", now)
            counts["reopened"] += 1
        elif f.state == "awaiting_verification":
            f.state = "in_progress"
            f.note = note_line(f.note, "Re-check: still detected — back in progress", now)
            counts["reopened"] += 1
        else:
            counts["updated"] += 1
    for key, f in existing.items():
        if key in seen or f.state == "closed":
            continue
        if f.state in ("detected", "recommended"):
            f.state, f.outcome, f.closed_at = "closed", "resolved", now
            f.note = note_line(f.note, "No longer detected — closed automatically", now)
            counts["resolved"] += 1
        elif f.state in ("task_created", "in_progress"):
            f.state = "awaiting_verification"
            f.note = note_line(f.note, "No longer detected — verify and close", now)
        elif f.state == "awaiting_verification":
            f.state, f.outcome, f.closed_at = "closed", "fixed", now
            f.note = note_line(f.note, "Re-check passed — verified fixed", now)
            counts["verified"] += 1
    await db.flush()
    return counts


def sla_due(f: SeoFinding) -> dt.datetime:
    return f.detected_at + dt.timedelta(hours=SLA_HOURS.get(f.severity, 168))


def overdue(f: SeoFinding, now: dt.datetime) -> bool:
    """Not yet picked up (no task) past its response SLA."""
    return f.state in ("detected", "recommended") and now > sla_due(f)


def is_open(state: str) -> bool:
    return state in OPEN_STATES
