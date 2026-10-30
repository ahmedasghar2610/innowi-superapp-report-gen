"""The one connected Google account for Google Ads: OAuth start/finish, tokens.

Same flow as GBP (modules/gbp/connection.py) and the same Google OAuth client
(GOOGLE_OAUTH_CLIENT_ID/SECRET), with the `adwords` scope and its own redirect
URI (ADS_OAUTH_REDIRECT_URI → GET /integrations/google-ads/callback):

1. A manager clicks "Connect Google Ads" → POST /ads/connect returns Google's
   consent URL with a signed, 10-minute `state`.
2. Google sends the browser to the callback; the signed state proves who
   started it. The code is exchanged for a refresh token, stored encrypted
   with CREDENTIAL_ENCRYPTION_KEY.
3. The browser goes back to <ADS_APP_URL>/ads (or Settings → Integrations).

Every Google Ads call also needs GOOGLE_ADS_DEVELOPER_TOKEN and is made through
the manager account GOOGLE_ADS_LOGIN_CUSTOMER_ID.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt as pyjwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.security.crypto import CredentialKeyMissing, decrypt_secret, encrypt_secret
from app.config import get_settings
from app.models.ads import AdsConnection, utcnow
from app.modules.ads import google
from app.modules.gbp import google as oauth  # generic Google OAuth helpers (token exchange/refresh/revoke)

STATE_TTL = dt.timedelta(minutes=10)
STATE_TYP = "ads-oauth"
RETURN_PATHS = {"ads": "/ads", "settings": "/settings/integrations"}


class NotConfigured(RuntimeError):
    """OAuth client, developer token or encryption key missing — `str(exc)` says which."""


def missing_env() -> list[str]:
    s = get_settings()
    keys = ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_LOGIN_CUSTOMER_ID")
    return [k for k in keys if not getattr(s, k, None)]


def login_customer_id() -> Optional[str]:
    v = get_settings().GOOGLE_ADS_LOGIN_CUSTOMER_ID
    return "".join(ch for ch in v if ch.isdigit()) if v else None


def _state_key() -> bytes:
    return hashlib.sha256((get_settings().JWT_ACCESS_SECRET + ":ads-oauth-state").encode()).digest()


def make_state(user_id: str, ret: str = "ads") -> str:
    now = utcnow()
    return pyjwt.encode(
        {"typ": STATE_TYP, "uid": user_id, "ret": ret if ret in RETURN_PATHS else "ads", "nonce": secrets.token_urlsafe(8), "iat": now, "exp": now + STATE_TTL},
        _state_key(),
        algorithm="HS256",
    )


def _state_payload(state: str) -> Optional[dict]:
    try:
        payload = pyjwt.decode(state, _state_key(), algorithms=["HS256"])
    except pyjwt.PyJWTError:
        return None
    return payload if payload.get("typ") == STATE_TYP else None


def read_state(state: str) -> Optional[str]:
    p = _state_payload(state)
    return p.get("uid") if p else None


def state_return(state: str) -> str:
    p = _state_payload(state)
    ret = p.get("ret") if p else None
    return ret if ret in RETURN_PATHS else "ads"


def connect_url(user_id: str, ret: str = "ads") -> str:
    missing = [k for k in missing_env() if k != "GOOGLE_ADS_LOGIN_CUSTOMER_ID"]
    if missing:
        raise NotConfigured("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
    s = get_settings()
    return google.authorize_url(s.GOOGLE_OAUTH_CLIENT_ID, s.ADS_OAUTH_REDIRECT_URI, make_state(user_id, ret))


def return_url(ret: str = "ads", **params: str) -> str:
    base = get_settings().ADS_APP_URL.rstrip("/") + RETURN_PATHS.get(ret, "/ads")
    return f"{base}?{urlencode(params)}" if params else base


async def current(db: AsyncSession) -> Optional[AdsConnection]:
    return (await db.execute(select(AdsConnection).order_by(AdsConnection.connected_at.desc()).limit(1))).scalar_one_or_none()


def _wrap(exc: oauth.GoogleError) -> google.GoogleAdsError:
    return google.GoogleAdsError(str(exc), exc.status, exc.friendly.replace("Click Connect again", "Click Connect Google Ads again"), auth=exc.auth)


async def finish(db: AsyncSession, http: httpx.AsyncClient, code: str, user_id: str) -> AdsConnection:
    """Exchange the code and store the connection (replacing any earlier one)."""
    missing = [k for k in missing_env() if k != "GOOGLE_ADS_LOGIN_CUSTOMER_ID"]
    if missing:
        raise NotConfigured("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
    s = get_settings()
    try:
        tokens = await oauth.exchange_code(http, s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET, s.ADS_OAUTH_REDIRECT_URI, code)
    except oauth.GoogleError as exc:
        raise _wrap(exc)
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise google.GoogleAdsError(
            "No refresh token in Google's answer",
            friendly="Google didn't return long-lived access. Remove the app under the Google account's Security → "
            "Third-party access, then click Connect Google Ads again.",
        )
    granted = tokens.get("scope") or ""
    if "adwords" not in granted:
        raise google.GoogleAdsError(
            "adwords scope not granted", friendly="The Google Ads permission wasn't granted. Click Connect again and tick every box on Google's screen."
        )
    email = await oauth.userinfo_email(http, tokens.get("access_token", ""))
    try:
        encrypted = encrypt_secret(refresh)
    except CredentialKeyMissing as exc:
        raise NotConfigured(str(exc))
    for old in (await db.execute(select(AdsConnection))).scalars().all():
        await db.delete(old)
    conn = AdsConnection(
        google_email=email, refresh_token_encrypted=encrypted, scopes=granted, status="connected", connected_by_id=user_id, connected_at=utcnow()
    )
    db.add(conn)
    await db.commit()
    return conn


async def access_token(db: AsyncSession, http: httpx.AsyncClient, conn: AdsConnection) -> str:
    s = get_settings()
    if not (s.GOOGLE_OAUTH_CLIENT_ID and s.GOOGLE_OAUTH_CLIENT_SECRET):
        raise NotConfigured("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are missing from the API's settings (environment variables).")
    try:
        refresh = decrypt_secret(conn.refresh_token_encrypted)
    except Exception as exc:
        raise NotConfigured("The stored Google token can't be decrypted with CREDENTIAL_ENCRYPTION_KEY. Connect Google Ads again.") from exc
    try:
        return await oauth.refresh_access_token(http, s.GOOGLE_OAUTH_CLIENT_ID, s.GOOGLE_OAUTH_CLIENT_SECRET, refresh)
    except oauth.GoogleError as exc:
        if exc.auth:
            conn.status = "error"
            conn.last_error = _wrap(exc).friendly
            await db.commit()
        raise _wrap(exc)


async def disconnect(db: AsyncSession, http: httpx.AsyncClient) -> bool:
    conn = await current(db)
    if not conn:
        return False
    try:
        await oauth.revoke(http, decrypt_secret(conn.refresh_token_encrypted))
    except Exception:
        pass
    await db.delete(conn)
    await db.commit()
    return True
