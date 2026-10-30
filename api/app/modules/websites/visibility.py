"""
Who may see a website that isn't public.

Only Live and Update-required sites are public (schemas.website.PUBLIC_STATUSES).
Anything else — In creation, Under review, Inactive… — is shown in full only to:

* Innowi staff signed in with `website.view` (the Super App's own calls),
* the site's own /admin editor session (site-scoped token, typ "site-admin"),
* a signed preview link (`?preview=<token>`, typ "site-preview") generated
  from the Super App, valid for a day, for this one site.

Everyone else gets a trimmed record (slug, name, status) so the site template
can show a "coming soon" page instead of the content.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt as pyjwt
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import has_capability
from app.common.security.jwt import ALGORITHM, decode_access_token
from app.config import get_settings
from app.models.auth import User
from app.models.enums import UserStatus
from app.models.website import Website
from app.schemas.website import is_public

PREVIEW_TOKEN_TYPE = "site-preview"
PREVIEW_TTL = timedelta(hours=24)


def create_preview_token(website: Website) -> tuple[str, datetime]:
    expires = datetime.now(timezone.utc) + PREVIEW_TTL
    token = pyjwt.encode(
        {"sub": website.id, "typ": PREVIEW_TOKEN_TYPE, "iat": datetime.now(timezone.utc), "exp": expires},
        get_settings().JWT_ACCESS_SECRET,
        algorithm=ALGORITHM,
    )
    return token, expires


def _decode(token: str) -> Optional[dict]:
    try:
        return decode_access_token(token)
    except pyjwt.PyJWTError:
        return None


async def can_see(request: Request, website: Website, db: AsyncSession) -> bool:
    """Full record allowed? Always for public sites."""
    if is_public(website.status):
        return True

    preview = request.query_params.get("preview")
    if preview:
        payload = _decode(preview)
        if payload and payload.get("typ") == PREVIEW_TOKEN_TYPE and payload.get("sub") == website.id:
            return True

    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        payload = _decode(auth[7:].strip())
        if payload:
            if payload.get("typ") == "site-admin":
                return payload.get("sub") == website.id
            if payload.get("typ") is None and payload.get("sub"):
                user = (await db.execute(select(User).where(User.id == payload["sub"]))).scalar_one_or_none()
                if user and user.status == UserStatus.ACTIVE and has_capability(user.role.value, "website.view"):
                    return True
    return False
