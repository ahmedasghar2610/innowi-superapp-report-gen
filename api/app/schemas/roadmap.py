"""DTOs for the roadmap (app/modules/roadmap)."""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Area = Literal["SALES", "MERCHANTS", "MARKETING", "PLATFORM"]
Status = Literal["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]
Priority = Literal["HIGH", "NORMAL", "LOW"]


def _strip(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def _first_of_month(v):
    if isinstance(v, dt.date):
        return v.replace(day=1)
    return v


class _In(BaseModel):
    model_config = {"extra": "forbid"}


# ── Out ───────────────────────────────────────────────────────────────────
class OwnerDto(BaseModel):
    id: str
    name: str
    email: str
    role: str


class ItemDto(BaseModel):
    id: str
    phaseId: str
    title: str
    description: Optional[str] = None
    area: Area
    status: Status
    priority: Priority
    ownerId: Optional[str] = None
    targetDate: Optional[dt.date] = None
    doneOn: Optional[dt.date] = None
    notes: Optional[str] = None
    link: Optional[str] = None
    sortOrder: int
    updatedByEmail: Optional[str] = None
    updatedAt: dt.datetime


class PhaseCountsDto(BaseModel):
    total: int
    done: int
    inProgress: int
    blocked: int
    todo: int


class PhaseDto(BaseModel):
    id: str
    name: str
    goal: Optional[str] = None
    startMonth: dt.date
    endMonth: dt.date
    sortOrder: int
    counts: PhaseCountsDto
    items: list[ItemDto]


class RoadmapDto(BaseModel):
    phases: list[PhaseDto]
    owners: list[OwnerDto]
    counts: PhaseCountsDto
    # What the signed-in user may do, so the page can show the right controls.
    canManage: bool
    me: str


# ── In ────────────────────────────────────────────────────────────────────
class PhaseCreateDto(_In):
    name: str = Field(min_length=1, max_length=120)
    goal: Optional[str] = Field(default=None, max_length=2000)
    startMonth: dt.date
    endMonth: dt.date
    sortOrder: Optional[int] = Field(default=None, ge=0, le=10000)

    _s = field_validator("name", "goal", mode="before")(_strip)
    _m = field_validator("startMonth", "endMonth", mode="after")(_first_of_month)

    @model_validator(mode="after")
    def _order(self):
        if self.endMonth < self.startMonth:
            raise ValueError("The last month can't be before the first month")
        return self


class PhaseUpdateDto(_In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    goal: Optional[str] = Field(default=None, max_length=2000)
    startMonth: Optional[dt.date] = None
    endMonth: Optional[dt.date] = None
    sortOrder: Optional[int] = Field(default=None, ge=0, le=10000)

    _s = field_validator("name", "goal", mode="before")(_strip)
    _m = field_validator("startMonth", "endMonth", mode="after")(_first_of_month)


class ItemCreateDto(_In):
    phaseId: str = Field(min_length=1, max_length=30)
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    area: Area
    status: Status = "TODO"
    priority: Priority = "NORMAL"
    ownerId: Optional[str] = Field(default=None, max_length=30)
    targetDate: Optional[dt.date] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    link: Optional[str] = Field(default=None, max_length=500)

    _s = field_validator("title", "description", "notes", "link", "ownerId", mode="before")(_strip)

    @field_validator("link")
    @classmethod
    def _link(cls, v):
        if v and not v.startswith(("https://", "http://")):
            raise ValueError("The link must start with https://")
        return v


class ItemUpdateDto(_In):
    """Every field optional; send null to clear ownerId, targetDate, description, notes or link."""
    phaseId: Optional[str] = Field(default=None, min_length=1, max_length=30)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    area: Optional[Area] = None
    status: Optional[Status] = None
    priority: Optional[Priority] = None
    ownerId: Optional[str] = Field(default=None, max_length=30)
    targetDate: Optional[dt.date] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    link: Optional[str] = Field(default=None, max_length=500)
    sortOrder: Optional[int] = Field(default=None, ge=0, le=10000)

    _s = field_validator("title", "description", "notes", "link", "ownerId", mode="before")(_strip)

    @field_validator("link")
    @classmethod
    def _link(cls, v):
        if v and not v.startswith(("https://", "http://")):
            raise ValueError("The link must start with https://")
        return v


# Fields the owner of an item may change without the roadmap.manage capability.
OWNER_FIELDS = {"status", "notes", "targetDate"}
