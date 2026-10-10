"""Where the aggregates go (sprint_5 5.8; agents/backend_engineer.md rule 4): one insert per accepted payload, of
exactly ``{payload, received_at}``. Never the address, never a header. ``MongoStore`` is the motor client's;
``MemoryStore`` keeps the documents in a list, for the tests. A database that does not take a document raises
``StoreError``, which the API answers with 503.
"""

from datetime import datetime
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import PyMongoError

type Document = dict[str, object]


class StoreError(Exception):
    """The database did not take a document. Its message names no payload."""


class Store(Protocol):
    """Stores one aggregate, and says whether the database answers."""

    async def insert(self, payload: dict[str, object], received_at: datetime) -> None:
        """Stores ``{payload, received_at}``."""

    async def ping(self) -> bool:
        """Whether the database answers."""


class MongoStore:
    """The aggregates collection of ``db`` at ``url``."""

    def __init__(self, url: str, db: str, client: AsyncIOMotorClient[Document] | None = None) -> None:
        """A client of ``url`` that waits at most two seconds for the server, or ``client`` (the tests' stand-in)."""
        self._client: AsyncIOMotorClient[Document] = client or AsyncIOMotorClient(url, serverSelectionTimeoutMS=2_000)
        self._aggregates = self._client[db]["aggregates"]

    async def insert(self, payload: dict[str, object], received_at: datetime) -> None:
        """Stores ``{payload, received_at}`` (header), and nothing else; ``StoreError`` when the database does not."""
        try:
            await self._aggregates.insert_one({"payload": payload, "received_at": received_at})
        except PyMongoError as error:
            message = "the database did not take the aggregate"
            raise StoreError(message) from error

    async def ping(self) -> bool:
        """Whether the server answers a ping."""
        try:
            await self._client.admin.command("ping")
        except PyMongoError:
            return False
        return True


class MemoryStore:
    """The documents stored, in a list (the tests read it)."""

    def __init__(self) -> None:
        """An empty store that answers pings."""
        self.documents: list[Document] = []
        self.up = True

    async def insert(self, payload: dict[str, object], received_at: datetime) -> None:
        """Keeps ``{payload, received_at}``; ``StoreError`` while it is down."""
        if not self.up:
            message = "the store is down"
            raise StoreError(message)
        self.documents.append({"payload": payload, "received_at": received_at})

    async def ping(self) -> bool:
        """Whether this store is up."""
        return self.up
