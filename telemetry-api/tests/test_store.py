"""The Mongo store (sprint_5 5.8; agents/backend_engineer.md rule 4), over mongomock's motor stand-in: one insert of
exactly ``{payload, received_at}``, the document holding nothing else but its ``_id``, the hash of the install id and
the day; one install's day stored once however often it comes (Sprint 5 close, tech review TECH-3); a ping; and the two
indexes the first call makes (Sprint 7 close, privacy review gap 8, security review SEC-4): one deletes a document
``RETENTION_DAYS`` after it arrived, the other serves the sums' days.
"""

import asyncio
from datetime import UTC, datetime

from mongomock_motor import AsyncMongoMockClient

from app.store import RETENTION_DAYS, Document, MongoStore, document_id

AT = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
PAYLOAD: dict[str, object] = {
    "installId": "4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    "dayBucket": "2026-10-09",
    "chromeMajor": 154,
}


def test_stores_exactly_the_payload_and_when_it_came() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    store = MongoStore("mongodb://unused", "attest_telemetry", mock)

    async def run() -> list[dict[str, object]]:
        await store.insert(PAYLOAD, AT)
        found: list[dict[str, object]] = await mock["attest_telemetry"]["aggregates"].find().to_list(None)
        return found

    [document] = asyncio.run(run())
    assert sorted(document) == ["_id", "payload", "received_at"]
    assert document["_id"] == document_id(PAYLOAD)
    assert document["payload"] == PAYLOAD
    assert document["received_at"] in (AT, AT.replace(tzinfo=None))


def test_stores_one_install_s_day_once() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    store = MongoStore("mongodb://unused", "attest_telemetry", mock)

    async def run() -> tuple[list[bool], int]:
        stored = [await store.insert(PAYLOAD, AT), await store.insert(PAYLOAD, AT)]
        stored.append(await store.insert({**PAYLOAD, "dayBucket": "2026-10-10"}, AT))
        count: int = await mock["attest_telemetry"]["aggregates"].count_documents({})
        return stored, count

    assert asyncio.run(run()) == ([True, False, True], 2)


def test_pings() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    store = MongoStore("mongodb://unused", "attest_telemetry", mock)
    assert asyncio.run(store.ping()) is True


def test_the_first_call_makes_the_retention_and_day_indexes() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    store = MongoStore("mongodb://unused", "attest_telemetry", mock)

    async def run() -> dict[str, dict[str, object]]:
        await store.insert(PAYLOAD, AT)
        await store.insert({**PAYLOAD, "dayBucket": "2026-10-10"}, AT)
        return dict(await mock["attest_telemetry"]["aggregates"].index_information())

    indexes = asyncio.run(run())
    keys = {str(index["key"]): index for index in indexes.values()}
    assert RETENTION_DAYS == 90
    assert keys["[('received_at', 1)]"]["expireAfterSeconds"] == RETENTION_DAYS * 86_400
    assert "expireAfterSeconds" not in keys["[('payload.dayBucket', 1)]"]
    assert len(indexes) == 3
