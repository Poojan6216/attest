"""The telemetry API at its edges (Sprint 5 QA review; sprint_5 5.8; agents/backend_engineer.md).

tests/test_api.py holds every route and status the API answers on purpose. Not held there:

- an error nobody planned for (a store that fails in a way it does not name) is answered 500 in the one shape, with
  no stack trace and nothing of the payload, and the API's own log line holds the event and the status alone;
- the size limit's exact edge: a body of exactly ``max_body_bytes`` is read, one byte more is refused (413), and
  nothing of it is stored;
- the Mongo store when the database is down: an insert raises ``StoreError``, whose message names no payload, and a
  ping says ``False`` (tests/test_store.py runs only a database that answers).

Every value is invented.
"""

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ServerSelectionTimeoutError

from app.main import create_app
from app.settings import Settings
from app.store import Document, MongoStore, StoreError
from tests.memory import MemoryStore

CASES: dict[str, Any] = json.loads((Path(__file__).parent / "payload-cases.json").read_text("utf-8"))
VALID: dict[str, Any] = CASES["valid"]
JSON = {"content-type": "application/json"}
AT = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


def settings() -> Settings:
    """The API's settings for these tests: the defaults, one allowed extension."""
    return Settings(mongo_url="mongodb://unused", allowed_ext_ids="a" * 32)


class BrokenStore(MemoryStore):
    """A store whose insert fails in a way the API does not name (not a ``StoreError``)."""

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Fails, its message quoting what it was given, as a careless error might."""
        message = f"unexpected: {json.dumps(payload)} at {received_at.isoformat()}"
        raise RuntimeError(message)


def test_an_unplanned_error_is_answered_500_in_the_one_shape_and_logged_by_event_and_status(
    capsys: pytest.CaptureFixture[str],
) -> None:
    api = TestClient(create_app(settings(), BrokenStore(), lambda: AT), raise_server_exceptions=False)
    answer = api.post("/v1/aggregate", content=json.dumps(VALID), headers=JSON)
    assert answer.status_code == 500
    assert answer.json() == {"success": False, "data": None, "error": "The request failed."}
    assert "Traceback" not in answer.text
    assert VALID["installId"] not in answer.text
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    assert lines == [{"event": "request.failed", "status": 500}]


def test_a_body_of_exactly_the_limit_is_read_and_one_byte_more_is_refused() -> None:
    limit = settings().max_body_bytes
    payload = json.dumps(VALID)
    store = MemoryStore()
    api = TestClient(create_app(settings(), store, lambda: AT))
    at_limit = payload + " " * (limit - len(payload.encode("utf-8")))
    assert len(at_limit.encode("utf-8")) == limit
    assert api.post("/v1/aggregate", content=at_limit, headers=JSON).status_code == 204
    over = at_limit + " "
    refused = api.post("/v1/aggregate", content=over, headers=JSON)
    assert refused.status_code == 413
    assert refused.json() == {"success": False, "data": None, "error": "The payload is larger than any Attest sends."}
    assert len(store.documents) == 1


class DownCollection:
    """A collection whose server never answers."""

    async def create_index(self, keys: list[tuple[str, int]], **_options: object) -> None:
        """Fails as motor does when no server answers."""
        message = f"no server answered for an index of {len(keys)} keys"
        raise ServerSelectionTimeoutError(message)

    async def insert_one(self, document: Document) -> None:
        """Fails as motor does when no server answers."""
        message = f"no server answered for {len(document)} fields"
        raise ServerSelectionTimeoutError(message)


class DownDatabase:
    """A database of collections that never answer."""

    def __getitem__(self, name: str) -> DownCollection:
        """The collection ``name``."""
        return DownCollection()


class DownAdmin:
    """The admin database of a server that never answers."""

    async def command(self, name: str) -> None:
        """Fails as motor does when no server answers."""
        message = f"no server answered {name}"
        raise ServerSelectionTimeoutError(message)


class DownClient:
    """A motor client whose server never answers."""

    admin = DownAdmin()

    def __getitem__(self, name: str) -> DownDatabase:
        """The database ``name``."""
        return DownDatabase()


def down_store() -> MongoStore:
    """The Mongo store over a client whose server never answers."""
    client = cast("AsyncIOMotorClient[Document]", DownClient())
    return MongoStore("mongodb://unused", "attest_telemetry", client)


def test_the_mongo_store_raises_store_error_naming_no_payload_when_the_database_is_down() -> None:
    payload: dict[str, object] = {"installId": VALID["installId"], "dayBucket": VALID["dayBucket"], "chromeMajor": 154}
    with pytest.raises(StoreError) as raised:
        asyncio.run(down_store().insert(payload, AT))
    assert str(raised.value) == "the database did not take the aggregate"
    assert VALID["installId"] not in str(raised.value)


def test_the_mongo_store_pings_false_when_the_database_is_down() -> None:
    assert asyncio.run(down_store().ping()) is False


def test_a_database_down_under_the_real_store_is_answered_503_and_health_says_so() -> None:
    api = TestClient(create_app(settings(), down_store(), lambda: AT))
    answer = api.post("/v1/aggregate", content=json.dumps(VALID), headers=JSON)
    assert answer.status_code == 503
    assert answer.json() == {"success": False, "data": None, "error": "The database does not answer."}
    health = api.get("/health")
    assert health.status_code == 503
    assert health.json()["success"] is False
