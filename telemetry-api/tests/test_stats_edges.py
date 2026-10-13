"""``GET /v1/stats`` at its edges (sprint_7 7.5; QA review, sprint 7): installs are distinct install ids, never the days
they sent; the answer kept an hour holds across the 50-install floor both ways, a failure is never kept and a kept
answer outlives an outage inside its hour; a rate is of every grade's receipts, to four places; Mongo's sums ignore a
count no payload could hold and a document outside every window, and a database error in a sum is a 503; and only GET
reads the stats, with no page of another site let in.
"""

import asyncio
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient
from pymongo.errors import ServerSelectionTimeoutError

from app.main import create_app
from app.settings import Settings
from app.stats import AGENTS, GRADES, MIN_INSTALLS, WINDOW_DAYS, Totals, rate
from app.store import Document, MongoStore, StoreError
from tests.test_stats import NOON, YESTERDAY, Clock, api, day_of, fifty

SINCE = (NOON.date() - timedelta(days=WINDOW_DAYS)).isoformat()


def days_ago(n: int) -> str:
    """The day ``n`` days before NOON's, as a payload writes it."""
    return (NOON.date() - timedelta(days=n)).isoformat()


def test_counts_installs_never_the_days_they_sent() -> None:
    below = [day_of(n, days_ago(d), VERIFIED=1) for n in range(MIN_INSTALLS - 1) for d in (1, 2, 3)]
    assert len(below) >= MIN_INSTALLS
    client, _, _ = api(below)
    assert client.get("/v1/stats").status_code == 204

    at = [day_of(n, days_ago(d), VERIFIED=1) for n in range(MIN_INSTALLS) for d in (1, 2)]
    data = api(at)[0].get("/v1/stats").json()["data"]
    assert data["installs"] == MIN_INSTALLS
    assert data["agents"]["muse"]["verified"] == 2 * MIN_INSTALLS


def test_mongo_counts_installs_never_the_days_they_sent() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    mongo = MongoStore("mongodb://unused", "attest_telemetry", mock)

    async def run() -> Totals:
        for n in range(3):
            for d in (1, 2, 3):
                await mongo.insert(day_of(n, days_ago(d), VERIFIED=1), NOON)
        return await mongo.totals(SINCE, YESTERDAY)

    totals = asyncio.run(run())
    assert totals.installs == 3
    assert totals.counts["muse"]["VERIFIED"] == 9


def test_keeps_a_withheld_answer_an_hour_though_the_floor_is_reached() -> None:
    client, store, clock = api(fifty(VERIFIED=1)[: MIN_INSTALLS - 1])
    assert client.get("/v1/stats").status_code == 204
    asyncio.run(store.insert(day_of(MIN_INSTALLS - 1, YESTERDAY, VERIFIED=1), NOON))
    clock.at = NOON + timedelta(minutes=59)
    kept = client.get("/v1/stats")
    assert kept.status_code == 204
    assert kept.headers["cache-control"] == "public, max-age=3600"
    clock.at = NOON + timedelta(hours=1)
    fresh = client.get("/v1/stats")
    assert fresh.status_code == 200
    assert fresh.json()["data"]["installs"] == MIN_INSTALLS


def test_keeps_a_published_answer_an_hour_and_withholds_once_the_window_passes_its_days() -> None:
    client, store, clock = api(fifty(VERIFIED=1))
    assert client.get("/v1/stats").status_code == 200
    store.documents.clear()
    clock.at = NOON + timedelta(minutes=59)
    assert client.get("/v1/stats").json()["data"]["installs"] == MIN_INSTALLS
    clock.at = NOON + timedelta(hours=1)
    assert client.get("/v1/stats").status_code == 204

    # Yesterday's days are the window's first on the 29th day after, and outside it from the 30th.
    moved, _, later = api(fifty(VERIFIED=1))
    later.at = NOON + timedelta(days=WINDOW_DAYS - 1)
    assert moved.get("/v1/stats").json()["data"]["since"] == YESTERDAY
    later.at = NOON + timedelta(days=WINDOW_DAYS)
    assert moved.get("/v1/stats").status_code == 204


def test_never_keeps_a_failure() -> None:
    client, store, _ = api(fifty(VERIFIED=1))
    store.up = False
    failed = client.get("/v1/stats")
    assert failed.status_code == 503
    assert "cache-control" not in failed.headers
    store.up = True
    assert client.get("/v1/stats").status_code == 200


