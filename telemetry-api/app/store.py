"""Where the aggregates go (sprint_5 5.8; agents/backend_engineer.md rule 4): one document per install and day, of
exactly ``{_id, payload, received_at}``. Never the address, never a header. The extension sends a day again when it
did not see the API's answer, so delivery is at least once (Sprint 5 close, tech review TECH-3): the ``_id`` is the
SHA-256 of the install id and the day, and a day already stored is not stored again. ``MongoStore`` is the motor
client's; the tests keep theirs in memory (tests/memory.py). A database that does not take a document, or does not
answer a sum, raises ``StoreError``, which the API answers with 503. The sums of a window (sprint_7 7.5, app/stats.py)
count distinct installs and add up each agent's grades; they read nothing else of a payload.
"""

import hashlib
from datetime import datetime
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.stats import AGENTS, GRADES, Totals

type Document = dict[str, object]


class StoreError(Exception):
    """The database did not take a document. Its message names no payload."""


def document_id(payload: dict[str, object]) -> str:
    """One install's day's id (header): the SHA-256 of its install id and its day, so a day has one document."""
    return hashlib.sha256(f"{payload['installId']}/{payload['dayBucket']}".encode()).hexdigest()


class Store(Protocol):
    """Stores one aggregate, and says whether the database answers."""

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Stores ``{payload, received_at}``; false, storing nothing, when the install's day is already stored."""

    async def ping(self) -> bool:
        """Whether the database answers."""

    async def totals(self, since: str, until: str) -> Totals:
        """The installs that reported a day from ``since`` to ``until``, and each agent's receipts by grade then."""


class MongoStore:
    """The aggregates collection of ``db`` at ``url``."""

    def __init__(self, url: str, db: str, client: AsyncIOMotorClient[Document] | None = None) -> None:
        """A client of ``url`` that waits at most two seconds for the server, or ``client`` (the tests' stand-in)."""
        self._client: AsyncIOMotorClient[Document] = client or AsyncIOMotorClient(url, serverSelectionTimeoutMS=2_000)
        self._aggregates = self._client[db]["aggregates"]

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Stores the day (header), and nothing else; false when it is stored already; ``StoreError`` when the database
        does not take it."""
        document = {"_id": document_id(payload), "payload": payload, "received_at": received_at}
        try:
            await self._aggregates.insert_one(document)
        except DuplicateKeyError:
            return False
        except PyMongoError as error:
            message = "the database did not take the aggregate"
            raise StoreError(message) from error
        return True

    async def ping(self) -> bool:
        """Whether the server answers a ping."""
        try:
            await self._client.admin.command("ping")
        except PyMongoError:
            return False
        return True

    async def totals(self, since: str, until: str) -> Totals:
        """Two sums over the window's days (header): distinct installs, and every agent's grades."""
        match: Document = {"$match": {"payload.dayBucket": {"$gte": since, "$lte": until}}}
        sums: Document = {
            f"{agent}_{grade}": {"$sum": f"$payload.counts.{agent}.{grade}"} for agent in AGENTS for grade in GRADES
        }
        try:
            installs = await self._aggregates.aggregate(
                [match, {"$group": {"_id": "$payload.installId"}}, {"$count": "installs"}],
            ).to_list(None)
            added = await self._aggregates.aggregate([match, {"$group": {"_id": None, **sums}}]).to_list(None)
        except PyMongoError as error:
            message = "the database did not answer a sum"
            raise StoreError(message) from error
        row = added[0] if added else {}
        return Totals(
            installs=whole(installs[0]["installs"]) if installs else 0,
            counts={agent: {grade: whole(row.get(f"{agent}_{grade}", 0)) for grade in GRADES} for agent in AGENTS},
        )


def whole(value: object) -> int:
    """A sum the database answered, as an int: every count it adds is one."""
    return int(value) if isinstance(value, int | float) else 0
