"""The Mongo store (sprint_5 5.8; agents/backend_engineer.md rule 4), over mongomock's motor stand-in: one insert of
exactly ``{payload, received_at}``, the document holding nothing else but Mongo's own ``_id``; and a ping.
"""

import asyncio
from datetime import UTC, datetime

from mongomock_motor import AsyncMongoMockClient

from app.store import Document, MongoStore

AT = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
PAYLOAD: dict[str, object] = {"installId": "4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "chromeMajor": 154}


def test_stores_exactly_the_payload_and_when_it_came() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    store = MongoStore("mongodb://unused", "attest_telemetry", mock)

    async def run() -> list[dict[str, object]]:
        await store.insert(PAYLOAD, AT)
        found: list[dict[str, object]] = await mock["attest_telemetry"]["aggregates"].find().to_list(None)
        return found

    [document] = asyncio.run(run())
    assert sorted(document) == ["_id", "payload", "received_at"]
    assert document["payload"] == PAYLOAD
    assert document["received_at"] in (AT, AT.replace(tzinfo=None))


def test_pings() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    store = MongoStore("mongodb://unused", "attest_telemetry", mock)
    assert asyncio.run(store.ping()) is True
