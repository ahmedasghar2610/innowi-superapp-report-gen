"""SQL for partner leads. Pure query-building helpers are kept separate from
the DB calls so they can be unit tested without a database."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.schemas import qualified

logger = logging.getLogger("PartnerLeads")

# Fully qualified on purpose: these are the partner portal's tables in the
# `public` schema, never one of the Super App's (prefixed) schemas.
LEADS = "public.partner_leads"
NOTES = "public.partner_lead_notes"
EVENTS = "public.partner_lead_events"

LEAD_COLUMNS = (
    "id, created_at, updated_at, status, full_name, title, company, email, phone, website, partner_type, region, "
    "portfolio_size, restaurant_share, processors, interests, timeline, heard_about, message, wants_call, source_cta, "
    "landing_url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, assigned_to, assigned_at, "
    "last_contacted_at, notified_at, teams_notified_at"
)

UNASSIGNED = "unassigned"


@dataclass
class LeadFilters:
    q: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    assigned_to: Optional[str] = None  # an email, or "unassigned"
    include_spam: bool = False
    from_: Optional[dt.datetime] = None
    to: Optional[dt.datetime] = None


@dataclass
class Where:
    sql: str
    params: dict[str, Any] = field(default_factory=dict)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_where(f: LeadFilters) -> Where:
    """WHERE clause + bind params for the lead list. Values are always bound, never interpolated."""
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if f.q and f.q.strip():
        params["q"] = f"%{_escape_like(f.q.strip())}%"
        clauses.append("(full_name ilike :q or company ilike :q or email ilike :q)")
    if f.status:
        params["status"] = f.status
        clauses.append("status = :status")
    elif not f.include_spam:
        clauses.append("status <> 'spam'")
    if f.source:
        params["source"] = f.source
        clauses.append("source_cta = :source")
    if f.assigned_to:
        if f.assigned_to == UNASSIGNED:
            clauses.append("assigned_to is null")
        else:
            params["assigned_to"] = f.assigned_to.lower()
            clauses.append("assigned_to = :assigned_to")
    if f.from_:
        params["from_"] = f.from_
        clauses.append("created_at >= :from_")
    if f.to:
        params["to"] = f.to
        clauses.append("created_at <= :to")
    return Where(" and ".join(clauses) if clauses else "true", params)


def parse_uuid(value: str) -> Optional[str]:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


# sortBy -> the column it orders by (a fixed list, so nothing from the request reaches the SQL).
LEAD_SORTS = {"createdAt": "created_at", "name": "lower(full_name)", "company": "lower(coalesce(nullif(company, ''), full_name))",
              "status": "status", "owner": "assigned_to"}


async def list_leads(db: AsyncSession, f: LeadFilters, *, offset: int, limit: int, order: str,
                     sort: str = "createdAt") -> tuple[list[dict], int]:
    w = build_where(f)
    direction = "asc" if order == "asc" else "desc"
    column = LEAD_SORTS.get(sort, "created_at")
    total = (await db.execute(text(f"select count(*) from {LEADS} where {w.sql}"), w.params)).scalar_one()
    rows = (
        await db.execute(
            text(f"select {LEAD_COLUMNS} from {LEADS} where {w.sql} order by {column} {direction} nulls last, created_at desc offset :offset limit :limit"),
            {**w.params, "offset": offset, "limit": limit},
        )
    ).mappings().all()
    return [dict(r) for r in rows], int(total)


async def get_lead(db: AsyncSession, lead_id: str) -> Optional[dict]:
    row = (await db.execute(text(f"select {LEAD_COLUMNS} from {LEADS} where id = :id"), {"id": lead_id})).mappings().first()
    return dict(row) if row else None


async def get_notes(db: AsyncSession, lead_id: str) -> list[dict]:
    rows = (
        await db.execute(
            text(f"select id, author_email, body, created_at from {NOTES} where lead_id = :id order by created_at desc"),
            {"id": lead_id},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def get_events(db: AsyncSession, lead_id: str) -> list[dict]:
    rows = (
        await db.execute(
            text(f"select id, actor_email, type, detail, created_at from {EVENTS} where lead_id = :id order by created_at desc"),
            {"id": lead_id},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


TEAM_STATUSES_ON_TEAM = ("active", "invited")


async def get_team(db: AsyncSession) -> list[dict]:
    """The partner team, from the Super App's people (auth.lead_team(), the same function
    the lead e-mails use). Everyone who can be given leads first, then known names who can't."""
    rows = (
        await db.execute(
            text(
                f"select email, name, superapp_role, role, assignable, receives_new_leads, status "
                f"from {qualified('auth')}.lead_team() "
                f"order by (status in ('active', 'invited')) desc, coalesce(name, email)"
            )
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def set_routing(
    db: AsyncSession, email: str, changes: dict[str, Any], *, actor_email: str, name: Optional[str] = None
) -> None:
    """Save one person's switches (upsert by e-mail). Only the keys in `changes` move."""
    cols = {k: v for k, v in changes.items() if k in ("assignable", "receives_new_leads")}
    if not cols:
        return
    t = f"{qualified('auth')}.lead_routing"
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols)
    await db.execute(
        text(
            f"insert into {t} (email, name, {', '.join(cols)}, updated_at, updated_by) "
            f"values (:email, :name, {', '.join(':' + c for c in cols)}, now(), :actor) "
            f"on conflict (email) do update set {updates}, updated_at = now(), updated_by = excluded.updated_by, "
            f"name = coalesce({t}.name, excluded.name)"
        ),
        {
            "email": email.lower(),
            "name": name,
            "actor": actor_email.lower(),
            "assignable": cols.get("assignable"),
            "receives_new_leads": bool(cols.get("receives_new_leads")) if "receives_new_leads" in cols else None,
        },
    )
    await db.commit()


async def summary(db: AsyncSession) -> dict:
    row = (
        await db.execute(
            text(
                f"select count(*) filter (where status <> 'spam') as total, "
                f"count(*) filter (where status = 'new' and assigned_to is null) as unassigned, "
                f"count(*) filter (where status <> 'spam' and created_at >= now() - interval '7 days') as last7 "
                f"from {LEADS}"
            )
        )
    ).mappings().one()
    by_status = (
        await db.execute(text(f"select status as key, count(*) as count from {LEADS} group by status order by count desc"))
    ).mappings().all()
    by_source = (
        await db.execute(
            text(
                f"select coalesce(source_cta, 'unknown') as key, count(*) as count from {LEADS} "
                f"where status <> 'spam' group by 1 order by count desc limit 12"
            )
        )
    ).mappings().all()
    return {
        "total": int(row["total"]),
        "unassigned": int(row["unassigned"]),
        "last7Days": int(row["last7"]),
        "byStatus": [{"key": r["key"], "count": int(r["count"])} for r in by_status],
        "bySource": [{"key": r["key"], "count": int(r["count"])} for r in by_source],
    }


async def delete_lead(db: AsyncSession, lead_id: str) -> bool:
    """Delete a lead for good. Its notes, history and tokens go with it (ON DELETE CASCADE);
    a Partner Network contact promoted to it keeps existing, unlinked (ON DELETE SET NULL).
    On the shared database the `superapp` role needs DELETE on the table plus an RLS policy:
    see api/sql/partner_leads_delete.sql."""
    result = await db.execute(text(f"delete from {LEADS} where id = :id"), {"id": lead_id})
    await db.commit()
    return (result.rowcount or 0) > 0


async def update_lead(db: AsyncSession, lead_id: str, changes: dict[str, Any], actor_email: str) -> None:
    """Apply status / owner changes. The partner portal's trigger (partner_leads_touch)
    writes the history rows and timestamps; `app.actor` tells it who made the change."""
    if not changes:
        return
    allowed = {"status", "assigned_to"}
    sets = ", ".join(f"{col} = :{col}" for col in changes if col in allowed)
    if not sets:
        return
    await db.execute(text("select set_config('app.actor', :actor, true)"), {"actor": actor_email.lower()})
    await db.execute(text(f"update {LEADS} set {sets} where id = :id"), {**changes, "id": lead_id})
    await db.commit()


def _post_json(url: str, apikey: str, payload: dict, timeout: float) -> int:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "apikey": apikey},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 — fixed https URL from settings
        return res.status


async def notify_assigned(lead_id: str) -> bool:
    """Ask the partner portal to e-mail the new owner + post to Teams. Never raises:
    the assignment is already saved, a failed notification must not undo or block it."""
    settings = get_settings()
    url = settings.PARTNER_LEADS_NOTIFY_URL
    if not url:
        return False
    try:
        status = await asyncio.to_thread(_post_json, url, settings.PARTNER_LEADS_NOTIFY_APIKEY, {"lead_id": lead_id}, 10.0)
        return 200 <= status < 300
    except Exception as e:  # network, timeout, HTTP error
        logger.warning("Partner lead %s: assignee notification failed: %s", lead_id, e)
        return False


async def add_note(db: AsyncSession, lead_id: str, author_email: str, body: str) -> dict:
    row = (
        await db.execute(
            text(
                f"insert into {NOTES} (lead_id, author_email, body) values (:lead_id, :author, :body) "
                f"returning id, author_email, body, created_at"
            ),
            {"lead_id": lead_id, "author": author_email.lower(), "body": body},
        )
    ).mappings().one()
    await db.commit()
    return dict(row)
