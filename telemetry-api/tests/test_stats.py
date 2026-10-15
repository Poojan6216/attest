"""``GET /v1/stats`` (sprint_7 7.5; agents/backend_engineer.md rule 7; app/stats.py; Sprint 7 close), over the in-memory
store, and its sums over an in-memory stand-in of PyMongo's async client (tests/async_mongo.py) too. Read on 20 November
2026, it publishes October: nothing (204) below 50 installs, the current small dataset among them; an install counted
only once its reports arrived on three UTC dates; at 50, each agent's installs, receipts and VERIFIED, NOT_FOUND and
UNASKED counts and rates, with the days outside October left out and an agent fewer than 50 installs used null; never an
install id; the same answer until November is published, which a client may keep an hour, or less when November comes
sooner; 503 when the database does not answer. The answer's agents, and the store's sums, are the payload schema's.
"""

import asyncio
from datetime import UTC, date, datetime, timedelta

from app.schema import AGENTS, GRADES, AgentCounts, GradeCounts
from app.stats import MIN_DAYS, MIN_INSTALLS
from app.store import Totals, sums
from tests.async_mongo import AsyncMongoMock, store_over
from tests.memory import MemoryStore
from tests.support import NOVEMBER_PUBLISHED, OCTOBER, Sent, api, fifty, install, month_of, sent

MUSE_ONLY = {"muse": MIN_INSTALLS, "chatgpt": 0, "dots": 0, "claude": 0}


def on_one_date(reports: list[Sent]) -> list[Sent]:
    """``reports``, each arriving on 3 October 2026, an hour after the one before."""
    return [(payload, datetime(2026, 10, 3, hour, tzinfo=UTC)) for hour, (payload, _) in enumerate(reports)]


def test_publishes_nothing_below_50_installs_and_says_how_long_that_holds() -> None:
    client, _, _ = api(fifty(VERIFIED=1)[: (MIN_INSTALLS - 1) * MIN_DAYS])
    response = client.get("/v1/stats")
    assert response.status_code == 204
    assert response.content == b""
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_publishes_nothing_on_the_current_small_dataset() -> None:
    client, _, _ = api([*month_of(1, VERIFIED=3), *month_of(2, NOT_FOUND=1)])
    assert client.get("/v1/stats").status_code == 204


def test_sums_each_agent_of_the_month_with_its_rates_and_null_for_one_too_few_used() -> None:
    client, _, _ = api(fifty(VERIFIED=2, PARTIAL=1, NOT_FOUND=1, UNASKED=1, OVER_SCOPE=0, UNVERIFIABLE=0))
    response = client.get("/v1/stats")
    assert response.status_code == 200
    body = response.json()
    assert (body["success"], body["error"]) == (True, None)
    data = body["data"]
    assert (data["installs"], data["since"], data["until"]) == (MIN_INSTALLS, "2026-10-01", "2026-10-31")
    assert data["agents"]["muse"] == {
        "installs": MIN_INSTALLS,
        "receipts": 750,
        "verified": 300,
        "notFound": 150,
        "unasked": 150,
        "verifiedRate": 0.4,
        "notFoundRate": 0.2,
        "unaskedRate": 0.2,
    }
    assert (data["agents"]["chatgpt"], data["agents"]["dots"], data["agents"]["claude"]) == (None, None, None)


def test_counts_an_install_only_once_its_reports_arrived_on_three_dates() -> None:
    others = fifty(VERIFIED=1)[: (MIN_INSTALLS - 1) * MIN_DAYS]
    last = MIN_INSTALLS - 1
    assert api([*others, *month_of(last, days=MIN_DAYS - 1, VERIFIED=1)])[0].get("/v1/stats").status_code == 204
    assert api([*others, *on_one_date(month_of(last, days=5, VERIFIED=1))])[0].get("/v1/stats").status_code == 204
    data = api([*others, *month_of(last, VERIFIED=1)])[0].get("/v1/stats").json()["data"]
    assert data["installs"] == MIN_INSTALLS


def test_leaves_out_the_days_outside_the_month() -> None:
    outside = [sent(100, date(2026, 9, 30), VERIFIED=7), sent(100, date(2026, 11, 1), VERIFIED=7)]
    client, _, _ = api([*fifty(VERIFIED=1), *month_of(100, NOT_FOUND=1), *outside])
    muse = client.get("/v1/stats").json()["data"]["agents"]["muse"]
    assert (muse["installs"], muse["verified"], muse["notFound"]) == (MIN_INSTALLS + 1, 3 * MIN_INSTALLS, 3)


