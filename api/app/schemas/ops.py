"""Ops CRM ticket DTOs. camelCase on the wire like every other DTO here;
inputs use extra="forbid" so an unknown key is a 400, not silently dropped."""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, BeforeValidator, Field, field_validator

from app.common.pagination import PageMeta
from app.models.enums import (
    CommentVisibility,
    TicketEventKind,
    TicketPriority,
    TicketRequestType,
    TicketSource,
    TicketStatus,
    TicketType,
)

_FORBID = {"extra": "forbid"}


def _trim(v):
    return v.strip() if isinstance(v, str) else v


def _blank_to_none(v):
    v = _trim(v)
    return None if v == "" else v


# Reusable input coercions: trim strings; turn "" into None for optional text.
Trimmed = Annotated[str, BeforeValidator(_trim)]
OptText = Annotated[Optional[str], BeforeValidator(_blank_to_none)]


# ---- shared refs --------------------------------------------------------------
class PersonRefDto(BaseModel):
    id: str
    name: str
    email: str


class PersonDto(PersonRefDto):
    role: str
    # Can this person create and edit tickets (ticket.manage)?
    canManageTickets: bool


class PeopleResponseDto(BaseModel):
    data: list[PersonDto]


class ProjectDto(BaseModel):
    id: str
    name: str
    archived: bool
    position: int


class ProjectsResponseDto(BaseModel):
    data: list[ProjectDto]


class CreateProjectDto(BaseModel):
    name: Trimmed = Field(..., min_length=1, max_length=120)

    model_config = _FORBID


class UpdateProjectDto(BaseModel):
    name: Optional[Trimmed] = Field(None, min_length=1, max_length=120)
    archived: Optional[bool] = None
    position: Optional[int] = Field(None, ge=0, le=10000)

    model_config = _FORBID


class MerchantRefDto(BaseModel):
    id: str
    name: str


class ProjectRefDto(BaseModel):
    id: str
    name: str


# ---- catalog ------------------------------------------------------------------
class CategoryDto(BaseModel):
    name: str
    subCategories: list[str]


class TicketTypeSpecDto(BaseModel):
    type: TicketType
    label: str
    description: str
    categories: list[CategoryDto]


class TicketCatalogDto(BaseModel):
    types: list[TicketTypeSpecDto]
    sla: list["SlaPolicyDto"] = []


# ---- tickets ------------------------------------------------------------------
class SubtaskDto(BaseModel):
    id: str
    title: str
    done: bool
    position: int
    doneAt: Optional[dt.datetime] = None
    createdAt: dt.datetime


class TicketSlaDto(BaseModel):
    """SLA clock (modules/ops/sla.py). Times count weekdays only; the
    resolution clock pauses while Awaiting Merchant."""

    state: Literal["on_track", "at_risk", "breached", "paused", "met"]
    responseState: Literal["pending", "met", "breached"]
    responseDueAt: dt.datetime
    firstResponseAt: Optional[dt.datetime] = None
    resolutionDueAt: dt.datetime
    # Business seconds left to resolve; negative once breached, frozen while paused.
    remainingSeconds: int
    targetResponseHours: int
    targetResolutionHours: int


class SlaPolicyDto(BaseModel):
    priority: TicketPriority
    responseHours: int
    resolutionHours: int


class TicketViewerDto(BaseModel):
    """What the signed-in user may do with this ticket (UI hints; the API
    enforces the same rules)."""

    canManage: bool  # edit any field, reassign, delete
    canWork: bool  # change status, tick sub-tasks (assignee or manager)
    watching: bool = False


class TicketDto(BaseModel):
    id: str
    key: str  # "OPS-1042"
    number: int
    title: str
    description: Optional[str] = None
    type: TicketType
    category: str
    subCategory: Optional[str] = None
    requestType: TicketRequestType
    priority: TicketPriority
    status: TicketStatus
    source: TicketSource
    project: ProjectRefDto
    merchant: Optional[MerchantRefDto] = None  # null = internal
    assignee: Optional[PersonRefDto] = None  # null only if the user was deleted
    createdBy: Optional[PersonRefDto] = None
    dueDate: Optional[dt.date] = None
    isOverdue: bool
    completedAt: Optional[dt.datetime] = None
    sla: Optional[TicketSlaDto] = None
    subtaskCount: int
    subtasksDone: int
    commentCount: int
    createdAt: dt.datetime
    updatedAt: dt.datetime


class MeetingRefDto(BaseModel):
    id: str
    title: str


