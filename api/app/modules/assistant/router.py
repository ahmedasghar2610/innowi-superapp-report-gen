"""HTTP side of the assistant.

POST /assistant/chat streams one answer as server-sent events
(text/event-stream): `chat` (the chat id, first), then any of `status`,
`text`, `chart`, and finally exactly one of `done` or `error`. The question
and the answer are saved to the person's chat afterwards, and one usage row
is written per question.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from contextlib import aclosing
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

import anyio
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, require_capability
from app.config import get_settings
from app.db.session import SessionLocal, get_db
from app.models.assistant import AssistantAction, AssistantChat, AssistantUsage
from app.models.auth import User
from app.models.common import cuid
from app.modules.assistant import actions, engine, registry
from app.modules.assistant.provider import MessagesApiProvider, Provider
from app.modules.assistant.tools_base import Ctx

logger = logging.getLogger("Assistant")
router = APIRouter(prefix="/assistant", tags=["assistant"])
_use = require_capability("assistant.use")

HISTORY_MESSAGES = 20
HISTORY_CHARS = 24_000
MAX_SAVED_MESSAGES = 200


# ---------------------------------------------------------------- DTOs ----
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    chatId: Optional[str] = Field(default=None, max_length=30)
    voice: bool = False


class ChatBriefDto(BaseModel):
    id: str
    title: str
    pinned: bool
    updatedAt: dt.datetime


class ChatDto(ChatBriefDto):
    messages: list[dict[str, Any]]


class ChatPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    pinned: Optional[bool] = None


class StatusDto(BaseModel):
    configured: bool
    provider: str
    model: Optional[str] = None
    dailyLimit: int
    usedToday: int
    areas: list[str]
    salesScope: Optional[Literal["all", "own", "unlinked"]] = None
    firstName: Optional[str] = None


# ------------------------------------------------------------- helpers ----
def make_provider() -> Optional[Provider]:
    """The configured model backend, or None when it isn't set up. Tests replace this."""
    s = get_settings()
    if s.ASSISTANT_PROVIDER == "messages-api" and s.ASSISTANT_API_KEY and s.ASSISTANT_API_URL and s.ASSISTANT_MODEL:
        return MessagesApiProvider(api_key=s.ASSISTANT_API_KEY, model=s.ASSISTANT_MODEL, base_url=s.ASSISTANT_API_URL,
                                   extra_headers=s.ASSISTANT_API_HEADERS)
    return None


def _day_start_utc() -> dt.datetime:
    tz = ZoneInfo(get_settings().SALES_TIMEZONE)
    now = dt.datetime.now(tz)
    return dt.datetime.combine(now.date(), dt.time.min, tzinfo=tz)


async def _used_today(db: AsyncSession, user_id: str) -> int:
    return (await db.execute(
        select(func.count()).select_from(AssistantUsage)
        .where(AssistantUsage.user_id == user_id, AssistantUsage.created_at >= _day_start_utc())
    )).scalar_one()


def _title(question: str) -> str:
    one_line = " ".join(question.split())
    return one_line if len(one_line) <= 60 else one_line[:57].rstrip() + "…"


def _history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Earlier turns as plain text for the model (lookups are re-run when needed)."""
    turns: list[dict[str, Any]] = []
    for msg in messages[-HISTORY_MESSAGES:]:
        parts = []
        for b in msg.get("blocks") or []:
            if b.get("type") == "text" and b.get("text"):
                parts.append(b["text"])
            elif b.get("type") == "chart":
                parts.append(f"[Chart shown: {(b.get('chart') or {}).get('title', '')}]")
            elif b.get("type") == "action":
                a = b.get("action") or {}
                # Only the kind, size and outcome - never the title, which quotes record text.
                parts.append(f"[Proposed action {a.get('name', '')} ({len(a.get('items') or [])} item(s)) - "
                             f"status: {a.get('status', '')}]")
        text = "\n\n".join(parts).strip()
        if not text:
            continue
        role = "assistant" if msg.get("role") == "assistant" else "user"
        if turns and turns[-1]["role"] == role:
            turns[-1]["content"] += "\n\n" + text
        else:
            turns.append({"role": role, "content": text})
    # Keep within a size budget, newest first, and start on a user turn.
    total, kept = 0, []
    for t in reversed(turns):
        total += len(t["content"])
        if total > HISTORY_CHARS:
            break
        kept.append(t)
    kept.reverse()
    while kept and kept[0]["role"] != "user":
        kept.pop(0)
    # The new question is appended as a user turn; history must end on an assistant turn.
    while kept and kept[-1]["role"] != "assistant":
        kept.pop()
    return kept


async def _with_current_actions(db: AsyncSession, user_id: str, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Saved messages with each action card's live status (it changes when the person
    confirms or cancels, after the message was saved)."""
    ids = [b["action"]["id"] for m in messages for b in (m.get("blocks") or [])
           if b.get("type") == "action" and isinstance(b.get("action"), dict) and b["action"].get("id")]
    if not ids:
        return messages
    rows = (await db.execute(
        select(AssistantAction).where(AssistantAction.id.in_(ids), AssistantAction.user_id == user_id)
    )).scalars().all()
    cards = {r.id: actions.action_card(r) for r in rows}
    out = []
    for m in messages:
        blocks = []
        for b in m.get("blocks") or []:
            if b.get("type") == "action" and (b.get("action") or {}).get("id") in cards:
                b = {**b, "action": cards[b["action"]["id"]]}
            blocks.append(b)
        out.append({**m, "blocks": blocks})
    return out


