"""The public aggregates (sprint_7 7.5; agents/backend_engineer.md rule 7; Sprint 7 close): ``GET /v1/stats``.

One answer a calendar month: the month app/days.py publishes, whose reports are all in, so every answer about it is the
same and no two can be subtracted to find what one install sent (security review SEC-1). An install counts only when
its reports about the month arrived on at least ``MIN_DAYS`` UTC dates, which a made-up install id has to keep up for
days (SEC-2). Over the installs that count: how many there are; and for each agent, how many of them had its receipts,
its receipts, how many were VERIFIED, NOT_FOUND and UNASKED, and each of those as a rate of its receipts. Never an
install id, a day, or anything a payload holds but its counts. With fewer than ``MIN_INSTALLS`` installs nothing is
published (204), and an agent fewer than ``MIN_INSTALLS`` of them used is ``null`` (privacy review gap 10): a rate of
a handful of people is no rate, and the reliability report never ships on one (launch/reliability-report-v0.md). The
install ids are random ones the extension makes, which the server cannot verify, so these floors make made-up installs
slow to add, not impossible; PRIVACY.md says so.

The answer is made once for its month, by one read of the store at a time however many ask (SEC-4; tech review
TECH-11), and a failed read is never kept. A client may keep it ``CACHE_SECONDS``, or until the month published
changes if that is sooner.
"""

import asyncio
import math
from datetime import UTC, date, datetime, time, timedelta

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.days import Month, published_month
from app.schema import AGENTS
from app.store import Store, StoreError, Totals

#: Fewer installs than this, in all or with an agent's receipts, and that is not published (header).
MIN_INSTALLS = 50
#: The fewest UTC dates an install's reports about the month must have arrived on for it to count (header).
MIN_DAYS = 3
#: The longest a client may keep an answer.
CACHE_SECONDS = 3_600


class Answer(BaseModel):
    """An answer's model: no key it does not name, each written in camelCase as the extension writes its keys (tech
    review TECH-9: snake_case in Python, camelCase on the wire)."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, validate_by_name=True, validate_by_alias=True)


class AgentStats(Answer):
    """One agent's month: how many installs had its receipts, its receipts, and three grades of them as counts and
    rates."""

    installs: int
    receipts: int
    verified: int
    not_found: int
    unasked: int
    verified_rate: float | None
    not_found_rate: float | None
    unasked_rate: float | None


class Stats(Answer):
    """The public aggregates (header): the month's first and last days, the installs that counted, and each agent's
    month, ``None`` below its floor."""

    installs: int
    since: str
    until: str
    agents: dict[str, AgentStats | None]


def rate(part: int, whole: int) -> float | None:
    """``part`` of ``whole``, to four places; ``None`` when there is no whole."""
    return None if whole == 0 else round(part / whole, 4)


def agent_stats(installs: int, counts: dict[str, int]) -> AgentStats | None:
    """One agent's month, from how many installs had its receipts and its receipts by grade; ``None`` below the
    floor."""
    if installs < MIN_INSTALLS:
        return None
    receipts = sum(counts.values())
    verified, not_found, unasked = counts["VERIFIED"], counts["NOT_FOUND"], counts["UNASKED"]
    return AgentStats(
        installs=installs,
        receipts=receipts,
        verified=verified,
        not_found=not_found,
        unasked=unasked,
        verified_rate=rate(verified, receipts),
        not_found_rate=rate(not_found, receipts),
        unasked_rate=rate(unasked, receipts),
    )


def stats_of(totals: Totals, month: Month) -> Stats | None:
    """The answer for ``month``'s ``totals`` (header); ``None`` below the floor, which is published as nothing."""
    if totals.installs < MIN_INSTALLS:
        return None
    first, last = month
    agents = {agent: agent_stats(totals.users[agent], totals.counts[agent]) for agent in AGENTS}
    return Stats(installs=totals.installs, since=first.isoformat(), until=last.isoformat(), agents=agents)


def seconds_left(moment: datetime) -> int:
    """How long a client may keep the answer made at ``moment`` (header): ``CACHE_SECONDS``, or until the UTC midnight
    at which another month is published if that is sooner."""
    today = moment.date()
    switch = today + timedelta(days=1)
    while published_month(switch) == published_month(today):
        switch += timedelta(days=1)
    left = datetime.combine(switch, time(), UTC) - moment
    return min(CACHE_SECONDS, math.ceil(left.total_seconds()))


class PublishedStats:
    """The answer ``GET /v1/stats`` serves (header): made once for the month published, by one read at a time."""

    def __init__(self, store: Store) -> None:
        """Nothing made yet: the first ask reads the store."""
        self._store = store
        self._lock = asyncio.Lock()
        self._month: Month | None = None
        self._stats: Stats | None = None
        self._finished = 0
        self._failed: Month | None = None

    async def of(self, today: date) -> Stats | None:
        """The answer on ``today``; ``StoreError`` when the store does not answer, and nothing kept. An ask that waited
        while another's read of the same month failed fails with it, so a store that does not answer is asked once,
        however many wait."""
        month = published_month(today)
        finished = self._finished
        async with self._lock:
            if self._month == month:
                return self._stats
            if self._finished != finished and self._failed == month:
                message = "the database did not answer a sum"
                raise StoreError(message)
            try:
                totals = await self._store.totals(month[0].isoformat(), month[1].isoformat(), MIN_DAYS)
            except StoreError:
                self._failed = month
                raise
            finally:
                self._finished += 1
            self._month, self._stats, self._failed = month, stats_of(totals, month), None
            return self._stats
