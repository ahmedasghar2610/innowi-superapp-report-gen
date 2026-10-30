"""roadmap schema - what the Super App team has done, is doing and will do.

* ``phase``: a stretch of work with a goal and target months (e.g. "Ready for
  real customers", Nov 2026).
* ``item``: one piece of work inside a phase, with an area (sales, running
  merchants, marketing, platform), a status, an owner (a Super App user), an
  optional target date and notes.

Everyone signed in can read it. Admins plan it (phases, items, owners); the
owner of an item can move its status and add notes.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "roadmap"

# item.area
AREA_SALES = "SALES"
AREA_MERCHANTS = "MERCHANTS"  # running merchants: workspace, issues, changes, notifications
AREA_MARKETING = "MARKETING"
AREA_PLATFORM = "PLATFORM"  # foundation, security, go-live, accounts
AREAS = (AREA_SALES, AREA_MERCHANTS, AREA_MARKETING, AREA_PLATFORM)

# item.status
STATUS_TODO = "TODO"
STATUS_IN_PROGRESS = "IN_PROGRESS"
STATUS_BLOCKED = "BLOCKED"
STATUS_DONE = "DONE"
STATUSES = (STATUS_TODO, STATUS_IN_PROGRESS, STATUS_BLOCKED, STATUS_DONE)

# item.priority
PRIORITY_HIGH = "HIGH"
PRIORITY_NORMAL = "NORMAL"
PRIORITY_LOW = "LOW"
PRIORITIES = (PRIORITY_HIGH, PRIORITY_NORMAL, PRIORITY_LOW)


class Phase(Base):
    __tablename__ = "phase"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    goal: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # First day of the first and last target month.
    start_month: Mapped[dt.date] = mapped_column(Date, nullable=False)
    end_month: Mapped[dt.date] = mapped_column(Date, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now(), nullable=False)


class Item(Base):
    __tablename__ = "item"
    __table_args__ = (
        Index("ix_roadmap_item_phase_id", "phase_id"),
        Index("ix_roadmap_item_owner_id", "owner_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    phase_id: Mapped[str] = mapped_column(String(30), ForeignKey(f"{SCHEMA}.phase.id", ondelete="RESTRICT"),
                                          nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    area: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=STATUS_TODO)
    priority: Mapped[str] = mapped_column(String(10), nullable=False, server_default=PRIORITY_NORMAL)
    owner_id: Mapped[Optional[str]] = mapped_column(String(30), ForeignKey("auth.user.id", ondelete="SET NULL"),
                                                    nullable=True)
    target_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    done_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_by_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    updated_by_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now(), nullable=False)
