"""The telemetry API (sprint_5 5.8; agents/backend_engineer.md rules 1 to 10), over a store keeping documents in a list.

A payload the extension sends is stored as exactly ``{payload, received_at}`` (204): never the address, a header or
anything else (the test reads the document). Every malformed payload of payload-cases.json, and bodies that are not
JSON, are refused (422) and nothing is stored; a body not sent as JSON is refused (415), and one larger than any
payload too (413). The 25th payload of one install in a UTC day, and the client's payload over its own limit, are
refused (429) and never stored, a payload one limit refuses counts against neither, and the next day each limit starts
again. ``GET /health`` answers 200, or 503 when the
database does not. CORS allows the allowed extensions' origins alone. Every error is ``{success, data, error}``,
and there is no other route. The log holds event names and status codes, never an install id or an address.
"""

import copy
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from tests.memory import MemoryStore

CASES: dict[str, Any] = json.loads((Path(__file__).parent / "payload-cases.json").read_text("utf-8"))
VALID: dict[str, Any] = CASES["valid"]
EXTENSION = "a" * 32
ORIGIN = f"chrome-extension://{EXTENSION}"
ADDRESS = "203.0.113.7"
JSON = {"content-type": "application/json"}


class Clock:
    """A clock the test moves."""

    def __init__(self) -> None:
        """Noon on 10 October 2026, UTC."""
        self.at = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        """The time it says."""
        return self.at


def client(install_limit_per_day: int = 24, ip_limit_per_day: int = 240) -> tuple[TestClient, MemoryStore, Clock]:
    """The API over a fresh store and clock, behind a proxy that names the client ``ADDRESS``."""
    settings = Settings(
        mongo_url="mongodb://unused",
        allowed_ext_ids=EXTENSION,
        trust_forwarded_for=True,
        install_limit_per_day=install_limit_per_day,
        ip_limit_per_day=ip_limit_per_day,
    )
    store, clock = MemoryStore(), Clock()
    return TestClient(create_app(settings, store, clock)), store, clock


def post(api: TestClient, payload: object, **headers: str) -> httpx.Response:
    """POSTs ``payload`` as JSON from ``ADDRESS``."""
    sent = {**JSON, "x-forwarded-for": ADDRESS, **headers}
    response: httpx.Response = api.post("/v1/aggregate", content=json.dumps(payload), headers=sent)
    return response


def changed(case: dict[str, Any]) -> object:
    """The valid payload with the case's change (as tests/test_schema.py makes it)."""
    payload = copy.deepcopy(VALID)
    path: list[str] = case["set"] if "set" in case else case["delete"]
    *parents, last = path
    at = payload
    for key in parents:
        at = at[key]
    if "set" in case:
        at[last] = case["value"]
    else:
        del at[last]
    return payload


def test_stores_exactly_the_payload_and_when_it_came() -> None:
    api, store, clock = client()
    answer = post(api, VALID)
    assert (answer.status_code, answer.content) == (204, b"")
    assert store.documents == [{"payload": VALID, "received_at": clock.at}]
    # The address, the test client's name and every header are nowhere in what was stored.
    stored = repr(store.documents)
    for absent in (ADDRESS, "testclient", "x-forwarded-for", "application/json", "chrome-extension"):
        assert absent not in stored


@pytest.mark.parametrize("case", CASES["invalid"], ids=[case["why"] for case in CASES["invalid"]])
def test_refuses_every_malformed_payload_and_stores_nothing(case: dict[str, Any]) -> None:
    api, store, _ = client()
    answer = post(api, changed(case))
    assert answer.status_code == 422
    assert answer.json() == {"success": False, "data": None, "error": "The payload is not one Attest sends."}
    assert store.documents == []


@pytest.mark.parametrize("body", ["", "{", "[]", "null", '"payload"', json.dumps([VALID])])
def test_refuses_a_body_that_is_not_a_payload(body: str) -> None:
    api, store, _ = client()
    answer = api.post("/v1/aggregate", content=body, headers=JSON)
    assert answer.status_code == 422
    assert store.documents == []


def test_refuses_a_body_not_sent_as_json_and_one_too_large() -> None:
    api, store, _ = client()
    assert (
        api.post("/v1/aggregate", content=json.dumps(VALID), headers={"content-type": "text/plain"}).status_code == 415
    )
    large = {**VALID, "padding": "x" * 20_000}
    answer = post(api, large)
    assert answer.status_code == 413
    assert answer.json()["error"] == "The payload is larger than any Attest sends."
    assert store.documents == []


def day(n: int) -> dict[str, Any]:
    """The valid payload about the ``n``-th day of September 2026 (each its own document)."""
    return {**VALID, "dayBucket": f"2026-09-{n:02d}"}


