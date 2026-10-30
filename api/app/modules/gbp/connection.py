"""The one connected Google account: OAuth start/finish, token handling.

Flow (all browser redirects, no password ever reaches us):

1. A manager clicks "Connect Google Business Profile" → POST /gbp/connect
   returns Google's consent URL carrying a signed, 10-minute `state`.
2. Google sends the browser to GBP_OAUTH_REDIRECT_URI
   (GET /integrations/gbp/callback?code=…&state=…). That route has no login —
   the signed state is what proves the request started here, from that user.
3. The code is exchanged for a refresh token, which is stored encrypted with
   CREDENTIAL_ENCRYPTION_KEY. The browser goes back to <GBP_APP_URL>/web/gbp.

The state is HMAC-signed with a key derived from JWT_ACCESS_SECRET but not
equal to it, so a state value (which appears in URLs and browser history) can
never be replayed as an API access token.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from typing import Optional

import httpx
import jwt as pyjwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.security.crypto import CredentialKeyMissing, decrypt_secret, encrypt_secret
from app.config import get_settings
from app.models.gbp import GbpConnection, utcnow
from app.modules.gbp import google

STATE_TTL = dt.timedelta(minutes=10)
STATE_TYP = "gbp-oauth"


class NotConfigured(RuntimeError):
    """OAuth client or encryption key missing from .env — `str(exc)` says which."""


def missing_env() -> list[str]:
    s = get_settings()
    missing = [k for k in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CREDENTIAL_ENCRYPTION_KEY") if not getattr(s, k, None)]
    return missing


def _state_key() -> bytes:
    return hashlib.sha256((get_settings().JWT_ACCESS_SECRET + ":gbp-oauth-state").encode()).digest()


RETURN_PATHS = {"gbp": "/web/gbp", "settings": "/settings/integrations"}


def make_state(user_id: str, ret: str = "gbp") -> str:
    now = utcnow()
    return pyjwt.encode(
        {"typ": STATE_TYP, "uid": user_id, "ret": ret if ret in RETURN_PATHS else "gbp", "nonce": secrets.token_urlsafe(8), "iat": now, "exp": now + STATE_TTL},
        _state_key(),
        algorithm="HS256",
    )


def read_state(state: str) -> Optional[str]:
    """User id from a valid state, else None."""
    payload = _state_payload(state)
    return payload.get("uid") if payload else None


def state_return(state: str) -> str:
    """Which page started the sign-in ("gbp" | "settings"); "gbp" if unknown."""
    payload = _state_payload(state)
    ret = payload.get("ret") if payload else None
    return ret if ret in RETURN_PATHS else "gbp"


def _state_payload(state: str) -> Optional[dict]:
    try:
        payload = pyjwt.decode(state, _state_key(), algorithms=["HS256"])
    except pyjwt.PyJWTError:
        return None
    return payload if payload.get("typ") == STATE_TYP else None


def connect_url(user_id: str, ret: str = "gbp") -> str:
    missing = missing_env()
    if missing:
        raise NotConfigured("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
    s = get_settings()
    return google.authorize_url(s.GOOGLE_OAUTH_CLIENT_ID, s.GBP_OAUTH_REDIRECT_URI, make_state(user_id, ret))


def return_url(ret: str = "gbp", **params: str) -> str:
    from urllib.parse import urlencode

    base = get_settings().GBP_APP_URL.rstrip("/") + RETURN_PATHS.get(ret, "/web/gbp")
    return f"{base}?{urlencode(params)}" if params else base


async def current(db: AsyncSession) -> Optional[GbpConnection]:
    return (await db.execute(select(GbpConnection).order_by(GbpConnection.connected_at.desc()).limit(1))).scalar_one_or_none()


async def finish(db: AsyncSession, http: httpx.AsyncClient, code: str, user_id: str) -> GbpConnection:
    """Exchange the code and store the connection (replacing any earlier one)."""
    missing = missing_env()
    if missing:
        raise NotConfigured("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
    s = get_settings()
    tokens = await google.exchange_code(http, s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET, s.GBP_OAUTH_REDIRECT_URI, code)
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise google.GoogleError(
            "No refresh token in Google's answer",
            friendly="Google didn't return long-lived access. Remove the app under the Google account's "
            "Security → Third-party access, then click Connect again.",
        )
    granted = tokens.get("scope") or ""
    if "business.manage" not in granted:
        raise google.GoogleError(
            "business.manage scope not granted",
            friendly="The Business Profile permission wasn't granted. Click Connect again and tick every box on Google's screen.",
        )
    email = await google.userinfo_email(http, tokens.get("access_token", ""))
    try:
        encrypted = encrypt_secret(refresh)
    except CredentialKeyMissing as exc:
        raise NotConfigured(str(exc))
    for old in (await db.execute(select(GbpConnection))).scalars().all():
        await db.delete(old)
    conn = GbpConnection(
        google_email=email,
        refresh_token_encrypted=encrypted,
        scopes=granted,
        status="connected",
        connected_by_id=user_id,
        connected_at=utcnow(),
    )
    db.add(conn)
    await db.commit()
    return conn


async def access_token(db: AsyncSession, http: httpx.AsyncClient, conn: GbpConnection) -> str:
    s = get_settings()
    if not (s.GOOGLE_OAUTH_CLIENT_ID and s.GOOGLE_OAUTH_CLIENT_SECRET):
        raise NotConfigured("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are missing from the API's settings (environment variables).")
    try:
        refresh = decrypt_secret(conn.refresh_token_encrypted)
    except Exception as exc:  # key missing or changed
        raise NotConfigured("The stored Google token can't be decrypted with CREDENTIAL_ENCRYPTION_KEY. Connect again.") from exc
    try:
        return await google.refresh_access_token(http, s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET, refresh)
    except google.GoogleError as exc:
        if exc.auth:
            conn.status = "error"
            conn.last_error = exc.friendly
            await db.commit()
        raise


async def disconnect(db: AsyncSession, http: httpx.AsyncClient) -> bool:
    conn = await current(db)
    if not conn:
        return False
    try:
        await google.revoke(http, decrypt_secret(conn.refresh_token_encrypted))
    except Exception:
        pass
    await db.delete(conn)
    await db.commit()
    return True
