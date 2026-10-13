"""What the stats and report tests share (Sprint 7 close, tech review TECH-9: helpers kept out of a test module): a
clock the test moves, invented installs, their reports about October 2026 arriving as the extension sends them (at
06:00 UTC the day after the day), the API over a store holding them, and what the report script's opener answers. On
``NOON``, 20 November 2026, October is the month published, until ``NOVEMBER_PUBLISHED`` (app/days.py). Every value is
invented.
"""

import asyncio
import copy
import json
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from types import TracebackType
from typing import Any, Self

from fastapi.testclient import TestClient

from app.main import create_app
from app.schema import AGENTS, GRADES
from app.settings import Settings
from app.stats import MIN_DAYS, MIN_INSTALLS
from tests.memory import MemoryStore

CASES: dict[str, Any] = json.loads((Path(__file__).parent / "payload-cases.json").read_text("utf-8"))
NOON = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
OCTOBER = (date(2026, 10, 1), date(2026, 10, 31))
NOVEMBER_PUBLISHED = datetime(2026, 12, 4, 0, 0, tzinfo=UTC)

#: A report, and when it arrived.
type Sent = tuple[dict[str, Any], datetime]


class Clock:
    """A clock the test moves."""

    def __init__(self, at: datetime = NOON) -> None:
        """At ``at``, ``NOON`` unless said."""
        self.at = at

    def __call__(self) -> datetime:
        """The time it says."""
        return self.at


def install(n: int) -> str:
    """Install ``n``'s id, a UUID v4."""
    return f"{n:08x}-0000-4000-8000-000000000000"


def report(n: int, day: date, *, agent: str = "muse", **grades: int) -> dict[str, Any]:
    """Install ``n``'s payload about ``day``: ``agent``'s receipts as given, every other count none."""
    payload: dict[str, Any] = copy.deepcopy(CASES["valid"])
    payload["installId"] = install(n)
    payload["dayBucket"] = day.isoformat()
    payload["counts"] = {name: dict.fromkeys(GRADES, 0) for name in AGENTS}
    payload["counts"][agent].update(grades)
    return payload


def sent(n: int, day: date, *, agent: str = "muse", **grades: int) -> Sent:
    """Install ``n``'s report about ``day`` (``report``), arriving at 06:00 UTC the day after."""
    return report(n, day, agent=agent, **grades), datetime.combine(day + timedelta(days=1), time(6), UTC)


def month_of(n: int, days: int = MIN_DAYS, *, agent: str = "muse", **grades: int) -> list[Sent]:
    """Install ``n``'s reports about October's first ``days`` days, each with ``agent``'s receipts as given."""
    return [sent(n, OCTOBER[0] + timedelta(days=d), agent=agent, **grades) for d in range(days)]


def fifty(**muse: int) -> list[Sent]:
    """``MIN_INSTALLS`` installs that count: each reports about ``MIN_DAYS`` days of October, every day with Muse's
    receipts as given."""
    return [one for n in range(MIN_INSTALLS) for one in month_of(n, agent="muse", **muse)]


def store_of(reports: list[Sent]) -> MemoryStore:
    """A store holding ``reports``."""
    store = MemoryStore()
    for payload, received in reports:
        asyncio.run(store.insert(payload, received))
    return store


def api(reports: list[Sent], **settings: int) -> tuple[TestClient, MemoryStore, Clock]:
    """The API on ``NOON`` over a store holding ``reports``, with any settings given."""
    store, clock = store_of(reports), Clock()
    app = create_app(Settings.model_validate({"mongo_url": "mongodb://unused", **settings}), store, clock)
    return TestClient(app), store, clock


def stats_answer(installs: int) -> tuple[int, Any]:
    """The API's own answer to ``GET /v1/stats`` on ``NOON`` over ``installs`` installs that count, each reporting
    three days of Muse's receipts, 3 VERIFIED and 1 NOT_FOUND a day: its status and its body (``None`` when empty)."""
    client, _, _ = api([one for n in range(installs) for one in month_of(n, VERIFIED=3, NOT_FOUND=1)])
    response = client.get("/v1/stats")
    return response.status_code, response.json() if response.content else None


class Answer:
    """What the report script's opener returns: a status and a body."""

    def __init__(self, status: int, body: object) -> None:
        """An answer of ``status`` with ``body`` as JSON, or as it is when it is bytes."""
        self.status = status
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def read(self) -> bytes:
        """The body."""
        return self._body

    def __enter__(self) -> Self:
        """Itself."""
        return self

    def __exit__(self, *_: type[BaseException] | BaseException | TracebackType | None) -> None:
        """Nothing to close."""


class Opener:
    """The report script's opener, answering every address with ``answer`` or failing with ``error``; it keeps the
    addresses it was asked to open."""

    def __init__(self, answer: Answer | None = None, error: BaseException | None = None) -> None:
        """Answers ``answer``, or raises ``error``."""
        self.answer = answer
        self.error = error
        self.opened: list[str] = []

    def open(self, address: str, timeout: float) -> Answer:
        """The answer (header)."""
        self.opened.append(address)
        if self.error is not None:
            raise self.error
        assert self.answer is not None
        assert timeout > 0
        return self.answer
