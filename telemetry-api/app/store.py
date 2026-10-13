"""Where the aggregates go (sprint_5 5.8; agents/backend_engineer.md rule 4): one document per install and day, of
exactly ``{_id, payload, received_at}``. Never the address, never a header. The extension sends a day again when it
did not see the API's answer, so delivery is at least once (Sprint 5 close, tech review TECH-3): the ``_id`` is the
SHA-256 of the install id and the day, and a day already stored is not stored again. ``MongoStore`` is the motor
client's; the tests keep theirs in memory (tests/memory.py). A database that does not take a document, or does not
answer a sum, raises ``StoreError``, which the API answers with 503.

A document is deleted ``RETENTION_DAYS`` after it arrived, by a TTL index on ``received_at`` (Sprint 7 close, privacy
review gap 8), and an index on the payload's day serves the sums (security review SEC-4). The first call to the store
in a process makes both; making one that exists changes nothing. MongoDB refuses a second TTL index on one field, so a
new ``RETENTION_DAYS`` takes a ``collMod`` on the deployed collection.

The sums of a month (app/stats.py) are one pipeline (tech review TECH-10), so the installs and the counts come from the
same documents. Per install: the UTC dates its documents about the month arrived on, and its counts. Then, over the
installs whose documents arrived on at least ``min_days`` dates: how many there are, how many had each agent's
receipts, and each agent's receipts by grade. Nothing else of a payload is read.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.schema import AGENTS, GRADES

type Document = dict[str, object]

#: How long a document is kept after it arrived (header): longer than the two months in which its month is read.
RETENTION_DAYS = 90


@dataclass(frozen=True)
class Totals:
    """A month's sums (header): the installs counted, how many of them had each agent's receipts, and each agent's
    receipts by grade."""

    installs: int
    users: dict[str, int]
    counts: dict[str, dict[str, int]]


class StoreError(Exception):
    """The database did not take a document, or did not answer a sum. Its message names no payload."""


def document_id(payload: dict[str, object]) -> str:
    """One install's day's id (header): the SHA-256 of its install id and its day, so a day has one document."""
    return hashlib.sha256(f"{payload['installId']}/{payload['dayBucket']}".encode()).hexdigest()


class Store(Protocol):
    """Stores one aggregate, says whether the database answers, and sums a month."""

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Stores ``{payload, received_at}``; false, storing nothing, when the install's day is already stored."""

    async def ping(self) -> bool:
        """Whether the database answers."""

    async def totals(self, since: str, until: str, min_days: int) -> Totals:
        """The sums of the days from ``since`` to ``until`` (header), over the installs whose documents about them
        arrived on at least ``min_days`` UTC dates."""


def sums(since: str, until: str, min_days: int) -> list[Document]:
    """``MongoStore.totals``'s one pipeline (header)."""
    per_install = {
        f"{agent}_{grade}": {"$sum": f"$payload.counts.{agent}.{grade}"} for agent in AGENTS for grade in GRADES
    }
    users = {
        f"{agent}_users": {
            "$sum": {"$cond": [{"$gt": [{"$add": [f"${agent}_{grade}" for grade in GRADES]}, 0]}, 1, 0]},
        }
        for agent in AGENTS
    }
    arrived = {"$dateToString": {"format": "%Y-%m-%d", "date": "$received_at"}}
    return [
        {
            "$match": {
                "payload.dayBucket": {"$gte": since, "$lte": until},
                "payload.installId": {"$type": "string"},
                "received_at": {"$type": "date"},
            },
        },
        {"$group": {"_id": "$payload.installId", "dates": {"$addToSet": arrived}, **per_install}},
        {"$match": {"$expr": {"$gte": [{"$size": "$dates"}, min_days]}}},
        {
            "$group": {
                "_id": None,
                "installs": {"$sum": 1},
                **{key: {"$sum": f"${key}"} for key in per_install},
                **users,
            }
        },
    ]


class MongoStore:
    """The aggregates collection of ``db`` at ``url``."""

    def __init__(self, url: str, db: str, client: AsyncIOMotorClient[Document] | None = None) -> None:
        """A client of ``url`` that waits at most two seconds for the server, or ``client`` (the tests' stand-in)."""
        self._client: AsyncIOMotorClient[Document] = client or AsyncIOMotorClient(url, serverSelectionTimeoutMS=2_000)
        self._aggregates = self._client[db]["aggregates"]
        self._indexed = False

    async def _index(self) -> None:
        """Makes the two indexes (header), once in this process."""
        if not self._indexed:
            await self._aggregates.create_index([("payload.dayBucket", 1)])
            await self._aggregates.create_index([("received_at", 1)], expireAfterSeconds=RETENTION_DAYS * 86_400)
            self._indexed = True

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Stores the day (header), and nothing else; false when it is stored already; ``StoreError`` when the database
        does not take it."""
        document = {"_id": document_id(payload), "payload": payload, "received_at": received_at}
        try:
            await self._index()
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

    async def totals(self, since: str, until: str, min_days: int) -> Totals:
        """The month's sums (header), from one pipeline."""
        try:
            await self._index()
            rows = await self._aggregates.aggregate(sums(since, until, min_days)).to_list(None)
        except PyMongoError as error:
            message = "the database did not answer a sum"
            raise StoreError(message) from error
        row = rows[0] if rows else {}
        return Totals(
            installs=whole(row.get("installs", 0)),
            users={agent: whole(row.get(f"{agent}_users", 0)) for agent in AGENTS},
            counts={agent: {grade: whole(row.get(f"{agent}_{grade}", 0)) for grade in GRADES} for agent in AGENTS},
        )


def whole(value: object) -> int:
    """A sum the database answered, as an int: every count it adds is one."""
    return int(value) if isinstance(value, int | float) else 0
