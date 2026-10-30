"""
Pydantic schemas for the websites module — ported from the standalone
`website-api` service's app/schemas.py.

That service used an alias generator to turn snake_case into camelCase on the
wire. This codebase writes camelCase field names directly (see
schemas/merchant_profiling.py), so the DTOs below are spelled camelCase and
the wire format is byte-identical to what the standalone service emitted:
the Super App's `Website` type needs no mapping layer either way.

Input DTOs carry `extra="forbid"` so an unexpected or misspelled body key is a
400 rather than being silently dropped — matching every other input DTO here
(and the NestJS original's `forbidNonWhitelisted: true`).
"""
from __future__ import annotations

import datetime as dt
import enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.pagination import PageMeta


class WebsiteStatus(str, enum.Enum):
    """Website lifecycle — PRD WEB-06. Only LIVE and UPDATE_REQUIRED are public
    (an update-required site stays up while it is being changed)."""

    NOT_STARTED = "not_started"
    IN_CREATION = "in_creation"
    CONTENT_REQUIRED = "content_required"
    CONTENT_MAP_REQUIRED = "content_map_required"
    UNDER_REVIEW = "under_review"
    LIVE = "live"
    UPDATE_REQUIRED = "update_required"
    INACTIVE = "inactive"


PUBLIC_STATUSES = frozenset({WebsiteStatus.LIVE.value, WebsiteStatus.UPDATE_REQUIRED.value})

#: Values from before WEB-06, still accepted on input and mapped on read.
LEGACY_STATUS = {"draft": "in_creation", "in_review": "under_review"}


def normalise_status(value):
    if isinstance(value, str):
        return LEGACY_STATUS.get(value, value)
    return value


def is_public(status: str) -> bool:
    return normalise_status(status) in PUBLIC_STATUSES


# ---- Input ------------------------------------------------------------------
class CreateWebsiteDto(BaseModel):
    """`slug` is optional — it is derived from the business name when omitted."""

    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(
        default_factory=dict,
        description="Nested answers, keyed by the form's dotted paths (business.name, offerings.items[…], …).",
    )
    status: WebsiteStatus = WebsiteStatus.IN_CREATION
    notes: str = Field("", max_length=20000)
    slug: Optional[str] = Field(None, max_length=80)

    @field_validator("status", mode="before")
    @classmethod
    def _legacy_status(cls, v):
        return normalise_status(v)

    #: Merchant this site belongs to. Omit for an unassigned site. When set,
    #: the merchant Profile's business fields are written over `values`.
    merchantId: Optional[str] = Field(None, max_length=30)


class UpdateWebsiteDto(BaseModel):
    """Partial update — only the supplied fields are written.

    `values` **replaces** the whole answer tree rather than merging: the form
    always holds the complete set of answers, and a merge would make it
    impossible to clear a field.
    """

    model_config = ConfigDict(extra="forbid")

    values: Optional[dict[str, Any]] = None
    status: Optional[WebsiteStatus] = None
    notes: Optional[str] = Field(None, max_length=20000)
    # Moves the site's public URL. Omit to keep the current slug — renaming the
    # business alone never moves it.
    slug: Optional[str] = Field(None, max_length=80)
    @field_validator("status", mode="before")
    @classmethod
    def _legacy_status(cls, v):
        return normalise_status(v)

    # Password for the site's /admin visual editor. A non-empty value sets (or
    # replaces) it and signs out every open /admin session; "" turns editing
    # off. Omit to leave it unchanged. Stored as a bcrypt hash, never returned.
    adminPassword: Optional[str] = Field(None, max_length=128)

    @field_validator("adminPassword")
    @classmethod
    def _password_length(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) < 8:
            raise ValueError("The admin password needs at least 8 characters.")
        return v


class QueryWebsiteDto(BaseModel):
    """Query string for GET /websites. Mirrors the other list endpoints."""

    q: Optional[str] = Field(None, description="Case-insensitive match on name, tagline, slug or contact email.")
    status: Optional[WebsiteStatus] = None

    @field_validator("status", mode="before")
    @classmethod
    def _legacy_status(cls, v):
        return normalise_status(v)

    merchantId: Optional[str] = Field(None, description="Only this merchant's sites.")
    unassigned: Optional[bool] = Field(None, description="true = only sites with no merchant.")


# ---- Output -----------------------------------------------------------------
class WebsiteResponseDto(BaseModel):
    # Built by modules/websites/mappers.website_to_dto, not by attribute
    # mapping: the field names here are camelCase and the columns are
    # snake_case, so `from_attributes` would silently miss contactEmail /
    # createdAt / updatedAt.
    id: str
    #: URL key the site template serves this website at (`/<slug>`).
    slug: str
    name: str
    tagline: str
    contactEmail: str
    status: WebsiteStatus
    values: dict[str, Any]
    notes: str
    createdAt: dt.datetime
    updatedAt: dt.datetime
    #: True when the site's /admin editor has a password (editing is on).
    hasAdminPassword: bool = False
    #: Set once the site has been edited in /admin; it is then served from
    #: those edited pages instead of `values` until rebuilt from the form.
    editorUpdatedAt: Optional[dt.datetime] = None
    #: The edited pages are bound to the form: form changes still reach the
    #: live page. False for sites edited before binding existed (those need a
    #: "Rebuild from form" once to pick it up).
    editorBound: bool = False
    #: Visible to the public at its URL (status Live or Update required).
    published: bool = False
    #: True when this response was trimmed because the site isn't public and
    #: the caller isn't allowed to see it (anonymous public read).
    restricted: bool = False
    #: The merchant this site belongs to; null = unassigned.
    merchantId: Optional[str] = None
    merchantName: Optional[str] = None
    #: `values` keys the merchant Profile supplies (locked in the form; a
    #: Profile edit shows on the site). Empty when unassigned.
    profileFields: list[str] = Field(default_factory=list)
    #: Governed fields changed on this website only (visual editor), mapped
    #: to the Profile's value — `values` shows the website's value. Cleared
    #: for a field once that Profile field is edited.
    siteOnlyFields: dict[str, str] = Field(default_factory=dict)