class TicketDetailDto(TicketDto):
    # The meeting this ticket was made from (an action item), if any.
    meeting: Optional[MeetingRefDto] = None
    subtasks: list[SubtaskDto]
    # People following the ticket, and its files (modules/ops/ticket_extras.py).
    watchers: list[PersonRefDto] = Field(default_factory=list)
    attachments: list[dict] = Field(default_factory=list)
    # Merchant contact, plan and services (modules/ops/ticket_more.py).
    merchantInfo: Optional[dict] = None
    # Linked Library pages, and the merchant's pages not linked yet.
    libraryLinks: list[dict] = Field(default_factory=list)
    librarySuggestions: list[dict] = Field(default_factory=list)
    viewer: TicketViewerDto


class PaginatedTicketsDto(BaseModel):
    data: list[TicketDto]
    meta: PageMeta


class TicketCountsDto(BaseModel):
    """Open-ticket counts for the list's team tabs, honouring every filter
    except `type`."""

    total: int
    byType: dict[str, int]


class CreateTicketDto(BaseModel):
    title: Trimmed = Field(..., min_length=1, max_length=200)
    description: OptText = Field(None, max_length=10000)
    type: TicketType
    category: Trimmed = Field(..., min_length=1, max_length=80)
    subCategory: OptText = Field(None, max_length=80)
    requestType: TicketRequestType = TicketRequestType.NEW_REQUEST
    priority: TicketPriority = TicketPriority.MEDIUM
    projectId: str
    merchantId: OptText = None  # omit / null for internal work
    assigneeId: str  # exactly one owner, required
    dueDate: Optional[dt.date] = None
    # Optional checklist to start with.
    subtasks: list[str] = Field(default_factory=list, max_length=30)
    # Made from a meeting's action item (Ops CRM → Meetings): links the two
    # and marks the action item done.
    actionItemId: OptText = None


    @field_validator("subtasks")
    @classmethod
    def _clean_subtasks(cls, v: list[str]) -> list[str]:
        out = [s.strip() for s in v if s and s.strip()]
        if any(len(s) > 200 for s in out):
            raise ValueError("Each sub-task must be 200 characters or fewer")
        return out

    model_config = _FORBID


class UpdateTicketDto(BaseModel):
    """Send only what changes. `merchantId: null` makes the ticket internal;
    `dueDate: null` clears the due date. Assignees may change `status` only."""

    title: Optional[Trimmed] = Field(None, min_length=1, max_length=200)
    description: OptText = Field(None, max_length=10000)
    type: Optional[TicketType] = None
    category: Optional[Trimmed] = Field(None, min_length=1, max_length=80)
    subCategory: OptText = Field(None, max_length=80)
    requestType: Optional[TicketRequestType] = None
    priority: Optional[TicketPriority] = None
    status: Optional[TicketStatus] = None
    projectId: Optional[str] = None
    merchantId: OptText = None
    assigneeId: Optional[str] = None
    dueDate: Optional[dt.date] = None


    model_config = _FORBID


# ---- sub-tasks ----------------------------------------------------------------
class CreateSubtaskDto(BaseModel):
    title: Trimmed = Field(..., min_length=1, max_length=200)

    model_config = _FORBID


class UpdateSubtaskDto(BaseModel):
    title: Optional[Trimmed] = Field(None, min_length=1, max_length=200)
    done: Optional[bool] = None

    model_config = _FORBID


# ---- comments & activity ------------------------------------------------------
class CreateCommentDto(BaseModel):
    body: Trimmed = Field(..., min_length=1, max_length=5000)
    # INTERNAL (team only, default) or MERCHANT (shared with the merchant;
    # only on tickets that have a merchant).
    visibility: CommentVisibility = CommentVisibility.INTERNAL
    # User ids @mentioned in the body — each gets a notification.
    mentions: list[str] = Field(default_factory=list, max_length=20)

    model_config = _FORBID


class CommentDto(BaseModel):
    id: str
    body: str
    author: Optional[PersonRefDto] = None
    visibility: CommentVisibility = CommentVisibility.INTERNAL
    mentions: list[PersonRefDto] = Field(default_factory=list)
    createdAt: dt.datetime


class ActivityItemDto(BaseModel):
    """One entry in a ticket's feed: a comment, or a change event."""

    kind: Literal["comment", "event"]
    id: str
    createdAt: dt.datetime
    actor: Optional[PersonRefDto] = None
    body: Optional[str] = None  # comments
    visibility: Optional[CommentVisibility] = None  # comments
    mentions: list[PersonRefDto] = Field(default_factory=list)  # comments
    event: Optional[TicketEventKind] = None  # events
    data: Optional[dict] = None  # events: {"from": …, "to": …} etc.


class ActivityResponseDto(BaseModel):
    data: list[ActivityItemDto]
