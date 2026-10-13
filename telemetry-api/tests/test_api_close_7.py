"""The API's Sprint 7 close fixes (reviews/sprint_7: security SEC-2, SEC-3 and SEC-4; privacy gap 10).

- A report about a day the API does not take (app/days.py) is refused (422) and never stored, nor counted against a
  limit; the days at the edges are taken.
- A client may send for at most ``INSTALLS_PER_CLIENT_PER_DAY`` install ids a UTC day: an id it has sent for is taken
  again, another client is counted on its own, and the next day starts again. A payload this limit refuses counts
  against no other.
- Each client may read the stats ``STATS_LIMIT_PER_DAY`` times a day (429, in the one shape).
- A path with a final slash is not found (404, in the one shape), never redirected: FastAPI's default answered it with
  a 307 to an ``http://`` address built from the client's ``Host`` header.

Every value is invented.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.days import LATE_DAYS
from app.main import create_app
from app.settings import Settings
from app.stats import MIN_DAYS, MIN_INSTALLS
from tests.memory import MemoryStore
from tests.support import CASES, Clock, install

VALID: dict[str, Any] = CASES["valid"]
AT = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
NOT_FOUND = {"success": False, "data": None, "error": "Nothing is here."}
TOO_MANY = {"success": False, "data": None, "error": "Too many requests today. Try again tomorrow."}


def api(**settings: int) -> tuple[TestClient, MemoryStore, Clock]:
    """The API on ``AT``, behind a proxy that names each client, over a fresh store, with any settings given."""
    store, clock = MemoryStore(), Clock(AT)
    config = Settings.model_validate({"mongo_url": "mongodb://unused", "trust_forwarded_for": True, **settings})
    return TestClient(create_app(config, store, clock)), store, clock


def post(client: TestClient, n: int, day: str = "2026-10-09", address: str = "203.0.113.7") -> httpx.Response:
    """Install ``n``'s payload about ``day``, from ``address``."""
    payload = {**VALID, "installId": install(n), "dayBucket": day}
    headers = {"content-type": "application/json", "x-forwarded-for": address}
    response: httpx.Response = client.post("/v1/aggregate", content=json.dumps(payload), headers=headers)
    return response


@pytest.mark.parametrize("day", ["2026-10-07", "2026-10-12", "2026-09-09", "1999-01-01", "2031-01-01"])
def test_refuses_a_day_it_does_not_take_and_stores_nothing(day: str) -> None:
    client, store, _ = api(install_limit_per_day=1, ip_limit_per_day=1)
    refused = post(client, 1, day)
    assert refused.status_code == 422
    assert refused.json() == {"success": False, "data": None, "error": "The payload is not one Attest sends."}
    assert store.documents == []
    # Never counted: the same install, from the same client, is taken on a day the API takes.
    assert post(client, 1).status_code == 204


def test_takes_the_days_at_the_edges() -> None:
    client, store, _ = api()
    assert [post(client, 1, day).status_code for day in ("2026-10-08", "2026-10-11")] == [204, 204]
    assert len(store.documents) == 2


def test_limits_the_install_ids_one_client_sends_for_in_a_day() -> None:
    client, store, clock = api(installs_per_client_per_day=5)
    assert [post(client, n).status_code for n in range(5)] == [204] * 5
    refused = post(client, 5)
    assert (refused.status_code, refused.json()) == (429, TOO_MANY)
    # An install it has sent for is taken again; another client is counted on its own.
    assert post(client, 4, "2026-10-10").status_code == 204
    assert post(client, 5, address="198.51.100.9").status_code == 204
    assert len(store.documents) == 7
    clock.at += timedelta(days=1)
    assert post(client, 6, "2026-10-10").status_code == 204


def test_a_payload_the_install_ids_limit_refuses_counts_against_no_other() -> None:
    client, _, _ = api(installs_per_client_per_day=1, install_limit_per_day=1)
    assert post(client, 1).status_code == 204
    assert post(client, 2).status_code == 429
    # Install 2 was never counted: from another client, its one payload of the day is taken.
    assert post(client, 2, address="198.51.100.9").status_code == 204


def test_limits_how_often_a_client_reads_the_stats_in_a_day() -> None:
    client, _, clock = api(stats_limit_per_day=3)
    reads = [client.get("/v1/stats", headers={"x-forwarded-for": "203.0.113.7"}) for _ in range(4)]
    assert [read.status_code for read in reads] == [204, 204, 204, 429]
    assert reads[3].json() == TOO_MANY
    assert client.get("/v1/stats", headers={"x-forwarded-for": "198.51.100.9"}).status_code == 204
    clock.at += timedelta(days=1)
    assert client.get("/v1/stats", headers={"x-forwarded-for": "203.0.113.7"}).status_code == 204


@pytest.mark.parametrize(("method", "path"), [("POST", "/v1/aggregate/"), ("GET", "/health/"), ("GET", "/v1/stats/")])
def test_never_redirects_a_path_with_a_final_slash(method: str, path: str) -> None:
    client, store, _ = api()
    answer = client.request(method, path, content=json.dumps(VALID), headers={"content-type": "application/json"})
    assert answer.status_code == 404
    assert answer.json() == NOT_FOUND
    assert "location" not in answer.headers
    assert store.documents == []


def test_one_client_alone_cannot_make_up_the_installs_that_pass_the_floor() -> None:
    # A month's reports arrive on at most its 31 days, the day before it, and LATE_DAYS after it (app/days.py); an
    # install counts once its reports arrived on MIN_DAYS of those dates; and one client sends for at most so many
    # install ids a date. So one client can make at most this many installs count in a month, fewer than the floor.
    dates = 31 + 1 + LATE_DAYS
    per_date = Settings(mongo_url="mongodb://unused").installs_per_client_per_day
    assert per_date * dates // MIN_DAYS < MIN_INSTALLS