class WebsitePageMeta(PageMeta):
    """The platform's PageMeta plus the two keys the standalone service emitted.

    `offset`/`hasMore` are additive: clients written against the old
    `{ total, limit, offset, hasMore }` envelope keep working, and clients
    written against this codebase's `{ page, limit, total, pageCount, … }`
    read the same object.
    """

    offset: int
    hasMore: bool


class PaginatedWebsitesDto(BaseModel):
    """`{ data, meta }` — the envelope every list endpoint here returns."""

    data: list[WebsiteResponseDto]
    meta: WebsitePageMeta


# ---- .docx import & images ----------------------------------------------------
class WebsiteDocxImportDto(BaseModel):
    """`POST /websites/import-docx` — the answers read from a content file.

    Nothing is saved: the Super App shows these to the user, collects images and
    anything the file doesn't carry, then creates the website as usual.
    """

    fileName: str
    values: dict[str, Any]
    warnings: list[str]
    sections: list[str] = Field(description="Section codes found in the file: G, S1…S8, JSON-LD.")


class WebsiteAssetDto(BaseModel):
    """An uploaded website image. `url` is what goes into the website's values."""

    key: str
    url: str
    sizeBytes: int
    mimeType: str


# ---- /admin visual editor --------------------------------------------------------
class SiteAdminLoginDto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=128)


class SiteAdminTokenDto(BaseModel):
    """A token scoped to ONE website's /admin editor — not a staff login."""

    token: str
    expiresIn: int
    websiteId: str
    slug: str


class SiteAdminSessionDto(BaseModel):
    websiteId: str
    slug: str
    name: str
    #: How the caller is signed in: the site's own password, or a staff account.
    via: str


class EditorContentDto(BaseModel):
    """The edited site, in the Site Builder's content shape.

    `pages` maps a path ("/", "/about") to `{title, description, html, css,
    updatedAt}`; `site` holds site-wide settings (name, theme, templateCss…).
    Both are kept as free-form JSON so the editor can grow fields without an
    API change.
    """

    model_config = ConfigDict(extra="forbid")
    pages: dict[str, dict[str, Any]]
    site: dict[str, Any] = Field(default_factory=dict)


class EditorContentResponseDto(EditorContentDto):
    model_config = ConfigDict(extra="ignore")
    updatedAt: Optional[dt.datetime] = None


# ---- Merchant link -----------------------------------------------------------
class WebsiteConflictDto(BaseModel):
    """One field where the merchant Profile and the site disagree."""

    field: str
    label: str
    profileValue: str
    websiteValue: str


class WebsiteLinkPreviewDto(BaseModel):
    merchantId: str
    merchantName: str
    conflicts: list[WebsiteConflictDto]
    #: Keys the Profile will govern after linking.
    profileFields: list[str]


class LinkWebsiteDto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    merchantId: str = Field(min_length=1, max_length=30)
    #: Per-conflict choice: "profile" copies the Profile value onto the site,
    #: "website" writes the site's value into the Profile. Unlisted conflicts
    #: default to "profile".
    resolutions: dict[str, Literal["profile", "website"]] = Field(default_factory=dict)


class MerchantSuggestionDto(BaseModel):
    merchantId: str
    restaurantName: str
    city: str
    websiteUrl: Optional[str] = None
    score: int
    reasons: list[str]


class MerchantFromWebsiteDto(BaseModel):
    """`POST /websites/{key}/merchant` — the few things the site can't tell us."""

    model_config = ConfigDict(extra="forbid")
    accountManagerId: Optional[str] = Field(None, max_length=30)
    merchantCode: Optional[str] = Field(None, max_length=50)
    cuisineCategory: Optional[str] = Field(None, max_length=200)


class WebsitePrefillDto(BaseModel):
    """`GET /merchants/{id}/website-prefill` — starter answers for a new site."""

    merchantId: str
    merchantName: str
    values: dict[str, Any]
    profileFields: list[str]


class MerchantWebsitesDto(BaseModel):
    """`GET /merchants/{id}/websites` — what the workspace Website tab shows."""

    merchantId: str
    #: "none" — no site at all; "external" — only a URL in the Profile;
    #: "managed" — at least one site built in this module.
    state: Literal["none", "external", "managed"]
    externalUrl: Optional[str] = None
    externalPlatform: Optional[str] = None
    websites: list[WebsiteResponseDto]


class WebsitePreviewLinkDto(BaseModel):
    """`POST /websites/{key}/preview-link` — a signed link that shows a site
    that isn't public yet (Draft, Under review, Inactive…)."""

    url: str
    expiresAt: dt.datetime
