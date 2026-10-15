"""``GET /v1/stats`` at its edges (sprint_7 7.5; QA review, sprint 7; at the Sprint 7 close, one answer per closed month
instead of one an hour, each test held to that): installs are distinct install ids, never the days they sent; the
month's answer holds across the 50-install floor both ways until the next month is published, a failure is never kept,
and a kept answer outlives an outage; the next month is made at its first read after it is published (QA-13); a rate is
of every grade's receipts, to four places; Mongo's sums ignore a count no payload could hold and a document outside
every month, and a database error in a sum is a 503; one read of the store serves every ask that waits on it, a failed
one too (security review SEC-4); and only GET reads the stats, with no page of another site let in.
"""

import asyncio
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

from app.main import create_app
from app.schema import AGENTS, GRADES
from app.settings import Settings
from app.stats import MIN_DAYS, MIN_INSTALLS, PublishedStats, Stats, rate
from app.store import Document, StoreError, Totals
from tests.async_mongo import AsyncMongoMock, store_over
from tests.memory import MemoryStore
from tests.support import NOON, NOVEMBER_PUBLISHED, OCTOBER, Clock, api, fifty, month_of, report, sent

SINCE, UNTIL = (day.isoformat() for day in OCTOBER)


def test_counts_installs_never_the_days_they_sent() -> None:
    below = [one for n in range(MIN_INSTALLS - 1) for one in month_of(n, days=5, VERIFIED=1)]
    assert len(below) >= MIN_INSTALLS
    assert api(below)[0].get("/v1/stats").status_code == 204

    at = [one for n in range(MIN_INSTALLS) for one in month_of(n, days=4, VERIFIED=1)]
    data = api(at)[0].get("/v1/stats").json()["data"]
    assert data["installs"] == MIN_INSTALLS
    assert data["agents"]["muse"]["verified"] == 4 * MIN_INSTALLS


def test_mongo_counts_installs_never_the_days_they_sent() -> None:
    mock = AsyncMongoMock()
    mongo = store_over(mock)

    async def run() -> Totals:
        for n in range(3):
            for payload, received in month_of(n, days=4, VERIFIED=1):
                await mongo.insert(payload, received)
        return await mongo.totals(SINCE, UNTIL, MIN_DAYS)

    totals = asyncio.run(run())
    assert (totals.installs, totals.users["muse"], totals.counts["muse"]["VERIFIED"]) == (3, 3, 12)


def test_keeps_a_withheld_answer_all_month_though_the_floor_is_reached() -> None:
    client, store, clock = api(fifty(VERIFIED=1)[: (MIN_INSTALLS - 1) * MIN_DAYS])
    assert client.get("/v1/stats").status_code == 204
    for payload, received in month_of(MIN_INSTALLS - 1, VERIFIED=1):
        asyncio.run(store.insert(payload, received))
    clock.at = NOON + timedelta(hours=1)
    kept = client.get("/v1/stats")
    assert kept.status_code == 204
    assert kept.headers["cache-control"] == "public, max-age=3600"
    clock.at = NOVEMBER_PUBLISHED - timedelta(seconds=1)
    assert client.get("/v1/stats").status_code == 204


def test_keeps_a_published_answer_all_month_and_withholds_the_next_without_reports() -> None:
    client, store, clock = api(fifty(VERIFIED=1))
    assert client.get("/v1/stats").status_code == 200
    store.documents.clear()
    clock.at = NOON + timedelta(days=10)
    assert client.get("/v1/stats").json()["data"]["installs"] == MIN_INSTALLS
    clock.at = NOVEMBER_PUBLISHED
    assert client.get("/v1/stats").status_code == 204