def test_publishes_an_agent_only_once_50_installs_had_its_receipts() -> None:
    one = month_of(MIN_INSTALLS, agent="claude", VERIFIED=2, NOT_FOUND=1)
    data = api([*fifty(VERIFIED=1), *one])[0].get("/v1/stats").json()["data"]
    assert (data["installs"], data["agents"]["claude"]) == (MIN_INSTALLS + 1, None)

    every = [r for n in range(MIN_INSTALLS) for r in month_of(n + 100, agent="claude", VERIFIED=1)]
    claude = api([*fifty(VERIFIED=1), *every])[0].get("/v1/stats").json()["data"]["agents"]["claude"]
    assert (claude["installs"], claude["receipts"], claude["verifiedRate"]) == (MIN_INSTALLS, 150, 1.0)


def test_never_names_an_install_id() -> None:
    client, _, _ = api(fifty(VERIFIED=1))
    text = client.get("/v1/stats").text
    assert all(install(n) not in text for n in range(MIN_INSTALLS))
    assert "installId" not in text


def test_answers_the_same_until_the_next_month_is_published() -> None:
    client, store, clock = api(fifty(VERIFIED=1))
    first = client.get("/v1/stats").json()
    # No report about October is taken now (app/days.py); were one stored, October's answer would stay what it was.
    for payload, received in month_of(500, VERIFIED=9):
        asyncio.run(store.insert(payload, received))
    clock.at = NOVEMBER_PUBLISHED - timedelta(seconds=1)
    assert client.get("/v1/stats").json() == first
    clock.at = NOVEMBER_PUBLISHED
    assert client.get("/v1/stats").status_code == 204


def test_lets_a_client_keep_it_an_hour_or_until_the_next_month_is_published() -> None:
    client, _, clock = api(fifty(VERIFIED=1))
    assert client.get("/v1/stats").headers["cache-control"] == "public, max-age=3600"
    clock.at = NOVEMBER_PUBLISHED - timedelta(minutes=30)
    assert client.get("/v1/stats").headers["cache-control"] == "public, max-age=1800"
    clock.at = NOVEMBER_PUBLISHED - timedelta(milliseconds=500)
    assert client.get("/v1/stats").headers["cache-control"] == "public, max-age=1"


def test_answers_503_when_the_database_does_not() -> None:
    client, store, _ = api(fifty(VERIFIED=1))
    store.up = False
    response = client.get("/v1/stats")
    assert response.status_code == 503
    assert response.json() == {"success": False, "data": None, "error": "The database does not answer."}


def test_mongo_sums_what_the_memory_store_sums() -> None:
    reports = [
        *fifty(VERIFIED=2, UNASKED=1),
        *month_of(60, days=MIN_DAYS - 1, NOT_FOUND=4),
        *month_of(61, days=5, agent="claude", VERIFIED=1, OVER_SCOPE=2),
        *on_one_date(month_of(62, VERIFIED=5)),
        sent(63, date(2026, 11, 1), VERIFIED=9),
    ]
    mock = AsyncMongoMock()
    mongo = store_over(mock)
    memory = MemoryStore()
    since, until = (day.isoformat() for day in OCTOBER)

    async def run() -> tuple[Totals, Totals]:
        for payload, received in reports:
            await mongo.insert(payload, received)
            await memory.insert(payload, received)
        return await mongo.totals(since, until, MIN_DAYS), await memory.totals(since, until, MIN_DAYS)

    from_mongo, from_memory = asyncio.run(run())
    assert from_mongo == from_memory
    assert (from_memory.installs, from_memory.users) == (MIN_INSTALLS + 1, {**MUSE_ONLY, "claude": 1})
    assert (from_memory.counts["muse"]["VERIFIED"], from_memory.counts["claude"]["OVER_SCOPE"]) == (300, 10)


def test_publishes_and_sums_exactly_the_schema_s_agents_and_grades() -> None:
    assert tuple(AgentCounts.model_fields) == AGENTS
    assert tuple(GradeCounts.model_fields) == GRADES
    data = api(fifty(VERIFIED=1))[0].get("/v1/stats").json()["data"]
    assert sorted(data["agents"]) == sorted(AgentCounts.model_fields)
    per_install = sums(OCTOBER[0].isoformat(), OCTOBER[1].isoformat(), MIN_DAYS)[1]["$group"]
    assert isinstance(per_install, dict)
    assert {f"{agent}_{grade}" for agent in AGENTS for grade in GRADES} <= set(per_install)
