"""
FastAPI dependencies mirroring JwtAuthGuard + RolesGuard + @CurrentUser.
Every route requires a valid bearer token by default (get_current_user);
require_capability(...) further restricts by role via the capability matrix.
There is no @Public() decorator equivalent needed — public routes (login,
refresh) simply omit the auth dependency.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import Capability, has_capability
from app.common.security.jwt import decode_access_token
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import UserStatus

_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthenticatedUser:
    id: str
    email: str
    role: str
    # Per-person extra capabilities (auth.user.granted_capabilities).
    grants: tuple[str, ...] = ()

    def can(self, capability: Capability) -> bool:
        return has_capability(self.role, capability, self.grants)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedUser:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    try:
        payload = decode_access_token(credentials.credentials)
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    # A website's /admin editor token (see websites/editor.py) is signed with
    # the same key but is not a staff login.
    if payload.get("typ") == "site-admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive or no longer exists",
        )
    auth_user = AuthenticatedUser(
        id=user.id, email=user.email, role=user.role.value, grants=tuple(user.granted_capabilities or ())
    )
    request.state.user = auth_user
    return auth_user


def require_capability(capability: Capability):
    """Mirrors @RequireCapability(...) + RolesGuard. SUPER_ADMIN always passes."""

    async def _check(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if not user.can(capability):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This action requires a different role or capability",
            )
        return user

    return _check


def require_roles(*roles: str):
    """Mirrors @Roles(...) directly (the escape hatch), for routes not expressed as a capability."""
    role_set = set(roles)

    async def _check(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        from app.models.enums import Role

        if user.role == Role.SUPER_ADMIN.value:
            return user
        if user.role not in role_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of the following roles: {', '.join(role_set)}",
            )
        return user

    return _check
