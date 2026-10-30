"""
Website <-> Merchant link.

A website may exist on its own ("unassigned") or belong to one merchant. Once
linked, the merchant's Customer Profiling record is the source of truth for
the business fields the public page shows (PRD §5.2: Profiling is the source
of truth; Website references Profile values by reference):

    Profile field                      -> website `values` key
    merchant.restaurant_name           -> business.name
    primary contact phone              -> business.phone
    primary contact email              -> business.email
    primary location address           -> business.address
    primary location city (+state/zip) -> business.city
    primary location hours             -> business.hours

Three operations live here:

* `conflicts()`   — before linking, list every field where the Profile and the
                    site disagree so staff can pick which value wins (one-time
                    prompt; nothing is overwritten silently).
* `link()`        — apply those choices, set `merchant_id`, and set the
                    merchant's `website_url` when the site is live.
* `overlay()`     — for the public read: fill the site's business fields from
                    the Profile so a Profile edit shows on the next render
                    without re-entering it on the site.

The website never writes to the Profile. On a linked site those fields are
read-only in the website form; the /admin visual editor may change them for
the website only (`record_site_edits()` -> `website.profile_overrides`). Such
a change shows on the site until that Profile field is next edited, then the
Profile's value wins again (`active_overrides()`).

Plus `suggest()` (match unassigned sites to merchants by name / phone / city)
and `merchant_from_website()` (create a merchant + primary location + owner
contact from a site's answers — the ".docx import → new merchant" path).
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import func, inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.enums import ContactRole
from app.models.profiling import Contact, Location, Merchant
from app.models.website import Website, utcnow
from app.modules.websites.service import get_at, summarise

# Site keys governed by the Profile once linked, with the label shown in the
# "which value wins" prompt.
PROFILE_FIELDS: dict[str, str] = {
    "business.name": "Business name",
    "business.phone": "Phone",
    "business.email": "Email",
    "business.address": "Address",
    "business.city": "City",
    "business.hours": "Business hours",
}


def _clean(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


def _set_at(values: dict[str, Any], path: str, value: str) -> None:
    node = values
    parts = path.split(".")
    for key in parts[:-1]:
        nxt = node.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            node[key] = nxt
        node = nxt
    node[parts[-1]] = value


# ---------------------------------------------------------------- profile ----

def _loaded(merchant: Merchant, rel: str) -> list:
    """A relationship's rows, or [] when it hasn't been loaded — never a lazy
    load, which an AsyncSession refuses (MissingGreenlet). Callers that need
    the rows load the merchant with `load_merchant()`."""
    try:
        if rel in inspect(merchant).unloaded:
            return []
    except Exception:  # noqa: BLE001 — not an ORM instance (tests)
        pass
    return list(getattr(merchant, rel, None) or [])


def primary_location(merchant: Merchant) -> Optional[Location]:
    locs = _loaded(merchant, "locations")
    if not locs:
        return None
    return next((l for l in locs if l.is_primary), None) or sorted(locs, key=lambda l: l.created_at or utcnow())[0]


def primary_contact(merchant: Merchant) -> Optional[Contact]:
    contacts = _loaded(merchant, "contacts")
    if not contacts:
        return None
    return next((c for c in contacts if c.role == ContactRole.OWNER), None) or contacts[0]


def _city_line(loc: Optional[Location]) -> str:
    if not loc:
        return ""
    parts = [p for p in [_clean(loc.city), " ".join(x for x in [_clean(loc.state), _clean(loc.zip)] if x)] if p]
    return ", ".join(parts)


def profile_values(merchant: Merchant) -> dict[str, str]:
    """The Profile's values for every governed key — empty string where the
    Profile has nothing (those keys stay editable on the site)."""
    loc = primary_location(merchant)
    contact = primary_contact(merchant)
    return {
        "business.name": _clean(merchant.restaurant_name),
        "business.phone": _clean(contact.phone) if contact else "",
        "business.email": _clean(contact.email) if contact else "",
        "business.address": _clean(loc.address) if loc else "",
        "business.city": _city_line(loc),
        "business.hours": _clean(loc.hours) if loc else "",
    }


def governed_fields(merchant: Merchant) -> list[str]:
    """Keys the Profile actually supplies (non-empty) — the UI locks these."""
    return [k for k, v in profile_values(merchant).items() if v]


def overlay(values: dict[str, Any], merchant: Merchant, overrides: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Website answers with the Profile's (non-empty) values written over the
    governed keys — or, where the website changed a field in the visual editor
    and the Profile hasn't changed since (`overrides`, see active_overrides),
    that website-only value. Used for the public read and for pre-filling."""
    out = copy.deepcopy(values or {})
    overrides = overrides or {}
    for key, value in profile_values(merchant).items():
        if not value:
            continue
        _set_at(out, key, overrides.get(key) or value)
    return out


