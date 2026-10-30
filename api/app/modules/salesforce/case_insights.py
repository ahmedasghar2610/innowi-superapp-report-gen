"""Support case analysis: which teams the tickets are for, and what they're about.

Salesforce has two relevant fields on Case:
* Issue_Category__c ("Issue Category": Printer, Menu, Payment ...) - filled on most cases.
* Case_Assigned_To__c ("Case Assigned To": Menu, Payments, Field Service Engineering ...) -
  the team, but filled on only a few percent of cases (checked 2026-10-20: 103 of 3,816).

So the department shown here is:
  1. the recorded team, when Case Assigned To is filled ("recorded");
  2. otherwise the team that normally handles that issue category, from CATEGORY_DEPARTMENT
     below ("estimated"); the mapping follows how the recorded cases were routed;
  3. otherwise "Unclassified" (no category, or category Other).
Every number that depends on it says which of the three it is. Change the mapping here only.

Visibility is the Sales screens' own: cases on the restaurants this person may see.
"""
from __future__ import annotations

import datetime as dt
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import Select, and_, case, extract, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import salesforce as m

UNCLASSIFIED = "Unclassified"
NO_CATEGORY = "(no category)"

# Case_Assigned_To__c API value -> label shown in Salesforce.
TEAM_LABELS: dict[str, str] = {
    "Care": "Care Tier 2", "Menu": "Menu", "Operations": "Operations", "Other": "Other team",
    "Payments": "Payments", "Product": "Product", "Sales": "Sales",
    "Field Service Engineering": "Field Service Engineering",
}

# Issue category -> the team that normally handles it (estimate; see module docstring).
CATEGORY_DEPARTMENT: dict[str, str] = {
    "Menu": "Menu", "Online Ordering": "Menu", "Schedule Change": "Menu",
    "Payment": "Payments", "Refund": "Payments",
    "Payment Terminal Error": "Field Service Engineering", "Printer": "Field Service Engineering",
    "Kiosk": "Field Service Engineering", "KDS": "Field Service Engineering", "POS": "Field Service Engineering",
    "Mobile POS": "Field Service Engineering", "Internet": "Field Service Engineering",
    "Router": "Field Service Engineering", "Ethernet Cable": "Field Service Engineering",
    "Power Cable": "Field Service Engineering",
    "Credentials": "Care Tier 2",
    "Sales": "Sales", "Cancelation": "Sales",
    "Website": "Marketing", "Marketing": "Marketing",
    # "Other" and no category -> Unclassified
}

SOURCES = ("recorded", "estimated", "unclassified")


def _team_label():
    c = m.SfCase.assigned_team
    return case(*[(c == k, literal(v)) for k, v in TEAM_LABELS.items()], else_=c)


def department_expr():
    """SQL for the department of a case (recorded team, else estimate, else Unclassified)."""
    c = m.SfCase
    estimated = case(*[(c.issue_category == k, literal(v)) for k, v in CATEGORY_DEPARTMENT.items()],
                     else_=literal(UNCLASSIFIED))
    return case((and_(c.assigned_team.is_not(None), c.assigned_team != ""), _team_label()), else_=estimated)


def source_expr():
    c = m.SfCase
    return case(
        (and_(c.assigned_team.is_not(None), c.assigned_team != ""), literal("recorded")),
        (c.issue_category.in_(list(CATEGORY_DEPARTMENT)), literal("estimated")),
        else_=literal("unclassified"),
    )


def category_expr():
    c = m.SfCase
    return func.coalesce(func.nullif(c.issue_category, ""), literal(NO_CATEGORY))


BLANK = "(blank)"


def blank_or(column):
    """A text column with NULL and '' shown (and filtered) as one "(blank)" value."""
    return func.coalesce(func.nullif(column, ""), literal(BLANK))


def _equals(column, value: str):
    """Filter matching blank_or(column) == value; uses the plain column for real values."""
    if value == BLANK:
        return or_(column.is_(None), column == "")
    return column == value


