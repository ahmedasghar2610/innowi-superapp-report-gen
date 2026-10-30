"""SLA clock — pure functions, no database."""
from __future__ import annotations

import datetime as dt

from app.models.enums import TicketPriority as P
from app.modules.ops import sla

TZ = sla.SLA_TIMEZONE


def at(y, m, d, h=0, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=TZ)


# 2026-10-09 is a Friday, 2026-10-12 a Monday.
FRI_10 = at(2026, 10, 9, 10)


def test_weekend_does_not_count():
    assert sla.business_seconds_between(FRI_10, at(2026, 10, 12, 10)) == 24 * 3600
    assert sla.business_seconds_between(at(2026, 10, 10, 9), at(2026, 10, 11, 18)) == 0  # Sat → Sun
    assert sla.business_seconds_between(at(2026, 10, 12), at(2026, 10, 9)) == 0  # reversed


def test_add_business_seconds_skips_weekend():
    assert sla.add_business_seconds(FRI_10, 24 * 3600) == at(2026, 10, 12, 10)
    # Starting on a Saturday counts from Monday midnight.
    assert sla.add_business_seconds(at(2026, 10, 10, 15), 3600) == at(2026, 10, 12, 1)
    # Round trip.
    end = sla.add_business_seconds(FRI_10, 100_000)
    assert sla.business_seconds_between(FRI_10, end) == 100_000


def test_targets_by_priority():
    assert sla.response_due(FRI_10, P.URGENT) == at(2026, 10, 9, 12)
    assert sla.resolution_due(FRI_10, P.URGENT) == at(2026, 10, 12, 10)
    assert sla.resolution_due(FRI_10, P.MEDIUM) == at(2026, 10, 16, 10)  # 5 working days
    # Paused time pushes the resolution due date out.
    assert sla.resolution_due(FRI_10, P.URGENT, paused_seconds=3600) == at(2026, 10, 12, 11)


def _eval(now, **kw):
    base = dict(
        priority=P.HIGH,
        response_due_at=sla.response_due(FRI_10, P.HIGH),
        resolution_due_at=sla.resolution_due(FRI_10, P.HIGH),
        first_response_at=None,
        completed_at=None,
        paused_at=None,
    )
    base.update(kw)
    return sla.evaluate(now=now, **base)


def test_states():
    # Fresh: on track, response pending.
    v = _eval(at(2026, 10, 9, 11))
    assert v.state == "on_track" and v.response_state == "pending"
    # Response deadline (4h) passed with no response.
    assert _eval(at(2026, 10, 9, 15)).response_state == "breached"
    assert _eval(at(2026, 10, 9, 15), first_response_at=at(2026, 10, 9, 11)).response_state == "met"
    # Under 25% of the 48h target left → at risk (due Tue 10:00; Mon 23:00 leaves 11h).
    assert _eval(at(2026, 10, 12, 23)).state == "at_risk"
    assert _eval(at(2026, 10, 12, 21)).state == "on_track"
    # Past due.
    late = _eval(at(2026, 10, 14, 10))
    assert late.state == "breached" and late.remaining_seconds < 0
    # Done in time / late.
    assert _eval(at(2026, 10, 20), completed_at=at(2026, 10, 12, 9)).state == "met"
    assert _eval(at(2026, 10, 20), completed_at=at(2026, 10, 15, 9)).state == "breached"
    # Paused: frozen remaining, whatever "now" is.
    p1 = _eval(at(2026, 10, 12, 10), paused_at=at(2026, 10, 9, 22))
    p2 = _eval(at(2026, 10, 30), paused_at=at(2026, 10, 9, 22))
    assert p1.state == p2.state == "paused" and p1.remaining_seconds == p2.remaining_seconds > 0
