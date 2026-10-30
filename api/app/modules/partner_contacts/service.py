"""SQL for the partner network (public.partner_contacts). Pure query-building
helpers are kept separate from the DB calls so they can be unit tested without
a database, same as partner_leads/service.py."""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

# Fully qualified on purpose: the partner portal's `public` schema, not a Super App schema.
CONTACTS = "public.partner_contacts"

CONTACT_COLUMNS = (
    "id, created_at, updated_at, status, full_name, title, company, email, phone, website, address, partner_type, "
    "notes, tags, met_at, met_on, source, scanned_by, card_id, other_text, photo_url, batch_id, promoted_lead_id, "
    "promoted_at, promoted_by"
)

# Columns the Super App may change on a contact (DTO camelCase -> column).
EDITABLE = {
    "status": "status", "fullName": "full_name", "title": "title", "company": "company", "email": "email",
    "phone": "phone", "website": "website", "address": "address", "partnerType": "partner_type", "notes": "notes",
    "tags": "tags", "metAt": "met_at", "metOn": "met_on",
}


class ContactError(Exception):
    """A business rule the database enforced (no e-mail to promote, duplicate e-mail…)."""


@dataclass
class ContactFilters:
    q: Optional[str] = None
    status: Optional[str] = None
    event: Optional[str] = None       # met_at
    source: Optional[str] = None
    promoted: Optional[bool] = None   # True = only promoted, False = only not yet
    from_: Optional[dt.datetime] = None
    to: Optional[dt.datetime] = None


@dataclass
class Where:
    sql: str
    params: dict[str, Any] = field(default_factory=dict)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_where(f: ContactFilters) -> Where:
    """WHERE clause + bind params for the contact list. Values are always bound, never interpolated."""
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if f.q and f.q.strip():
        params["q"] = f"%{_escape_like(f.q.strip())}%"
        clauses.append("(full_name ilike :q or company ilike :q or email ilike :q or title ilike :q)")
    if f.status:
        params["status"] = f.status
        clauses.append("status = :status")
    if f.event:
        params["event"] = f.event
        clauses.append("met_at = :event")
    if f.source:
        params["source"] = f.source
        clauses.append("source = :source")
    if f.promoted is True:
        clauses.append("promoted_lead_id is not null")
    elif f.promoted is False:
        clauses.append("promoted_lead_id is null")
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


CONTACT_SORTS = {"createdAt": "created_at", "name": "lower(full_name)", "company": "lower(company)",
                 "metOn": "met_on", "status": "status"}


async def list_contacts(
    db: AsyncSession, f: ContactFilters, *, offset: int, limit: int, order: str, sort: str = "createdAt"
) -> tuple[list[dict], int]:
    w = build_where(f)
    direction = "asc" if order == "asc" else "desc"
    column = CONTACT_SORTS.get(sort, "created_at")
    total = (await db.execute(text(f"select count(*) from {CONTACTS} where {w.sql}"), w.params)).scalar_one()
    rows = (
        await db.execute(
            text(
                f"select {CONTACT_COLUMNS} from {CONTACTS} where {w.sql} "
                f"order by {column} {direction} nulls last, created_at desc offset :offset limit :limit"
            ),
            {**w.params, "offset": offset, "limit": limit},
        )
    ).mappings().all()
    return [dict(r) for r in rows], int(total)


async def get_contact(db: AsyncSession, contact_id: str) -> Optional[dict]:
    row = (
        await db.execute(text(f"select {CONTACT_COLUMNS} from {CONTACTS} where id = :id"), {"id": contact_id})
    ).mappings().first()
    return dict(row) if row else None


async def summary(db: AsyncSession) -> dict:
    row = (
        await db.execute(
            text(
                f"select count(*) as total, "
                f"count(*) filter (where status = 'new') as unreviewed, "
                f"count(*) filter (where promoted_lead_id is not null) as promoted, "
                f"count(*) filter (where created_at >= now() - interval '7 days') as last7 "
                f"from {CONTACTS}"
            )
        )
    ).mappings().one()
    by_status = (
        await db.execute(text(f"select status as key, count(*) as count from {CONTACTS} group by status order by count desc"))
    ).mappings().all()
    by_event = (
        await db.execute(
            text(
                f"select coalesce(nullif(met_at, ''), 'unknown') as key, count(*) as count from {CONTACTS} "
                f"group by 1 order by count desc limit 12"
            )
        )
    ).mappings().all()
    return {
        "total": int(row["total"]),
        "unreviewed": int(row["unreviewed"]),
        "promoted": int(row["promoted"]),
        "last7Days": int(row["last7"]),
        "byStatus": [{"key": r["key"], "count": int(r["count"])} for r in by_status],
        "byEvent": [{"key": r["key"], "count": int(r["count"])} for r in by_event],
    }


def _is_unique_violation(e: DBAPIError) -> bool:
    return "partner_contacts_email_key" in str(e.orig or e)


async def create_contact(db: AsyncSession, data: dict[str, Any], actor_email: str) -> dict:
    """Manual add from the Super App. The merge trigger folds a duplicate e-mail into the
    existing contact, in which case the insert returns no row and we look it up by e-mail."""
    cols = {EDITABLE[k]: v for k, v in data.items() if k in EDITABLE and k != "status"}
    cols["source"] = "manual"
    cols["scanned_by"] = actor_email.lower()
    names = ", ".join(cols)
    binds = ", ".join(f":{c}" for c in cols)
    try:
        row = (
            await db.execute(text(f"insert into {CONTACTS} ({names}) values ({binds}) returning {CONTACT_COLUMNS}"), cols)
        ).mappings().first()
    except DBAPIError as e:
        await db.rollback()
        if _is_unique_violation(e):
            raise ContactError("A contact with that e-mail already exists") from e
        raise
    if row is None and cols.get("email"):
        row = (
            await db.execute(text(f"select {CONTACT_COLUMNS} from {CONTACTS} where lower(email) = :email"), {"email": cols["email"].lower()})
        ).mappings().first()
    await db.commit()
    return dict(row) if row else {}


async def update_contact(db: AsyncSession, contact_id: str, changes: dict[str, Any]) -> None:
    cols = {EDITABLE[k]: v for k, v in changes.items() if k in EDITABLE}
    if not cols:
        return
    sets = ", ".join(f"{c} = :{c}" for c in cols)
    try:
        await db.execute(text(f"update {CONTACTS} set {sets} where id = :id"), {**cols, "id": contact_id})
    except DBAPIError as e:
        await db.rollback()
        if _is_unique_violation(e):
            raise ContactError("Another contact already has that e-mail") from e
        raise
    await db.commit()


async def promote(db: AsyncSession, contact_id: str, partner_type: Optional[str], actor_email: str) -> str:
    """Create the partner lead (DB function) and link it. Returns the lead id; raises
    ContactError when the contact has no e-mail."""
    try:
        lead_id = (
            await db.execute(
                text("select public.promote_contact_to_lead(:id, :ptype, :actor)"),
                {"id": contact_id, "ptype": partner_type, "actor": actor_email.lower()},
            )
        ).scalar_one()
    except DBAPIError as e:
        await db.rollback()
        msg = str(e.orig or e)
        if "no e-mail" in msg:
            raise ContactError("This contact has no e-mail address. Add one first — a partner lead needs it.") from e
        raise
    await db.commit()
    return str(lead_id)
