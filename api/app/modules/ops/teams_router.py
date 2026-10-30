"""Ops CRM ↔ Teams through the Power Automate flow (modules/ops/teams_flow.py).

    GET  /ops/teams/status     is the flow set up, e-mail set up, my Teams address
    POST /ops/teams/test       send a test card to me, or to the alerts channel (admins)
    POST /ops/teams/digest     post the daily digest now (admins)
    POST /ops/teams/meeting    Teams meeting + Outlook invite (ticket managers, or the
                               assignee when it is about their ticket)
"""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import CommentVisibility, UserStatus
from app.models.ops import Ticket, TicketComment, utcnow
from app.modules.ops import digest, notifications, teams_flow

router = APIRouter(
    prefix="/ops/teams", tags=["Ops CRM"], dependencies=[Depends(require_capability("ticket.view"))]
)

_FORBID = {"extra": "forbid"}


class TeamsStatusDto(BaseModel):
    configured: bool
    emailConfigured: bool
    myMicrosoftEmail: str
    timezone: str
    digestHour: int
    canManage: bool


class TeamsTestDto(BaseModel):
    target: Literal["me", "channel"] = "me"

    model_config = _FORBID


class TeamsResultDto(BaseModel):
    ok: bool
    detail: str


class MeetingDto(BaseModel):
    subject: str = Field(..., min_length=1, max_length=250)
    text: Optional[str] = Field(None, max_length=4000)
    start: dt.datetime
    durationMinutes: int = Field(30, ge=15, le=480)
    attendeeIds: list[str] = Field(default_factory=list, max_length=30)
    ticketKey: Optional[str] = Field(None, max_length=40)

    model_config = _FORBID


async def _me(db: AsyncSession, user: AuthenticatedUser) -> User:
    u = await db.get(User, user.id)
    if not u:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found")
    return u


def _need_flow() -> None:
    if not teams_flow.configured():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teams isn't connected yet: add OPS_TEAMS_FLOW_URL and OPS_TEAMS_FLOW_SECRET to the API settings.",
        )


def _result(ok: Optional[bool], sent: str) -> TeamsResultDto:
    if ok:
        return TeamsResultDto(ok=True, detail=sent)
    return TeamsResultDto(ok=False, detail="The Teams flow didn't accept it. Check the flow's run history in Power Automate.")


@router.get("/status", response_model=TeamsStatusDto)
async def teams_status(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    from app.config import get_settings

    me = await _me(db, user)
    addr = teams_flow.microsoft_email(me)
    s = get_settings()
    return TeamsStatusDto(
        configured=teams_flow.configured(),
        emailConfigured=notifications.email_configured(),
        myMicrosoftEmail=addr,
        timezone=s.OPS_TEAMS_TIMEZONE,
        digestHour=s.OPS_DIGEST_HOUR,
        canManage=user.can("settings.manage"),
    )


@router.post("/test", response_model=TeamsResultDto)
async def teams_test(
    dto: TeamsTestDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    _need_flow()
    if dto.target == "channel":
        if not user.can("settings.manage"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can post a test to the channel")
        ok = await teams_flow.channel(
            "Test from the Super App", "The Ops alerts channel is connected.", "/settings/integrations"
        )
        return _result(ok, "Posted to the Ops alerts channel.")
    me = await _me(db, user)
    to = teams_flow.microsoft_email(me)
    ok = await teams_flow.dm(
        to, "Test from the Super App", "Ticket alerts will arrive in this chat.", "/settings/notifications"
    )
    return _result(ok, f"Sent to {to} in Teams.")


@router.post("/digest", response_model=TeamsResultDto, dependencies=[Depends(require_capability("settings.manage"))])
async def teams_digest(db: AsyncSession = Depends(get_db)):
    _need_flow()
    ok = await digest.post_now(db)
    return _result(ok, "Today's digest was posted to the Ops alerts channel.")


@router.post("/meeting", response_model=TeamsResultDto)
async def teams_meeting(
    dto: MeetingDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    _need_flow()
    ticket: Optional[Ticket] = None
    if dto.ticketKey:
        from app.modules.ops.router import _load_ticket

        ticket = await _load_ticket(db, dto.ticketKey)
    if not (user.can("ticket.manage") or (ticket is not None and ticket.assignee_id == user.id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only ticket managers, or the ticket's assignee, can book a Teams meeting",
        )
    if dto.start.tzinfo is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start time needs a time zone")
    if dto.start < utcnow() - dt.timedelta(minutes=5):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pick a start time in the future")
    ids = list(dict.fromkeys(dto.attendeeIds))
    people = (
        list((await db.execute(select(User).where(User.id.in_(ids), User.status == UserStatus.ACTIVE))).scalars().all())
        if ids
        else []
    )
    if len(people) != len(ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Someone in the list isn't an active user")
    me = await _me(db, user)
    attendees = [teams_flow.microsoft_email(p) for p in people if p.id != me.id]
    if not attendees:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add at least one other person")
    end = dto.start + dt.timedelta(minutes=dto.durationMinutes)
    text = dto.text or ""
    if ticket is not None:
        text = (text + "\n\n" if text else "") + f"Ticket: {teams_flow.app_url(f'/ops/tickets/{ticket.key}')}"
    ok = await teams_flow.meeting(dto.subject, text, dto.start, end, attendees)
    if ok:
        from app.modules.ops.availability import record_booked_meeting

        await record_booked_meeting(db, subject=dto.subject, start=dto.start, end=end, organizer=me,
                                    attendees=attendees, ticket=ticket, text=dto.text)
        await db.commit()
    if ok and ticket is not None:
        local = dto.start.astimezone(teams_flow.flow_timezone())
        db.add(
            TicketComment(
                ticket_id=ticket.id,
                author_id=user.id,
                body=f"Booked a Teams meeting “{dto.subject}” for {local.strftime('%a %d %b, %I:%M %p')} "
                f"({dto.durationMinutes} min) with {', '.join(attendees)}.",
                visibility=CommentVisibility.INTERNAL,
                mentions=[],
            )
        )
        ticket.updated_at = utcnow()
        await db.commit()
    return _result(ok, f"Teams meeting booked; invites sent to {len(attendees)} people.")
