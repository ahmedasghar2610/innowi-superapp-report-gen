"""Who receives a site's client report.

Two sources, merged and de-duplicated (case-insensitive):
  1. Merchant contacts — every contact of the site's linked merchant
     (Merchant Profiling) with an email and the role OWNER or MARKETING.
     Picked up automatically, so a new or changed contact needs no SEO edit.
  2. Hand-written — `SeoSite.report_recipients`, typed in SEO → Site settings
     (agency people, a second inbox, sites with no merchant linked yet).
"""

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import ContactRole
from app.models.profiling import Contact

REPORT_ROLES = (ContactRole.OWNER, ContactRole.MARKETING)
ROLE_LABEL = {ContactRole.OWNER: "Owner", ContactRole.MARKETING: "Marketing"}


async def merchant_contacts(db: AsyncSession, merchant_ids: Iterable[Optional[str]]) -> dict[str, list[dict]]:
    """merchant id → [{email, name, role}] for report-receiving contacts."""
    ids = sorted({m for m in merchant_ids if m})
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(Contact)
            .where(Contact.merchant_id.in_(ids), Contact.role.in_(REPORT_ROLES), Contact.email.is_not(None))
            .order_by(Contact.role, Contact.name)
        )
    ).scalars()
    out: dict[str, list[dict]] = {}
    for c in rows:
        email = (c.email or "").strip().lower()
        if "@" not in email:
            continue
        lst = out.setdefault(c.merchant_id, [])
        if all(x["email"] != email for x in lst):
            lst.append({"email": email, "name": c.name, "role": ROLE_LABEL.get(c.role, c.role.value.title())})
    return out


def merged(from_merchant: list[dict], manual: Optional[list[str]]) -> list[str]:
    """Merchant contacts first, then hand-written ones; no duplicates."""
    seen: list[str] = []
    for e in [c["email"] for c in from_merchant] + [str(x).strip().lower() for x in (manual or [])]:
        if e and e not in seen:
            seen.append(e)
    return seen


async def for_site(db: AsyncSession, site) -> dict:
    """{fromMerchant: [...], manual: [...], all: [...]} for one site."""
    contacts = (await merchant_contacts(db, [site.merchant_id])).get(site.merchant_id, []) if site.merchant_id else []
    manual = [str(x).lower() for x in (site.report_recipients or [])]
    return {"fromMerchant": contacts, "manual": manual, "all": merged(contacts, manual)}