def test_makes_the_next_month_at_its_first_read_after_it_is_published() -> None:
    november = [sent(n, date(2026, 11, d), VERIFIED=1) for n in range(MIN_INSTALLS) for d in (1, 2, 3)]
    client, _, clock = api([*fifty(VERIFIED=1), *november])
    clock.at = NOVEMBER_PUBLISHED - timedelta(minutes=30)
    assert client.get("/v1/stats").json()["data"]["since"] == "2026-10-01"
    clock.at = NOVEMBER_PUBLISHED + timedelta(minutes=10)
    data = client.get("/v1/stats").json()["data"]
    assert (data["since"], data["until"]) == ("2026-11-01", "2026-11-30")


def test_never_keeps_a_failure() -> None:
    client, store, _ = api(fifty(VERIFIED=1))
    store.up = False
    failed = client.get("/v1/stats")
    assert failed.status_code == 503
    assert "cache-control" not in failed.headers
    store.up = True
    assert client.get("/v1/stats").status_code == 200


def test_serves_the_kept_answer_through_an_outage_while_its_month_is_published() -> None:
    client, store, clock = api(fifty(VERIFIED=1))
    assert client.get("/v1/stats").status_code == 200
    store.up = False
    clock.at = NOON + timedelta(days=5)
    assert client.get("/v1/stats").status_code == 200
    clock.at = NOVEMBER_PUBLISHED
    assert client.get("/v1/stats").status_code == 503


def test_rates_every_grade_s_receipts_to_four_places() -> None:
    muse = api(fifty(VERIFIED=1, NOT_FOUND=1, UNASKED=1))[0].get("/v1/stats").json()["data"]["agents"]["muse"]
    assert (muse["verifiedRate"], muse["notFoundRate"], muse["unaskedRate"]) == (0.3333, 0.3333, 0.3333)
    unverifiable = api(fifty(VERIFIED=1, UNVERIFIABLE=3))[0].get("/v1/stats").json()["data"]["agents"]["muse"]
    assert (unverifiable["receipts"], unverifiable["verifiedRate"]) == (4 * MIN_DAYS * MIN_INSTALLS, 0.25)
    assert (rate(2, 3), rate(1, 7), rate(0, 5), rate(0, 0)) == (0.6667, 0.1429, 0.0, None)


def test_mongo_sums_ignore_a_count_no_payload_holds_and_a_day_outside_every_month() -> None:
    mock = AsyncMongoMock()
    mongo = store_over(mock)
    collection = mock["attest_telemetry"]["aggregates"]
    _, arrival = sent(0, date(2026, 10, 10))
    text_count = {**report(1, date(2026, 10, 10)), "counts": {"muse": {"VERIFIED": "7"}}}
    no_counts = {key: value for key, value in report(2, date(2026, 10, 10)).items() if key != "counts"}
    no_agents = {**report(3, date(2026, 10, 10)), "counts": {}}
    unknown_agent = {**report(4, date(2026, 10, 10)), "counts": {"instinct": {"VERIFIED": 5}}}
    day_as_date = {**report(MIN_INSTALLS + 1, date(2026, 10, 10), VERIFIED=9), "dayBucket": NOON}
    odd: list[Document] = [
        {"_id": "text-count", "payload": text_count, "received_at": arrival},
        {"_id": "no-counts", "payload": no_counts, "received_at": arrival},
        {"_id": "no-agents", "payload": no_agents, "received_at": arrival},
        {"_id": "unknown-agent", "payload": unknown_agent, "received_at": arrival},
    ]
    for n in range(3):
        unarrived = report(MIN_INSTALLS + 2, date(2026, 10, n + 1), VERIFIED=9)
        text_arrival = report(MIN_INSTALLS + 3, date(2026, 10, n + 1), VERIFIED=9)
        odd.append({"_id": f"day-as-date-{n}", "payload": day_as_date, "received_at": arrival + timedelta(days=n)})
        odd.append({"_id": f"no-arrival-{n}", "payload": unarrived})
        odd.append({"_id": f"arrival-as-text-{n}", "payload": text_arrival, "received_at": f"2026-10-0{n + 2}"})
    odd += [
        {"_id": "not-an-object", "payload": "a payload", "received_at": arrival},
        {"_id": "no-payload", "received_at": arrival},
    ]

    async def run() -> Totals:
        for payload, received in fifty(VERIFIED=1):
            await mongo.insert(payload, received)
        await collection.insert_many(odd)
        return await mongo.totals(SINCE, UNTIL, MIN_DAYS)

    totals = asyncio.run(run())
    # Installs 1 to 4 are among the fifty already. A day written as a date is in no month, and a document with no time
    # of arrival arrived on no date: neither install ever counts.
    assert totals.installs == MIN_INSTALLS
    assert totals.counts["muse"]["VERIFIED"] == MIN_DAYS * MIN_INSTALLS
    assert sum(totals.counts[agent][grade] for agent in AGENTS for grade in GRADES) == MIN_DAYS * MIN_INSTALLS
    assert sorted(totals.counts) == sorted(AGENTS)


