"""ops schema — Ops CRM tickets.

A ticket is one piece of work for the Marketing, Design or Website team (or an
internal task), owned by exactly one assignee. It may belong to a merchant,
but doesn't have to: internal work has `merchant_id = NULL`.

Tickets are addressed in the UI as `OPS-<number>`. `number` comes from a
Postgres sequence (ops.ticket_number_seq, starting at 1001) so it is
gap-tolerant, concurrency-safe and never reused; `id` stays a cuid like every
other table so foreign keys look the same across the platform.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    BigInteger,
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import (
    ActionItemStatus,
    CommentVisibility,
    NotificationKind,
    CredentialAction,
    MeetingSource,
    LibrarySection,
    TicketEventKind,
    TicketPriority,
    TicketRequestType,
    TicketSource,
    TicketStatus,
    TicketType,
)

SCHEMA = "ops"
TICKET_KEY_PREFIX = "OPS"

ticket_number_seq = Sequence("ticket_number_seq", schema=SCHEMA, start=1001)


def utcnow() -> dt.datetime:
    """Python-side timestamp so rows written in one transaction still order
    deterministically (Postgres now() is per transaction). Same reasoning as
    models/website.py."""
    return dt.datetime.now(dt.timezone.utc)


def _enum(enum_cls, name: str):
    return Enum(enum_cls, name=name, schema=SCHEMA, native_enum=True)


class Project(Base):
    """A folder every ticket belongs to (the prototype's "Project" filter):
    Merchant requests, Email & SMS, SuperApp, Website relaunch, …"""

    __tablename__ = "project"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class Ticket(Base):
    __tablename__ = "ticket"
    __table_args__ = (
        Index("ix_ops_ticket_status", "status"),
        Index("ix_ops_ticket_assignee_id", "assignee_id"),
        Index("ix_ops_ticket_merchant_id", "merchant_id"),
        Index("ix_ops_ticket_project_id", "project_id"),
        Index("ix_ops_ticket_type", "type"),
        Index("ix_ops_ticket_due_date", "due_date"),
        {"schema": SCHEMA},
    )
    # Fetch the sequence-generated `number` (and other server defaults) back
    # via RETURNING on INSERT, so the response can show OPS-1042 straight away.
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[str] = id_column()
    number: Mapped[int] = mapped_column(
        Integer, ticket_number_seq, server_default=ticket_number_seq.next_value(), unique=True, nullable=False
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    type: Mapped[TicketType] = mapped_column(_enum(TicketType, "TicketType"), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    sub_category: Mapped[Optional[str]] = mapped_column("sub_category", String(80), nullable=True)
    request_type: Mapped[TicketRequestType] = mapped_column(
        "request_type", _enum(TicketRequestType, "TicketRequestType"), nullable=False,
        default=TicketRequestType.NEW_REQUEST,
    )
    priority: Mapped[TicketPriority] = mapped_column(
        _enum(TicketPriority, "TicketPriority"), nullable=False, default=TicketPriority.MEDIUM
    )
    status: Mapped[TicketStatus] = mapped_column(
        _enum(TicketStatus, "TicketStatus"), nullable=False, default=TicketStatus.NEW
    )
    source: Mapped[TicketSource] = mapped_column(
        _enum(TicketSource, "TicketSource"), nullable=False, default=TicketSource.MANUAL
    )

    project_id: Mapped[str] = mapped_column(
        "project_id", ForeignKey(f"{SCHEMA}.project.id", ondelete="RESTRICT"), nullable=False
    )
    # Optional: internal work has no merchant. Deleting a merchant keeps its
    # tickets (as internal) rather than erasing the work history.
    merchant_id: Mapped[Optional[str]] = mapped_column(
        "merchant_id", ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True
    )
    # Exactly one owner. Required by the API on create; nullable in the table
    # only so deleting a user leaves their tickets "Unassigned" (to be
    # reassigned) instead of blocking the delete or losing the tickets.
    assignee_id: Mapped[Optional[str]] = mapped_column(
        "assignee_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        "created_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )

    # Set when the ticket was made from a meeting's action item (Fathom).
    meeting_id: Mapped[Optional[str]] = mapped_column(
        "meeting_id", ForeignKey(f"{SCHEMA}.meeting.id", ondelete="SET NULL"), nullable=True
    )

    due_date: Mapped[Optional[dt.date]] = mapped_column("due_date", Date, nullable=True)
    completed_at: Mapped[Optional[dt.datetime]] = mapped_column("completed_at", DateTime(timezone=True), nullable=True)

    # SLA clock (modules/ops/sla.py). Due times are set on create and moved
    # when the priority changes or a pause ends.
    first_response_at: Mapped[Optional[dt.datetime]] = mapped_column(
        "first_response_at", DateTime(timezone=True), nullable=True
    )
    response_due_at: Mapped[Optional[dt.datetime]] = mapped_column(
        "response_due_at", DateTime(timezone=True), nullable=True
    )
    resolution_due_at: Mapped[Optional[dt.datetime]] = mapped_column(
        "resolution_due_at", DateTime(timezone=True), nullable=True
    )
    # Set while Awaiting Merchant; the resolution clock doesn't run then.
    sla_paused_at: Mapped[Optional[dt.datetime]] = mapped_column("sla_paused_at", DateTime(timezone=True), nullable=True)
    # Business seconds spent paused so far, added onto the resolution target.
    sla_paused_seconds: Mapped[int] = mapped_column(
        "sla_paused_seconds", Integer, nullable=False, default=0, server_default="0"
    )

    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )

    project: Mapped["Project"] = relationship(lazy="raise")
    subtasks: Mapped[list["TicketSubtask"]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", order_by="TicketSubtask.position", lazy="raise"
    )

    @property
    def key(self) -> str:
        return f"{TICKET_KEY_PREFIX}-{self.number}"


class TicketSubtask(Base):
    __tablename__ = "ticket_subtask"
    __table_args__ = (Index("ix_ops_ticket_subtask_ticket_id", "ticket_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    ticket_id: Mapped[str] = mapped_column(
        "ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    done_at: Mapped[Optional[dt.datetime]] = mapped_column("done_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )

    ticket: Mapped["Ticket"] = relationship(back_populates="subtasks", lazy="raise")


class TicketComment(Base):
    __tablename__ = "ticket_comment"
    __table_args__ = (Index("ix_ops_ticket_comment_ticket_id", "ticket_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    ticket_id: Mapped[str] = mapped_column(
        "ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[Optional[str]] = mapped_column(
        "author_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[CommentVisibility] = mapped_column(
        _enum(CommentVisibility, "CommentVisibility"), nullable=False, default=CommentVisibility.INTERNAL,
        server_default=CommentVisibility.INTERNAL.value,
    )
    # User ids @mentioned in the comment (they get a MENTIONED notice).
    mentions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class TicketEvent(Base):
    """One line of a ticket's change history ("Status changed New → In
    Progress · Aima Raza"). `data` holds the before/after values, e.g.
    {"from": "NEW", "to": "IN_PROGRESS"}. Separate from the platform audit log,
    which is admin-only; this feed is shown to everyone on the ticket page."""

    __tablename__ = "ticket_event"
    __table_args__ = (Index("ix_ops_ticket_event_ticket_id", "ticket_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    ticket_id: Mapped[str] = mapped_column(
        "ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[Optional[str]] = mapped_column(
        "actor_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[TicketEventKind] = mapped_column(_enum(TicketEventKind, "TicketEventKind"), nullable=False)
    data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


# ================================================================ Library ====
class LibraryPage(Base):
    """A Library page: guidelines, a process, a template, or one merchant's
    brand guidelines. `body` is Markdown. Every save that changes the title or
    body bumps `version` and keeps the old text in library_page_version."""

    __tablename__ = "library_page"
    __table_args__ = (
        Index("ix_ops_library_page_section", "section"),
        Index("ix_ops_library_page_merchant_id", "merchant_id"),
        Index("ix_ops_library_page_parent_id", "parent_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    section: Mapped[LibrarySection] = mapped_column(_enum(LibrarySection, "LibrarySection"), nullable=False)
    # One level of nesting ("Processes & SOPs" → "Ticket routing rules").
    parent_id: Mapped[Optional[str]] = mapped_column(
        "parent_id", ForeignKey(f"{SCHEMA}.library_page.id", ondelete="RESTRICT"), nullable=True
    )
    merchant_id: Mapped[Optional[str]] = mapped_column(
        "merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    owner_id: Mapped[Optional[str]] = mapped_column(
        "owner_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        "updated_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class LibraryPageVersion(Base):
    """The title and body of a page *before* an edit."""

    __tablename__ = "library_page_version"
    __table_args__ = (Index("ix_ops_library_page_version_page_id", "page_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    page_id: Mapped[str] = mapped_column(
        "page_id", ForeignKey(f"{SCHEMA}.library_page.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited_by_id: Mapped[Optional[str]] = mapped_column(
        "edited_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class Credential(Base):
    """A login the team holds for a merchant (or for Innowi itself when
    merchant_id is NULL). The secret is Fernet-encrypted with
    CREDENTIAL_ENCRYPTION_KEY (common/security/crypto.py) and only ever
    returned by the reveal endpoint, which logs who saw it and why."""

    __tablename__ = "credential"
    __table_args__ = (Index("ix_ops_credential_merchant_id", "merchant_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    merchant_id: Mapped[Optional[str]] = mapped_column(
        "merchant_id", ForeignKey("profiling.merchant.id", ondelete="CASCADE"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)  # "Instagram · @cha2cha"
    username: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    secret_encrypted: Mapped[str] = mapped_column("secret_encrypted", Text, nullable=False)
    created_by_id: Mapped[Optional[str]] = mapped_column(
        "created_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class CredentialAccessLog(Base):
    """Every create / update / reveal / delete of a credential. Rows outlive
    the credential (credential_id is set NULL on delete; the label is kept)."""

    __tablename__ = "credential_access_log"
    __table_args__ = (Index("ix_ops_credential_access_log_credential_id", "credential_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    credential_id: Mapped[Optional[str]] = mapped_column(
        "credential_id", ForeignKey(f"{SCHEMA}.credential.id", ondelete="SET NULL"), nullable=True
    )
    credential_label: Mapped[str] = mapped_column("credential_label", String(120), nullable=False)
    merchant_id: Mapped[Optional[str]] = mapped_column("merchant_id", String(30), nullable=True)
    user_id: Mapped[Optional[str]] = mapped_column(
        "user_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    user_email: Mapped[Optional[str]] = mapped_column("user_email", String(255), nullable=True)
    action: Mapped[CredentialAction] = mapped_column(_enum(CredentialAction, "CredentialAction"), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


class AppSetting(Base):
    """Workspace-wide settings edited in Settings (key → JSON value):
    `workspace` (company name, timezone, work week, office hours) and
    `sla_targets` (first response / resolution hours per priority). A
    missing row means "use the built-in default"."""

    __tablename__ = "app_setting"
    __table_args__ = {"schema": SCHEMA}

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        "updated_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )



# =============================================================== Meetings ====
class Meeting(Base):
    """One recorded call. Created from Fathom (webhook or sync), keyed by
    Fathom's recording_id so a re-delivery updates rather than duplicates.
    The merchant is matched from external attendees' emails; Aima and Maheen
    can change it. JSON columns keep Fathom's shapes (see modules/ops/fathom.py)."""

    __tablename__ = "meeting"
    __table_args__ = (
        Index("ix_ops_meeting_merchant_id", "merchant_id"),
        Index("ix_ops_meeting_started_at", "started_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    fathom_recording_id: Mapped[Optional[int]] = mapped_column("fathom_recording_id", BigInteger, unique=True, nullable=True)
    source: Mapped[MeetingSource] = mapped_column(_enum(MeetingSource, "MeetingSource"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    started_at: Mapped[Optional[dt.datetime]] = mapped_column("started_at", DateTime(timezone=True), nullable=True)
    ended_at: Mapped[Optional[dt.datetime]] = mapped_column("ended_at", DateTime(timezone=True), nullable=True)
    scheduled_start_at: Mapped[Optional[dt.datetime]] = mapped_column("scheduled_start_at", DateTime(timezone=True), nullable=True)
    scheduled_end_at: Mapped[Optional[dt.datetime]] = mapped_column("scheduled_end_at", DateTime(timezone=True), nullable=True)
    fathom_url: Mapped[Optional[str]] = mapped_column("fathom_url", String(500), nullable=True)
    share_url: Mapped[Optional[str]] = mapped_column("share_url", String(500), nullable=True)
    call_url: Mapped[Optional[str]] = mapped_column("call_url", String(500), nullable=True)
    recorded_by_name: Mapped[Optional[str]] = mapped_column("recorded_by_name", String(200), nullable=True)
    recorded_by_email: Mapped[Optional[str]] = mapped_column("recorded_by_email", String(255), nullable=True)
    merchant_id: Mapped[Optional[str]] = mapped_column(
        "merchant_id", ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True
    )
    # "auto" (matched from attendee emails) or "manual" (someone picked it) —
    # a manual choice is never overwritten by a later re-delivery.
    merchant_match: Mapped[Optional[str]] = mapped_column("merchant_match", String(10), nullable=True)
    project_id: Mapped[Optional[str]] = mapped_column(
        "project_id", ForeignKey(f"{SCHEMA}.project.id", ondelete="SET NULL"), nullable=True
    )
    # [{name, email, isExternal, userId, spoke}]
    attendees: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Markdown
    # [{speaker, email, text, timestamp}]
    transcript: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    language: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


class MeetingActionItem(Base):
    """An action item Fathom heard on the call. Aima or Maheen turn it into a
    ticket (status TICKET, ticket_id set) or dismiss it."""

    __tablename__ = "meeting_action_item"
    __table_args__ = (Index("ix_ops_meeting_action_item_meeting_id", "meeting_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    meeting_id: Mapped[str] = mapped_column(
        "meeting_id", ForeignKey(f"{SCHEMA}.meeting.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    assignee_name: Mapped[Optional[str]] = mapped_column("assignee_name", String(200), nullable=True)
    assignee_email: Mapped[Optional[str]] = mapped_column("assignee_email", String(255), nullable=True)
    assignee_user_id: Mapped[Optional[str]] = mapped_column(
        "assignee_user_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    recording_timestamp: Mapped[Optional[str]] = mapped_column("recording_timestamp", String(20), nullable=True)
    playback_url: Mapped[Optional[str]] = mapped_column("playback_url", String(500), nullable=True)
    status: Mapped[ActionItemStatus] = mapped_column(
        _enum(ActionItemStatus, "ActionItemStatus"), nullable=False, default=ActionItemStatus.OPEN
    )
    ticket_id: Mapped[Optional[str]] = mapped_column(
        "ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="SET NULL"), nullable=True
    )
    decided_by_id: Mapped[Optional[str]] = mapped_column(
        "decided_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[Optional[dt.datetime]] = mapped_column("decided_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )



# ================================================== ticket attachments ====
class TicketAttachment(Base):
    """A file on a ticket. The bytes live in file storage (common/storage);
    this row keeps the name, type and size."""

    __tablename__ = "ticket_attachment"
    __table_args__ = (Index("ix_ops_ticket_attachment_ticket_id", "ticket_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    ticket_id: Mapped[str] = mapped_column("ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column("file_name", String(255), nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column("content_type", String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column("size_bytes", Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column("storage_key", String(500), nullable=False)
    uploaded_by_id: Mapped[Optional[str]] = mapped_column(
        "uploaded_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


# ======================================================= ticket watchers ====
class TicketWatcher(Base):
    """Someone following a ticket: they hear about its comments, status
    changes and SLA alerts (alerts.py)."""

    __tablename__ = "ticket_watcher"
    __table_args__ = (Index("ix_ops_ticket_watcher_user_id", "user_id"), {"schema": SCHEMA})

    ticket_id: Mapped[str] = mapped_column(
        "ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column("user_id", ForeignKey("auth.user.id", ondelete="CASCADE"), primary_key=True)
    added_by_id: Mapped[Optional[str]] = mapped_column(
        "added_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


# ========================================================= notifications ====
class Notification(Base):
    """One in-app notice for one person (the bell). `dedupe_key` stops the
    SLA checker from sending the same alert twice."""

    __tablename__ = "notification"
    __table_args__ = (
        Index("ix_ops_notification_user_unread", "user_id", "read_at"),
        Index("uq_ops_notification_user_dedupe", "user_id", "dedupe_key", unique=True),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column("user_id", ForeignKey("auth.user.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[NotificationKind] = mapped_column(_enum(NotificationKind, "NotificationKind"), nullable=False)
    ticket_id: Mapped[Optional[str]] = mapped_column(
        "ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), nullable=True
    )
    actor_id: Mapped[Optional[str]] = mapped_column("actor_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Where the notice opens when it isn't about a ticket (e.g. "/requests/R-1004").
    link: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    dedupe_key: Mapped[Optional[str]] = mapped_column("dedupe_key", String(200), nullable=True)
    read_at: Mapped[Optional[dt.datetime]] = mapped_column("read_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )



# =================================================== ticket ↔ library ====
class TicketLibraryLink(Base):
    """A Library page linked to a ticket (e.g. the merchant's brand
    guidelines on a design ticket). Shown on both sides."""

    __tablename__ = "ticket_library_link"
    __table_args__ = (Index("ix_ops_ticket_library_link_page_id", "page_id"), {"schema": SCHEMA})

    ticket_id: Mapped[str] = mapped_column("ticket_id", ForeignKey(f"{SCHEMA}.ticket.id", ondelete="CASCADE"), primary_key=True)
    page_id: Mapped[str] = mapped_column("page_id", ForeignKey(f"{SCHEMA}.library_page.id", ondelete="CASCADE"), primary_key=True)
    added_by_id: Mapped[Optional[str]] = mapped_column("added_by_id", ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )


# ============================================================ saved views ====
class SavedView(Base):
    """A named set of Tickets-list filters, saved by one person."""

    __tablename__ = "saved_view"
    __table_args__ = (Index("ix_ops_saved_view_user_id", "user_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column("user_id", ForeignKey("auth.user.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(
        "created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False
    )
