"""
Website ORM row -> response DTO.

The DTOs here are spelled camelCase (the wire format the Super App and the
public site template consume) while the columns are snake_case, so Pydantic's
`from_attributes` cannot bridge them on its own — `contactEmail` does not match
`contact_email`. Every other module in this codebase solves that with an
explicit mapper (see merchant_profiling/mappers.py); this is the same thing for
one model.
"""
from __future__ import annotations

from typing import Any, Optional

from app.models.website import Website
from app.modules.websites.binding import has_bindings
from app.schemas.website import WebsiteResponseDto, WebsiteStatus, is_public, normalise_status


def website_to_dto(w: Website, *, values: Optional[dict[str, Any]] = None, restricted: bool = False) -> WebsiteResponseDto:
    """`values` overrides the stored answers. `restricted` trims the record to
    what an anonymous visitor may know about a site that isn't public: its
    slug, name and status — no answers, notes or editor details."""
    if restricted:
        return WebsiteResponseDto(
            id=w.id, slug=w.slug, name=w.name, tagline="", contactEmail="",
            status=WebsiteStatus(normalise_status(w.status)), values={}, notes="",
            createdAt=w.created_at, updatedAt=w.updated_at, published=False, restricted=True,
        )
    merchant = getattr(w, "merchant", None)
    profile_fields: list[str] = []
    site_only: dict[str, str] = {}
    name, tagline, contact_email = w.name, w.tagline or "", w.contact_email or ""
    if merchant is not None:
        # Profile is the source of truth for the business fields: every read
        # (list, form, public page) shows the merchant's *current* name /
        # phone / address / hours, never the copy stored on the site.
        # A field changed on the website only (visual editor) shows that value
        # until the Profile field is next edited.
        from app.modules.websites.merchant_link import active_overrides, governed_fields, overlay, profile_values
        from app.modules.websites.service import summarise

        profile_fields = governed_fields(merchant)
        overrides = active_overrides(w, merchant)
        prof = profile_values(merchant)
        site_only = {k: prof[k] for k in overrides}
        values = overlay(values if values is not None else (w.values or {}), merchant, overrides)
        summary = summarise(values)
        name, tagline, contact_email = summary["name"], summary["tagline"], summary["contact_email"]
    return WebsiteResponseDto(
        id=w.id,
        slug=w.slug,
        name=name,
        tagline=tagline,
        contactEmail=contact_email,
        status=WebsiteStatus(normalise_status(w.status)),
        published=is_public(w.status),
        values=values if values is not None else (w.values or {}),
        notes=w.notes or "",
        createdAt=w.created_at,
        updatedAt=w.updated_at,
        hasAdminPassword=bool(w.admin_password_hash),
        editorUpdatedAt=w.editor_updated_at,
        editorBound=has_bindings(w.editor_content),
        merchantId=w.merchant_id,
        merchantName=merchant.restaurant_name if merchant is not None else None,
        profileFields=profile_fields,
        siteOnlyFields=site_only,
    )
