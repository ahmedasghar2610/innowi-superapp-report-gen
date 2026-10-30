from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, Field

from app.common.pagination import PageMeta
from app.models.enums import AuditAction, AuditOutcome


class AuditLogResponseDto(BaseModel):
    id: str
    actorId: Optional[str] = Field(None, validation_alias="actor_id")
    actorEmail: Optional[str] = Field(None, validation_alias="actor_email")
    actorRole: Optional[str] = Field(None, validation_alias="actor_role")
    action: AuditAction
    entityType: str = Field(..., validation_alias="entity_type")
    entityId: Optional[str] = Field(None, validation_alias="entity_id")
    merchantId: Optional[str] = Field(None, validation_alias="merchant_id")
    before: Optional[dict]
    after: Optional[dict]
    changedFields: list[str] = Field(..., validation_alias="changed_fields")
    method: str
    path: str
    outcome: AuditOutcome
    statusCode: int = Field(..., validation_alias="status_code")
    errorMessage: Optional[str] = Field(None, validation_alias="error_message")
    ip: Optional[str]
    userAgent: Optional[str] = Field(None, validation_alias="user_agent")
    createdAt: dt.datetime = Field(..., validation_alias="created_at")

    model_config = {"from_attributes": True, "populate_by_name": True}


class PaginatedAuditLogsDto(BaseModel):
    data: list[AuditLogResponseDto]
    meta: PageMeta


class QueryAuditLogDto(BaseModel):
    page: int = 1
    limit: int = 25
    order: str = "desc"
    actorId: Optional[str] = None
    entityType: Optional[str] = None
    entityId: Optional[str] = None
    merchantId: Optional[str] = None
    action: Optional[AuditAction] = None
    outcome: Optional[AuditOutcome] = None
    from_: Optional[str] = None
    to: Optional[str] = None

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit

    # Nest ran a global ValidationPipe with forbidNonWhitelisted: true —
    # an unknown property in the body is a 400, not a silently ignored key.
    model_config = {"extra": "forbid"}