def _sse(event: str, data: Any) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, default=str, separators=(',', ':'))}\n\n".encode()


async def _display_name(db: AsyncSession, user_id: str) -> tuple[Optional[str], Optional[str]]:
    user = await db.get(User, user_id)
    if not user:
        return None, None
    full = " ".join(p for p in (user.first_name, user.last_name) if p) or None
    return full, user.first_name


# ------------------------------------------------------------- routes ----
@router.get("/status", response_model=StatusDto)
async def get_status(user: AuthenticatedUser = Depends(_use), db: AsyncSession = Depends(get_db)) -> StatusDto:
    s = get_settings()
    ctx = Ctx(db=db, user=user)
    scope = None
    if ctx.can("sales.view"):
        sc = await ctx.sales_scope()
        scope = "all" if sc.see_all else "own" if sc.sf_user_id else "unlinked"
    _, first = await _display_name(db, user.id)
    return StatusDto(
        configured=make_provider() is not None, provider=s.ASSISTANT_PROVIDER, model=s.ASSISTANT_MODEL,
        dailyLimit=s.ASSISTANT_DAILY_LIMIT, usedToday=await _used_today(db, user.id),
        areas=sorted({t.label for t in registry.tools_for(ctx) if t.name != "show_chart" and not t.name.startswith("propose_")}),
        salesScope=scope, firstName=first,
    )


@router.get("/chats", response_model=list[ChatBriefDto])
async def list_chats(user: AuthenticatedUser = Depends(_use), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AssistantChat.id, AssistantChat.title, AssistantChat.pinned, AssistantChat.updated_at)
        .where(AssistantChat.user_id == user.id)
        .order_by(AssistantChat.pinned.desc(), AssistantChat.updated_at.desc()).limit(100)
    )).all()
    return [ChatBriefDto(id=r.id, title=r.title, pinned=r.pinned, updatedAt=r.updated_at) for r in rows]


async def _own_chat(db: AsyncSession, user_id: str, chat_id: str) -> AssistantChat:
    chat = await db.get(AssistantChat, chat_id)
    # Same answer for "missing" and "someone else's".
    if not chat or chat.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat


@router.get("/chats/{chat_id}", response_model=ChatDto)
async def get_chat(chat_id: str, user: AuthenticatedUser = Depends(_use), db: AsyncSession = Depends(get_db)):
    chat = await _own_chat(db, user.id, chat_id)
    messages = await _with_current_actions(db, user.id, chat.messages or [])
    return ChatDto(id=chat.id, title=chat.title, pinned=chat.pinned, updatedAt=chat.updated_at, messages=messages)


@router.patch("/chats/{chat_id}", response_model=ChatBriefDto)
async def patch_chat(chat_id: str, body: ChatPatch, user: AuthenticatedUser = Depends(_use),
                     db: AsyncSession = Depends(get_db)):
    chat = await _own_chat(db, user.id, chat_id)
    if body.title is not None:
        chat.title = body.title.strip()[:120] or chat.title
    if body.pinned is not None:
        chat.pinned = body.pinned
    await db.commit()
    await db.refresh(chat)
    return ChatBriefDto(id=chat.id, title=chat.title, pinned=chat.pinned, updatedAt=chat.updated_at)


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(chat_id: str, user: AuthenticatedUser = Depends(_use), db: AsyncSession = Depends(get_db)):
    await _own_chat(db, user.id, chat_id)
    await db.execute(delete(AssistantChat).where(AssistantChat.id == chat_id, AssistantChat.user_id == user.id))
    await db.commit()


