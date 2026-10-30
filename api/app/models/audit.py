"""audit schema — AuditLog. Append-only, populated only by the audit middleware."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import ARRAY, DateTime, Enum, Index, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import AuditAction, AuditOutcome

SCHEMA = "audit"


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_merchant_created", "merchant_id", "created_at"),
        Index("ix_audit_log_entity_created", "entity_type", "entity_id", "created_at"),
        Index("ix_audit_log_actor_created", "actor_id", "created_at"),
        Index("ix_audit_log_action", "action"),
        Index("ix_audit_log_created_at", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()

    actor_id: Mapped[Optional[str]] = mapped_column("actor_id", String, nullable=True)
    actor_email: Mapped[Optional[str]] = mapped_column("actor_email", String, nullable=True)
    actor_role: Mapped[Optional[str]] = mapped_column("actor_role", String, nullable=True)

    action: Mapped[AuditAction] = mapped_column(Enum(AuditAction, name="AuditAction", schema=SCHEMA, native_enum=True), nullable=False)
    entity_type: Mapped[str] = mapped_column("entity_type", String, nullable=False)
    entity_id: Mapped[Optional[str]] = mapped_column("entity_id", String, nullable=True)
    merchant_id: Mapped[Optional[str]] = mapped_column("merchant_id", String, nullable=True)

    before: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    after: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    changed_fields: Mapped[list[str]] = mapped_column("changed_fields", ARRAY(String), nullable=False, default=list)

    method: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str] = mapped_column(String, nullable=False)
    outcome: Mapped[AuditOutcome] = mapped_column(
        Enum(AuditOutcome, name="AuditOutcome", schema=SCHEMA, native_enum=True), nullable=False, default=AuditOutcome.SUCCESS
    )
    status_code: Mapped[int] = mapped_column("status_code", Integer, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column("error_message", String, nullable=True)

    ip: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column("user_agent", String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    )