def active_overrides(website: Website, merchant: Merchant) -> dict[str, str]:
    """Website-only values still in force: the Profile field still holds the
    value it had when the website changed it. Once the Profile is edited, the
    Profile wins and the entry is ignored (and dropped on the next save)."""
    prof = profile_values(merchant)
    out: dict[str, str] = {}
    for key, entry in (website.profile_overrides or {}).items():
        if key not in PROFILE_FIELDS or not isinstance(entry, dict):
            continue
        value, base, p = _clean(entry.get("value")), _clean(entry.get("base")), prof.get(key, "")
        if value and p and _clean(base) == p:
            out[key] = value
    return out


def effective_values(website: Website, merchant: Optional[Merchant]) -> dict[str, Any]:
    """What a linked site shows: its answers + Profile + website-only edits."""
    if merchant is None:
        return copy.deepcopy(website.values or {})
    return overlay(website.values or {}, merchant, active_overrides(website, merchant))


def record_site_edits(website: Website, merchant: Merchant, edits: dict[str, str]) -> list[str]:
    """Visual-editor changes to Profile-governed fields, kept on the website
    only — the Profile is never written. A value equal to the Profile's clears
    the entry. Keys the Profile has no value for aren't governed: the caller
    saves those in the website's own answers. Returns the keys that changed."""
    prof = profile_values(merchant)
    current = active_overrides(website, merchant)
    kept = {k: {"value": v, "base": prof[k]} for k, v in current.items()}
    changed: list[str] = []
    for key, value in edits.items():
        value, p = _clean(value), prof.get(key, "")
        if key not in PROFILE_FIELDS or not p or not value:
            continue
        if same_value(key, value, current.get(key) or p):
            continue  # unchanged
        if same_value(key, value, p):
            kept.pop(key, None)  # changed back to the Profile's value
        else:
            kept[key] = {"value": value, "base": p}
        changed.append(key)
    if kept != (website.profile_overrides or {}):
        website.profile_overrides = kept  # new dict: JSON change is detected
    return changed


# -------------------------------------------------------------- conflicts ----

@dataclass
class Conflict:
    field: str
    label: str
    profileValue: str
    websiteValue: str


def conflicts(website: Website, merchant: Merchant) -> list[Conflict]:
    """Fields where both sides have a value and they differ."""
    out: list[Conflict] = []
    prof = profile_values(merchant)
    for key, label in PROFILE_FIELDS.items():
        p = prof.get(key, "")
        w = _clean(get_at(website.values or {}, key))
        if not p or not w:
            continue
        if not same_value(key, p, w):
            out.append(Conflict(field=key, label=label, profileValue=p, websiteValue=w))
    return out


# ------------------------------------------------------------------- link ----

