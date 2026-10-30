"""Invitations.

Admin (users.manage):
  POST   /invitations              {email, role}  → creates the invite, e-mails the link, returns it too
  GET    /invitations              pending invites
  POST   /invitations/{id}/resend  new link (the old one stops working), e-mailed again
  DELETE /invitations/{id}         revoke
Public (the person invited):
  GET    /auth/invitations/{token}         who/which role the link is for
  POST   /auth/invitations/accept          {token, password, firstName, lastName} → account created

Only a SHA-256 of the token is stored. The link is returned to the admin on
create/resend (so it can be copied and sent by hand while e-mail isn't set up)
and is never retrievable again afterwards.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
import secrets
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, require_capability
from app.common.security.throttle import FailureThrottle
from app.config import get_settings
from app.db.session import get_db
from app.models.auth import Invitation, User
from app.models.enums import Role
from app.modules.auth.service import UserService
from app.schemas.auth import RegisterDto

logger = logging.getLogger("Invitations")

INVITE_TTL = dt.timedelta(days=7)
INVITABLE_ROLES = {Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE, Role.SALES_EXECUTIVE, Role.SALES_MANAGER}

# Wrong/expired tokens per client IP: 20 in 10 minutes. The token is 256 random
# bits, so this only blunts noise; it is not what keeps links unguessable.
invite_throttle = FailureThrottle(limit=20, window_seconds=600)

admin_router = APIRouter(prefix="/invitations", tags=["Invitations"], dependencies=[Depends(require_capability("users.manage"))])
public_router = APIRouter(prefix="/auth/invitations", tags=["Invitations"])


# ── DTOs ──────────────────────────────────────────────────────────────────
class CreateInvitationDto(BaseModel):
    email: EmailStr = Field(..., max_length=255)
    role: Role

    model_config = {"extra": "forbid"}

    @field_validator("email", mode="before")
    @classmethod
    def _trim(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class InvitationDto(BaseModel):
    id: str
    email: str
    role: str
    invitedBy: Optional[str] = Field(None, validation_alias="invited_by")
    expiresAt: dt.datetime = Field(..., validation_alias="expires_at")
    emailedAt: Optional[dt.datetime] = Field(None, validation_alias="emailed_at")
    createdAt: dt.datetime = Field(..., validation_alias="created_at")

    model_config = {"from_attributes": True, "populate_by_name": True}


class InvitationCreatedDto(BaseModel):
    invitation: InvitationDto
    inviteUrl: str
    emailed: bool


class InvitationListDto(BaseModel):
    data: list[InvitationDto]


class InvitationPreviewDto(BaseModel):
    email: str
    role: str
    expiresAt: dt.datetime


class AcceptInvitationDto(BaseModel):
    token: str = Field(..., min_length=20, max_length=200)
    password: str = Field(..., min_length=8, max_length=200)
    firstName: Optional[str] = Field(None, max_length=100)
    lastName: Optional[str] = Field(None, max_length=100)

    model_config = {"extra": "forbid"}


class AcceptedDto(BaseModel):
    email: str


# ── helpers ───────────────────────────────────────────────────────────────
def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def invite_url(token: str) -> str:
    return f"{get_settings().APP_WEB_URL.rstrip('/')}/invite?token={token}"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def is_usable(inv: Invitation, now: Optional[dt.datetime] = None) -> bool:
    now = now or _now()
    return inv.accepted_at is None and inv.revoked_at is None and inv.expires_at > now


def _post_json(url: str, apikey: str, payload: dict, timeout: float) -> int:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "apikey": apikey}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 — fixed https URL from settings
        return res.status


async def send_invite_email(invitation_id: str, token: str, url: str) -> bool:
    """Ask the Supabase function to e-mail the link. It re-checks the token against the
    stored hash, so it can't be used to e-mail anyone else. Never raises."""
    settings = get_settings()
    if not settings.INVITE_EMAIL_URL:
        return False
    try:
        code = await asyncio.to_thread(
            _post_json, settings.INVITE_EMAIL_URL, settings.PARTNER_LEADS_NOTIFY_APIKEY,
            {"invitation_id": invitation_id, "token": token, "invite_url": url}, 15.0,
        )
        return 200 <= code < 300
    except Exception as e:
        logger.warning("Invitation %s: e-mail failed: %s", invitation_id, e)
        return False


