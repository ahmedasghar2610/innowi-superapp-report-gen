"""Profile completion for a Business Profile listing.

A plain count of the 14 fields the GBP prototype tracks — present or missing,
each worth the same. No weighting or invented score: the percentage is
done / tracked, and the UI shows the two lists. Fields Google didn't report
(photos when the media call failed) count as missing.
"""
from __future__ import annotations

from typing import Any

FIELDS: list[tuple[str, str]] = [
    ("name", "Business name"),
    ("address", "Address"),
    ("phone", "Phone"),
    ("website", "Website"),
    ("primaryCategory", "Primary category"),
    ("secondaryCategories", "Secondary categories"),
    ("hours", "Business hours"),
    ("attributes", "Attributes"),
    ("description", "Business description"),
    ("menuLink", "Menu link"),
    ("orderingLink", "Online ordering link"),
    ("socialLinks", "Social links"),
    ("photos", "Photos"),
    ("logoCover", "Logo & cover photo"),
]


def compute(loc: Any) -> list[dict]:
    """`loc` is a GbpLocation (or anything with the same attributes)."""
    done = {
        "name": bool(loc.title),
        "address": bool(loc.address_line or loc.city),
        "phone": bool(loc.phone),
        "website": bool(loc.website_url),
        "primaryCategory": bool(loc.primary_category),
        "secondaryCategories": bool(loc.additional_categories),
        "hours": bool(loc.regular_hours),
        "attributes": (loc.attribute_count or 0) > 0,
        "description": bool((loc.description or "").strip()),
        "menuLink": bool(loc.menu_url),
        "orderingLink": bool(loc.ordering_url),
        "socialLinks": bool(loc.social_links),
        "photos": (loc.photo_count or 0) > 0,
        "logoCover": bool(loc.has_logo) and bool(loc.has_cover),
    }
    return [{"key": k, "label": label, "done": done[k]} for k, label in FIELDS]


def pct(fields: list[dict]) -> int:
    if not fields:
        return 0
    return round(100 * sum(1 for f in fields if f.get("done")) / len(fields))
