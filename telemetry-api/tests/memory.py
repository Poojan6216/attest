"""A store that keeps the documents in a list, for the tests (Sprint 5 close, tech review TECH-11: moved out of the
app's package, so the image ships no test double). It keeps one document per install and day, as ``MongoStore`` does.
"""

from datetime import datetime

from app.stats import AGENTS, GRADES, Totals
from app.store import Document, StoreError, document_id


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

    async def totals(self, since: str, until: str) -> Totals:
        """The window's sums, as ``MongoStore`` makes them; ``StoreError`` while it is down."""
        if not self.up:
            message = "the store is down"
            raise StoreError(message)
        days = [
            document["payload"]
            for document in self.documents
            if isinstance(document["payload"], dict) and since <= str(document["payload"]["dayBucket"]) <= until
        ]
        counts = {
            agent: {grade: sum(int(day["counts"][agent][grade]) for day in days) for grade in GRADES}
            for agent in AGENTS
        }
        return Totals(installs=len({day["installId"] for day in days}), counts=counts)
