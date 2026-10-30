"""Port of audit-log.controller.ts + audit.service.ts."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.enums import AuditAction, AuditOutcome
from app.schemas.audit import AuditLogResponseDto, PaginatedAuditLogsDto

router = APIRouter(
    prefix="/audit-logs", tags=["Audit Log"], dependencies=[Depends(require_capability("audit.view"))]
)


@router.get("", response_model=PaginatedAuditLogsDto)
async def list_audit_logs(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    actorId: Optional[str] = None,
    entityType: Optional[str] = None,
    entityId: Optional[str] = None,
    merchantId: Optional[str] = None,
    action: Optional[AuditAction] = None,
    outcome: Optional[AuditOutcome] = None,
    from_: Optional[dt.datetime] = Query(None, alias="from"),
    to: Optional[dt.datetime] = None,
):
    conditions = []
    if actorId:
        conditions.append(AuditLog.actor_id == actorId)
    if entityType:
        conditions.append(AuditLog.entity_type == entityType)
    if entityId:
        conditions.append(AuditLog.entity_id == entityId)
    if merchantId:
        conditions.append(AuditLog.merchant_id == merchantId)
    if action:
        conditions.append(AuditLog.action == action)
    if outcome:
        conditions.append(AuditLog.outcome == outcome)
    if from_:
        conditions.append(AuditLog.created_at >= from_)
    if to:
        conditions.append(AuditLog.created_at <= to)

    where = and_(*conditions) if conditions else True
    order_col = AuditLog.created_at.desc() if order == "desc" else AuditLog.created_at.asc()

    total = (await db.execute(select(func.count()).select_from(AuditLog).where(where))).scalar_one()
    rows = (
        await db.execute(select(AuditLog).where(where).order_by(order_col).offset((page - 1) * limit).limit(limit))
    ).scalars().all()

    return PaginatedAuditLogsDto(
        data=[AuditLogResponseDto.model_validate(r) for r in rows],
        meta=PageMeta.build(page, limit, total),
    )


async def find_by_merchant(db: AsyncSession, merchant_id: str, page: int, limit: int) -> PaginatedAuditLogsDto:
    """Used by merchant-profiling's GET /merchants/:id/history — same underlying data (PRD §22)."""
    where = AuditLog.merchant_id == merchant_id
    total = (await db.execute(select(func.count()).select_from(AuditLog).where(where))).scalar_one()
    rows = (
        await db.execute(
            select(AuditLog).where(where).order_by(AuditLog.created_at.desc()).offset((page - 1) * limit).limit(limit)
        )
    ).scalars().all()
    return PaginatedAuditLogsDto(
        data=[AuditLogResponseDto.model_validate(r) for r in rows],
        meta=PageMeta.build(page, limit, total),
    )
