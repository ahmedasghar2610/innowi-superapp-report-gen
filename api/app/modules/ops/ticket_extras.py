"""Ticket attachments, watchers and the notification bell.

    GET    /ops/tickets/{key}/attachments
    POST   /ops/tickets/{key}/attachments            multipart `file` — anyone on staff
    GET    /ops/attachments/{id}/download             ?inline=1 shows images in the page
    DELETE /ops/attachments/{id}                      the uploader or a ticket manager

    POST   /ops/tickets/{key}/watchers                {userId?} — yourself; others: ticket managers
    DELETE /ops/tickets/{key}/watchers/{userId|me}    yourself; others: ticket managers

    GET    /ops/notifications                         ?unread=true — newest first, plus the unread count
    POST   /ops/notifications/read                    {ids: [...]} or {all: true}
"""
from __future__ import annotations

import datetime as dt
import mimetypes
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.storage.local_disk import get_storage
from app.common.storage.port import PutFileInput
from app.common.storage.upload_helpers import read_upload_within_limit, stream_file_response
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import NotificationKind, TicketEventKind
from app.models.ops import Notification, Ticket, TicketAttachment, TicketWatcher, utcnow
from app.modules.ops import alerts
from app.schemas.ops import PersonRefDto

router = APIRouter(prefix="/ops", tags=["Ops CRM — Tickets"], dependencies=[Depends(require_capability("ticket.view"))])

# Files that run code when opened. Everything else is allowed and is always
# downloaded (never rendered) except the image types below.
BLOCKED_EXT = {
    ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".pif", ".vbs", ".vbe", ".js", ".jse", ".ws", ".wsf",
    ".ps1", ".psm1", ".sh", ".jar", ".apk", ".dll", ".lnk", ".reg", ".hta", ".cpl",
}
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_ATTACHMENTS = 50


class AttachmentDto(BaseModel):
    id: str
    fileName: str
    contentType: Optional[str] = None
    sizeBytes: int
    isImage: bool
    uploadedBy: Optional[PersonRefDto] = None
    createdAt: dt.datetime
    downloadPath: str
    canDelete: bool


class WatchersDto(BaseModel):
    data: list[PersonRefDto]
    watching: bool


class AddWatcherDto(BaseModel):
    userId: Optional[str] = None

    model_config = {"extra": "forbid"}


class NotificationDto(BaseModel):
    id: str
    kind: NotificationKind
    title: str
    body: Optional[str] = None
    ticketKey: Optional[str] = None
    # Set for notices that aren't about a ticket (e.g. a request): where to open.
    link: Optional[str] = None
    actor: Optional[str] = None
    read: bool
    createdAt: dt.datetime


class NotificationsDto(BaseModel):
    data: list[NotificationDto]
    unread: int


class MarkReadDto(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=200)
    all: bool = False

    model_config = {"extra": "forbid"}


def _name(u: User) -> str:
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def _ref(u: Optional[User]) -> Optional[PersonRefDto]:
    return PersonRefDto(id=u.id, name=_name(u), email=u.email) if u else None


async def _ticket(db: AsyncSession, key: str) -> Ticket:
    from app.modules.ops.router import _load_ticket

    return await _load_ticket(db, key)


# ----------------------------------------------------------- attachments ----
async def attachment_dtos(db: AsyncSession, ticket_id: str, user: AuthenticatedUser) -> list[AttachmentDto]:
    rows = (
        await db.execute(select(TicketAttachment).where(TicketAttachment.ticket_id == ticket_id).order_by(TicketAttachment.created_at))
    ).scalars().all()
    ids = {a.uploaded_by_id for a in rows if a.uploaded_by_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids or {""})))).scalars()}
    manager = user.can("ticket.manage")
    return [
        AttachmentDto(
            id=a.id,
            fileName=a.file_name,
            contentType=a.content_type,
            sizeBytes=a.size_bytes,
            isImage=(a.content_type or "") in INLINE_TYPES,
            uploadedBy=_ref(users.get(a.uploaded_by_id)),
            createdAt=a.created_at,
            downloadPath=f"/ops/attachments/{a.id}/download",
            canDelete=manager or a.uploaded_by_id == user.id,
        )
        for a in rows
    ]


