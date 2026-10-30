"""Settings — request/response shapes (modules/settings/router.py)."""
from __future__ import annotations

import datetime as dt
import re
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

from app.models.enums import TicketPriority
from app.schemas.auth import UserResponseDto

_FORBID = {"extra": "forbid"}

# ------------------------------------------------------------- personal ----
NotificationEvent = Literal["assigned", "mentioned", "statusChanged", "watching", "slaAtRisk", "slaBreached", "dailyDigest",
                            "requests"]
NOTIFICATION_EVENTS: tuple[str, ...] = ("assigned", "mentioned", "statusChanged", "watching", "slaAtRisk", "slaBreached", "dailyDigest",
                                        "requests")


class Channels(BaseModel):
    inApp: bool = True
    email: bool = False
    teams: bool = False

    model_config = _FORBID


DEFAULT_NOTIFICATIONS: dict[str, dict[str, bool]] = {
    "assigned": {"inApp": True, "email": True, "teams": True},
    "mentioned": {"inApp": True, "email": True, "teams": False},
    "statusChanged": {"inApp": True, "email": False, "teams": False},
    # A ticket I own or watch gets a comment; a watched ticket changes status.
    "watching": {"inApp": True, "email": False, "teams": False},
    "slaAtRisk": {"inApp": True, "email": True, "teams": False},
    "slaBreached": {"inApp": True, "email": True, "teams": True},
    "dailyDigest": {"inApp": False, "email": False, "teams": False},
    # Requests (modules/requests): a new request (triage owners), and replies or
    # a decision on a request you submitted, upvoted or commented on.
    "requests": {"inApp": True, "email": True, "teams": False},
}


class Preferences(BaseModel):
    """auth.user.preferences. Unknown keys from older builds are dropped."""

    startPage: Literal["home", "tickets", "my-work"] = "home"
    notifications: dict[NotificationEvent, Channels] = Field(
        default_factory=lambda: {k: Channels(**v) for k, v in DEFAULT_NOTIFICATIONS.items()}
    )

    @classmethod
    def from_stored(cls, raw: Optional[dict]) -> "Preferences":
        raw = raw or {}
        notif = {k: dict(v) for k, v in DEFAULT_NOTIFICATIONS.items()}
        for k, v in (raw.get("notifications") or {}).items():
            if k in notif and isinstance(v, dict):
                notif[k].update({c: bool(v[c]) for c in ("inApp", "email", "teams") if c in v})
        start = raw.get("startPage") if raw.get("startPage") in ("home", "tickets", "my-work") else "home"
        return cls(startPage=start, notifications={k: Channels(**v) for k, v in notif.items()})


class PreferencesPatch(BaseModel):
    startPage: Optional[Literal["home", "tickets", "my-work"]] = None
    notifications: Optional[dict[NotificationEvent, Channels]] = None

    model_config = _FORBID


class MySettingsDto(BaseModel):
    user: UserResponseDto
    preferences: Preferences
    passwordChangedAt: Optional[dt.datetime] = None


class UpdateMySettingsDto(BaseModel):
    firstName: Optional[str] = Field(None, max_length=100)
    lastName: Optional[str] = Field(None, max_length=100)
    preferences: Optional[PreferencesPatch] = None

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def _trim(cls, v):
        return v.strip() if isinstance(v, str) else v

    model_config = _FORBID


class SessionDto(BaseModel):
    id: str
    ip: Optional[str] = None
    userAgent: Optional[str] = None
    device: str
    createdAt: dt.datetime
    expiresAt: dt.datetime


# ------------------------------------------------------------ workspace ----
TIMEZONES: tuple[str, ...] = (
    "Asia/Karachi",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Europe/London",
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
)
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class OfficeHours(BaseModel):
    start: str = "09:00"
    end: str = "18:00"

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        if not _HHMM.match(v):
            raise ValueError("Use 24-hour HH:MM, e.g. 09:00")
        return v

    model_config = _FORBID


class Workspace(BaseModel):
    companyName: str = Field("Innowi", min_length=1, max_length=120)
    supportEmail: str = Field("support@myinnowi.com", max_length=255)
    timezone: str = "Asia/Karachi"
    # Monday = 0 … Sunday = 6. The SLA clock only counts these days.
    workDays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    officeHours: OfficeHours = Field(default_factory=OfficeHours)
    dateFormat: Literal["D MMM YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] = "D MMM YYYY"
    weekStartsOn: Literal["monday", "sunday"] = "monday"

    @field_validator("companyName", "supportEmail", mode="before")
    @classmethod
    def _trim(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except Exception as exc:
            raise ValueError(f"Unknown timezone: {v}") from exc
        return v

    @field_validator("workDays")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        days = sorted(set(v))
        if not days or any(d < 0 or d > 6 for d in days):
            raise ValueError("Pick at least one working day (0 = Monday … 6 = Sunday)")
        return days

    model_config = _FORBID


class WorkspaceDto(BaseModel):
    workspace: Workspace
    ticketPrefix: str
    timezones: list[str]
    canEdit: bool
    updatedAt: Optional[dt.datetime] = None
    updatedBy: Optional[str] = None


# ------------------------------------------------------------------ SLA ----
class SlaTarget(BaseModel):
    priority: TicketPriority
    responseHours: int = Field(..., ge=1, le=2000)
    resolutionHours: int = Field(..., ge=1, le=5000)

    model_config = _FORBID


class SlaTargetsInput(BaseModel):
    targets: list[SlaTarget]

    @field_validator("targets")
    @classmethod
    def _all(cls, v: list[SlaTarget]) -> list[SlaTarget]:
        if sorted(t.priority.value for t in v) != sorted(p.value for p in TicketPriority):
            raise ValueError("Give one target for each priority: Urgent, High, Medium and Low")
        for t in v:
            if t.responseHours > t.resolutionHours:
                raise ValueError(f"{t.priority.value.title()}: first response can't be later than resolution")
        return v

    model_config = _FORBID


class SlaTargetDto(SlaTarget):
    defaultResponseHours: int
    defaultResolutionHours: int


class SlaSettingsDto(BaseModel):
    targets: list[SlaTargetDto]
    atRiskShare: float
    timezone: str
    workDays: list[int]
    isDefault: bool
    canEdit: bool
    updatedAt: Optional[dt.datetime] = None
    updatedBy: Optional[str] = None


# --------------------------------------------------------- integrations ----
IntegrationStatus = Literal["connected", "configured", "attention", "not_connected", "logged_only", "planned"]


class IntegrationDto(BaseModel):
    key: str
    name: str
    description: str
    status: IntegrationStatus
    statusText: str
    usedFor: list[str]
    envKeys: list[str] = Field(default_factory=list)
    nextStep: Optional[str] = None


class IntegrationsDto(BaseModel):
    data: list[IntegrationDto]