def handler_label():
    """Who has the case: the Salesforce user's name, else the queue (each queue told apart)."""
    c = m.SfCase
    return func.coalesce(
        m.SfUser.name,
        case((c.owner_id.like("00G%"), literal("Queue ·") + func.right(c.owner_id, 4)), else_=literal("(unknown)")),
    )


def hours_to_close():
    c = m.SfCase
    return extract("epoch", c.sf_closed_at - c.sf_created_at) / 3600.0


@dataclass
class CaseFilters:
    state: str = "all"                     # open | closed | all
    from_: Optional[dt.date] = None        # created on/after (sales time zone)
    to: Optional[dt.date] = None           # created on/before
    department: Optional[str] = None
    category: Optional[str] = None         # a category, or NO_CATEGORY
    source: Optional[str] = None           # recorded | estimated | unclassified
    priority: Optional[str] = None
    origin: Optional[str] = None
    handled_by: Optional[str] = None       # case owner id (a care agent or queue)
    search: Optional[str] = None


def conditions(f: CaseFilters, tz: str) -> list[Any]:
    c = m.SfCase
    out: list[Any] = []
    if f.state == "open":
        out.append(c.is_closed.is_(False))
    elif f.state == "closed":
        out.append(c.is_closed.is_(True))
    local_day = func.date(func.timezone(tz, c.sf_created_at))
    if f.from_:
        out.append(local_day >= f.from_)
    if f.to:
        out.append(local_day <= f.to)
    if f.department:
        out.append(department_expr() == f.department)
    if f.category:
        out.append(category_expr() == f.category)
    if f.source:
        out.append(source_expr() == f.source)
    if f.priority:
        out.append(_equals(c.priority, f.priority))
    if f.origin:
        out.append(_equals(c.origin, f.origin))
    if f.handled_by:
        out.append(_equals(c.owner_id, f.handled_by))
    if f.search and f.search.strip():
        like = "%" + f.search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        out.append(or_(c.subject.ilike(like), c.case_number.ilike(like), c.details.ilike(like),
                       m.SfAccount.name.ilike(like)))
    return out


# Words that say nothing about the issue.
STOPWORDS = set("""
a an and are as at be but by can cant could did do does for from get got has have having he her his how i if in
into is it its just me my need needs no not of on or our please pos re fw fwd regarding request issue issues
problem problems help support case new that the their them there they this to up us was we were what when where
which who will with you your restaurant innowi hi hello thanks thank urgent asap today call called calling
""".split())
WORD = re.compile(r"[a-zA-Z][a-zA-Z'\-]{2,}")


def subject_words(subjects: list[Optional[str]], top: int = 30) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for s in subjects:
        seen = {w.lower().strip("'-") for w in WORD.findall(s or "")}
        counts.update(w for w in seen if w and w not in STOPWORDS)
    return [{"key": w, "count": n} for w, n in counts.most_common(top)]