async def _issue(db: AsyncSession, inv: Invitation) -> InvitationCreatedDto:
    token, token_hash = new_token()
    inv.token_hash = token_hash
    inv.expires_at = _now() + INVITE_TTL
    inv.emailed_at = None
    await db.commit()
    await db.refresh(inv)
    url = invite_url(token)
    emailed = await send_invite_email(inv.id, token, url)
    if emailed:
        await db.refresh(inv)
    return InvitationCreatedDto(invitation=InvitationDto.model_validate(inv), inviteUrl=url, emailed=emailed)


# ── admin ─────────────────────────────────────────────────────────────────
@admin_router.post("", response_model=InvitationCreatedDto, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    dto: CreateInvitationDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(require_capability("users.manage")),
):
    if dto.role not in INVITABLE_ROLES:
        raise HTTPException(status_code=400, detail="That role can't be given by invitation")
    email = str(dto.email).lower()
    if (await db.execute(select(User).where(User.email == email))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Someone with this email already has an account")
    # One live invite per address: older pending ones stop working.
    for old in (await db.execute(select(Invitation).where(Invitation.email == email))).scalars():
        if is_usable(old):
            old.revoked_at = _now()
    inv = Invitation(email=email, role=dto.role.value, invited_by=user.email, token_hash=secrets.token_hex(32), expires_at=_now())
    db.add(inv)
    await db.flush()
    return await _issue(db, inv)


@admin_router.get("", response_model=InvitationListDto)
async def list_invitations(db: AsyncSession = Depends(get_db)):
    now = _now()
    rows = (await db.execute(select(Invitation).order_by(Invitation.created_at.desc()))).scalars().all()
    return InvitationListDto(data=[InvitationDto.model_validate(r) for r in rows if is_usable(r, now)])


async def _get_pending(db: AsyncSession, invitation_id: str) -> Invitation:
    inv = await db.get(Invitation, invitation_id)
    if not inv or inv.accepted_at is not None or inv.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    return inv


@admin_router.post("/{id}/resend", response_model=InvitationCreatedDto)
async def resend_invitation(id: str, db: AsyncSession = Depends(get_db)):
    inv = await _get_pending(db, id)
    return await _issue(db, inv)


@admin_router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(id: str, db: AsyncSession = Depends(get_db)):
    inv = await _get_pending(db, id)
    inv.revoked_at = _now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── public (the invited person) ──────────────────────────────────────────
async def _by_token(db: AsyncSession, token: str, request: Request) -> Invitation:
    ip = request.client.host if request.client else "-"
    if invite_throttle.is_blocked(ip):
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    inv = (await db.execute(select(Invitation).where(Invitation.token_hash == hash_token(token)))).scalar_one_or_none()
    if not inv or not is_usable(inv):
        invite_throttle.record_failure(ip)
        raise HTTPException(status_code=404, detail="This invitation link isn't valid any more. Ask an admin for a new one.")
    return inv


@public_router.get("/{token}", response_model=InvitationPreviewDto)
async def preview_invitation(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    inv = await _by_token(db, token, request)
    return InvitationPreviewDto(email=inv.email, role=inv.role, expiresAt=inv.expires_at)


@public_router.post("/accept", response_model=AcceptedDto, status_code=status.HTTP_201_CREATED)
async def accept_invitation(dto: AcceptInvitationDto, request: Request, db: AsyncSession = Depends(get_db)):
    inv = await _by_token(db, dto.token, request)
    await UserService(db).create(
        RegisterDto(email=inv.email, password=dto.password, firstName=dto.firstName, lastName=dto.lastName, role=Role(inv.role))
    )
    inv.accepted_at = _now()
    await db.commit()
    return AcceptedDto(email=inv.email)
