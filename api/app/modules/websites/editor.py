"""
/websites/{key}/admin/* and /websites/{key}/content — the per-site /admin
visual editor served by the public site template (nextjs-site, /<slug>/admin).

Who may edit
    * Anyone holding the website's own admin password. Logging in with it
      returns a token scoped to that ONE website (`typ: site-admin`). It is
      signed with the platform's access-token key but `get_current_user`
      rejects it, so it can never act as a staff login.
    * Innowi staff with `website.edit`, using their normal access token (the
      Super App's "Rebuild from form" uses this).

Changing or removing the password invalidates every site token already issued
(the token carries a fingerprint of the password hash).

What is stored
    `editor_content` holds the edited site in the Site Builder's own shape —
    `{pages: {path: {title, html, css, …}}, site: {…}}` — so the same
    VisualEditor that edits cloned sites edits these unchanged. Reading it is
    public, like `GET /websites/{key}`: it is the page being published.
"""
from __future__ import annotations

import hashlib
import mimetypes
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt as pyjwt
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import has_capability
from app.common.deps import get_current_user
from app.common.security.jwt import ALGORITHM, decode_access_token
from app.common.security.password import verify_password
from app.common.security.throttle import FailureThrottle
from app.config import get_settings
from app.db.session import get_db
from app.models.website import Website, utcnow
from app.modules.websites import binding, service
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.websites.merchant_link import PROFILE_FIELDS, active_overrides, get_at, overlay, profile_values, record_site_edits
from app.schemas.website import (
    EditorContentDto,
    EditorContentResponseDto,
    SiteAdminLoginDto,
    SiteAdminSessionDto,
    SiteAdminTokenDto,
    WebsiteAssetDto,
)

router = APIRouter(tags=["Websites — /admin editor"])
_bearer = HTTPBearer(auto_error=False)

SITE_TOKEN_TYPE = "site-admin"
SITE_TOKEN_TTL = 60 * 60 * 24 * 7  # 7 days, like a cloned site's /admin cookie
MAX_CONTENT_BYTES = 15 * 1024 * 1024

# Failed password attempts per website: at most 10 in any 10 minutes.
_site_login_throttle = FailureThrottle(limit=10, window_seconds=600)


def _password_fingerprint(website: Website) -> str:
    return hashlib.sha256((website.admin_password_hash or "").encode()).hexdigest()[:16]


def create_site_token(website: Website) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    token = pyjwt.encode(
        {
            "sub": website.id,
            "typ": SITE_TOKEN_TYPE,
            "slug": website.slug,
            "pv": _password_fingerprint(website),
            "iat": now,
            "exp": now + timedelta(seconds=SITE_TOKEN_TTL),
        },
        get_settings().JWT_ACCESS_SECRET,
        algorithm=ALGORITHM,
    )
    return token, SITE_TOKEN_TTL


async def _website(db: AsyncSession, key: str) -> Website:
    website = await service.resolve(db, key)
    if website is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No website with id or slug {key}")
    return website