@router.post("/chat")
async def chat(body: ChatRequest, request: Request, user: AuthenticatedUser = Depends(_use),
               db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    provider = make_provider()
    if provider is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="The assistant isn't set up yet. An admin needs to add the AI service key.")
    question = body.message.strip()
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ask a question")
    limit = settings.ASSISTANT_DAILY_LIMIT
    if limit and await _used_today(db, user.id) >= limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=f"You've asked {limit} questions today, the daily limit. It resets at midnight.")

    if body.chatId:
        chat_row = await _own_chat(db, user.id, body.chatId)
        history = _history(await _with_current_actions(db, user.id, chat_row.messages or []))
        chat_id = chat_row.id
    else:
        chat_row = AssistantChat(user_id=user.id, title=_title(question), messages=[])
        db.add(chat_row)
        history, chat_id = [], None
    # The usage row is written now (and filled in at the end) so parallel questions all count
    # towards the daily limit, even while they're still being answered.
    usage = AssistantUsage(user_id=user.id, provider=provider.name, model=provider.model, rounds=0, tool_calls=0,
                           input_tokens=0, output_tokens=0, cache_read_tokens=0, cache_write_tokens=0, duration_ms=0)
    db.add(usage)
    await db.flush()
    chat_id = chat_id or chat_row.id
    usage.chat_id = chat_id
    full_name, _ = await _display_name(db, user.id)
    usage_id = usage.id
    await db.commit()
    # Hand the request's connection back now; the answer streams on its own sessions.
    await db.close()
    asked_at = dt.datetime.now(dt.timezone.utc)

    async def events():
        outcome = engine.Outcome()
        try:
            yield _sse("chat", {"type": "chat", "id": chat_id})
            async with SessionLocal() as read_db:
                await engine.begin_readonly(read_db)
                ctx = Ctx(db=read_db, user=user, chat_id=chat_id, session_factory=SessionLocal)
                gen = engine.answer(ctx, provider, history=history, question=question, voice=body.voice,
                                    display_name=full_name, outcome=outcome)
                async with aclosing(gen):
                    async for ev in gen:
                        yield _sse(ev["type"], ev)
                        # Stop paying for an answer nobody is reading (the Stop button, a closed tab).
                        if await request.is_disconnected():
                            outcome.error = outcome.error or "Stopped."
                            break
                await read_db.rollback()
        except (anyio.get_cancelled_exc_class(), GeneratorExit):
            # The browser went away mid-call (Stop, closed tab): record it as stopped.
            outcome.error = outcome.error or "Stopped."
            raise
        except Exception:  # anything unexpected still ends the stream cleanly
            logger.exception("assistant answer failed")
            outcome.error = outcome.error or "Something went wrong while answering. Try again."
            yield _sse("error", {"type": "error", "message": outcome.error})
        finally:
            # Shielded: if the browser goes away mid-answer, still keep what was said.
            with anyio.CancelScope(shield=True):
                await _save(user.id, chat_id, usage_id, question, asked_at, outcome, voice=body.voice)

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    })


async def _save(user_id: str, chat_id: str, usage_id: str, question: str, asked_at: dt.datetime,
                outcome: engine.Outcome, *, voice: bool) -> None:
    """Append the turn to the chat and fill in the usage row. Never raises: the answer is already on screen."""
    try:
        async with SessionLocal() as db:
            # Row lock: two tabs answering in the same chat append in turn instead of overwriting.
            chat_row = (await db.execute(
                select(AssistantChat).where(AssistantChat.id == chat_id).with_for_update()
            )).scalar_one_or_none()
            if chat_row is not None and chat_row.user_id == user_id:
                now = dt.datetime.now(dt.timezone.utc)
                user_msg = {"id": cuid(), "role": "user", "blocks": [{"type": "text", "text": question}],
                            "createdAt": asked_at.isoformat(), **({"voice": True} if voice else {})}
                reply = {"id": cuid(), "role": "assistant", "blocks": outcome.blocks, "tools": outcome.tools,
                         "createdAt": now.isoformat()}
                if outcome.error:
                    reply["error"] = outcome.error
                # A new list so SQLAlchemy sees the JSON column change.
                chat_row.messages = [*(chat_row.messages or []), user_msg, reply][-MAX_SAVED_MESSAGES:]
                chat_row.updated_at = now
            usage = await db.get(AssistantUsage, usage_id)
            if usage is not None:
                usage.rounds = outcome.rounds
                usage.tool_calls = outcome.tool_calls
                usage.input_tokens = outcome.usage.input_tokens
                usage.output_tokens = outcome.usage.output_tokens
                usage.cache_read_tokens = outcome.usage.cache_read_tokens
                usage.cache_write_tokens = outcome.usage.cache_write_tokens
                usage.duration_ms = outcome.duration_ms
                usage.error = outcome.error[:300] if outcome.error else None
            await db.commit()
    except Exception:
        logger.exception("assistant: saving the chat failed")


# ------------------------------------------------------------ actions ----
class ActionResultDto(BaseModel):
    action: dict[str, Any]
    # Values an endpoint hands out once (a new quote link, a temporary password): returned to the
    # person who clicked Confirm, in this response only. Never saved and never sent to the model.
    revealed: list[dict[str, Any]] = []


