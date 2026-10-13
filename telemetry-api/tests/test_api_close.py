"""The API's Sprint 5 close fixes (reviews/sprint_5: security SEC-4, SEC-5, SEC-9; tech TECH-12; QA GAP 4).

- A body is never read past the limit: a ``Content-Length`` over it is refused before anything is read, and a body
  sent without one is refused as soon as it passes the limit (413), its remaining chunks never read.
- A request with two ``X-Forwarded-For`` lines is refused (400): a proxy writes one at most.
- An IPv6 client is one client across its /64; every address that does not parse is one client together; an
  IPv4-mapped address is its IPv4 address.
- Each limit counts at most so many keys a day, and the API stores at most so many payloads a day: past either, 429.
- The arrival time is stored to the hour.
- An error nobody planned for is answered 500 in the one shape, with the extension's CORS headers, and never reaches
  the server: the test client raises any error that escapes, as uvicorn would print it.

Every value is invented.
"""

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.types import Message

from app.limits import UNPARSED, client_of
from app.main import create_app
from app.settings import Settings
from tests.memory import MemoryStore

CASES: dict[str, Any] = json.loads((Path(__file__).parent / "payload-cases.json").read_text("utf-8"))
VALID: dict[str, Any] = CASES["valid"]
EXTENSION = "a" * 32
JSON_HEADERS = {"content-type": "application/json"}
LIMIT = 16_384
#: The day after the valid payload's day: a date the API takes it on (app/days.py).
AT = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


def api(
    ip_limit_per_day: int = 240, limit_keys_per_day: int = 100_000, store_limit_per_day: int = 100_000
) -> tuple[TestClient, MemoryStore]:
    """The API behind a trusted proxy, with these limits, over a fresh store; errors that escape are raised."""
    store = MemoryStore()
    settings = Settings(
        mongo_url="mongodb://unused",
        allowed_ext_ids=EXTENSION,
        trust_forwarded_for=True,
        ip_limit_per_day=ip_limit_per_day,
        limit_keys_per_day=limit_keys_per_day,
        store_limit_per_day=store_limit_per_day,
    )
    return TestClient(create_app(settings, store, lambda: AT), raise_server_exceptions=True), store


def install(n: int) -> dict[str, Any]:
    """The valid payload of the ``n``-th invented install."""
    return {**VALID, "installId": f"4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f{n:04x}"}


def post(client: TestClient, payload: object, forwarded: str = "203.0.113.7") -> int:
    """POSTs ``payload`` as JSON through a proxy that names ``forwarded``; the status."""
    headers = {**JSON_HEADERS, "x-forwarded-for": forwarded}
    status: int = client.post("/v1/aggregate", content=json.dumps(payload), headers=headers).status_code
    return status


def run_asgi(headers: list[tuple[bytes, bytes]], chunks: list[bytes]) -> tuple[int, int]:
    """The app called directly over ASGI with ``chunks`` as its body; its status and how many chunks it read."""
    app = create_app(Settings(mongo_url="mongodb://unused"), MemoryStore(), lambda: AT)
    read = 0
    statuses: list[int] = []

    async def receive() -> Message:
        nonlocal read
        read += 1
        body = chunks[read - 1] if read <= len(chunks) else b""
        return {"type": "http.request", "body": body, "more_body": read < len(chunks)}

    async def send(message: Message) -> None:
        if message["type"] == "http.response.start":
            statuses.append(message["status"])

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/aggregate",
        "raw_path": b"/v1/aggregate",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", b"application/json"), *headers],
        "client": ("203.0.113.7", 50_000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))
    return statuses[0], read


def test_refuses_a_content_length_over_the_limit_before_reading_anything() -> None:
    assert run_asgi([(b"content-length", str(LIMIT + 1).encode())], [b"{}"]) == (413, 0)


def test_stops_reading_a_body_without_a_length_as_soon_as_it_passes_the_limit() -> None:
    status, read = run_asgi([], [b"x" * 4_096] * 10)
    assert status == 413
    # The fifth chunk takes the body past 16 KiB: the other five are never read.
    assert read == 5


