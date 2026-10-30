"""Port of auth.service.ts + user.service.ts + password.service.ts."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.pagination import PageMeta
from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password, verify_password
from app.config import get_settings
from app.models.auth import RefreshToken, User
from app.models.enums import Role, UserStatus
from app.schemas.auth import (
    AuthResponseDto,
    ChangePasswordDto,
    QueryUserDto,
    RegisterDto,
    UpdateUserDto,
    UserResponseDto,
)


def to_user_response(user: User) -> UserResponseDto:
    return UserResponseDto.model_validate(user)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def login(self, email: str, password: str, ip: Optional[str] = None, user_agent: Optional[str] = None) -> AuthResponseDto:
        # Emails are stored lower-cased (UserService.create), and the Nest
        # repository looked up with `email.toLowerCase()`. Without this, a user
        # who types "Marketing@Innowi.com" can never log in.
        result = await self.db.execute(select(User).where(User.email == email.lower()))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        if user.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive or suspended")
        if not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

        user.last_login_at = datetime.now(timezone.utc)
        await self.db.flush()

        return await self._issue_tokens(user, ip, user_agent)

    async def refresh(self, raw_token: str, ip: Optional[str] = None, user_agent: Optional[str] = None) -> AuthResponseDto:
        token_hash = _hash_token(raw_token)
        result = await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        stored = result.scalar_one_or_none()

        if not stored:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
        if stored.revoked_at:
            if await self._is_concurrent_refresh(stored):
                # Same browser, several requests refreshing at once: give this
                # one its own fresh pair; the first rotation stays valid too.
                user = await self.db.get(User, stored.user_id)
                if not user or user.status != UserStatus.ACTIVE:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive or no longer exists")
                tokens = await self._issue_tokens(user, ip, user_agent)
                await self.db.commit()
                return tokens
            await self._revoke_all_for_user(stored.user_id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token has already been used; all sessions revoked",
            )
        if stored.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")

        user = await self.db.get(User, stored.user_id)
        if not user or user.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive or no longer exists")

        tokens = await self._issue_tokens(user, ip, user_agent)

        new_hash = _hash_token(tokens.refreshToken)
        stored.revoked_at = datetime.now(timezone.utc)
        stored.replaced_by = new_hash
        # MUST commit: get_db() never commits on its own, so a bare flush() here
        # left the rotated token un-revoked and infinitely replayable.
        await self.db.commit()

        return tokens

    async def _is_concurrent_refresh(self, stored: RefreshToken) -> bool:
        """A revoked token counts as a concurrent refresh, not theft, only if it
        was ROTATED (not signed out) within the grace window and the session it
        was rotated into is still signed in."""
        grace = get_settings().JWT_REFRESH_REUSE_GRACE_S
        if not grace or not stored.replaced_by or not stored.revoked_at:
            return False
        if datetime.now(timezone.utc) - stored.revoked_at > timedelta(seconds=grace):
            return False
        successor = (await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == stored.replaced_by)
        )).scalar_one_or_none()
        return successor is not None and successor.revoked_at is None

    async def logout(self, raw_token: str) -> None:
        token_hash = _hash_token(raw_token)
        result = await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        stored = result.scalar_one_or_none()
        if stored and not stored.revoked_at:
            stored.revoked_at = datetime.now(timezone.utc)
            await self.db.commit()

    async def logout_all(self, user_id: str) -> None:
        await self._revoke_all_for_user(user_id)

    async def _revoke_all_for_user(self, user_id: str) -> None:
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        )
        now = datetime.now(timezone.utc)
        for token in result.scalars():
            token.revoked_at = now
        await self.db.commit()

    async def _issue_tokens(self, user: User, ip: Optional[str], user_agent: Optional[str]) -> AuthResponseDto:
        settings = get_settings()
        payload = {"sub": user.id, "email": user.email, "role": user.role.value}
        access_token, expires_in = create_access_token(payload)

        refresh_token = secrets.token_hex(64)
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)

        self.db.add(
            RefreshToken(
                user_id=user.id,
                token_hash=_hash_token(refresh_token),
                expires_at=expires_at,
                ip=ip,
                user_agent=user_agent,
            )
        )
        await self.db.commit()
        await self.db.refresh(user)

        return AuthResponseDto(
            accessToken=access_token,
            refreshToken=refresh_token,
            expiresIn=expires_in,
            user=to_user_response(user),
        )


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, dto: RegisterDto) -> UserResponseDto:
        email = dto.email.lower()
        result = await self.db.execute(select(User).where(User.email == email))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

        user = User(
            email=email,
            password_hash=hash_password(dto.password),
            first_name=dto.firstName,
            last_name=dto.lastName,
            role=dto.role or Role.MARKETING_EXECUTIVE,
            password_changed_at=datetime.now(timezone.utc),
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return to_user_response(user)

    async def find_all(self, query: QueryUserDto) -> dict:
        stmt = select(User)
        count_stmt = select(func.count()).select_from(User)

        if query.search:
            like = f"%{query.search}%"
            cond = or_(User.email.ilike(like), User.first_name.ilike(like), User.last_name.ilike(like))
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        if query.role:
            stmt = stmt.where(User.role == query.role)
            count_stmt = count_stmt.where(User.role == query.role)
        if query.status:
            stmt = stmt.where(User.status == query.status)
            count_stmt = count_stmt.where(User.status == query.status)

        order_col = User.created_at.desc() if query.order == "desc" else User.created_at.asc()
        stmt = stmt.order_by(order_col).offset(query.skip).limit(query.limit)

        total = (await self.db.execute(count_stmt)).scalar_one()
        rows = (await self.db.execute(stmt)).scalars().all()

        return {
            "data": [to_user_response(u) for u in rows],
            "meta": PageMeta.build(query.page, query.limit, total),
        }

    async def find_one(self, user_id: str) -> UserResponseDto:
        user = await self.db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return to_user_response(user)

    async def find_one_raw(self, user_id: str) -> Optional[dict]:
        user = await self.db.get(User, user_id)
        if not user:
            return None
        return to_user_response(user).model_dump(mode="json")

    async def update(self, user_id: str, dto: UpdateUserDto, actor_role: Optional[str] = None) -> UserResponseDto:
        user = await self.db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        if user.role == Role.SUPER_ADMIN and dto.role and dto.role != Role.SUPER_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change the role of a Super Admin")
        # Only a Super Admin may make someone a Super Admin, or turn a Super Admin's login off.
        actor_is_super = (actor_role.value if isinstance(actor_role, Role) else actor_role) == Role.SUPER_ADMIN.value
        if not actor_is_super:
            if dto.role == Role.SUPER_ADMIN:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can make someone a Super Admin")
            if user.role == Role.SUPER_ADMIN and dto.status is not None:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can change a Super Admin's login")

        if dto.firstName is not None:
            user.first_name = dto.firstName
        if dto.lastName is not None:
            user.last_name = dto.lastName
        if dto.role is not None:
            user.role = dto.role
        if dto.status is not None:
            user.status = dto.status
        if dto.grantedCapabilities is not None:
            user.granted_capabilities = dto.grantedCapabilities

        await self.db.flush()

        if dto.status in (UserStatus.SUSPENDED, UserStatus.INACTIVE):
            await AuthService(self.db)._revoke_all_for_user(user_id)

        await self.db.commit()
        await self.db.refresh(user)
        return to_user_response(user)

    async def remove(self, user_id: str) -> None:
        user = await self.db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if user.role == Role.SUPER_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete a Super Admin")
        await AuthService(self.db)._revoke_all_for_user(user_id)
        await self.db.delete(user)
        await self.db.commit()

    async def reset_password(self, user_id: str) -> str:
        """New random temporary password; every session is signed out."""
        user = await self.db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        temp = "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))
        user.password_hash = hash_password(temp)
        user.password_changed_at = datetime.now(timezone.utc)
        await self.db.flush()
        await AuthService(self.db)._revoke_all_for_user(user_id)
        await self.db.commit()
        return temp

    async def change_password(self, user_id: str, dto: ChangePasswordDto) -> None:
        user = await self.db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if not verify_password(dto.currentPassword, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
        if dto.currentPassword == dto.newPassword:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be different from the current password",
            )
        user.password_hash = hash_password(dto.newPassword)
        user.password_changed_at = datetime.now(timezone.utc)
        await self.db.flush()
        await AuthService(self.db)._revoke_all_for_user(user_id)
        await self.db.commit()