def test_a_database_error_in_a_sum_is_a_store_error_and_a_503(monkeypatch: pytest.MonkeyPatch) -> None:
    mock = AsyncMongoMock()
    mongo = store_over(mock)

    def refuse(*_args: object, **_kwargs: object) -> object:
        message = "no server answered"
        raise ServerSelectionTimeoutError(message)

    monkeypatch.setattr(mongo._aggregates, "aggregate", refuse)
    with pytest.raises(StoreError) as raised:
        asyncio.run(mongo.totals(SINCE, UNTIL, MIN_DAYS))
    assert "no server answered" not in str(raised.value)
    client = TestClient(create_app(Settings(mongo_url="mongodb://unused"), mongo, Clock()))
    answer = client.get("/v1/stats")
    assert answer.status_code == 503
    assert answer.json() == {"success": False, "data": None, "error": "The database does not answer."}


class SlowStore(MemoryStore):
    """A store whose sums take a while, and count how often they were asked; failing while ``fails``."""

    def __init__(self) -> None:
        """Up, answering, nothing asked yet."""
        super().__init__()
        self.reads = 0
        self.fails = False

    async def totals(self, since: str, until: str, min_days: int) -> Totals:
        """Counts the read, waits, then answers or fails."""
        self.reads += 1
        await asyncio.sleep(0.05)
        if self.fails:
            message = "the store is down"
            raise StoreError(message)
        return await super().totals(since, until, min_days)


def ask(published: PublishedStats, times: int) -> list[Stats | BaseException | None]:
    """``times`` asks of ``published`` on NOON's date, all at once."""

    async def run() -> list[Stats | BaseException | None]:
        return await asyncio.gather(*(published.of(NOON.date()) for _ in range(times)), return_exceptions=True)

    return asyncio.run(run())


def test_one_read_of_the_store_serves_every_ask_that_waits_on_it_a_failed_one_too() -> None:
    store = SlowStore()
    for payload, received in fifty(VERIFIED=1):
        asyncio.run(store.insert(payload, received))
    answers = ask(PublishedStats(store), 40)
    assert store.reads == 1
    assert isinstance(answers[0], Stats)
    assert all(answer == answers[0] for answer in answers)

    failing = SlowStore()
    failing.fails = True
    published = PublishedStats(failing)
    failed = ask(published, 40)
    assert failing.reads == 1
    assert all(isinstance(answer, StoreError) for answer in failed)
    failing.fails = False
    assert ask(published, 1) == [None]
    assert failing.reads == 2


def test_reads_the_stats_by_get_alone_and_lets_no_other_site_s_page_read_them() -> None:
    client, _, _ = api(fifty(VERIFIED=1))
    for method in ("POST", "PUT", "DELETE"):
        answer = client.request(method, "/v1/stats")
        assert answer.status_code == 405, method
        assert answer.json() == {"success": False, "data": None, "error": "This route does not take that method."}
    page = client.get("/v1/stats", headers={"origin": "https://example.com"})
    assert page.status_code == 200
    assert "access-control-allow-origin" not in page.headers
