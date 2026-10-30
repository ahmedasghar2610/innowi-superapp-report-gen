"""
/websites — create, list, read, update and delete website intake
questionnaires. Port of the standalone service's app/routers/websites.py.

Two differences from the service it came from, both deliberate:

1. **Auth.** That service ran unauthenticated behind the assumption a gateway
   would add it. Here the collection and every write are gated by the
   capability matrix like the rest of the API. `GET /websites/{key}` stays
   **public**: it is what the public site template calls to render
   `https://…/<slug>`, and the record it returns is, by definition, the page
   the merchant is publishing.
2. **Pagination.** The platform's `page`/`limit`/`order` convention replaces
   `limit`/`offset`. `offset` is still accepted and still returned in `meta`,
   so callers written against the standalone service keep working.
"""
from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.pagination import PageMeta, PaginationParams
from app.common.storage.local_disk import get_storage
from app.common.storage.port import PutFileInput
from app.common.storage.upload_helpers import read_upload_within_limit
from app.db.session import get_db
from app.models.website import Website
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.common.capabilities import has_capability
from app.config import get_settings
from app.modules.websites import merchant_link, service, visibility
from app.modules.websites.docx_import import DocxImportError, parse_docx
from app.modules.websites.mappers import website_to_dto
from app.schemas.website import (
    CreateWebsiteDto,
    LinkWebsiteDto,
    MerchantFromWebsiteDto,
    MerchantSuggestionDto,
    MerchantWebsitesDto,
    PaginatedWebsitesDto,
    QueryWebsiteDto,
    UpdateWebsiteDto,
    WebsiteAssetDto,
    WebsiteConflictDto,
    WebsiteDocxImportDto,
    WebsiteLinkPreviewDto,
    WebsitePageMeta,
    WebsitePrefillDto,
    WebsitePreviewLinkDto,
    WebsiteResponseDto,
    WebsiteStatus,
    is_public,
)

router = APIRouter(tags=["Websites"])

_view = Depends(require_capability("website.view"))
_edit = Depends(require_capability("website.edit"))
_delete = Depends(require_capability("website.delete"))


async def _require(db: AsyncSession, key: str) -> Website:
    """Resolve by id or slug, 404 otherwise."""
    website = await service.resolve(db, key)
    if website is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No website with id or slug {key}"
        )
    return website


async def _website_raw(key: str, db: AsyncSession):
    """Before-snapshot reader for the audit decorator."""
    website = await service.resolve(db, key)
    return website_to_dto(website).model_dump(mode="json") if website else None


# ------------------------------------------------------------------ list ----
@router.get(
    "/websites",
    response_model=PaginatedWebsitesDto,
    dependencies=[_view],
    summary="List websites",
)
async def list_websites(
    query: QueryWebsiteDto = Depends(),
    pagination: PaginationParams = Depends(),
    offset: int | None = Query(
        None,
        ge=0,
        description="Row offset. Overrides `page` when supplied — kept for clients written against the standalone website-api.",
    ),
    db: AsyncSession = Depends(get_db),
):
    skip = offset if offset is not None else pagination.skip
    rows, total = await service.list_websites(
        db,
        q=query.q,
        status=query.status,
        merchant_id=query.merchantId,
        unassigned=query.unassigned,
        limit=pagination.limit,
        offset=skip,
        order=pagination.order,
    )
    # PageMeta.build() is a classmethod returning cls(...), and WebsitePageMeta
    # adds two required fields — so build the base envelope and widen it.
    base = PageMeta.build(page=pagination.page, limit=pagination.limit, total=total)
    meta = WebsitePageMeta(**base.model_dump(), offset=skip, hasMore=skip + len(rows) < total)
    return PaginatedWebsitesDto(
        data=[website_to_dto(row) for row in rows],
        meta=meta,
    )