def test_limits_each_install_to_its_day_and_starts_again_the_next() -> None:
    api, store, clock = client(install_limit_per_day=24)
    for n in range(1, 25):
        assert post(api, day(n)).status_code == 204
    refused = post(api, day(25))
    assert refused.status_code == 429
    assert refused.json() == {"success": False, "data": None, "error": "Too many payloads today. Try again tomorrow."}
    assert len(store.documents) == 24
    clock.at += timedelta(days=1)
    assert post(api, day(25)).status_code == 204


def test_stores_one_install_s_day_once_however_often_it_is_sent() -> None:
    # The extension sends a day again when it did not see the answer (tech review TECH-3): taken, never stored twice.
    api, store, _ = client()
    assert [post(api, VALID).status_code for _ in range(3)] == [204, 204, 204]
    assert len(store.documents) == 1
    assert post(api, day(1)).status_code == 204
    assert len(store.documents) == 2


def test_limits_each_client_whatever_install_ids_it_sends() -> None:
    api, store, _ = client(ip_limit_per_day=3)
    ids = [f"4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5{n}" for n in range(4)]
    statuses = [post(api, {**VALID, "installId": install_id}).status_code for install_id in ids]
    assert statuses == [204, 204, 204, 429]
    assert len(store.documents) == 3
    # Another client is counted on its own.
    assert post(api, {**VALID, "installId": ids[3]}, **{"x-forwarded-for": "198.51.100.9"}).status_code == 204


def test_a_payload_one_limit_refuses_counts_against_neither() -> None:
    api, store, _ = client(install_limit_per_day=2, ip_limit_per_day=1)
    assert post(api, day(1)).status_code == 204
    # Refused by its client's limit: its install's count stays at one.
    assert post(api, day(2)).status_code == 429
    assert post(api, day(2), **{"x-forwarded-for": "198.51.100.9"}).status_code == 204
    # The install's second payload was the last; a third client is refused by the install's limit alone.
    assert post(api, day(3), **{"x-forwarded-for": "198.51.100.10"}).status_code == 429
    assert len(store.documents) == 2


def test_health_says_whether_the_database_answers() -> None:
    api, store, _ = client()
    assert api.get("/health").json() == {"success": True, "data": {"status": "ok"}, "error": None}
    store.up = False
    down = api.get("/health")
    assert down.status_code == 503
    assert down.json() == {"success": False, "data": None, "error": "The database does not answer."}


def test_a_database_that_does_not_take_it_is_said_and_nothing_is_kept() -> None:
    api, store, _ = client()
    store.up = False
    answer = post(api, VALID)
    assert answer.status_code == 503
    assert answer.json() == {"success": False, "data": None, "error": "The database does not answer."}
    assert store.documents == []


def test_cors_allows_the_extensions_origin_and_no_other() -> None:
    api, _, _ = client()
    preflight = {"access-control-request-method": "POST", "access-control-request-headers": "content-type"}
    allowed = api.options("/v1/aggregate", headers={"origin": ORIGIN, **preflight})
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in allowed.headers
    other = api.options("/v1/aggregate", headers={"origin": "https://example.com", **preflight})
    assert "access-control-allow-origin" not in other.headers
    assert post(api, VALID, origin=ORIGIN).headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-origin" not in post(api, VALID, origin="https://example.com").headers


def test_has_no_other_route_and_answers_every_error_in_one_shape() -> None:
    api, _, _ = client()
    # /v1/stats is the one route Sprint 7 adds (agents/backend_engineer.md rule 7; tests/test_stats.py).
    for path in ("/", "/docs", "/openapi.json", "/v1/installs", "/v1/stats/muse"):
        answer = api.get(path)
        assert answer.status_code == 404, path
        assert answer.json() == {"success": False, "data": None, "error": "Nothing is here."}
    wrong = api.get("/v1/aggregate")
    assert wrong.status_code == 405
    assert wrong.json()["success"] is False


def test_logs_events_and_statuses_never_an_install_id_or_an_address(capsys: pytest.CaptureFixture[str]) -> None:
    api, _, _ = client(install_limit_per_day=1)
    post(api, VALID)
    post(api, VALID)
    post(api, {**VALID, "extra": 1})
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    assert [(line["event"], line["status"]) for line in lines] == [
        ("aggregate.stored", 204),
        ("aggregate.refused", 429),
        ("aggregate.refused", 422),
    ]
    text = json.dumps(lines)
    assert VALID["installId"] not in text
    assert ADDRESS not in text


def test_settings_refuse_anything_but_extension_ids() -> None:
    assert Settings(mongo_url="mongodb://x", allowed_ext_ids=f" {EXTENSION} ,").allowed_origins == [ORIGIN]
    with pytest.raises(ValueError, match="not a Chrome extension id"):
        Settings(mongo_url="mongodb://x", allowed_ext_ids="https://example.com")
