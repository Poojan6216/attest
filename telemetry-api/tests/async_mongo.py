"""A stand-in for PyMongo's async client in the tests: mongomock's in-memory collections behind the few calls the store
(app/store.py) and the tests make, each answering as ``pymongo.AsyncMongoClient`` does. Its ``aggregate`` is a coroutine
that answers a cursor, unlike motor's, so mongomock-motor no longer fits (Decisions [7.close], 2026-10-14). The tests
hand it to the store as a client with ``cast``: it is the client's shape, not its type.
"""

from collections.abc import Iterable, Mapping, Sequence
from typing import Any, cast

import mongomock
from pymongo import AsyncMongoClient

from app.store import Document, MongoStore

type Row = dict[str, Any]


class AsyncCursor:
    """The rows a query or a pipeline answered, read with ``to_list`` as PyMongo's cursors are."""

    def __init__(self, rows: Iterable[Row]) -> None:
        """The rows, read at once: the stand-in never streams."""
        self._rows = list(rows)

    async def to_list(self, length: int | None = None) -> list[Row]:
        """Every row, or the first ``length``."""
        return self._rows if length is None else self._rows[:length]


class AsyncCollection:
    """A mongomock collection behind PyMongo's async calls."""

    def __init__(self, collection: "mongomock.Collection[Row]") -> None:
        """The in-memory collection."""
        self._collection = collection

    async def create_index(self, keys: Sequence[tuple[str, int]], **options: Any) -> str:  # noqa: ANN401
        """Makes the index, or does nothing when it exists."""
        return str(self._collection.create_index(list(keys), **options))

    async def insert_one(self, document: Mapping[str, Any]) -> object:
        """Stores one document, raising ``DuplicateKeyError`` on a stored ``_id``."""
        return self._collection.insert_one(dict(document))

    async def insert_many(self, documents: Iterable[Mapping[str, Any]]) -> object:
        """Stores each document."""
        return self._collection.insert_many([dict(document) for document in documents])

    async def count_documents(self, query: Mapping[str, Any]) -> int:
        """How many documents match."""
        return int(self._collection.count_documents(dict(query)))

    async def index_information(self) -> Row:
        """The indexes, by name."""
        return dict(self._collection.index_information())

    def find(self, query: Mapping[str, Any] | None = None) -> AsyncCursor:
        """The documents that match, as a cursor (PyMongo's ``find`` is not a coroutine)."""
        return AsyncCursor(self._collection.find(dict(query or {})))

    async def aggregate(self, pipeline: Sequence[Mapping[str, Any]]) -> AsyncCursor:
        """The pipeline's rows, as a cursor the coroutine answers (PyMongo's ``aggregate`` is one)."""
        return AsyncCursor(self._collection.aggregate([dict(stage) for stage in pipeline]))


class AsyncDatabase:
    """A mongomock database behind PyMongo's async calls."""

    def __init__(self, database: "mongomock.Database[Row]") -> None:
        """The in-memory database."""
        self._database = database

    def __getitem__(self, name: str) -> AsyncCollection:
        """The collection ``name``."""
        return AsyncCollection(self._database[name])

    async def command(self, name: str) -> Row:
        """Answers a command: the store sends ``ping``."""
        return dict(self._database.command(name))


class AsyncMongoMock:
    """The client: databases by name, and ``admin`` for ``ping``."""

    def __init__(self) -> None:
        """One in-memory server."""
        self._client: mongomock.MongoClient[Row] = mongomock.MongoClient()
        self.admin = AsyncDatabase(self._client["admin"])

    def __getitem__(self, name: str) -> AsyncDatabase:
        """The database ``name``."""
        return AsyncDatabase(self._client[name])


def store_over(mock: AsyncMongoMock) -> MongoStore:
    """The Mongo store over the stand-in, as the tests use it."""
    return MongoStore("mongodb://unused", "attest_telemetry", cast("AsyncMongoClient[Document]", mock))
