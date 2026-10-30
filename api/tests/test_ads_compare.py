"""Google Ads "vs previous period" — which period a report is compared with."""
import datetime as dt

import pytest

from app.modules.ads.reports import Period, compare_period, previous_period

D = dt.date


@pytest.mark.parametrize(
    "start,end,pstart,pend",
    [
        # whole months → the months right before
        (D(2026, 9, 1), D(2026, 9, 30), D(2026, 8, 1), D(2026, 8, 31)),
        (D(2026, 3, 1), D(2026, 3, 31), D(2026, 2, 1), D(2026, 2, 28)),
        (D(2026, 1, 1), D(2026, 3, 31), D(2025, 10, 1), D(2025, 12, 31)),
        (D(2026, 1, 1), D(2026, 1, 31), D(2025, 12, 1), D(2025, 12, 31)),
        # month to date → same days of the previous month (cut to its length)
        (D(2026, 10, 1), D(2026, 10, 23), D(2026, 9, 1), D(2026, 9, 23)),
        (D(2026, 3, 1), D(2026, 3, 30), D(2026, 2, 1), D(2026, 2, 28)),
        # anything else → the same number of days right before
        (D(2026, 10, 16), D(2026, 10, 22), D(2026, 10, 9), D(2026, 10, 15)),
        (D(2026, 10, 12), D(2026, 10, 18), D(2026, 10, 5), D(2026, 10, 11)),
        (D(2026, 10, 22), D(2026, 10, 22), D(2026, 10, 21), D(2026, 10, 21)),
        (D(2026, 9, 15), D(2026, 10, 14), D(2026, 8, 16), D(2026, 9, 14)),
    ],
)
def test_previous_period(start, end, pstart, pend):
    p = previous_period(Period(start, end))
    assert (p.start, p.end) == (pstart, pend)


def test_compare_param():
    p = Period(D(2026, 10, 16), D(2026, 10, 22))
    assert compare_period(p, None) is None and compare_period(p, "none") is None
    assert compare_period(p, "previous").days == 7
    with pytest.raises(ValueError):
        compare_period(p, "lastyear")
