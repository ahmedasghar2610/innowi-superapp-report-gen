"""Requests: ideas, feature asks, bugs and complaints from the team, in one place.

Anyone signed in submits a request (a short form), sees everyone else's and
upvotes the ones they need too. The triage owners (Super Admins, plus people
granted ``requests.triage``) review each one and decide: approve it onto the
roadmap, ask for more information, or decline it with a reason.

Tables live in the ``roadmap`` schema because an approved request becomes a
roadmap item (``request.roadmap_item_id``), and so no new schema is needed:

* ``request``: the ask itself, its status and the triage decision.
* ``request_vote``: one row per person who upvoted it.
* ``request_comment``: the conversation on a request.
* ``request_event``: what happened and when (created, status changes,
  approved onto the roadmap, shipped) — the history shown on the request.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "roadmap"

# request.type
TYPE_FEATURE = "FEATURE"  # a new screen, field, report or automation
TYPE_IMPROVEMENT = "IMPROVEMENT"  # make something that exists work better
TYPE_BUG = "BUG"  # something is broken or wrong
TYPE_COMPLAINT = "COMPLAINT"  # something is getting in the way of the work
TYPE_DATA = "DATA"  # import, clean up or fix data
TYPE_PROCESS = "PROCESS"  # a workflow or process the app should follow
TYPES = (TYPE_FEATURE, TYPE_IMPROVEMENT, TYPE_BUG, TYPE_COMPLAINT, TYPE_DATA, TYPE_PROCESS)

# request.area — the part of the business it is about
AREAS = ("SALES", "PARTNERS", "SUPPORT", "OPERATIONS", "MARKETING", "PAYMENTS", "REPORTING", "PLATFORM", "OTHER")

# request.urgency
URGENCY_LOW = "LOW"
URGENCY_NORMAL = "NORMAL"
URGENCY_HIGH = "HIGH"
URGENCY_BLOCKING = "BLOCKING"  # I can't do my job until this is done
URGENCIES = (URGENCY_LOW, URGENCY_NORMAL, URGENCY_HIGH, URGENCY_BLOCKING)

# request.status
STATUS_NEW = "NEW"
STATUS_UNDER_REVIEW = "UNDER_REVIEW"
STATUS_NEEDS_INFO = "NEEDS_INFO"
STATUS_APPROVED = "APPROVED"  # on the roadmap
STATUS_IN_PROGRESS = "IN_PROGRESS"
STATUS_SHIPPED = "SHIPPED"
STATUS_DECLINED = "DECLINED"
STATUS_DUPLICATE = "DUPLICATE"
STATUSES = (STATUS_NEW, STATUS_UNDER_REVIEW, STATUS_NEEDS_INFO, STATUS_APPROVED, STATUS_IN_PROGRESS,
            STATUS_SHIPPED, STATUS_DECLINED, STATUS_DUPLICATE)
OPEN_STATUSES = (STATUS_NEW, STATUS_UNDER_REVIEW, STATUS_NEEDS_INFO, STATUS_APPROVED, STATUS_IN_PROGRESS)
CLOSED_STATUSES = (STATUS_SHIPPED, STATUS_DECLINED, STATUS_DUPLICATE)

# request_event.kind
EVENT_CREATED = "CREATED"
EVENT_EDITED = "EDITED"
EVENT_STATUS = "STATUS"
EVENT_ROADMAP = "ROADMAP"  # approved onto the roadmap (or linked to an existing item)
EVENTS = (EVENT_CREATED, EVENT_EDITED, EVENT_STATUS, EVENT_ROADMAP)


class Request(Base):
    __tablename__ = "request"
    __table_args__ = (
        Index("ix_roadmap_request_status", "status"),
        Index("ix_roadmap_request_requester_id", "requester_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    # R-1001, R-1002 … (sequence roadmap.request_number_seq)
    number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    area: Mapped[str] = mapped_column(String(20), nullable=False)
    urgency: Mapped[str] = mapped_column(String(10), nullable=False, server_default=URGENCY_NORMAL)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)  # what is needed
    why: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # the problem it solves / business impact
    who_affected: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    links: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # sheets, screenshots, emails (one per line)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=STATUS_NEW)
    decision_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # why declined / what info is needed
    duplicate_of_id: Mapped[Optional[str]] = mapped_column(
        String(30), ForeignKey(f"{SCHEMA}.request.id", ondelete="SET NULL"), nullable=True)
    roadmap_item_id: Mapped[Optional[str]] = mapped_column(
        String(30), ForeignKey(f"{SCHEMA}.item.id", ondelete="SET NULL"), nullable=True)
    requester_id: Mapped[Optional[str]] = mapped_column(
        String(30), ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    requester_email: Mapped[str] = mapped_column(String(320), nullable=False)
    triaged_by_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    status_changed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                           nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now(), nullable=False)


class RequestVote(Base):
    __tablename__ = "request_vote"
    __table_args__ = {"schema": SCHEMA}

    request_id: Mapped[str] = mapped_column(String(30), ForeignKey(f"{SCHEMA}.request.id", ondelete="CASCADE"),
                                            primary_key=True)
    user_id: Mapped[str] = mapped_column(String(30), ForeignKey("auth.user.id", ondelete="CASCADE"),
                                         primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RequestComment(Base):
    __tablename__ = "request_comment"
    __table_args__ = (Index("ix_roadmap_request_comment_request_id", "request_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    request_id: Mapped[str] = mapped_column(String(30), ForeignKey(f"{SCHEMA}.request.id", ondelete="CASCADE"),
                                            nullable=False)
    author_id: Mapped[Optional[str]] = mapped_column(String(30), ForeignKey("auth.user.id", ondelete="SET NULL"),
                                                     nullable=True)
    author_email: Mapped[str] = mapped_column(String(320), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RequestEvent(Base):
    __tablename__ = "request_event"
    __table_args__ = (Index("ix_roadmap_request_event_request_id", "request_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    request_id: Mapped[str] = mapped_column(String(30), ForeignKey(f"{SCHEMA}.request.id", ondelete="CASCADE"),
                                            nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    from_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    to_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actor_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
