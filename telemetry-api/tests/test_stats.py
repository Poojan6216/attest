"""``GET /v1/stats`` (sprint_7 7.5; agents/backend_engineer.md rule 7; app/stats.py), over the in-memory store, and its
sums over mongomock's motor stand-in too: nothing (204) below 50 installs, the current small dataset among them; at 50,
each agent's receipts and its VERIFIED, NOT_FOUND and UNASKED counts and rates over the 30 days before today, a day
outside them left out and a rate null when the agent has no receipt; never an install id; one answer an hour, which
Cache-Control says; 503 when the database does not answer.
"""

import asyncio
import copy
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.main import create_app
from app.settings import Settings
from app.stats import MIN_INSTALLS, WINDOW_DAYS
from app.store import Document, MongoStore
from tests.memory import MemoryStore

CASES: dict[str, Any] = json.loads((Path(__file__).parent / "payload-cases.json").read_text("utf-8"))
NOON = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
YESTERDAY = (NOON.date() - timedelta(days=1)).isoformat()
ZERO = {"VERIFIED": 0, "PARTIAL": 0, "NOT_FOUND": 0, "UNASKED": 0, "OVER_SCOPE": 0, "UNVERIFIABLE": 0}


class Clock:
    """A clock the test moves."""

    def __init__(self) -> None:
        """Noon on 20 November 2026, UTC."""
        self.at = NOON

    def __call__(self) -> datetime:
        """The time it says."""
        return self.at


def install(n: int) -> str:
    """Install ``n``'s id, a UUID v4."""
    return f"{n:08x}-0000-4000-8000-000000000000"


def day_of(n: int, day: str, **muse: int) -> dict[str, Any]:
    """Install ``n``'s payload for ``day``: Muse's receipts as given, every other agent's none."""
    payload: dict[str, Any] = copy.deepcopy(CASES["valid"])
    payload["installId"] = install(n)
    payload["dayBucket"] = day
    payload["counts"] = {agent: dict(ZERO) for agent in ("muse", "chatgpt", "dots", "claude")}
    payload["counts"]["muse"].update(muse)
    return payload


def api(payloads: list[dict[str, Any]]) -> tuple[TestClient, MemoryStore, Clock]:
    """The API over a store holding ``payloads``."""
    store = MemoryStore()
    for payload in payloads:
        asyncio.run(store.insert(payload, NOON))
    clock = Clock()
    return TestClient(create_app(Settings(mongo_url="mongodb://unused"), store, clock)), store, clock


def fifty(**muse: int) -> list[dict[str, Any]]:
    """``MIN_INSTALLS`` installs' yesterdays, each with Muse's receipts as given."""
    return [day_of(n, YESTERDAY, **muse) for n in range(MIN_INSTALLS)]


def test_publishes_nothing_below_50_installs_and_says_how_long_that_holds() -> None:
    client, _, _ = api(fifty(VERIFIED=1)[: MIN_INSTALLS - 1])
    response = client.get("/v1/stats")
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_publishes_nothing_on_the_current_small_dataset() -> None:
    client, _, _ = api([day_of(1, YESTERDAY, VERIFIED=3), day_of(2, YESTERDAY, NOT_FOUND=1)])
    assert client.get("/v1/stats").status_code == 204


def test_sums_each_agent_over_the_window_with_its_rates_and_none_without_receipts() -> None:
    client, _, _ = api(fifty(VERIFIED=2, PARTIAL=1, NOT_FOUND=1, UNASKED=1, OVER_SCOPE=0, UNVERIFIABLE=0))
    response = client.get("/v1/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    data = body["data"]
    since = (NOON.date() - timedelta(days=WINDOW_DAYS)).isoformat()
    assert (data["installs"], data["since"], data["until"]) == (MIN_INSTALLS, since, YESTERDAY)
    assert data["agents"]["muse"] == {
        "receipts": 250,
        "verified": 100,
        "notFound": 50,
        "unasked": 50,
        "verifiedRate": 0.4,
        "notFoundRate": 0.2,
        "unaskedRate": 0.2,
    }
    assert data["agents"]["claude"] == {
        "receipts": 0,
        "verified": 0,
        "notFound": 0,
        "unasked": 0,
        "verifiedRate": None,
        "notFoundRate": None,
        "unaskedRate": None,
    }


def test_leaves_out_a_day_outside_the_window_and_its_install() -> None:
    first = (NOON.date() - timedelta(days=WINDOW_DAYS)).isoformat()
    outside = [
        day_of(100, NOON.date().isoformat(), VERIFIED=7),
        day_of(101, (NOON.date() - timedelta(days=WINDOW_DAYS + 1)).isoformat(), VERIFIED=7),
    ]
    client, _, _ = api([*fifty(VERIFIED=1), day_of(102, first, NOT_FOUND=1), *outside])
    data = client.get("/v1/stats").json()["data"]
    assert data["installs"] == MIN_INSTALLS + 1
    assert (data["agents"]["muse"]["verified"], data["agents"]["muse"]["notFound"]) == (MIN_INSTALLS, 1)


def test_never_names_an_install_id() -> None:
    client, _, _ = api(fifty(VERIFIED=1))
    text = client.get("/v1/stats").text
    assert all(install(n) not in text for n in range(MIN_INSTALLS))
    assert "installId" not in text


def test_keeps_one_answer_an_hour() -> None:
    client, store, clock = api(fifty(VERIFIED=1))
    assert client.get("/v1/stats").json()["data"]["installs"] == MIN_INSTALLS
    asyncio.run(store.insert(day_of(500, YESTERDAY, VERIFIED=1), NOON))
    clock.at = NOON + timedelta(minutes=59)
    assert client.get("/v1/stats").json()["data"]["installs"] == MIN_INSTALLS
    clock.at = NOON + timedelta(hours=1)
    assert client.get("/v1/stats").json()["data"]["installs"] == MIN_INSTALLS + 1


def test_answers_503_when_the_database_does_not() -> None:
    client, store, _ = api(fifty(VERIFIED=1))
    store.up = False
    response = client.get("/v1/stats")
    assert response.status_code == 503
    assert response.json() == {"success": False, "data": None, "error": "The database does not answer."}


def test_mongo_sums_what_the_memory_store_sums() -> None:
    payloads = [
        *fifty(VERIFIED=2, UNASKED=1),
        day_of(7, (NOON.date() - timedelta(days=3)).isoformat(), NOT_FOUND=4),
        day_of(8, NOON.date().isoformat(), VERIFIED=9),
    ]
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    mongo = MongoStore("mongodb://unused", "attest_telemetry", mock)
    memory = MemoryStore()

    async def run() -> tuple[object, object]:
        for payload in payloads:
            await mongo.insert(payload, NOON)
            await memory.insert(payload, NOON)
        since = (date(2026, 11, 20) - timedelta(days=WINDOW_DAYS)).isoformat()
        return await mongo.totals(since, YESTERDAY), await memory.totals(since, YESTERDAY)

    from_mongo, from_memory = asyncio.run(run())
    assert from_mongo == from_memory
