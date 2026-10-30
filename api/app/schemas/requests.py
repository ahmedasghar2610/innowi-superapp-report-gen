"""DTOs for Requests (app/modules/requests)."""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

RequestType = Literal["FEATURE", "IMPROVEMENT", "BUG", "COMPLAINT", "DATA", "PROCESS"]
RequestArea = Literal["SALES", "PARTNERS", "SUPPORT", "OPERATIONS", "MARKETING", "PAYMENTS", "REPORTING", "PLATFORM",
                      "OTHER"]
Urgency = Literal["LOW", "NORMAL", "HIGH", "BLOCKING"]
RequestStatus = Literal["NEW", "UNDER_REVIEW", "NEEDS_INFO", "APPROVED", "IN_PROGRESS", "SHIPPED", "DECLINED",
                        "DUPLICATE"]
# What a triage owner can set directly. APPROVED goes through /approve (it needs a roadmap item).
TriageStatus = Literal["UNDER_REVIEW", "NEEDS_INFO", "IN_PROGRESS", "SHIPPED", "DECLINED", "DUPLICATE"]
RoadmapArea = Literal["SALES", "MERCHANTS", "MARKETING", "PLATFORM"]
RoadmapPriority = Literal["HIGH", "NORMAL", "LOW"]


def _strip(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class _In(BaseModel):
    model_config = {"extra": "forbid"}


# ── out ───────────────────────────────────────────────────────────────────
class PersonDto(BaseModel):
    id: Optional[str] = None
    name: str
    email: str


class RoadmapLinkDto(BaseModel):
    id: str
    title: str
    status: str
    phaseName: str
    targetDate: Optional[dt.date] = None


class RequestRowDto(BaseModel):
    id: str
    number: int
    ref: str  # "R-1001"
    type: RequestType
    area: RequestArea
    urgency: Urgency
    title: str
    status: RequestStatus
    requester: PersonDto
    votes: int
    votedByMe: bool
    comments: int
    mine: bool
    roadmapItemId: Optional[str] = None
    createdAt: dt.datetime
    statusChangedAt: dt.datetime


class RequestCountsDto(BaseModel):
    open: int
    closed: int
    new: int  # waiting for triage
    needsInfo: int
    approved: int  # approved or in progress
    shipped: int
    mine: int


class RequestListDto(BaseModel):
    data: list[RequestRowDto]
    counts: RequestCountsDto
    canTriage: bool


class CommentDto(BaseModel):
    id: str
    author: PersonDto
    body: str
    createdAt: dt.datetime


class EventDto(BaseModel):
    id: str
    kind: str
    fromStatus: Optional[str] = None
    toStatus: Optional[str] = None
    note: Optional[str] = None
    actor: Optional[str] = None
    createdAt: dt.datetime


class RequestDetailDto(RequestRowDto):
    details: str
    why: Optional[str] = None
    whoAffected: Optional[str] = None
    links: Optional[str] = None
    decisionNote: Optional[str] = None
    duplicateOf: Optional[str] = None  # "R-1003"
    roadmapItem: Optional[RoadmapLinkDto] = None
    triagedByEmail: Optional[str] = None
    voters: list[str]
    commentList: list[CommentDto]
    events: list[EventDto]
    canEdit: bool
    canTriage: bool
    updatedAt: dt.datetime


# ── in ────────────────────────────────────────────────────────────────────
class RequestCreateDto(_In):
    type: RequestType
    area: RequestArea
    urgency: Urgency = "NORMAL"
    title: str = Field(min_length=3, max_length=200)
    details: str = Field(min_length=3, max_length=10000)
    why: Optional[str] = Field(None, max_length=5000)
    whoAffected: Optional[str] = Field(None, max_length=300)
    links: Optional[str] = Field(None, max_length=5000)

    _s = field_validator("title", "details", "why", "whoAffected", "links", mode="before")(_strip)


class RequestUpdateDto(_In):
    type: Optional[RequestType] = None
    area: Optional[RequestArea] = None
    urgency: Optional[Urgency] = None
    title: Optional[str] = Field(None, min_length=3, max_length=200)
    details: Optional[str] = Field(None, min_length=3, max_length=10000)
    why: Optional[str] = Field(None, max_length=5000)
    whoAffected: Optional[str] = Field(None, max_length=300)
    links: Optional[str] = Field(None, max_length=5000)

    _s = field_validator("title", "details", "why", "whoAffected", "links", mode="before")(_strip)


class CommentCreateDto(_In):
    body: str = Field(min_length=1, max_length=5000)

    _s = field_validator("body", mode="before")(_strip)


class StatusChangeDto(_In):
    status: TriageStatus
    note: Optional[str] = Field(None, max_length=5000)
    duplicateOf: Optional[str] = Field(None, max_length=20)  # "R-1003" or "1003"

    _s = field_validator("note", "duplicateOf", mode="before")(_strip)

    @model_validator(mode="after")
    def _needs(self):
        if self.status in ("DECLINED", "NEEDS_INFO") and not self.note:
            raise ValueError("Say why (declined) or what you need (needs info): a note is required")
        if self.status == "DUPLICATE" and not self.duplicateOf:
            raise ValueError("Pick the request this one duplicates")
        return self


class ApproveDto(_In):
    """Approve onto the roadmap: create a new item in `phaseId`, or link `itemId`."""

    itemId: Optional[str] = None
    phaseId: Optional[str] = None
    title: Optional[str] = Field(None, min_length=3, max_length=200)  # default: the request's title
    roadmapArea: Optional[RoadmapArea] = None  # default: from the request's area
    priority: Optional[RoadmapPriority] = None  # default: from the request's urgency
    ownerId: Optional[str] = None
    targetDate: Optional[dt.date] = None
    note: Optional[str] = Field(None, max_length=5000)

    _s = field_validator("title", "note", mode="before")(_strip)

    @model_validator(mode="after")
    def _one(self):
        if bool(self.itemId) == bool(self.phaseId):
            raise ValueError("Give either phaseId (new roadmap item) or itemId (existing item)")
        return self
