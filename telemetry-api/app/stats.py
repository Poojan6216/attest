"""The public aggregates (sprint_7 7.5; agents/backend_engineer.md rule 7): ``GET /v1/stats``.

Summed over every install's days of the last ``WINDOW_DAYS`` (each payload counts the day before it was sent, so the
window ends yesterday): for each agent, its receipts, how many were VERIFIED, NOT_FOUND and UNASKED, and each of those
as a rate of its receipts, ``None`` when it has none (no rate is made up, Hard Rule 5); and how many installs reported.
Never an install id, a day of one install, or anything a payload holds but its counts. With fewer than
``MIN_INSTALLS`` installs nothing is published (204): a rate of a handful of people is no rate, and the reliability
report never ships on one (launch/reliability-report-v0.md). An answer is kept ``CACHE_SECONDS`` and may be cached as
long by whoever reads it.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from pydantic import BaseModel, ConfigDict

#: The agents and the grades a payload counts (app/schema.py).
AGENTS = ("muse", "chatgpt", "dots", "claude")
GRADES = ("VERIFIED", "PARTIAL", "NOT_FOUND", "UNASKED", "OVER_SCOPE", "UNVERIFIABLE")

#: Fewer installs than this in the window, and nothing is published (header).
MIN_INSTALLS = 50
#: The days summed: the 30 before today.
WINDOW_DAYS = 30
#: How long an answer is kept, here and by a client.
CACHE_SECONDS = 3_600


@dataclass(frozen=True)
class Totals:
    """What the store sums over a window: the installs that reported, and each agent's receipts by grade."""

    installs: int
    counts: dict[str, dict[str, int]]


class Strict(BaseModel):
    """An answer's model: no key it does not name."""

    model_config = ConfigDict(extra="forbid")


class AgentStats(Strict):
    """One agent's receipts over the window, and three grades of them as counts and rates, in camelCase as every key the
    extension sends is."""

    receipts: int
    verified: int
    notFound: int
    unasked: int
    verifiedRate: float | None
    notFoundRate: float | None
    unaskedRate: float | None


class Stats(Strict):
    """The public aggregates (header)."""

    installs: int
    since: str
    until: str
    agents: dict[str, AgentStats]


def window(today: date) -> tuple[str, str]:
    """The first and the last day summed, as payloads write days: the ``WINDOW_DAYS`` before ``today``."""
    return (today - timedelta(days=WINDOW_DAYS)).isoformat(), (today - timedelta(days=1)).isoformat()


def rate(part: int, whole: int) -> float | None:
    """``part`` of ``whole``, to four places; ``None`` when there is no whole."""
    return None if whole == 0 else round(part / whole, 4)


def stats_of(totals: Totals, since: str, until: str) -> Stats | None:
    """The answer for ``totals`` (header); ``None`` below ``MIN_INSTALLS``, which is published as nothing."""
    if totals.installs < MIN_INSTALLS:
        return None
    agents: dict[str, AgentStats] = {}
    for agent in AGENTS:
        counts = totals.counts.get(agent, {})
        receipts = sum(counts.get(grade, 0) for grade in GRADES)
        verified, not_found, unasked = (counts.get(grade, 0) for grade in ("VERIFIED", "NOT_FOUND", "UNASKED"))
        agents[agent] = AgentStats(
            receipts=receipts,
            verified=verified,
            notFound=not_found,
            unasked=unasked,
            verifiedRate=rate(verified, receipts),
            notFoundRate=rate(not_found, receipts),
            unaskedRate=rate(unasked, receipts),
        )
    return Stats(installs=totals.installs, since=since, until=until, agents=agents)