@router.get("/tickets/{key}/attachments", response_model=list[AttachmentDto])
async def list_attachments(key: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    t = await _ticket(db, key)
    return await attachment_dtos(db, t.id, user)


@router.post("/tickets/{key}/attachments", response_model=AttachmentDto, status_code=201)
async def upload_attachment(
    key: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Anyone who can see tickets can attach (like commenting)."""
    from app.modules.ops.router import _event, _mark_response

    t = await _ticket(db, key)
    name = os.path.basename((file.filename or "file").replace("\\", "/")).strip()[:255] or "file"
    if os.path.splitext(name)[1].lower() in BLOCKED_EXT:
        raise HTTPException(status_code=400, detail="That file type can't be attached (programs and scripts aren't allowed)")
    count = (await db.execute(select(func.count()).select_from(TicketAttachment).where(TicketAttachment.ticket_id == t.id))).scalar_one()
    if count >= MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"A ticket can have at most {MAX_ATTACHMENTS} attachments")
    data = await read_upload_within_limit(file)
    ctype = (file.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream")[:120]
    stored = await get_storage().put(PutFileInput(buffer=data, original_name=name, mime_type=ctype, scope=f"tickets/{t.id}"))
    a = TicketAttachment(ticket_id=t.id, file_name=name, content_type=ctype, size_bytes=stored.size_bytes, storage_key=stored.key, uploaded_by_id=user.id)
    db.add(a)
    _event(db, t, user, TicketEventKind.ATTACHMENT_ADDED, {"name": name})
    _mark_response(t, user)
    t.updated_at = utcnow()
    await db.commit()
    return next(x for x in await attachment_dtos(db, t.id, user) if x.id == a.id)


async def _attachment(db: AsyncSession, attachment_id: str) -> TicketAttachment:
    a = await db.get(TicketAttachment, attachment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return a


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: str, inline: bool = False, db: AsyncSession = Depends(get_db)):
    a = await _attachment(db, attachment_id)
    f = await get_storage().open(a.storage_key)
    if not f:
        raise HTTPException(status_code=404, detail="The file is missing from storage")
    resp = stream_file_response(f, a.file_name, a.content_type)
    if inline and (a.content_type or "") in INLINE_TYPES:
        resp.headers["Content-Disposition"] = resp.headers["Content-Disposition"].replace("attachment;", "inline;", 1)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@router.delete("/attachments/{attachment_id}", status_code=204)
async def delete_attachment(attachment_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    from app.modules.ops.router import _event

    a = await _attachment(db, attachment_id)
    if not (user.can("ticket.manage") or a.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the person who added it or a ticket manager can remove an attachment")
    t = await db.get(Ticket, a.ticket_id)
    key = a.storage_key
    await db.delete(a)
    if t:
        _event(db, t, user, TicketEventKind.ATTACHMENT_REMOVED, {"name": a.file_name})
        t.updated_at = utcnow()
    await db.commit()
    try:
        await get_storage().delete(key)
    except Exception:  # the row is gone; a stray file is harmless
        pass
    return Response(status_code=204)


# -------------------------------------------------------------- watchers ----
async def watchers_dto(db: AsyncSession, ticket_id: str, user_id: str) -> WatchersDto:
    users = (
        await db.execute(
            select(User).join(TicketWatcher, TicketWatcher.user_id == User.id).where(TicketWatcher.ticket_id == ticket_id).order_by(TicketWatcher.created_at)
        )
    ).scalars().all()
    return WatchersDto(data=[_ref(u) for u in users], watching=any(u.id == user_id for u in users))


async def add_watcher(db: AsyncSession, ticket_id: str, user_id: str, added_by: Optional[str]) -> None:
    from sqlalchemy.dialects.postgresql import insert

    await db.execute(
        insert(TicketWatcher).values(ticket_id=ticket_id, user_id=user_id, added_by_id=added_by, created_at=utcnow()).on_conflict_do_nothing()
    )


@router.post("/tickets/{key}/watchers", response_model=WatchersDto)
async def watch(key: str, dto: AddWatcherDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    t = await _ticket(db, key)
    target = dto.userId or user.id
    if target != user.id and not user.can("ticket.manage"):
        raise HTTPException(status_code=403, detail="Only ticket managers can add other people as watchers")
    u = await db.get(User, target)
    if not u:
        raise HTTPException(status_code=400, detail="User not found")
    await add_watcher(db, t.id, target, user.id)
    await db.commit()
    return await watchers_dto(db, t.id, user.id)


@router.delete("/tickets/{key}/watchers/{user_id}", response_model=WatchersDto)
async def unwatch(key: str, user_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    t = await _ticket(db, key)
    target = user.id if user_id == "me" else user_id
    if target != user.id and not user.can("ticket.manage"):
        raise HTTPException(status_code=403, detail="Only ticket managers can remove other watchers")
    w = await db.get(TicketWatcher, (t.id, target))
    if w:
        await db.delete(w)
        await db.commit()
    return await watchers_dto(db, t.id, user.id)


# --------------------------------------------------------- notifications ----
@router.get("/notifications", response_model=NotificationsDto)
async def my_notifications(
    unread: bool = False,
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    await alerts.scan_if_due(db)
    conds = [Notification.user_id == user.id]
    if unread:
        conds.append(Notification.read_at.is_(None))
    rows = (
        await db.execute(select(Notification).where(*conds).order_by(Notification.created_at.desc()).limit(limit))
    ).scalars().all()
    unread_count = (
        await db.execute(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)))
    ).scalar_one()
    tickets = {t.id: t for t in (await db.execute(select(Ticket).where(Ticket.id.in_({n.ticket_id for n in rows if n.ticket_id} or {""})))).scalars()}
    actors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_({n.actor_id for n in rows if n.actor_id} or {""})))).scalars()}
    return NotificationsDto(
        data=[
            NotificationDto(
                id=n.id,
                kind=n.kind,
                title=n.title,
                body=n.body,
                ticketKey=tickets[n.ticket_id].key if n.ticket_id in tickets else None,
                link=n.link,
                actor=_name(actors[n.actor_id]) if n.actor_id in actors else None,
                read=n.read_at is not None,
                createdAt=n.created_at,
            )
            for n in rows
        ],
        unread=unread_count,
    )


@router.post("/notifications/read", status_code=204)
async def mark_read(dto: MarkReadDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    stmt = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if not dto.all:
        if not dto.ids:
            return Response(status_code=204)
        stmt = stmt.where(Notification.id.in_(dto.ids))
    await db.execute(stmt.values(read_at=utcnow()))
    await db.commit()
    return Response(status_code=204)