async def site_editor(
    key: str,
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> tuple[Website, str]:
    """The website being edited, and how the caller is signed in ("password" | "staff")."""
    website = await _website(db, key)
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to edit this website.")
    try:
        payload = decode_access_token(credentials.credentials)
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your editing session has expired.")

    if payload.get("typ") == SITE_TOKEN_TYPE:
        if (
            payload.get("sub") != website.id
            or not website.admin_password_hash
            or payload.get("pv") != _password_fingerprint(website)
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your editing session has expired.")
        return website, "password"

    user = await get_current_user(request, credentials, db)
    if not has_capability(user.role, "website.edit"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This action requires website edit rights")
    return website, "staff"


# ------------------------------------------------------------------ login ----
@router.post(
    "/websites/{key}/admin/login",
    response_model=SiteAdminTokenDto,
    summary="Sign in to a website's /admin editor with its password",
)
async def admin_login(key: str, dto: SiteAdminLoginDto, db: AsyncSession = Depends(get_db)):
    website = await _website(db, key)
    if _site_login_throttle.is_blocked(website.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again in a few minutes.",
            headers={"Retry-After": str(_site_login_throttle.retry_after(website.id))},
        )
    if not website.admin_password_hash:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Editing isn't turned on for this website yet. Set an admin password in the Super App.",
        )
    if not verify_password(dto.password, website.admin_password_hash):
        _site_login_throttle.record_failure(website.id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password.")
    _site_login_throttle.reset(website.id)
    token, ttl = create_site_token(website)
    return SiteAdminTokenDto(token=token, expiresIn=ttl, websiteId=website.id, slug=website.slug)


@router.get(
    "/websites/{key}/admin/session",
    response_model=SiteAdminSessionDto,
    summary="Check an /admin editor session",
)
async def admin_session(editor: tuple[Website, str] = Depends(site_editor)):
    website, via = editor
    return SiteAdminSessionDto(websiteId=website.id, slug=website.slug, name=website.name, via=via)


# ---------------------------------------------------------------- content ----
ASSET_MARKER = "/api/v1/websites/assets/"


def _asset_helpers(request: Optional[Request] = None, origin: Optional[str] = None):
    """Uploaded images are stored in `values` as root-relative API paths; the
    page needs them absolute (it is served by the site template's origin), and
    a src changed in the editor comes back absolute and is stored relative."""
    origin = (get_settings().API_PUBLIC_URL or origin or (str(request.base_url) if request else "http://localhost:3000")).rstrip("/")

    def to_url(value: str) -> str:
        return f"{origin}{value}" if value.startswith(ASSET_MARKER) else value

    def to_path(src: str) -> str:
        i = src.find(ASSET_MARKER)
        return src[i:] if i > 0 and src.startswith("http") else src

    return to_url, to_path


def _binding_inputs(website: Website) -> tuple[dict, set[str]]:
    """The answers the page should show (merchant Profile + website-only
    edits applied) and the paths the Profile governs (marked in the editor:
    editable, but saved on this website only)."""
    merchant = website.merchant
    if merchant is None:
        return website.values or {}, set()
    governed = {k for k, v in profile_values(merchant).items() if v}
    return overlay(website.values or {}, merchant, active_overrides(website, merchant)), governed


def _filled_pages(website: Website, pages: dict, request: Optional[Request] = None, origin: Optional[str] = None) -> dict:
    values, locked = _binding_inputs(website)
    to_url, to_path = _asset_helpers(request, origin)
    out = {}
    for path, page in pages.items():
        page = dict(page)
        page["html"] = binding.fill(page.get("html") or "", values, locked, asset_url=to_url, asset_path=to_path)
        out[path] = page
    return out


@router.get(
    "/websites/{key}/content",
    response_model=EditorContentResponseDto,
    summary="The site as edited in /admin (public)",
    description="404 when the site has never been edited in /admin — it is then rendered from its form answers.",
)
async def get_content(key: str, request: Request, db: AsyncSession = Depends(get_db)):
    website = await _website(db, key)
    from app.modules.websites import visibility

    if not await visibility.can_see(request, website, db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This website isn't published.")
    content = website.editor_content
    if not content or not isinstance(content.get("pages"), dict) or not content["pages"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This website hasn't been edited in /admin.")
    # Bound elements are brought up to date with the form answers (and the
    # merchant Profile) on every read — see modules/websites/binding.py.
    return EditorContentResponseDto(
        pages=_filled_pages(website, content["pages"], request),
        site=content.get("site") or {},
        updatedAt=website.editor_updated_at,
    )


@router.put(
    "/websites/{key}/content",
    response_model=EditorContentResponseDto,
    summary="Save the site as edited in /admin",
)
async def put_content(
    dto: EditorContentDto,
    request: Request,
    editor: tuple[Website, str] = Depends(site_editor),
    db: AsyncSession = Depends(get_db),
):
    website, _via = editor
    if int(request.headers.get("content-length") or 0) > MAX_CONTENT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The page is too large to save.")
    if "/" not in dto.pages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The home page (/) is required.")

    pages, profile_changed = apply_editor_save(website, dto.pages, dto.site, request=request)
    await db.commit()
    if profile_changed:
        await refresh_completion_cache(db, website.merchant.id)
    return EditorContentResponseDto(pages=pages, site=dto.site, updatedAt=website.editor_updated_at)


def apply_editor_save(
    website: Website, incoming: dict, site: dict, *, request: Optional[Request] = None, origin: Optional[str] = None
) -> tuple[dict, list[str]]:
    """Save edited pages: write visual edits of bound fields back (to the form
    answers; Profile-governed fields to this website only), then store the
    pages re-stamped. Returns (stored pages, Profile keys changed) — the
    second is always empty now: the website never changes the Profile.
    Caller commits."""
    # Text / links / images / list rows changed in the visual editor are
    # written back into the form answers, so the Super App's form shows them.
    values, locked = _binding_inputs(website)
    _to_url, to_path = _asset_helpers(request, origin)
    # Edits that were never recorded as edits (made before the page's first
    # save, or while Profile fields were read-only) are flagged so they sync too.
    incoming = {p: {**pg, "html": binding.mark_pending_edits(pg.get("html") or "", values)} for p, pg in incoming.items()}
    changes: dict = {}
    for page in incoming.values():
        changes = binding.merge(changes, binding.extract(page.get("html") or "", values, locked, asset_path=to_path))
    site_only_changed: list[str] = []
    if changes and website.merchant is not None:
        # Name / phone / email / address / hours the Profile governs: kept on
        # this website only — the merchant Profile is never changed from here.
        governed = {k for k in PROFILE_FIELDS if profile_values(website.merchant).get(k)}
        site_only_changed = record_site_edits(
            website, website.merchant, {k: v for k in governed if (v := get_at(changes, k)) is not None}
        )
        business = changes.get("business")
        if isinstance(business, dict):
            for k in governed:
                business.pop(k.split(".", 1)[1], None)
            if not business:
                changes.pop("business")
    if changes:
        website.values = binding.merge(website.values or {}, changes)
        for column, value in service.summarise(website.values).items():
            setattr(website, column, value)
    if changes or site_only_changed:
        website.updated_at = utcnow()

    # Store the pages re-stamped against the updated answers.
    pages = _filled_pages(website, incoming, request, origin)
    website.editor_content = {"pages": pages, "site": site}
    website.editor_updated_at = utcnow()
    return pages, []


@router.delete(
    "/websites/{key}/content",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Rebuild from form — discard the /admin edits",
)
async def delete_content(
    editor: tuple[Website, str] = Depends(site_editor),
    db: AsyncSession = Depends(get_db),
):
    website, _via = editor
    website.editor_content = None
    website.editor_updated_at = None
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/websites/{key}/content/assets",
    response_model=WebsiteAssetDto,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an image from the /admin editor",
)
async def upload_editor_asset(
    file: UploadFile = File(...),
    editor: tuple[Website, str] = Depends(site_editor),
):
    # Same storage, limits and public URL as the Super App's image uploads.
    from app.modules.websites.router import upload_asset

    return await upload_asset(file)