# ---------------------------------------------------------------- create ----
@router.post(
    "/websites",
    response_model=WebsiteResponseDto,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_edit],
    summary="Create a website",
)
@audited(entity_type="Website")
async def create_website(
    dto: CreateWebsiteDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    _require_publish_right(user, current=None, new=dto.status.value)
    merchant = None
    if dto.merchantId:
        merchant = await merchant_link.load_merchant(db, dto.merchantId)
        if merchant is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown merchantId")
    created = await service.create_website(db, dto, merchant)
    return website_to_dto(await _require(db, created.id))


# ---------------------------------------------------------- docx import ----
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.post(
    "/websites/import-docx",
    response_model=WebsiteDocxImportDto,
    dependencies=[_edit],
    summary="Read a website content .docx into form answers (nothing is saved)",
)
async def import_docx(file: UploadFile = File(...)):
    data = await read_upload_within_limit(file)
    name = file.filename or "website.docx"
    if not name.lower().endswith(".docx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a Word .docx file (older .doc files aren't supported — re-save as .docx).",
        )
    try:
        result = parse_docx(data)
    except DocxImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return WebsiteDocxImportDto(
        fileName=name, values=result.values, warnings=result.warnings, sections=result.sections
    )


# --------------------------------------------------------------- images ----
# Website images live in file storage, not inside the record: a site with a
# logo, two section photos and a photo per dish would otherwise carry tens of
# megabytes of base64 in `values`, and every public page view would fetch it.
ASSET_SCOPE = "website"
ASSET_PREFIX = f"local/{ASSET_SCOPE}/"
MAX_IMAGE_MB = 8
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
}


def asset_url(key: str) -> str:
    """Root-relative on purpose: the Super App reaches it through its /api/v1
    proxy, and the site template rewrites it onto WEBSITE_API_URL's origin."""
    return f"/api/v1/websites/assets/{key}"


@router.post(
    "/websites/assets",
    response_model=WebsiteAssetDto,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_edit],
    summary="Upload a website image",
)
async def upload_asset(file: UploadFile = File(...)):
    data = await read_upload_within_limit(file)
    if len(data) > MAX_IMAGE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Images are limited to {MAX_IMAGE_MB} MB.",
        )
    name = file.filename or "image"
    mime = (file.content_type or "").lower()
    if not mime or mime == "application/octet-stream":
        mime = mimetypes.guess_type(name)[0] or ""
    if mime not in IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only image files can be uploaded (JPG, PNG, WebP, GIF, SVG, AVIF or ICO).",
        )
    if not mimetypes.guess_type(name)[0]:
        name += IMAGE_TYPES[mime]
    stored = await get_storage().put(
        PutFileInput(buffer=data, original_name=name, mime_type=mime, scope=ASSET_SCOPE)
    )
    return WebsiteAssetDto(key=stored.key, url=asset_url(stored.key), sizeBytes=stored.size_bytes, mimeType=mime)


@router.get(
    "/websites/assets/{key:path}",
    summary="Serve a website image (public)",
    description="Public, like `GET /websites/{key}`: these images appear on the merchant's public site.",
)
async def get_asset(key: str):
    if not key.startswith(ASSET_PREFIX) or ".." in key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    opened = await get_storage().open(key)
    if opened is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    mime = mimetypes.guess_type(key)[0] or "application/octet-stream"
    if mime not in IMAGE_TYPES:
        mime = "application/octet-stream"
    return StreamingResponse(
        opened.stream,
        media_type=mime,
        headers={
            "Content-Length": str(opened.size_bytes),
            # Keys are unique per upload, so the bytes never change.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            # An SVG opened directly must not run script on the API origin.
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
            "Cross-Origin-Resource-Policy": "cross-origin",
        },
    )


# ------------------------------------------------------------------ read ----
@router.get(
    "/websites/{key}",
    response_model=WebsiteResponseDto,
    summary="Get one website by id or slug (public)",
    description=(
        "`key` accepts either the `web_…` id or the site slug, so the public site "
        "template can fetch the record by the URL it is serving.\n\n"
        "**This route is intentionally unauthenticated** — it returns the content a "
        "merchant is publishing on their own public site. Every other route on this "
        "resource requires a bearer token."
    ),
)
async def get_website(key: str, request: Request, db: AsyncSession = Depends(get_db)):
    # The mapper overlays the linked merchant's current Profile values, so the
    # public page always renders the merchant's latest name / phone / hours.
    # A site that isn't public comes back trimmed unless the caller may see it
    # (staff, the site's editor session, or a preview link) — see visibility.py.
    website = await _require(db, key)
    if not await visibility.can_see(request, website, db):
        return website_to_dto(website, restricted=True)
    return website_to_dto(website)


