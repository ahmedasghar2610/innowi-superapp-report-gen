"""
Website intake questionnaires — ported from the standalone `website-api`
service (app/models.py) into the `marketing` Postgres schema.

The service this came from stored a single table in SQLite with no auth; here
it joins the rest of the platform: same engine, same schema layout, same audit
log. The document-shaped `values` column is kept exactly as it was — that is
the whole point of the design, and it means adding a question to the Super
App's website form still needs no migration.
"""
from __future__ import annotations

import datetime as dt
from uuid import uuid4

from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

SCHEMA = "marketing"


def utcnow() -> dt.datetime:
    """Timestamp default, applied Python-side.

    Postgres `now()` is the *transaction* timestamp, so every row written in
    one transaction (the seed script, a bulk import) would share a
    created_at/updated_at to the microsecond — and `updated_at` is what the
    list endpoint orders by. Generating it per row in Python keeps the order
    stable, which is what the standalone service did. `server_default` is kept
    as well, for rows inserted outside the ORM.
    """
    return dt.datetime.now(dt.timezone.utc)


def website_id() -> str:
    """`web_<16 hex chars>` — the id shape the standalone service issued.

    Deliberately *not* the platform's `cuid()`: records already exist with
    these ids, the Super App's frontend holds them, and the site template
    resolves `/api/v1/websites/web_…` against them. Changing the shape would
    orphan every saved website.
    """
    return f"web_{uuid4().hex[:16]}"


class Website(Base):
    """One website intake questionnaire.

    Every answer lives in `values` as the same nested JSON tree the form
    produces, keyed by the dotted paths declared in the frontend's
    `features/websites/data/website-form-steps.ts`.

    `slug`, `name`, `tagline` and `contact_email` are denormalised copies of
    `values.business.*`, derived on write (see `websites.service.summarise`)
    so the list endpoint can search and sort without opening every JSON blob.
    A client that sends its own `name` is ignored.
    """

    __tablename__ = "website"
    __table_args__ = (
        Index("ix_website_status", "status"),
        Index("ix_website_name", "name"),
        Index("ix_website_updated_at", "updated_at"),
        Index("ix_website_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=website_id)

    # URL key for the public site template (nextjs-site serves /<slug>).
    # Generated from the business name on create and never changed after, so a
    # published URL keeps working even when the merchant is renamed.
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled website")
    tagline: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    contact_email: Mapped[str] = mapped_column("contact_email", String(320), nullable=False, default="")

    # PRD WEB-06 lifecycle — see schemas.website.WebsiteStatus. Kept as a
    # plain VARCHAR rather than a native Postgres enum: the status set belongs
    # to the intake workflow and changes more freely than the profiling enums,
    # and a VARCHAR avoids an ALTER TYPE for every new state.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="in_creation")

    # `values` is a reserved word in SQL, hence the distinct column name.
    values: Mapped[dict] = mapped_column("values_json", JSON, nullable=False, default=dict)

    # Free-text working notes; not part of the questionnaire.
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # ---- Merchant link ---------------------------------------------------
    # The Customer Profiling record this site belongs to. NULL = "unassigned":
    # the site was created (form, .docx import, clone) before its merchant
    # existed, and can be linked later. When linked, the merchant Profile is
    # the source of truth for the business fields (name, phone, address,
    # hours) — see modules/websites/merchant_link.py. ON DELETE SET NULL so
    # removing a merchant never takes a public page offline.
    merchant_id: Mapped[Optional[str]] = mapped_column(
        String(30), ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True
    )
    merchant = relationship("Merchant", lazy="selectin")
    # Business fields changed on THIS website only (in the /admin visual
    # editor) while linked: {key: {"value": shown on the site, "base": the
    # Profile value when it was changed}}. The Profile itself is never written
    # from the website. An entry applies while the Profile still holds `base`;
    # once that Profile field is edited, the Profile wins again.
    profile_overrides: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")

    # ---- /admin visual editor (nextjs-site at /<slug>/admin) ------------
    # bcrypt hash of the per-website editor password. NULL = editing is off.
    admin_password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # The page as edited in /admin: `{ "pages": { "/": {title, html, css, …} },
    # "site": {name, theme, templateCss, …} }` — the same shape a cloned
    # site's content/pages.json + content/site.json use, so the Site Builder
    # editor works on it unchanged. NULL = the site is rendered live from
    # `values` by the template; once set, the template serves these pages
    # instead, until "Rebuild from form" clears it.
    editor_content: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    editor_updated_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow, server_default=func.now()
    )