def test_refuses_two_forwarded_for_lines() -> None:
    client, store = api()
    headers = [("content-type", "application/json"), ("x-forwarded-for", "192.0.2.1"), ("x-forwarded-for", "192.0.2.2")]
    answer = client.post("/v1/aggregate", content=json.dumps(VALID), headers=headers)
    assert answer.status_code == 400
    assert answer.json() == {"success": False, "data": None, "error": "The request could not be read."}
    assert store.documents == []


def test_counts_an_ipv6_client_by_its_slash_64() -> None:
    client, _ = api(ip_limit_per_day=1)
    assert post(client, install(1), "2001:db8:0:5::1") == 204
    assert post(client, install(2), "2001:db8:0:5:ffff::2") == 429
    assert post(client, install(3), "2001:db8:0:6::1") == 204


def test_counts_every_address_that_does_not_parse_as_one_client() -> None:
    client, _ = api(ip_limit_per_day=1)
    assert post(client, install(1), "not-an-address") == 204
    assert post(client, install(2), "also not one") == 429


@pytest.mark.parametrize(
    ("address", "client"),
    [
        ("198.51.100.7", "198.51.100.7"),
        (" 198.51.100.7 ", "198.51.100.7"),
        ("::ffff:198.51.100.7", "198.51.100.7"),
        ("2001:db8::1", "2001:db8::/64"),
        ("2001:db8:0:0:ffff:1:2:3", "2001:db8::/64"),
        ("unknown", UNPARSED),
        ("", UNPARSED),
    ],
)
def test_client_of(address: str, client: str) -> None:
    assert client_of(address) == client


def test_counts_at_most_so_many_keys_a_day() -> None:
    client, store = api(limit_keys_per_day=2)
    assert [post(client, install(n), f"198.51.100.{n}") for n in (1, 2)] == [204, 204]
    # A third install, and a third client, would be new keys: refused, never stored.
    assert post(client, install(3), "198.51.100.3") == 429
    assert len(store.documents) == 2


def test_stores_at_most_so_many_payloads_a_day() -> None:
    client, store = api(store_limit_per_day=2)
    statuses = [post(client, install(n), f"198.51.100.{n}") for n in (1, 2, 3)]
    assert statuses == [204, 204, 429]
    assert len(store.documents) == 2


def test_stores_the_arrival_time_to_the_hour() -> None:
    store = MemoryStore()
    settings = Settings(mongo_url="mongodb://unused", allowed_ext_ids=EXTENSION)
    at = datetime(2026, 10, 10, 12, 34, 56, 789_000, tzinfo=UTC)
    client = TestClient(create_app(settings, store, lambda: at))
    assert client.post("/v1/aggregate", content=json.dumps(VALID), headers=JSON_HEADERS).status_code == 204
    assert store.documents[0]["received_at"] == datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


class BrokenStore(MemoryStore):
    """A store whose insert fails in a way the API does not name, its message quoting what it was given."""

    async def insert(self, payload: dict[str, object], received_at: datetime) -> bool:
        """Fails."""
        message = f"unexpected: {json.dumps(payload)} at {received_at.isoformat()}"
        raise RuntimeError(message)


def test_an_unplanned_error_is_answered_and_never_handed_on_to_the_server(capsys: pytest.CaptureFixture[str]) -> None:
    settings = Settings(mongo_url="mongodb://unused", allowed_ext_ids=EXTENSION)
    client = TestClient(create_app(settings, BrokenStore(), lambda: AT), raise_server_exceptions=True)
    headers = {**JSON_HEADERS, "origin": f"chrome-extension://{EXTENSION}"}
    answer = client.post("/v1/aggregate", content=json.dumps(VALID), headers=headers)
    assert answer.status_code == 500
    assert answer.json() == {"success": False, "data": None, "error": "The request failed."}
    assert answer.headers["access-control-allow-origin"] == f"chrome-extension://{EXTENSION}"
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    assert lines == [{"event": "request.failed", "status": 500}]
