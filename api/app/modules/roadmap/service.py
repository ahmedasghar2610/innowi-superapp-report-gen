"""Roadmap reads and writes. The router checks who may do what; this module
only talks to the database and builds the DTOs."""
from __future__ import annotations

import datetime as dt
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import roadmap as m
from app.models.auth import User
from app.models.enums import UserStatus
from app.schemas import roadmap as dto


def today() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def display_name(u: User) -> str:
    name = " ".join(p for p in (u.first_name, u.last_name) if p and p.strip()).strip()
    return name or u.email.split("@", 1)[0]


async def active_users(db: AsyncSession) -> list[User]:
    rows = await db.execute(select(User).where(User.status == UserStatus.ACTIVE).order_by(User.email))
    return list(rows.scalars())


async def is_active_user(db: AsyncSession, user_id: str) -> bool:
    row = await db.get(User, user_id)
    return bool(row and row.status == UserStatus.ACTIVE)


async def list_phases(db: AsyncSession) -> list[m.Phase]:
    rows = await db.execute(select(m.Phase).order_by(m.Phase.sort_order, m.Phase.start_month, m.Phase.name))
    return list(rows.scalars())


async def list_items(db: AsyncSession) -> list[m.Item]:
    rows = await db.execute(select(m.Item).order_by(m.Item.sort_order, m.Item.created_at))
    return list(rows.scalars())


async def phase_item_count(db: AsyncSession, phase_id: str) -> int:
    rows = await db.execute(select(m.Item.id).where(m.Item.phase_id == phase_id).limit(1))
    return len(rows.all())


async def next_sort(db: AsyncSession, model, **where) -> int:
    stmt = select(model.sort_order)
    for k, v in where.items():
        stmt = stmt.where(getattr(model, k) == v)
    values = [v for (v,) in (await db.execute(stmt)).all()]
    return (max(values) + 10) if values else 10


def counts(items: Iterable[m.Item]) -> dto.PhaseCountsDto:
    items = list(items)
    by = {s: sum(1 for i in items if i.status == s) for s in m.STATUSES}
    return dto.PhaseCountsDto(total=len(items), done=by[m.STATUS_DONE], inProgress=by[m.STATUS_IN_PROGRESS],
                              blocked=by[m.STATUS_BLOCKED], todo=by[m.STATUS_TODO])


def item_dto(i: m.Item) -> dto.ItemDto:
    return dto.ItemDto(
        id=i.id, phaseId=i.phase_id, title=i.title, description=i.description, area=i.area, status=i.status,
        priority=i.priority, ownerId=i.owner_id, targetDate=i.target_date, doneOn=i.done_on, notes=i.notes,
        link=i.link, sortOrder=i.sort_order, updatedByEmail=i.updated_by_email, updatedAt=i.updated_at,
    )


def phase_dto(p: m.Phase, items: list[m.Item]) -> dto.PhaseDto:
    return dto.PhaseDto(id=p.id, name=p.name, goal=p.goal, startMonth=p.start_month, endMonth=p.end_month,
                        sortOrder=p.sort_order, counts=counts(items), items=[item_dto(i) for i in items])


def apply_status(item: m.Item, status: str) -> None:
    """DONE stamps the day it was finished; leaving DONE clears it."""
    if status == m.STATUS_DONE and item.status != m.STATUS_DONE:
        item.done_on = today()
    elif status != m.STATUS_DONE:
        item.done_on = None
    item.status = status


async def roadmap(db: AsyncSession, me: str, can_manage: bool) -> dto.RoadmapDto:
    phases = await list_phases(db)
    items = await list_items(db)
    by_phase: dict[str, list[m.Item]] = {p.id: [] for p in phases}
    for i in items:
        by_phase.setdefault(i.phase_id, []).append(i)
    owners = [dto.OwnerDto(id=u.id, name=display_name(u), email=u.email, role=u.role.value if hasattr(u.role, "value")
                           else str(u.role)) for u in await active_users(db)]
    return dto.RoadmapDto(
        phases=[phase_dto(p, by_phase.get(p.id, [])) for p in phases],
        owners=owners, counts=counts(items), canManage=can_manage, me=me,
    )


def find_owner(users: list[User], email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    for u in users:
        if u.email.lower() == email.lower():
            return u.id
    return None
