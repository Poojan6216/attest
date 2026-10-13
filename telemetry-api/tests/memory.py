"""A store that keeps the documents in a list, for the tests (Sprint 5 close, tech review TECH-11: moved out of the
app's package, so the image ships no test double). It keeps one document per install and day, as ``MongoStore`` does,
and sums a month as ``MongoStore``'s pipeline does on MongoDB: only the documents with a payload, an install id, a day
in the month and an arrival time; only the installs whose documents arrived on enough UTC dates; and only counts that
are numbers, a boolean among them not one (mongomock adds ``true`` as 1, MongoDB does not: QA review, sprint 7, QA-12).
"""

from datetime import UTC, date, datetime

from app.schema import AGENTS, GRADES
from app.store import Document, StoreError, Totals, document_id


def arrived(moment: datetime) -> date:
    """The UTC date of ``moment``, a time without a zone read as UTC, as MongoDB stores it."""
    return (moment.astimezone(UTC) if moment.tzinfo is not None else moment).date()


def count(payload: dict[str, object], agent: str, grade: str) -> int:
    """The payload's count of ``agent``'s ``grade``; 0 when it holds none, or something that is not a number."""
    counts = payload.get("counts")
    grades = counts.get(agent) if isinstance(counts, dict) else None
    value = grades.get(grade) if isinstance(grades, dict) else None
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0


class MemoryStore:
    """The documents stored, in a list (the tests read it)."""

    def __init__(self) -> None:
        """An empty store that answers pings."""
        self.documents: list[Document] = []
        self.up = True
        self._ids: set[str] = set()

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Keeps ``{payload, received_at}`` once per install and day; ``StoreError`` while it is down."""
        if not self.up:
            message = "the store is down"
            raise StoreError(message)
        key = document_id(payload)
        if key in self._ids:
            return False
        self._ids.add(key)
        self.documents.append({"payload": payload, "received_at": received_at})
        return True

    async def ping(self) -> bool:
        """Whether this store is up."""
        return self.up

    async def totals(self, since: str, until: str, min_days: int) -> Totals:
        """The month's sums (header); ``StoreError`` while it is down."""
        if not self.up:
            message = "the store is down"
            raise StoreError(message)
        installs: dict[str, list[tuple[dict[str, object], datetime]]] = {}
        for document in self.documents:
            payload, received = document.get("payload"), document.get("received_at")
            if not isinstance(payload, dict) or not isinstance(received, datetime):
                continue
            day, install = payload.get("dayBucket"), payload.get("installId")
            if isinstance(day, str) and since <= day <= until and isinstance(install, str):
                installs.setdefault(install, []).append((payload, received))
        sums = [
            {
                (agent, grade): sum(count(payload, agent, grade) for payload, _ in days)
                for agent in AGENTS
                for grade in GRADES
            }
            for days in installs.values()
            if len({arrived(received) for _, received in days}) >= min_days
        ]
        return Totals(
            installs=len(sums),
            users={agent: sum(1 for one in sums if sum(one[agent, grade] for grade in GRADES) > 0) for agent in AGENTS},
            counts={agent: {grade: sum(one[agent, grade] for one in sums) for grade in GRADES} for agent in AGENTS},
        )