async def insights(db: AsyncSession, base: Select, conds: list[Any]) -> dict[str, Any]:
    """Every breakdown for the filtered cases. `base` is a select on SfCase that already joins
    SfAccount (for visibility and search) and applies the person's scope."""
    scoped = base.where(*[x for x in conds if x is not None]).subquery()
    S = scoped.c  # columns of the filtered set

    async def grouped(*keys, label_names: tuple[str, ...], limit: Optional[int] = None, order_by_count=True):
        q = select(*keys, func.count().label("count"),
                   func.count().filter(S.is_closed.is_(False)).label("open"),
                   func.percentile_cont(0.5).within_group(S.hours).filter(S.is_closed.is_(True)).label("median_hours"))
        q = q.group_by(*keys)
        q = q.order_by(func.count().desc()) if order_by_count else q.order_by(*keys)
        if limit:
            q = q.limit(limit)
        rows = (await db.execute(q)).all()
        out = []
        for r in rows:
            item = {name: (r[i] if r[i] is not None else "(blank)") for i, name in enumerate(label_names)}
            item.update(count=int(r.count), open=int(r.open),
                        medianHoursToClose=round(float(r.median_hours), 1) if r.median_hours is not None else None)
            out.append(item)
        return out

    totals_row = (await db.execute(select(
        func.count().label("n"),
        func.count().filter(S.is_closed.is_(False)).label("open"),
        func.percentile_cont(0.5).within_group(S.hours).filter(S.is_closed.is_(True)).label("median_hours"),
        func.count().filter(S.category != NO_CATEGORY).label("categorised"),
        func.count().filter(S.source == "recorded").label("recorded"),
        func.count().filter(S.source == "estimated").label("estimated"),
        func.min(S.sf_created_at).label("first"), func.max(S.sf_created_at).label("last"),
    ))).one()

    month = func.to_char(S.created_local, "YYYY-MM")
    by_month_dept = (await db.execute(
        select(month.label("month"), S.department, func.count().label("count"))
        .group_by(month, S.department).order_by(month)
    )).all()

    matrix = (await db.execute(
        select(S.department, S.category, func.count().label("count")).group_by(S.department, S.category)
    )).all()

    top_restaurants = (await db.execute(
        select(S.account_id, S.account_name, func.count().label("count"),
               func.count().filter(S.is_closed.is_(False)).label("open"))
        .where(S.account_id.is_not(None)).group_by(S.account_id, S.account_name)
        .order_by(func.count().desc()).limit(15)
    )).all()

    subjects = (await db.execute(select(S.subject).order_by(S.sf_created_at.desc()).limit(8000))).scalars().all()
    n = int(totals_row.n)
    return {
        "totals": {
            "cases": n, "open": int(totals_row.open),
            "medianHoursToClose": round(float(totals_row.median_hours), 1) if totals_row.median_hours is not None else None,
            "categorised": int(totals_row.categorised),
            "departmentRecorded": int(totals_row.recorded), "departmentEstimated": int(totals_row.estimated),
            "departmentUnclassified": n - int(totals_row.recorded) - int(totals_row.estimated),
            "firstCreated": totals_row.first, "lastCreated": totals_row.last,
        },
        "byDepartment": await grouped(S.department, label_names=("key",)),
        "byCategory": await grouped(S.category, S.cat_department, label_names=("key", "department")),
        "bySource": await grouped(S.source, label_names=("key",)),
        "byPriority": await grouped(S.priority, label_names=("key",)),
        "byOrigin": await grouped(S.origin, label_names=("key",)),
        "byHandler": await grouped(S.handler_id, S.handler, label_names=("id", "key"), limit=15),
        "byMonth": [{"month": r.month, "department": r.department, "count": int(r.count)} for r in by_month_dept],
        "matrix": [{"department": r.department, "category": r.category, "count": int(r.count)} for r in matrix],
        "topRestaurants": [{"id": r.account_id, "key": r.account_name or r.account_id, "count": int(r.count),
                            "open": int(r.open)} for r in top_restaurants],
        "subjectWords": subject_words(list(subjects)),
        "mapping": [{"category": k, "department": v} for k, v in CATEGORY_DEPARTMENT.items()],
    }


def base_select(tz: str) -> Select:
    """One row per case with everything the breakdowns group by."""
    c = m.SfCase
    return (
        select(
            c.id, blank_or(c.status).label("status"), blank_or(c.priority).label("priority"),
            blank_or(c.origin).label("origin"), c.is_closed, c.sf_created_at, c.subject,
            blank_or(c.resolution_type).label("resolution_type"),
            c.account_id, m.SfAccount.name.label("account_name"),
            blank_or(c.owner_id).label("handler_id"),
            handler_label().label("handler"),
            department_expr().label("department"),
            source_expr().label("source"),
            category_expr().label("category"),
            case(*[(c.issue_category == k, literal(v)) for k, v in CATEGORY_DEPARTMENT.items()],
                 else_=literal(UNCLASSIFIED)).label("cat_department"),
            hours_to_close().label("hours"),
            func.timezone(tz, c.sf_created_at).label("created_local"),
        )
        .select_from(c)
        .outerjoin(m.SfAccount, m.SfAccount.id == c.account_id)
        .outerjoin(m.SfUser, m.SfUser.id == c.owner_id)
    )