async def _own_action(db: AsyncSession, user_id: str, action_id: str) -> AssistantAction:
    row = await db.get(AssistantAction, action_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")
    return row


def _error_text(res: httpx.Response) -> str:
    try:
        body = res.json()
        msg = body.get("message") or body.get("detail")
        if isinstance(msg, list):
            msg = msg[0] if msg else None
        if isinstance(msg, str):
            return msg[:300]
    except ValueError:
        pass
    return f"Failed ({res.status_code})"


@router.get("/actions/{action_id}", response_model=ActionResultDto)
async def get_action(action_id: str, user: AuthenticatedUser = Depends(_use), db: AsyncSession = Depends(get_db)):
    return ActionResultDto(action=actions.action_card(await _own_action(db, user.id, action_id)))


@router.post("/actions/{action_id}/confirm", response_model=ActionResultDto)
async def confirm_action(action_id: str, request: Request, user: AuthenticatedUser = Depends(_use),
                         db: AsyncSession = Depends(get_db)):
    """Carry out a proposed action, as the person confirming it.

    Each step is replayed against this same API with the caller's own login, so it gets exactly
    the permission checks, validation, notifications and audit-log rows of the screen that does
    the same thing. The audit rows show "SuperApp assistant" as the user agent.
    """
    row = await _own_action(db, user.id, action_id)
    now = dt.datetime.now(dt.timezone.utc)
    if row.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This action is already {row.status}.")
    if row.expires_at <= now:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This proposal expired. Ask the assistant again to get a fresh one.")
    # Claim it atomically, so a double click (or two tabs) can't run it twice.
    claimed = (await db.execute(
        update(AssistantAction)
        .where(AssistantAction.id == action_id, AssistantAction.status == "pending",
               AssistantAction.expires_at > now)
        .values(status="running", decided_at=now, results=[])
        .returning(AssistantAction.id)
    )).scalar_one_or_none()
    await db.commit()
    if claimed is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This action is already being carried out.")

    steps = list(row.steps)
    auth = request.headers.get("authorization", "")
    client_ip = request.client.host if request.client else "127.0.0.1"
    results: list[dict[str, Any]] = []
    revealed: list[dict[str, Any]] = []

    async def save(final: Optional[str] = None) -> None:
        values: dict[str, Any] = {"results": list(results)}
        if final:
            values["status"] = final
        async with SessionLocal() as s2:
            await s2.execute(update(AssistantAction).where(AssistantAction.id == action_id).values(**values))
            await s2.commit()

    # Shielded: once started, the steps finish and the outcome is recorded even if the
    # browser goes away. Progress is saved after every step, so an outright kill (a
    # platform timeout) still leaves a record of what went through ("interrupted").
    with anyio.CancelScope(shield=True):
        transport = httpx.ASGITransport(app=request.app, client=(client_ip, 0))
        try:
            async with httpx.AsyncClient(transport=transport, base_url="http://superapp.internal") as client:
                for step in steps:
                    try:
                        res = await client.request(
                            step["method"], "/api/v1" + step["path"], json=step.get("json"),
                            headers={"Authorization": auth, "User-Agent": f"SuperApp assistant (action {action_id})"},
                        )
                        ok = 200 <= res.status_code < 300
                        results.append({"label": step.get("label", ""), "ok": ok, "status": res.status_code,
                                        **({} if ok else {"message": _error_text(res)})})
                        if ok and step.get("reveal"):
                            revealed.append({"label": step.get("label", ""), **_reveal(res, step["reveal"])})
                    except Exception:
                        logger.exception("assistant action step failed")
                        results.append({"label": step.get("label", ""), "ok": False, "status": 500,
                                        "message": "Something went wrong on this step."})
                    await save()
        finally:
            good = sum(1 for r in results if r["ok"])
            if len(results) < len(steps):
                final = "partial" if good else "failed"
            else:
                final = "done" if good == len(results) else "failed" if good == 0 else "partial"
            await save(final)
    await db.refresh(row)
    return ActionResultDto(action=actions.action_card(row), revealed=revealed)


def _reveal(res: httpx.Response, keys: list[str]) -> dict[str, Any]:
    """Pick the show-once fields (top level) out of a step's response."""
    try:
        data = res.json()
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: data[k] for k in keys if k in data and isinstance(data[k], (str, int, float, bool))}


@router.post("/actions/{action_id}/cancel", response_model=ActionResultDto)
async def cancel_action(action_id: str, user: AuthenticatedUser = Depends(_use), db: AsyncSession = Depends(get_db)):
    row = await _own_action(db, user.id, action_id)
    result = await db.execute(
        update(AssistantAction)
        .where(AssistantAction.id == action_id, AssistantAction.status == "pending")
        .values(status="cancelled", decided_at=dt.datetime.now(dt.timezone.utc))
    )
    await db.commit()
    if not result.rowcount:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This action is already {row.status}.")
    await db.refresh(row)
    return ActionResultDto(action=actions.action_card(row))
