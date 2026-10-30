"""Ops CRM meetings (Fathom) — response/request shapes."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, Field

from app.common.pagination import PageMeta
from app.models.enums import ActionItemStatus, MeetingSource, TicketStatus
from app.schemas.ops import MerchantRefDto, PersonRefDto, ProjectRefDto


class AttendeeDto(BaseModel):
    name: str
    email: Optional[str] = None
    isExternal: bool
    userId: Optional[str] = None
    spoke: bool


class ActionCountsDto(BaseModel):
    open: int = 0
    ticket: int = 0
    dismissed: int = 0


class MeetingSummaryDto(BaseModel):
    id: str
    title: str
    source: MeetingSource
    startedAt: Optional[dt.datetime] = None
    endedAt: Optional[dt.datetime] = None
    durationMinutes: Optional[int] = None
    merchant: Optional[MerchantRefDto] = None
    project: Optional[ProjectRefDto] = None
    recordedBy: Optional[str] = None
    attendees: list[AttendeeDto]
    hasSummary: bool
    actions: ActionCountsDto
    fathomUrl: Optional[str] = None


class PaginatedMeetingsDto(BaseModel):
    data: list[MeetingSummaryDto]
    meta: PageMeta


class TicketMiniDto(BaseModel):
    key: str
    title: str
    status: TicketStatus


class ActionItemDto(BaseModel):
    id: str
    description: str
    assigneeName: Optional[str] = None
    assigneeEmail: Optional[str] = None
    # The Super App user matched by email — the suggested ticket assignee.
    assignee: Optional[PersonRefDto] = None
    recordingTimestamp: Optional[str] = None
    playbackUrl: Optional[str] = None
    status: ActionItemStatus
    ticket: Optional[TicketMiniDto] = None
    decidedBy: Optional[str] = None
    decidedAt: Optional[dt.datetime] = None


class TranscriptLineDto(BaseModel):
    speaker: str
    email: Optional[str] = None
    text: str
    timestamp: Optional[str] = None


class MeetingDetailDto(MeetingSummaryDto):
    summary: Optional[str] = None
    transcript: list[TranscriptLineDto]
    actionItems: list[ActionItemDto]
    linkedTickets: list[TicketMiniDto]
    shareUrl: Optional[str] = None
    callUrl: Optional[str] = None
    merchantMatch: Optional[str] = None
    canManage: bool


class UpdateMeetingDto(BaseModel):
    """Send only what changes. `merchantId: null` clears the merchant."""

    merchantId: Optional[str] = None
    projectId: Optional[str] = None
    summary: Optional[str] = Field(None, max_length=50000)

    model_config = {"extra": "forbid"}


class FathomStatusDto(BaseModel):
    apiKeySet: bool
    webhookSecretSet: bool
    webhookPath: str
    lastSyncAt: Optional[dt.datetime] = None
    lastWebhookAt: Optional[dt.datetime] = None
    lastError: Optional[str] = None
    meetings: int
    openActions: int
    canSync: bool


class SyncResultDto(BaseModel):
    fetched: int
    added: int
    updated: int