async def load_merchant(db: AsyncSession, merchant_id: str) -> Optional[Merchant]:
    stmt = (
        select(Merchant)
        .where(Merchant.id == merchant_id)
        .options(selectinload(Merchant.locations), selectinload(Merchant.contacts))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


def site_public_url(website: Website) -> str:
    return f"{get_settings().SITE_TEMPLATE_URL.rstrip('/')}/{website.slug}"


def _apply_website_value_to_profile(merchant: Merchant, key: str, value: str) -> None:
    """"Website wins" for one field: write the site's value into the Profile."""
    if key == "business.name":
        merchant.restaurant_name = value
        return
    if key in ("business.phone", "business.email"):
        contact = primary_contact(merchant)
        if contact is None:
            contact = Contact(merchant_id=merchant.id, role=ContactRole.OWNER)
            merchant.contacts.append(contact)
        if key == "business.phone":
            contact.phone = value
        else:
            contact.email = value
        return
    loc = primary_location(merchant)
    if loc is None:
        loc = Location(merchant_id=merchant.id, is_primary=True)
        merchant.locations.append(loc)
    if key == "business.address":
        loc.address = value
    elif key == "business.city":
        m = re.match(r"^(.*?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$", value)
        if m:
            loc.city, loc.state = m.group(1).strip(), m.group(2).upper()
            if m.group(3):
                loc.zip = m.group(3)
        else:
            loc.city = value
    elif key == "business.hours":
        loc.hours = value


def same_value(key: str, a: str, b: str) -> bool:
    if key == "business.phone":
        return _digits(a) == _digits(b)
    return _clean(a).casefold() == _clean(b).casefold()


def write_to_profile(merchant: Merchant, edits: dict[str, str]) -> list[str]:
    """Write values into the Profile. NOT used by the website form, the visual
    editor or linking (the website never changes the Profile); kept for
    callers that create or fill a merchant on purpose. Returns changed keys."""
    current = profile_values(merchant)
    changed = []
    for key, value in edits.items():
        value = _clean(value)
        if key not in PROFILE_FIELDS or not value or same_value(key, value, current.get(key, "")):
            continue
        _apply_website_value_to_profile(merchant, key, value)
        changed.append(key)
    return changed


def sync_merchant_url(website: Website, merchant: Merchant) -> None:
    """A linked site is the merchant's website: the Profile's website URL
    points at it whatever its status (draft pages are reachable too), so the
    merchant table and Profile never show "—" for a merchant that has a site."""
    merchant.website_url = site_public_url(website)
    merchant.website_platform = "Innowi"


async def link(
    db: AsyncSession,
    website: Website,
    merchant: Merchant,
    resolutions: dict[str, str] | None = None,
) -> Website:
    """Attach `website` to `merchant`, applying the caller's per-field choices.

    `resolutions` maps a governed key to "profile" (Profile value shown on the
    site) or "website" (the site keeps its own value, Profile unchanged).
    Conflicts not mentioned default to "profile". A field only the site has
    stays on the site; the Profile is never written.
    """
    resolutions = resolutions or {}
    values = copy.deepcopy(website.values or {})
    prof = profile_values(merchant)
    overrides: dict[str, dict[str, str]] = {}

    # The Profile is never changed by linking. "website" keeps the site's
    # value on the site only (until that Profile field is next edited).
    for key in PROFILE_FIELDS:
        p = prof.get(key, "")
        w = _clean(get_at(values, key))
        if p and w and not same_value(key, p, w) and resolutions.get(key) == "website":
            overrides[key] = {"value": w, "base": p}
        elif p:
            _set_at(values, key, p)
        # w only: the Profile has nothing — the site keeps its own value.

    website.profile_overrides = overrides

    website.values = values
    for column, value in summarise(values).items():
        setattr(website, column, value)
    website.merchant_id = merchant.id
    website.updated_at = utcnow()
    sync_merchant_url(website, merchant)

    await db.commit()
    await db.refresh(website)
    return website


async def unlink(db: AsyncSession, website: Website) -> Website:
    merchant = website.merchant
    if merchant is not None:
        # Keep showing exactly what it showed while linked.
        website.values = effective_values(website, merchant)
        for column, value in summarise(website.values).items():
            setattr(website, column, value)
        if merchant.website_url == site_public_url(website):
            merchant.website_url = None
    website.profile_overrides = {}
    website.merchant_id = None
    website.updated_at = utcnow()
    await db.commit()
    await db.refresh(website)
    return website


# ---------------------------------------------------------------- suggest ----

@dataclass
class Suggestion:
    merchantId: str
    restaurantName: str
    city: str
    websiteUrl: Optional[str]
    score: int
    reasons: list[str] = field(default_factory=list)


async def suggest(db: AsyncSession, website: Website, limit: int = 5) -> list[Suggestion]:
    """Merchants that look like this site: same name, phone or city."""
    values = website.values or {}
    name = _clean(get_at(values, "business.name"))
    phone = _digits(_clean(get_at(values, "business.phone")))
    city = _clean(get_at(values, "business.city")).split(",")[0].strip()

    filters = []
    if name:
        filters.append(func.lower(Merchant.restaurant_name).like(f"%{name.lower()}%"))
        first = name.split()[0].lower()
        if len(first) >= 4:
            filters.append(func.lower(Merchant.restaurant_name).like(f"%{first}%"))
    if not filters and not phone and not city:
        return []

    stmt = select(Merchant).options(selectinload(Merchant.locations), selectinload(Merchant.contacts))
    if filters:
        stmt = stmt.where(or_(*filters))
    stmt = stmt.limit(50)
    candidates = list((await db.execute(stmt)).scalars().all())

    # Phone / city matches can't be expressed as a cheap SQL filter on the
    # contact/location tables without a join per field; score in Python.
    if phone or city:
        extra = select(Merchant).options(selectinload(Merchant.locations), selectinload(Merchant.contacts))
        if city:
            extra = extra.join(Merchant.locations).where(func.lower(Location.city) == city.lower())
        seen = {m.id for m in candidates}
        for m in (await db.execute(extra.limit(50))).scalars().unique().all():
            if m.id not in seen:
                candidates.append(m)

    out: list[Suggestion] = []
    for m in candidates:
        score, reasons = 0, []
        mname = _clean(m.restaurant_name).lower()
        if name and mname == name.lower():
            score, reasons = score + 60, reasons + ["Same business name"]
        elif name and (name.lower() in mname or mname in name.lower()):
            score, reasons = score + 35, reasons + ["Similar business name"]
        if phone:
            for c in m.contacts or []:
                if _digits(c.phone or "") and _digits(c.phone or "") == phone:
                    score, reasons = score + 40, reasons + ["Same phone"]
                    break
        if city:
            for l in m.locations or []:
                if _clean(l.city).lower() == city.lower():
                    score, reasons = score + 15, reasons + ["Same city"]
                    break
        if score:
            out.append(
                Suggestion(
                    merchantId=m.id,
                    restaurantName=m.restaurant_name,
                    city=_city_line(primary_location(m)),
                    websiteUrl=m.website_url,
                    score=score,
                    reasons=reasons,
                )
            )
    out.sort(key=lambda s: -s.score)
    return out[:limit]


# ------------------------------------------------- merchant from website ----

async def merchant_from_website(
    db: AsyncSession,
    website: Website,
    *,
    account_manager_id: Optional[str] = None,
    merchant_code: Optional[str] = None,
    cuisine_category: Optional[str] = None,
) -> Merchant:
    """Create a Merchant (+ primary Location, + Owner Contact) from a site's
    answers, then link the site to it. Only fields the site knows are filled;
    everything else stays empty and shows up in Profile completeness."""
    values = website.values or {}
    name = _clean(get_at(values, "business.name")) or website.name or "Untitled merchant"
    order_url = _clean(get_at(values, "orderUrl")) or _clean(get_at(values, "hero.ctaLink"))

    merchant = Merchant(
        restaurant_name=name,
        merchant_code=merchant_code or None,
        cuisine_category=cuisine_category or None,
        account_manager_id=account_manager_id or None,
        online_ordering=order_url or None,
        notes=f"Created from website /{website.slug}",
        source="WEBSITE",
        source_detail=f"/{website.slug}",
        website_url=site_public_url(website),
        website_platform="Innowi",
    )
    db.add(merchant)
    await db.flush()

    address = _clean(get_at(values, "business.address"))
    city_raw = _clean(get_at(values, "business.city"))
    hours = _clean(get_at(values, "business.hours"))
    if address or city_raw or hours:
        city, state, zip_ = city_raw, None, None
        m = re.match(r"^(.*?),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$", city_raw)
        if m:
            city, state, zip_ = m.group(1).strip(), m.group(2).upper(), m.group(3)
        db.add(
            Location(
                merchant_id=merchant.id,
                address=address or None,
                city=city or None,
                state=state,
                zip=zip_,
                hours=hours or None,
                is_primary=True,
            )
        )

    phone = _clean(get_at(values, "business.phone"))
    email = _clean(get_at(values, "business.email"))
    if phone or email:
        db.add(Contact(merchant_id=merchant.id, role=ContactRole.OWNER, phone=phone or None, email=email or None))

    website.merchant_id = merchant.id
    website.updated_at = utcnow()
    await db.commit()
    await db.refresh(website)
    return merchant
