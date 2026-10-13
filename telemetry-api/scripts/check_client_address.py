"""Checks, on the deployed API, that a client cannot choose the address its per-client limit counts it by.

Behind Railway's edge the API reads a client's address from the first ``X-Forwarded-For`` entry
(``TRUST_FORWARDED_FOR=true``). Railway says its edge strips what a client sends there and writes the real address
first (Decisions.md [5.8]). This proves it. With ``IP_LIMIT_PER_DAY=1`` set on the service, run from telemetry-api/:

    uv run python scripts/check_client_address.py https://<the API's domain>

It posts the valid payload of tests/payload-cases.json four times, about yesterday's UTC date (a day the API takes:
app/days.py), each with its own invented install id and a made-up ``X-Forwarded-For`` (addresses kept for
documentation, RFC 5737): the first two say the same address, the third
another, and the fourth sends two such lines (Sprint 5 close, security review SEC-5). The API must take the first (204)
and refuse the rest, all from one client whatever they said: the second and third with 429, the fourth with 429 or 400
(a request with two lines is refused). A 204 for the second means the limit is not 1; a 204 for the third means the API
counted the address the client wrote, and one for the fourth that a client's own line got through, so a client could
dodge the per-client limit. Prints ok or FAIL; exits 1 unless ok. Each payload taken is one day of an invented install.
"""

import http.client
import json
import sys
import urllib.parse
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

CASES: dict[str, Any] = json.loads((Path(__file__).parent.parent / "tests" / "payload-cases.json").read_text("utf-8"))

#: The four sends: an invented install id (UUID v4) and the made-up ``X-Forwarded-For`` lines (RFC 5737) of each.
SENDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d6e", ("192.0.2.1",)),
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d6f", ("192.0.2.1",)),
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d70", ("198.51.100.1",)),
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d71", ("203.0.113.1", "203.0.113.2")),
)

#: Posts a payload with these ``X-Forwarded-For`` lines; answers the status.
type Post = Callable[[dict[str, Any], tuple[str, ...]], int]


def verdict(statuses: list[int]) -> tuple[bool, str]:
    """Whether ``statuses`` say the API counted every send as one client (header), and what to print."""
    if statuses[:3] == [204, 429, 429] and statuses[3] in (400, 429):
        return True, "ok   a client cannot choose its address: made-up ones, and a second line, were one client"
    if statuses[:2] == [204, 204]:
        return False, "FAIL the second was taken: set IP_LIMIT_PER_DAY to 1, wait for the redeploy, run it again"
    if statuses[:3] == [204, 429, 204]:
        return False, "FAIL the API counted the address the client wrote: set TRUST_FORWARDED_FOR to false"
    if statuses[:3] == [204, 429, 429] and statuses[3] == 204:
        return False, "FAIL a client's own X-Forwarded-For line got through: set TRUST_FORWARDED_FOR to false"
    return False, f"FAIL expected 204, 429, 429, 429 or 400, got {statuses}: a redeploy starts the day's counts again"


def check(post: Post, day: str) -> tuple[bool, str]:
    """Sends the four (header), each about ``day``, through ``post``; the verdict."""
    payload = {**CASES["valid"], "dayBucket": day}
    return verdict([post({**payload, "installId": install_id}, lines) for install_id, lines in SENDS])


def over_http(api: str) -> Post:
    """Posts to the API at ``api`` (``http.client``, which can send one header twice)."""
    parsed = urllib.parse.urlsplit(api)
    path = parsed.path.rstrip("/") + "/v1/aggregate"

    def post(payload: dict[str, Any], forwarded: tuple[str, ...]) -> int:
        body = json.dumps(payload).encode("utf-8")
        kind = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = kind(parsed.netloc, timeout=10)
        try:
            connection.putrequest("POST", path)
            connection.putheader("content-type", "application/json")
            connection.putheader("content-length", str(len(body)))
            for line in forwarded:
                connection.putheader("x-forwarded-for", line)
            connection.endheaders(body)
            return connection.getresponse().status
        finally:
            connection.close()

    return post


def main(argv: list[str]) -> int:
    """The check (header) against the API at ``argv[0]``."""
    if len(argv) != 1 or not argv[0].startswith(("https://", "http://")):
        print("usage: check_client_address.py https://<the API's domain>")
        return 2
    yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
    ok, said = check(over_http(argv[0]), yesterday)
    print(said)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
