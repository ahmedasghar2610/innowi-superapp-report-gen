"""Calendar-month maths for reports. Pure; no database.

Reports cover whole calendar months only (never the 28-day scorecard or the
Blog Impact windows). Month-on-month compares with the month right before;
year-on-year is offered only when twelve months of history exist (MFR03)."""
from __future__ import annotations

import calendar
import datetime as dt
import re
from dataclasses import dataclass
from typing import Optional

MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")


@dataclass(frozen=True)
class Period:
    start: dt.date
    end: dt.date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    @property
    def month(self) -> str:
        return f"{self.start.year:04d}-{self.start.month:02d}"

    @property
    def label(self) -> str:
        return self.start.strftime("%B %Y")

    def dto(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "days": self.days, "month": self.month, "label": self.label}


def month_period(year: int, month: int) -> Period:
    last = calendar.monthrange(year, month)[1]
    return Period(dt.date(year, month, 1), dt.date(year, month, last))


def parse_month(value: Optional[str], today: Optional[dt.date] = None) -> Period:
    """'YYYY-MM' → that month; empty → the previous calendar month (the report month)."""
    if not value:
        return report_month(today or dt.date.today())
    m = MONTH_RE.match(value.strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise ValueError(f"'{value}' is not a month (YYYY-MM)")
    return month_period(int(m.group(1)), int(m.group(2)))


def report_month(today: dt.date) -> Period:
    """The previous calendar month — the one a report made today covers."""
    first_this = today.replace(day=1)
    last_prev = first_this - dt.timedelta(days=1)
    return month_period(last_prev.year, last_prev.month)


def previous_month(p: Period) -> Period:
    last_prev = p.start - dt.timedelta(days=1)
    return month_period(last_prev.year, last_prev.month)


def shift_months(p: Period, months: int) -> Period:
    idx = p.start.year * 12 + (p.start.month - 1) - months
    return month_period(idx // 12, idx % 12 + 1)


def has_ended(p: Period, today: dt.date) -> bool:
    return p.end < today


def yoy_available(first_data_date: Optional[dt.date], p: Period) -> bool:
    """True when data exists for the same month a year earlier (12 months of history)."""
    if not first_data_date:
        return False
    return first_data_date <= shift_months(p, 12).start


def change(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
    """Relative change as a fraction (0.12 = +12 %). None when either side is missing or prev is 0."""
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / prev, 4)