# ---------------------------------------------------------------- update ----
@router.patch(
    "/websites/{key}",
    response_model=WebsiteResponseDto,
    dependencies=[_edit],
    summary="Update a website",
)
@audited(entity_type="Website", id_param="key", read=_website_raw, resolve_merchant_id=lambda e: (e or {}).get("merchantId"))
async def update_website(
    key: str,
    dto: UpdateWebsiteDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    website = await _require(db, key)
    if dto.status is not None:
        _require_publish_right(user, current=website.status, new=dto.status.value)
    updated = await service.update_website(db, website, dto)
    if updated.merchant_id:
        await refresh_completion_cache(db, updated.merchant_id)
    return website_to_dto(await _require(db, updated.id))


# ---------------------------------------------------------------- delete ----
@router.delete(
    "/websites/{key}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[_delete],
    summary="Delete a website",
)
@audited(entity_type="Website", id_param="key", read=_website_raw)
async def delete_website(
    key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    website = await _require(db, key)
    await service.delete_website(db, website)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------- merchant link ----
# A website may be unassigned or belong to one merchant. See
# modules/websites/merchant_link.py for the rules; the routes below are thin.

async def _merchant_or_400(db: AsyncSession, merchant_id: str):
    merchant = await merchant_link.load_merchant(db, merchant_id)
    if merchant is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown merchantId")
    return merchant


@router.get(
    "/websites/{key}/merchant-suggestions",
    response_model=list[MerchantSuggestionDto],
    dependencies=[_view],
    summary="Merchants that look like this website (by name, phone, city)",
)
async def merchant_suggestions(key: str, db: AsyncSession = Depends(get_db)):
    website = await _require(db, key)
    return [MerchantSuggestionDto(**vars(s)) for s in await merchant_link.suggest(db, website)]


@router.get(
    "/websites/{key}/link-preview",
    response_model=WebsiteLinkPreviewDto,
    dependencies=[_view],
    summary="What linking to a merchant would change (conflicts to resolve)",
)
async def link_preview(key: str, merchantId: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    website = await _require(db, key)
    merchant = await _merchant_or_400(db, merchantId)
    return WebsiteLinkPreviewDto(
        merchantId=merchant.id,
        merchantName=merchant.restaurant_name,
        conflicts=[WebsiteConflictDto(**vars(c)) for c in merchant_link.conflicts(website, merchant)],
        profileFields=merchant_link.governed_fields(merchant),
    )


@router.post(
    "/websites/{key}/link",
    response_model=WebsiteResponseDto,
    dependencies=[_edit],
    summary="Link a website to a merchant",
    description=(
        "Attaches the site to the merchant. For every field where the Profile and the site "
        "disagree, `resolutions` says which value wins (default: the Profile). A live site "
        "also sets the merchant's website URL."
    ),
)
@audited(entity_type="Website", id_param="key", read=_website_raw, resolve_merchant_id=lambda e: (e or {}).get("merchantId"))
async def link_website(
    key: str,
    dto: LinkWebsiteDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    website = await _require(db, key)
    merchant = await _merchant_or_400(db, dto.merchantId)
    if website.merchant_id and website.merchant_id != merchant.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This website already belongs to another merchant. Unlink it first.",
        )
    website = await merchant_link.link(db, website, merchant, dto.resolutions)
    await refresh_completion_cache(db, merchant.id)
    return website_to_dto(await _require(db, website.id))


@router.delete(
    "/websites/{key}/link",
    response_model=WebsiteResponseDto,
    dependencies=[_edit],
    summary="Unlink a website from its merchant (the site stays, as unassigned)",
)
@audited(entity_type="Website", id_param="key", read=_website_raw, resolve_merchant_id=lambda e: (e or {}).get("merchantId"))
async def unlink_website(
    key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    website = await _require(db, key)
    if not website.merchant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This website isn't linked to a merchant.")
    previous = website.merchant_id
    website = await merchant_link.unlink(db, website)
    await refresh_completion_cache(db, previous)
    return website_to_dto(await _require(db, website.id))


@router.post(
    "/websites/{key}/merchant",
    response_model=WebsiteResponseDto,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_capability("merchant.create"))],
    summary="Create a new merchant from this website's answers and link them",
    description=(
        "For a site that came in first (form, .docx import, clone): creates the Merchant with a "
        "primary Location and an Owner contact from the business details, links the site, and "
        "leaves every other Profile field empty for Data Quality to flag."
    ),
)
@audited(entity_type="Website", id_param="key", read=_website_raw, resolve_merchant_id=lambda e: (e or {}).get("merchantId"))
async def create_merchant_from_website(
    key: str,
    dto: MerchantFromWebsiteDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    website = await _require(db, key)
    if website.merchant_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This website already has a merchant.")
    merchant = await merchant_link.merchant_from_website(
        db,
        website,
        account_manager_id=dto.accountManagerId,
        merchant_code=dto.merchantCode,
        cuisine_category=dto.cuisineCategory,
    )
    await refresh_completion_cache(db, merchant.id)
    website = await _require(db, website.id)
    return website_to_dto(website)


# --------------------------------------------------- merchant-side views ----

@router.get(
    "/merchants/{merchant_id}/websites",
    response_model=MerchantWebsitesDto,
    dependencies=[_view],
    summary="This merchant's website situation: none / external / managed",
)
async def merchant_websites(merchant_id: str, db: AsyncSession = Depends(get_db)):
    merchant = await merchant_link.load_merchant(db, merchant_id)
    if merchant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    rows, _total = await service.list_websites(db, merchant_id=merchant.id, limit=100)
    if rows:
        state = "managed"
    elif (merchant.website_url or "").strip():
        state = "external"
    else:
        state = "none"
    return MerchantWebsitesDto(
        merchantId=merchant.id,
        state=state,
        externalUrl=merchant.website_url if state == "external" else None,
        externalPlatform=merchant.website_platform if state == "external" else None,
        websites=[website_to_dto(r) for r in rows],
    )


@router.get(
    "/merchants/{merchant_id}/website-prefill",
    response_model=WebsitePrefillDto,
    dependencies=[_view],
    summary="Starter answers for a new website, taken from the merchant Profile",
)
async def website_prefill(merchant_id: str, db: AsyncSession = Depends(get_db)):
    merchant = await merchant_link.load_merchant(db, merchant_id)
    if merchant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    values: dict = merchant_link.overlay({}, merchant)
    order_url = (merchant.online_ordering or "").strip()
    if order_url.startswith("http"):
        values["orderUrl"] = order_url
    return WebsitePrefillDto(
        merchantId=merchant.id,
        merchantName=merchant.restaurant_name,
        values=values,
        profileFields=merchant_link.governed_fields(merchant),
    )


# ---------------------------------------------------------------- status ----
PUBLISH_DENIED = "Requires Website publish permission — contact Admin"


def _require_publish_right(user: AuthenticatedUser, *, current: str | None, new: str) -> None:
    """Going public, leaving public, or taking a site down (Inactive) needs
    `website.publish` (Super App PRD §17). Moves between the non-public
    working states (In creation, Content required, Under review…) don't."""
    was_public = bool(current) and is_public(current)
    crosses = was_public != is_public(new) or (new == WebsiteStatus.INACTIVE.value and current != new)
    if crosses and not has_capability(user.role, "website.publish"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PUBLISH_DENIED)


@router.post(
    "/websites/{key}/preview-link",
    response_model=WebsitePreviewLinkDto,
    dependencies=[_view],
    summary="A signed link that shows a site that isn't public yet (valid 24 hours)",
)
async def preview_link(key: str, db: AsyncSession = Depends(get_db)):
    website = await _require(db, key)
    token, expires = visibility.create_preview_token(website)
    base = get_settings().SITE_TEMPLATE_URL.rstrip("/")
    return WebsitePreviewLinkDto(url=f"{base}/{website.slug}?preview={token}", expiresAt=expires)
