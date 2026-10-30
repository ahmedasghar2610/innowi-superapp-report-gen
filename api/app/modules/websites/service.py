"""
Database operations for websites — port of the standalone service's
app/crud.py, converted from a synchronous Session to SQLAlchemy 2.0's
AsyncSession.

Kept separate from the router so the HTTP layer stays thin and the slug /
summary logic stays testable without a client or a database.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.security.password import hash_password
from app.models.profiling import Merchant
from app.models.website import Website, utcnow
from app.schemas.website import CreateWebsiteDto, UpdateWebsiteDto, WebsiteStatus

# ------------------------------------------------------------------- slugs

#: Paths the site template serves itself. A website slug must never shadow one,
#: or the record becomes unreachable at its own URL.
RESERVED_SLUGS = {"api", "_next", "static", "images", "favicon.ico", "robots.txt", "sitemap.xml"}


def slugify(text: str) -> str:
    """`"Primo Cafe & Bakery"` -> `"primo-cafe-bakery"`."""
    normalised = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^a-z0-9]+", "-", normalised.lower()).strip("-")
    return cleaned[:60] or "site"


async def unique_slug(db: AsyncSession, desired: str) -> str:
    """`desired`, or `desired-2`, `desired-3`… until it is free.

    The slug is the site template's public URL (`/<slug>`), so it has to be
    unique and must not collide with the template's own paths.
    """
    base = slugify(desired)
    if base in RESERVED_SLUGS:
        base = f"{base}-site"

    candidate = base
    n = 1
    while await db.scalar(select(func.count()).select_from(Website).where(Website.slug == candidate)):
        n += 1
        candidate = f"{base}-{n}"
    return candidate


# ---------------------------------------------------------------- summaries

def get_at(values: dict[str, Any], path: str) -> Any:
    """Read a dotted path out of the answer tree."""
    node: Any = values
    for key in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def summarise(values: dict[str, Any]) -> dict[str, str]:
    """Derive the denormalised list columns from the answers.

    The server owns these so they can never drift from `values` — a client that
    sends its own `name` is ignored.
    """

    def text(path: str) -> str:
        raw = get_at(values, path)
        return str(raw).strip() if raw is not None else ""

    return {
        "name": text("business.name") or "Untitled website",
        "tagline": text("business.tagline"),
        "contact_email": text("business.email"),
    }


# ---------------------------------------------------------------- queries

#: The linked merchant with what the mapper needs (primary location, owner
#: contact) — loaded up front so no read ever lazy-loads inside the async session.
MERCHANT_OPTS = (
    selectinload(Website.merchant).selectinload(Merchant.locations),
    selectinload(Website.merchant).selectinload(Merchant.contacts),
)

async def list_websites(
    db: AsyncSession,
    *,
    q: Optional[str] = None,
    status: Optional[WebsiteStatus] = None,
    merchant_id: Optional[str] = None,
    unassigned: Optional[bool] = None,
    limit: int = 25,
    offset: int = 0,
    order: str = "desc",
) -> tuple[list[Website], int]:
    """Newest activity first by default, optionally filtered. Returns (rows, total)."""
    filters = []

    if status is not None:
        filters.append(Website.status == status.value)

    if merchant_id:
        filters.append(Website.merchant_id == merchant_id)
    elif unassigned:
        filters.append(Website.merchant_id.is_(None))

    if q:
        needle = f"%{q.strip().lower()}%"
        filters.append(
            or_(
                func.lower(Website.name).like(needle),
                func.lower(Website.tagline).like(needle),
                func.lower(Website.slug).like(needle),
                func.lower(Website.contact_email).like(needle),
            )
        )

    total = await db.scalar(select(func.count()).select_from(Website).where(*filters)) or 0

    ordering = Website.updated_at.asc() if order == "asc" else Website.updated_at.desc()
    rows = (
        await db.execute(
            select(Website).options(*MERCHANT_OPTS).where(*filters).order_by(ordering).limit(limit).offset(offset)
        )
    ).scalars().all()

    return list(rows), int(total)


async def get_website(db: AsyncSession, website_id: str) -> Optional[Website]:
    return await db.scalar(select(Website).options(*MERCHANT_OPTS).where(Website.id == website_id))


async def get_by_slug(db: AsyncSession, slug: str) -> Optional[Website]:
    return await db.scalar(select(Website).options(*MERCHANT_OPTS).where(Website.slug == slug))


async def resolve(db: AsyncSession, key: str) -> Optional[Website]:
    """Look a website up by id or by slug — whichever the caller has.

    The Super App holds ids; the public site template only knows slugs.
    """
    return await get_website(db, key) or await get_by_slug(db, key)


# ---------------------------------------------------------------- mutations

async def create_website(db: AsyncSession, payload: CreateWebsiteDto, merchant=None) -> Website:
    """`merchant` (a loaded Merchant) links the new site and writes the
    Profile's business fields over the answers before saving."""
    values = payload.values
    if merchant is not None:
        from app.modules.websites.merchant_link import overlay

        values = overlay(values, merchant)
    summary = summarise(values)
    website = Website(
        slug=await unique_slug(db, payload.slug or summary["name"]),
        status=payload.status.value,
        values=values,
        notes=payload.notes,
        merchant_id=merchant.id if merchant is not None else None,
        **summary,
    )
    db.add(website)
    if merchant is not None:
        from app.modules.websites.merchant_link import sync_merchant_url

        sync_merchant_url(website, merchant)
    await db.commit()
    await db.refresh(website)
    return website


async def update_website(db: AsyncSession, website: Website, payload: UpdateWebsiteDto) -> Website:
    # The slug is the site's public URL, so renaming the business deliberately
    # does NOT move it. Only an explicit `slug` in the payload changes it.
    if payload.slug is not None and slugify(payload.slug) != website.slug:
        website.slug = await unique_slug(db, payload.slug)

    if payload.values is not None:
        values = payload.values
        # Linked site: business name / phone / email / address / hours are
        # read-only in the form — whatever the form sends for them is replaced
        # by what the site shows (Profile, or a visual-editor change). The
        # Profile itself is never written from the website.
        if website.merchant is not None:
            from app.modules.websites.merchant_link import active_overrides, overlay

            values = overlay(values, website.merchant, active_overrides(website, website.merchant))
        website.values = values
        for column, value in summarise(values).items():
            setattr(website, column, value)

    if payload.status is not None:
        website.status = payload.status.value

    if website.merchant is not None:
        from app.modules.websites.merchant_link import sync_merchant_url

        sync_merchant_url(website, website.merchant)  # also follows a slug change

    if payload.notes is not None:
        website.notes = payload.notes

    if payload.adminPassword is not None:
        website.admin_password_hash = hash_password(payload.adminPassword) if payload.adminPassword else None

    # `onupdate` only fires when a mapped column actually changed; a status-only
    # PATCH that re-sends the same value would otherwise leave the timestamp
    # stale, and the list is ordered by it.
    website.updated_at = utcnow()

    await db.commit()
    await db.refresh(website)
    return website


async def delete_website(db: AsyncSession, website: Website) -> None:
    await db.delete(website)
    await db.commit()
