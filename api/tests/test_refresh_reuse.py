"""Refresh-token reuse: two requests refreshing at once must not sign the person
out, but a stolen or old token still revokes every session.

Runs against the configured Postgres (skipped when unreachable or not migrated).
"""
from __future__ import annotations

import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.common.security.password import hash_password
from app.config import get_settings
from app.db.schemas import qualified
from app.db.session import engine_kwargs
from app.models.auth import RefreshToken, User
from app.models.enums import Role, UserStatus
from app.modules.auth.service import AuthService, _hash_token

EMAIL = "racer@test.refresh"


@pytest.fixture()
async def sessions():
    settings = get_settings()
    engine = create_async_engine(settings.database_url_async, **{**engine_kwargs(), "poolclass": NullPool})
    try:
        async with engine.connect() as conn:
            await conn.execute(text(f'select 1 from {qualified("auth")}."refresh_token" limit 1'))
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"database not reachable: {exc}")
    clean = f'DELETE FROM {qualified("auth")}."user" WHERE email = \'{EMAIL}\''
    async with engine.begin() as conn:
        await conn.execute(text(clean))
    yield async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with engine.begin() as conn:
        await conn.execute(text(clean))
    await engine.dispose()


async def _signed_in(sessions) -> tuple[str, str]:
    async with sessions() as db:
        u = User(email=EMAIL, password_hash=hash_password("x" * 12), role=Role.SALES_EXECUTIVE, status=UserStatus.ACTIVE)
        db.add(u)
        await db.commit()
        tokens = await AuthService(db)._issue_tokens(u, None, "test")
        return u.id, tokens.refreshToken


async def _refresh(sessions, raw: str) -> str:
    async with sessions() as db:
        return (await AuthService(db).refresh(raw)).refreshToken


async def _live_tokens(sessions, user_id: str) -> int:
    async with sessions() as db:
        rows = (await db.execute(select(RefreshToken).where(RefreshToken.user_id == user_id,
                                                             RefreshToken.revoked_at.is_(None)))).scalars()
        return len(list(rows))


async def test_concurrent_refresh_with_the_same_token_keeps_the_session(sessions):
    user_id, a = await _signed_in(sessions)
    b = await _refresh(sessions, a)          # first request rotates A -> B
    c = await _refresh(sessions, a)          # second request, same cookie, a moment later
    assert c and c != b
    assert await _live_tokens(sessions, user_id) == 2  # nobody was signed out
    assert await _refresh(sessions, b)       # both new tokens keep working
    assert await _refresh(sessions, c)


async def test_reuse_after_the_grace_window_still_revokes_everything(sessions, monkeypatch):
    user_id, a = await _signed_in(sessions)
    await _refresh(sessions, a)
    async with sessions() as db:             # pretend the rotation happened 5 minutes ago
        row = (await db.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(a)))).scalar_one()
        row.revoked_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)
        await db.commit()
    with pytest.raises(HTTPException) as exc:
        await _refresh(sessions, a)
    assert exc.value.status_code == 401 and "all sessions revoked" in exc.value.detail
    assert await _live_tokens(sessions, user_id) == 0


async def test_reuse_after_the_new_session_signed_out_still_revokes_everything(sessions):
    user_id, a = await _signed_in(sessions)
    b = await _refresh(sessions, a)
    async with sessions() as db:
        await AuthService(db).logout(b)      # the person signed out
    with pytest.raises(HTTPException) as exc:
        await _refresh(sessions, a)
    assert "all sessions revoked" in exc.value.detail
    assert await _live_tokens(sessions, user_id) == 0


async def test_a_signed_out_token_is_never_a_concurrent_refresh(sessions):
    user_id, a = await _signed_in(sessions)
    async with sessions() as db:
        await AuthService(db).logout(a)      # revoked without a successor
    with pytest.raises(HTTPException):
        await _refresh(sessions, a)
    assert await _live_tokens(sessions, user_id) == 0


async def test_grace_can_be_turned_off(sessions, monkeypatch):
    monkeypatch.setattr(get_settings(), "JWT_REFRESH_REUSE_GRACE_S", 0)
    user_id, a = await _signed_in(sessions)
    await _refresh(sessions, a)
    with pytest.raises(HTTPException):
        await _refresh(sessions, a)
    assert await _live_tokens(sessions, user_id) == 0