def test_serves_the_kept_answer_through_an_outage_inside_its_hour() -> None:
    client, store, clock = api(fifty(VERIFIED=1))
    assert client.get("/v1/stats").status_code == 200
    store.up = False
    clock.at = NOON + timedelta(minutes=30)
    assert client.get("/v1/stats").status_code == 200
    clock.at = NOON + timedelta(hours=1)
    assert client.get("/v1/stats").status_code == 503


def test_rates_every_grade_s_receipts_to_four_places() -> None:
    muse = api(fifty(VERIFIED=1, NOT_FOUND=1, UNASKED=1))[0].get("/v1/stats").json()["data"]["agents"]["muse"]
    assert (muse["verifiedRate"], muse["notFoundRate"], muse["unaskedRate"]) == (0.3333, 0.3333, 0.3333)
    unverifiable = api(fifty(VERIFIED=1, UNVERIFIABLE=3))[0].get("/v1/stats").json()["data"]["agents"]["muse"]
    assert (unverifiable["receipts"], unverifiable["verifiedRate"]) == (4 * MIN_INSTALLS, 0.25)
    assert (rate(2, 3), rate(1, 7), rate(0, 5), rate(0, 0)) == (0.6667, 0.1429, 0.0, None)


def test_mongo_sums_ignore_a_count_no_payload_holds_and_a_day_outside_every_window() -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    mongo = MongoStore("mongodb://unused", "attest_telemetry", mock)
    collection = mock["attest_telemetry"]["aggregates"]
    text_count = {**day_of(1, YESTERDAY), "counts": {"muse": {"VERIFIED": "7"}}}
    no_counts = {key: value for key, value in day_of(2, days_ago(2)).items() if key != "counts"}
    no_agents = {**day_of(3, days_ago(3)), "counts": {}}
    unknown_agent = {**day_of(4, days_ago(4)), "counts": {"instinct": {"VERIFIED": 5}}}
    day_as_date = {**day_of(MIN_INSTALLS + 1, YESTERDAY, VERIFIED=9), "dayBucket": NOON}
    odd: list[Document] = [
        {"_id": "text-count", "payload": text_count},
        {"_id": "no-counts", "payload": no_counts},
        {"_id": "no-agents", "payload": no_agents},
        {"_id": "unknown-agent", "payload": unknown_agent},
        {"_id": "day-as-date", "payload": day_as_date},
        {"_id": "not-an-object", "payload": "a payload"},
        {"_id": "no-payload"},
    ]

    async def run() -> Totals:
        for payload in fifty(VERIFIED=1):
            await mongo.insert(payload, NOON)
        await collection.insert_many(odd)
        return await mongo.totals(SINCE, YESTERDAY)

    totals = asyncio.run(run())
    # Installs 1 to 4 are among the fifty already; a day written as a date is in no window, so its install never counts.
    assert totals.installs == MIN_INSTALLS
    assert totals.counts["muse"]["VERIFIED"] == MIN_INSTALLS
    assert sum(totals.counts[agent][grade] for agent in AGENTS for grade in GRADES) == MIN_INSTALLS
    assert sorted(totals.counts) == sorted(AGENTS)


def test_a_database_error_in_a_sum_is_a_store_error_and_a_503(monkeypatch: pytest.MonkeyPatch) -> None:
    mock: AsyncMongoMockClient[Document] = AsyncMongoMockClient()
    mongo = MongoStore("mongodb://unused", "attest_telemetry", mock)

    def refuse(*_args: object, **_kwargs: object) -> object:
        message = "no server answered"
        raise ServerSelectionTimeoutError(message)

    monkeypatch.setattr(mongo._aggregates, "aggregate", refuse)
    with pytest.raises(StoreError) as raised:
        asyncio.run(mongo.totals(SINCE, YESTERDAY))
    assert "no server answered" not in str(raised.value)
    client = TestClient(create_app(Settings(mongo_url="mongodb://unused"), mongo, Clock()))
    answer = client.get("/v1/stats")
    assert answer.status_code == 503
    assert answer.json() == {"success": False, "data": None, "error": "The database does not answer."}


def test_reads_the_stats_by_get_alone_and_lets_no_other_site_s_page_read_them() -> None:
    client, _, _ = api(fifty(VERIFIED=1))
    for method in ("POST", "PUT", "DELETE"):
        answer = client.request(method, "/v1/stats")
        assert answer.status_code == 405, method
        assert answer.json() == {"success": False, "data": None, "error": "This route does not take that method."}
    page = client.get("/v1/stats", headers={"origin": "https://example.com"})
    assert page.status_code == 200
    assert "access-control-allow-origin" not in page.headers
