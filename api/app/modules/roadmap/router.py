"""/roadmap — what the team has done, is doing and will do, by phase, with owners.

Read: roadmap.view (everyone signed in).
Plan (phases, items, owners, any field): roadmap.manage (admins).
The owner of an item may also change its status, notes and target date.
Every change is written to the audit log.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser, require_capability
from app.db.session import get_db
from app.models import roadmap as m
from app.models.audit import AuditLog
from app.models.enums import AuditAction, AuditOutcome
from app.modules.roadmap import service
from app.schemas import roadmap as dto

router = APIRouter(prefix="/roadmap", tags=["Roadmap"])

_view = require_capability("roadmap.view")
_manage = require_capability("roadmap.manage")

# DTO field -> model column
_ITEM_FIELDS = {
    "phaseId": "phase_id", "title": "title", "description": "description", "area": "area", "priority": "priority",
    "ownerId": "owner_id", "targetDate": "target_date", "notes": "notes", "link": "link", "sortOrder": "sort_order",
}
_NULLABLE_ITEM = {"description", "ownerId", "targetDate", "notes", "link"}
_PHASE_FIELDS = {"name": "name", "goal": "goal", "startMonth": "start_month", "endMonth": "end_month",
                 "sortOrder": "sort_order"}


async def _audit(db: AsyncSession, request: Request, user: AuthenticatedUser, action: AuditAction, entity_type: str,
                 entity_id: str, before: Optional[dict], after: Optional[dict]) -> None:
    changed = sorted(k for k in set(before or {}) | set(after or {}) if (before or {}).get(k) != (after or {}).get(k)) \
        if action == AuditAction.UPDATE else []
    db.add(AuditLog(
        actor_id=user.id, actor_email=user.email, actor_role=user.role, action=action, entity_type=entity_type,
        entity_id=entity_id, before=before, after=after, changed_fields=changed, method=request.method,
        path=str(request.url.path), outcome=AuditOutcome.SUCCESS, status_code=200,
        ip=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"),
    ))
    await db.commit()


def _item_json(i: m.Item) -> dict:
    return service.item_dto(i).model_dump(mode="json", exclude={"updatedAt", "updatedByEmail"})


def _phase_json(p: m.Phase) -> dict:
    return {"name": p.name, "goal": p.goal, "startMonth": p.start_month.isoformat(),
            "endMonth": p.end_month.isoformat(), "sortOrder": p.sort_order}


async def _phase_or_404(db: AsyncSession, phase_id: str) -> m.Phase:
    p = await db.get(m.Phase, phase_id)
    if not p:
        raise HTTPException(status_code=404, detail="Phase not found")
    return p


async def _check_owner(db: AsyncSession, owner_id: Optional[str]) -> None:
    if owner_id and not await service.is_active_user(db, owner_id):
        raise HTTPException(status_code=400, detail="The owner must be an active Super App user")


# ── read ──────────────────────────────────────────────────────────────────
@router.get("", response_model=dto.RoadmapDto)
async def get_roadmap(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    return await service.roadmap(db, me=user.id, can_manage=has_capability(user.role, "roadmap.manage"))


# ── phases ────────────────────────────────────────────────────────────────
@router.post("/phases", response_model=dto.PhaseDto, status_code=201)
async def create_phase(body: dto.PhaseCreateDto, request: Request, db: AsyncSession = Depends(get_db),
                       user: AuthenticatedUser = Depends(_manage)):
    p = m.Phase(name=body.name, goal=body.goal, start_month=body.startMonth, end_month=body.endMonth,
                sort_order=body.sortOrder if body.sortOrder is not None else await service.next_sort(db, m.Phase))
    db.add(p)
    await db.commit()
    await db.refresh(p)
    out = service.phase_dto(p, [])
    await _audit(db, request, user, AuditAction.CREATE, "RoadmapPhase", p.id, None, _phase_json(p))
    return out


@router.patch("/phases/{phase_id}", response_model=dto.PhaseDto)
async def update_phase(phase_id: str, body: dto.PhaseUpdateDto, request: Request, db: AsyncSession = Depends(get_db),
                       user: AuthenticatedUser = Depends(_manage)):
    p = await _phase_or_404(db, phase_id)
    before = _phase_json(p)
    for key in body.model_fields_set:
        value = getattr(body, key)
        if value is None and key != "goal":
            continue
        setattr(p, _PHASE_FIELDS[key], value)
    if p.end_month < p.start_month:
        await db.rollback()
        raise HTTPException(status_code=400, detail="The last month can't be before the first month")
    await db.commit()
    await db.refresh(p)
    items = [i for i in await service.list_items(db) if i.phase_id == p.id]
    out = service.phase_dto(p, items)
    await _audit(db, request, user, AuditAction.UPDATE, "RoadmapPhase", p.id, before, _phase_json(p))
    return out


@router.delete("/phases/{phase_id}", status_code=204)
async def delete_phase(phase_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: AuthenticatedUser = Depends(_manage)):
    p = await _phase_or_404(db, phase_id)
    if await service.phase_item_count(db, p.id):
        raise HTTPException(status_code=409, detail="Move or delete this phase's items first")
    before = _phase_json(p)
    await db.delete(p)
    await db.commit()
    await _audit(db, request, user, AuditAction.DELETE, "RoadmapPhase", phase_id, before, None)
    return Response(status_code=204)


# ── items ─────────────────────────────────────────────────────────────────
@router.post("/items", response_model=dto.ItemDto, status_code=201)
async def create_item(body: dto.ItemCreateDto, request: Request, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(_manage)):
    await _phase_or_404(db, body.phaseId)
    await _check_owner(db, body.ownerId)
    i = m.Item(phase_id=body.phaseId, title=body.title, description=body.description, area=body.area,
               priority=body.priority, owner_id=body.ownerId, target_date=body.targetDate, notes=body.notes,
               link=body.link, status=m.STATUS_TODO, created_by_email=user.email, updated_by_email=user.email,
               sort_order=await service.next_sort(db, m.Item, phase_id=body.phaseId))
    service.apply_status(i, body.status)
    db.add(i)
    await db.commit()
    await db.refresh(i)
    out = service.item_dto(i)
    await _audit(db, request, user, AuditAction.CREATE, "RoadmapItem", i.id, None, _item_json(i))
    return out


@router.patch("/items/{item_id}", response_model=dto.ItemDto)
async def update_item(item_id: str, body: dto.ItemUpdateDto, request: Request, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(_view)):
    i = await db.get(m.Item, item_id)
    if not i:
        raise HTTPException(status_code=404, detail="Item not found")
    fields = set(body.model_fields_set)
    if not has_capability(user.role, "roadmap.manage"):
        if i.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Only admins and the item's owner can change it")
        extra = fields - dto.OWNER_FIELDS
        if extra:
            raise HTTPException(status_code=403,
                                detail="As the owner you can change the status, notes and target date; ask an admin for the rest")
    if "phaseId" in fields and body.phaseId:
        await _phase_or_404(db, body.phaseId)
    if "ownerId" in fields:
        await _check_owner(db, body.ownerId)

    before = _item_json(i)
    for key in fields:
        value = getattr(body, key)
        if key == "status":
            if value is not None:
                service.apply_status(i, value)
            continue
        if value is None and key not in _NULLABLE_ITEM:
            continue  # null means "leave as is" for required fields
        setattr(i, _ITEM_FIELDS[key], value)
    i.updated_by_email = user.email
    await db.commit()
    await db.refresh(i)
    out = service.item_dto(i)
    await _audit(db, request, user, AuditAction.UPDATE, "RoadmapItem", i.id, before, _item_json(i))
    if "status" in fields and before.get("status") != i.status:
        # Requests approved onto this item follow it (in progress / shipped) and tell their people.
        from app.modules.requests.router import follow_roadmap_item

        await follow_roadmap_item(db, i, user)
    return out


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: str, request: Request, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(_manage)):
    i = await db.get(m.Item, item_id)
    if not i:
        raise HTTPException(status_code=404, detail="Item not found")
    before = _item_json(i)
    await db.delete(i)
    await db.commit()
    await _audit(db, request, user, AuditAction.DELETE, "RoadmapItem", item_id, before, None)
    return Response(status_code=204)
