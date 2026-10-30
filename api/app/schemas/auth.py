"""Pydantic schemas mirroring src/modules/auth/api/dto/*.ts 1:1."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.common.pagination import PageMeta
from app.models.enums import Role, UserStatus


class LoginDto(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=200, min_length=1)

    @field_validator("email", mode="before")
    @classmethod
    def _trim_email(cls, v):
        return v.strip() if isinstance(v, str) else v

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class RegisterDto(BaseModel):
    email: EmailStr = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=200)
    firstName: Optional[str] = Field(None, max_length=100)
    lastName: Optional[str] = Field(None, max_length=100)
    role: Optional[Role] = None

    @field_validator("email", mode="before")
    @classmethod
    def _trim_email(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def _trim(cls, v):
        return v.strip() if isinstance(v, str) else v

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UpdateUserDto(BaseModel):
    firstName: Optional[str] = Field(None, max_length=100)
    lastName: Optional[str] = Field(None, max_length=100)
    role: Optional[Role] = None
    status: Optional[UserStatus] = None
    # Replaces the person's granted capabilities. Only values in
    # capabilities.USER_GRANTABLE are accepted.
    grantedCapabilities: Optional[list[str]] = None

    @field_validator("grantedCapabilities")
    @classmethod
    def _grantable(cls, v):
        if v is None:
            return v
        from app.common.capabilities import USER_GRANTABLE

        bad = sorted(set(v) - USER_GRANTABLE)
        if bad:
            raise ValueError(f"Not grantable: {', '.join(bad)}. Allowed: {', '.join(sorted(USER_GRANTABLE))}")
        return sorted(set(v))

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def _trim(cls, v):
        return v.strip() if isinstance(v, str) else v

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class QueryUserDto(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(25, ge=1, le=100)
    order: str = Field("desc", pattern="^(asc|desc)$")
    search: Optional[str] = None
    role: Optional[Role] = None
    status: Optional[UserStatus] = None

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class ChangePasswordDto(BaseModel):
    currentPassword: str = Field(..., min_length=1)
    newPassword: str = Field(..., min_length=8, max_length=200)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class RefreshTokenDto(BaseModel):
    refreshToken: str = Field(..., min_length=1)

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}


class UserResponseDto(BaseModel):
    id: str
    email: str
    firstName: Optional[str] = Field(None, validation_alias="first_name")
    lastName: Optional[str] = Field(None, validation_alias="last_name")
    role: Role
    status: UserStatus
    # Extra capabilities granted to this person (e.g. "ticket.manage").
    grantedCapabilities: list[str] = Field(default_factory=list, validation_alias="granted_capabilities")
    lastLoginAt: Optional[dt.datetime] = Field(None, validation_alias="last_login_at")
    createdAt: dt.datetime = Field(..., validation_alias="created_at")

    model_config = {"from_attributes": True, "populate_by_name": True}


class PaginatedUsersDto(BaseModel):
    """GET /users — `{ data, meta }`, same page envelope as every other list."""

    data: list[UserResponseDto]
    meta: PageMeta


class AuthResponseDto(BaseModel):
    accessToken: str
    refreshToken: str
    expiresIn: int
    user: UserResponseDto


class TemporaryPasswordDto(BaseModel):
    """POST /users/:id/reset-password — shown to the admin once."""

    temporaryPassword: str
