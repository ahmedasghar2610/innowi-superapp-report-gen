"""auth schema — User, RefreshToken. Mirrors schema.prisma `@@schema("auth")`."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import Role, UserStatus

SCHEMA = "auth"


class User(Base):
    __tablename__ = "user"
    __table_args__ = (
        Index("ix_auth_user_role", "role"),
        Index("ix_auth_user_status", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column("password_hash", String, nullable=False)
    first_name: Mapped[Optional[str]] = mapped_column("first_name", String, nullable=True)
    last_name: Mapped[Optional[str]] = mapped_column("last_name", String, nullable=True)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="Role", schema=SCHEMA, native_enum=True), nullable=False,
        default=Role.MARKETING_EXECUTIVE,
    )
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="UserStatus", schema=SCHEMA, native_enum=True), nullable=False,
        default=UserStatus.ACTIVE,
    )

    # Capabilities granted to this one person on top of their role — e.g.
    # "ticket.manage" for the two people allowed to create tickets. Only
    # capabilities listed in common/capabilities.USER_GRANTABLE are honoured.
    granted_capabilities: Mapped[list[str]] = mapped_column(
        "granted_capabilities", ARRAY(String), nullable=False, default=list, server_default=text("'{}'")
    )

    # Personal settings (Settings → Profile / Notifications): start page and
    # notification choices. Shape: app/modules/settings/schemas.Preferences.
    preferences: Mapped[dict] = mapped_column(
        "preferences", JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    last_login_at: Mapped[Optional[dt.datetime]] = mapped_column("last_login_at", DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[Optional[dt.datetime]] = mapped_column(
        "password_changed_at", DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_token"
    __table_args__ = (
        Index("ix_auth_refresh_token_user_id", "user_id"),
        Index("ix_auth_refresh_token_expires_at", "expires_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column("user_id", ForeignKey(f"{SCHEMA}.user.id", ondelete="CASCADE"), nullable=False)
    user: Mapped["User"] = relationship(back_populates="refresh_tokens")

    token_hash: Mapped[str] = mapped_column("token_hash", String, unique=True, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column("expires_at", DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[dt.datetime]] = mapped_column("revoked_at", DateTime(timezone=True), nullable=True)
    replaced_by: Mapped[Optional[str]] = mapped_column("replaced_by", String, nullable=True)

    ip: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column("user_agent", String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Invitation(Base):
    """An e-mailed invite to join the Super App with a given role. The person
    opens the link, picks their own name + password, and becomes a User.
    Only a SHA-256 of the token is stored; the raw token exists only in the link."""

    __tablename__ = "invitation"
    __table_args__ = (
        Index("ix_auth_invitation_email", "email"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    email: Mapped[str] = mapped_column(String, nullable=False)
    # Plain string (validated against Role in code) so the migration needn't touch the enum type's schema.
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column("token_hash", String(64), unique=True, nullable=False)
    invited_by: Mapped[Optional[str]] = mapped_column("invited_by", String, nullable=True)
    expires_at: Mapped[dt.datetime] = mapped_column("expires_at", DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[Optional[dt.datetime]] = mapped_column("accepted_at", DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[dt.datetime]] = mapped_column("revoked_at", DateTime(timezone=True), nullable=True)
    emailed_at: Mapped[Optional[dt.datetime]] = mapped_column("emailed_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LeadRouting(Base):
    """Per-person partner-lead switches, keyed by e-mail so an invitation's settings
    carry over when it is accepted. `assignable` None = the role's default (on for
    Sales Manager / Sales Executive, off for admins). Who is on the team at all is
    decided by the SQL function auth.lead_team() (see migration b2c3d4e5f6a8)."""

    __tablename__ = "lead_routing"
    __table_args__ = {"schema": SCHEMA}

    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    assignable: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    receives_new_leads: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(String(254), nullable=True)
