"""Ops CRM — Team reports and CSV export.

Numbers are computed in Python over the matching tickets. That is fine at the
team's volume (hundreds to a few thousand tickets); move the aggregations
into SQL if the table grows into the tens of thousands.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import statistics
from collections import Counter, defaultdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import TicketPriority, TicketStatus, TicketType
from app.models.ops import Project, Ticket, utcnow
from app.models.profiling import Merchant
from app.modules.ops.router import (
    load_sla_settings,
    _SORTS,
    _filters,
    _parse_enum_list,
    _person_name,
    _sla_dto,
    _today,
)

router = APIRouter(
    prefix="/ops",
    tags=["Ops CRM — Reports"],
    dependencies=[Depends(require_capability("ticket.view")), Depends(load_sla_settings)],
)


def _week_start(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


def _median_hours(durations: list[float]) -> Optional[float]:
    return round(statistics.median(durations), 1) if durations else None


@router.get("/reports")
async def team_report(
    days: int = Query(30, ge=7, le=365, description="Reporting window, in days back from today"),
    type_: Optional[TicketType] = Query(None, alias="type"),
    projectId: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Leadership view: open load, overdue, SLA compliance, resolution time,
    created vs closed per week, and breakdowns by person, project, category
    and source."""
    now = utcnow()
    today = _today()
    since = now - dt.timedelta(days=days)
    prev_since = since - dt.timedelta(days=days)

    stmt = select(Ticket)
    if type_:
        stmt = stmt.where(Ticket.type == type_)
    if projectId:
        stmt = stmt.where(Ticket.project_id == projectId)
    tickets = list((await db.execute(stmt)).scalars().all())

    open_ = [t for t in tickets if t.status != TicketStatus.DONE]
    overdue = [t for t in open_ if t.due_date and t.due_date < today]
    urgent = [t for t in open_ if t.priority == TicketPriority.URGENT]
    high = [t for t in open_ if t.priority == TicketPriority.HIGH]

    def resolved_between(a: dt.datetime, b: dt.datetime) -> list[Ticket]:
        return [t for t in tickets if t.status == TicketStatus.DONE and t.completed_at and a <= t.completed_at < b]

    resolved = resolved_between(since, now)
    resolved_prev = resolved_between(prev_since, since)

    def hours(t: Ticket) -> float:
        return (t.completed_at - t.created_at).total_seconds() / 3600

    # SLA: resolution compliance over tickets resolved in the window; first
    # response compliance over tickets created in the window that are decided.
    slas = [_sla_dto(t, now) for t in resolved]
    res_met = sum(1 for s in slas if s and s.state == "met")
    res_total = sum(1 for s in slas if s)
    created = [t for t in tickets if t.created_at >= since]
    resp = [_sla_dto(t, now) for t in created]
    resp_met = sum(1 for s in resp if s and s.responseState == "met")
    resp_total = sum(1 for s in resp if s and s.responseState != "pending")
    breached_open = sum(1 for t in open_ if (s := _sla_dto(t, now)) and s.state == "breached")

    # Created vs closed per week (Monday-start), oldest first.
    n_weeks = min(12, max(4, (days + 6) // 7))
    first_week = _week_start(today) - dt.timedelta(weeks=n_weeks - 1)
    weeks = [first_week + dt.timedelta(weeks=i) for i in range(n_weeks)]
    created_w: Counter = Counter()
    closed_w: Counter = Counter()
    for t in tickets:
        cw = _week_start(t.created_at.date())
        if cw >= first_week:
            created_w[cw] += 1
        if t.status == TicketStatus.DONE and t.completed_at:
            dw = _week_start(t.completed_at.date())
            if dw >= first_week:
                closed_w[dw] += 1

    # Names for the breakdowns.
    user_ids = {t.assignee_id for t in open_ if t.assignee_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}
    projects = {p.id: p.name for p in (await db.execute(select(Project))).scalars()}

    by_assignee: dict[Optional[str], dict] = defaultdict(lambda: {"open": 0, "overdue": 0, "urgentHigh": 0})
    for t in open_:
        row = by_assignee[t.assignee_id]
        row["open"] += 1
        row["overdue"] += 1 if t in overdue else 0
        row["urgentHigh"] += 1 if t.priority in (TicketPriority.URGENT, TicketPriority.HIGH) else 0

    by_project = Counter(t.project_id for t in open_)
    categories = Counter((t.type.value, t.category) for t in created)
    sources = Counter(t.source.value for t in created)
    by_type = Counter(t.type.value for t in open_)

    return {
        "window": {"days": days, "from": since, "to": now},
        "kpis": {
            "open": len(open_),
            "openByType": {tt.value: by_type.get(tt.value, 0) for tt in TicketType},
            "urgent": len(urgent),
            "high": len(high),
            "overdue": len(overdue),
            "overdueShare": round(len(overdue) / len(open_), 3) if open_ else 0,
            "slaBreachedOpen": breached_open,
            "resolutionSla": {"met": res_met, "total": res_total},
            "responseSla": {"met": resp_met, "total": resp_total},
            "created": len(created),
            "resolved": len(resolved),
            "medianResolutionHours": _median_hours([hours(t) for t in resolved]),
            "medianResolutionHoursPrevious": _median_hours([hours(t) for t in resolved_prev]),
        },
        "weekly": [
            {"weekStart": w.isoformat(), "created": created_w.get(w, 0), "closed": closed_w.get(w, 0)} for w in weeks
        ],
        "byAssignee": sorted(
            [
                {
                    "id": uid,
                    "name": _person_name(users[uid]) if uid in users else "Unassigned",
                    **row,
                }
                for uid, row in by_assignee.items()
            ],
            key=lambda r: (-r["open"], r["name"]),
        ),
        "byProject": sorted(
            [{"id": pid, "name": projects.get(pid, "—"), "open": n} for pid, n in by_project.items()],
            key=lambda r: -r["open"],
        ),
        "topCategories": [
            {"type": ty, "category": cat, "count": n} for (ty, cat), n in categories.most_common(8)
        ],
        "bySource": [{"source": src, "count": n} for src, n in sources.most_common()],
    }


@router.get("/tickets/export", response_class=StreamingResponse)
async def export_tickets(
    view: Literal["open", "done", "all"] = "all",
    status_: Optional[str] = Query(None, alias="status"),
    type_: Optional[TicketType] = Query(None, alias="type"),
    priority: Optional[str] = None,
    projectId: Optional[str] = None,
    assigneeId: Optional[str] = None,
    merchantId: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=200),
    overdue: bool = False,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """CSV of the tickets matching the same filters as GET /ops/tickets."""
    conds = _filters(
        user=user,
        view=view,
        statuses=_parse_enum_list(status_, TicketStatus, "status"),
        priorities=_parse_enum_list(priority, TicketPriority, "priority"),
        project_id=projectId,
        assignee_id=assigneeId,
        merchant_id=merchantId,
        search=search,
        overdue=overdue,
    )
    if type_:
        conds.append(Ticket.type == type_)
    tickets = list(
        (await db.execute(select(Ticket).where(*conds).order_by(*_SORTS["created"]()).limit(10_000))).scalars().all()
    )

    merchant_ids = {t.merchant_id for t in tickets if t.merchant_id}
    merchants = (
        dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(merchant_ids)))).all())
        if merchant_ids
        else {}
    )
    user_ids = {i for t in tickets for i in (t.assignee_id, t.created_by_id) if i}
    users = {u.id: _person_name(u) for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}
    projects = {p.id: p.name for p in (await db.execute(select(Project))).scalars()}
    now = utcnow()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "Key", "Title", "Merchant", "Type", "Category", "Sub-category", "Request type", "Priority", "Status",
        "Project", "Assignee", "Created by", "Created", "Due date", "Completed", "SLA", "First response",
    ])
    for t in tickets:
        s = _sla_dto(t, now)
        w.writerow([
            t.key,
            t.title,
            merchants.get(t.merchant_id, "") if t.merchant_id else "Internal",
            t.type.value,
            t.category,
            t.sub_category or "",
            t.request_type.value,
            t.priority.value,
            t.status.value,
            projects.get(t.project_id, ""),
            users.get(t.assignee_id, "") if t.assignee_id else "Unassigned",
            users.get(t.created_by_id, "") if t.created_by_id else "",
            t.created_at.isoformat(timespec="minutes"),
            t.due_date.isoformat() if t.due_date else "",
            t.completed_at.isoformat(timespec="minutes") if t.completed_at else "",
            s.state if s else "",
            s.responseState if s else "",
        ])
    data = "﻿" + buf.getvalue()  # BOM so Excel opens it as UTF-8
    filename = f"tickets-{_today().isoformat()}.csv"
    return StreamingResponse(
        iter([data]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
