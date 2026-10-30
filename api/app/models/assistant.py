"""AI assistant: saved chats and per-question usage.

Kept in the existing `auth` schema (both rows belong to one login and are
deleted with it) so the shared database needs no new schema - the `superapp`
role there may not create schemas.
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "auth"


class AssistantChat(Base):
    """One conversation. `messages` is the list shown on screen:
    [{"id", "role": "user"|"assistant", "blocks": [{"type": "text", "text"} | {"type": "chart", ...}],
      "tools": [labels], "createdAt", "error"?}]"""

    __tablename__ = "assistant_chat"
    __table_args__ = (Index("ix_assistant_chat_user_updated", "user_id", "updated_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.user.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Set when a question is answered (router._save), not on rename/pin, so history order follows activity.
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AssistantUsage(Base):
    """One row per question asked: what it cost and whether it worked."""

    __tablename__ = "assistant_usage"
    __table_args__ = (Index("ix_assistant_usage_user_created", "user_id", "created_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.user.id", ondelete="CASCADE"), nullable=False)
    chat_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AssistantAction(Base):
    """A change the assistant proposed. Nothing happens until its owner confirms it.

    `steps` are the exact API calls to make on confirm: [{"method", "path", "json"?, "label"}],
    built by the server from validated ids (never from free text the model wrote).
    `results` mirror `steps`: [{"label", "ok", "status", "message"?}].
    status: pending -> running -> done | partial | failed; or pending -> cancelled | expired.
    """

    __tablename__ = "assistant_action"
    __table_args__ = (Index("ix_assistant_action_user_created", "user_id", "created_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.user.id", ondelete="CASCADE"), nullable=False)
    chat_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    items: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    destructive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    results: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
