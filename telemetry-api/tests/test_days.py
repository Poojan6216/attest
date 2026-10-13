"""The days the API takes and the month it publishes (app/days.py; Sprint 7 close, security review SEC-1 and SEC-2):
every day the extension can send, from any time zone at any hour, is taken, and nothing further off; a month is
published from the fourth day after it ends, once no report about it can still be taken, until the next one is; and
no date takes a report about the month it publishes, so its answer can never change.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.days import LATE_DAYS, published_month, takes_day

TODAY = date(2026, 10, 10)


def test_takes_from_late_days_before_the_date_to_the_day_after() -> None:
    assert LATE_DAYS == 2
    assert [takes_day(TODAY + timedelta(days=n), TODAY) for n in range(-4, 4)] == [
        False,
        False,
        True,
        True,
        True,
        True,
        False,
        False,
    ]


@pytest.mark.parametrize("offset", range(-12, 15))
def test_takes_every_day_the_extension_sends_from_any_time_zone(offset: int) -> None:
    # The extension sends its local yesterday (extension/src/telemetry/aggregate.ts reportedDay), at any hour.
    for minute in range(0, 24 * 60, 15):
        moment = datetime(2026, 10, 10, tzinfo=UTC) + timedelta(minutes=minute)
        local = (moment + timedelta(hours=offset)).date()
        assert takes_day(local - timedelta(days=1), moment.date()), (offset, moment)


@pytest.mark.parametrize(
    ("today", "month"),
    [
        (date(2026, 11, 3), (date(2026, 9, 1), date(2026, 9, 30))),
        (date(2026, 11, 4), (date(2026, 10, 1), date(2026, 10, 31))),
        (date(2026, 11, 20), (date(2026, 10, 1), date(2026, 10, 31))),
        (date(2026, 12, 3), (date(2026, 10, 1), date(2026, 10, 31))),
        (date(2026, 12, 4), (date(2026, 11, 1), date(2026, 11, 30))),
        (date(2027, 1, 4), (date(2026, 12, 1), date(2026, 12, 31))),
        (date(2027, 3, 4), (date(2027, 2, 1), date(2027, 2, 28))),
        (date(2028, 3, 4), (date(2028, 2, 1), date(2028, 2, 29))),
    ],
)
def test_publishes_a_month_from_the_fourth_day_after_it(today: date, month: tuple[date, date]) -> None:
    assert published_month(today) == month


def test_no_date_takes_a_report_about_the_month_it_publishes() -> None:
    today = date(2026, 1, 1)
    while today < date(2028, 1, 1):
        first, last = published_month(today)
        assert not takes_day(last, today)
        assert not takes_day(last, today - timedelta(days=1)), today
        assert first <= last < today
        today += timedelta(days=1)
