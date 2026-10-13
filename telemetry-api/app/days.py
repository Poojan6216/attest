"""The days the telemetry API takes, and the month it publishes (Sprint 7 close: security review SEC-1 and SEC-2,
privacy review gap 10).

The extension sends one report a day, about its own yesterday, worked out when it sends
(extension/src/telemetry/aggregate.ts ``reportedDay``): a day it missed is never sent later. In every time zone, that
day is from two days before the server's UTC date to the date itself. ``takes_day`` takes a day from ``LATE_DAYS``
before the server's date to the day after, and refuses the rest, so no one can fill a month with days long past or
still to come.

``published_month`` is the calendar month ``GET /v1/stats`` publishes: the latest whose last day is a whole day before
the last date that takes a report about it. No report about any of its days can still be stored, so every answer about
a month is the same answer, and no two answers can be subtracted to find what one install sent.
"""

from datetime import date, timedelta

#: The most days a report's day may be before the server's UTC date and still be taken (header).
LATE_DAYS = 2

#: A month: its first day and its last.
type Month = tuple[date, date]


def takes_day(day: date, today: date) -> bool:
    """Whether a report about ``day`` is taken on ``today``: from ``LATE_DAYS`` before it to the day after (header)."""
    return today - timedelta(days=LATE_DAYS) <= day <= today + timedelta(days=1)


def published_month(today: date) -> Month:
    """The month published on ``today`` (header): reports about its last day were taken until ``LATE_DAYS`` after it,
    and a whole day has passed since."""
    final = today - timedelta(days=LATE_DAYS + 2)
    last = (final + timedelta(days=1)).replace(day=1) - timedelta(days=1)
    return last.replace(day=1), last
