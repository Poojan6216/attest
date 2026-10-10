"""Checks, on the deployed API, that a client cannot choose the address its per-client limit counts it by.

Behind Railway's edge the API reads a client's address from the first ``X-Forwarded-For`` entry
(``TRUST_FORWARDED_FOR=true``). Railway says its edge strips what a client sends there and writes the real address
first (Decisions.md [5.8]). This proves it. With ``IP_LIMIT_PER_DAY=1`` set on the service, run from telemetry-api/:

    uv run python scripts/check_client_address.py https://<the API's domain>

It posts the valid payload of tests/payload-cases.json three times, each with its own invented install id and a
made-up ``X-Forwarded-For`` (addresses kept for documentation, RFC 5737): the first two say the same address, the third
another. The API must take the first (204) and refuse the other two (429), all from one client whatever they said. A
204 for the second means the limit is not 1; a 204 for the third alone means the API counted the address the client
wrote, so a client could dodge the per-client limit. Prints ok or FAIL; exits 1 unless ok. Each payload taken is one
day of an invented install.
"""

import json
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

CASES: dict[str, Any] = json.loads((Path(__file__).parent.parent / "tests" / "payload-cases.json").read_text("utf-8"))

#: The three sends: an invented install id (UUID v4) and a made-up address (RFC 5737) each.
SENDS = (
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d6e", "192.0.2.1"),
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d6f", "192.0.2.1"),
    ("8a1d6c2e-3f4b-4a5c-9d7e-1f2a3b4c5d70", "198.51.100.1"),
)

#: Posts a payload with one ``X-Forwarded-For``; answers the status.
type Post = Callable[[dict[str, Any], str], int]


def check(post: Post) -> tuple[bool, str]:
    """Sends the three (header) through ``post``; whether the API counted them as one client, and what to print."""
    statuses = [post({**CASES["valid"], "installId": install_id}, forwarded) for install_id, forwarded in SENDS]
    if statuses == [204, 429, 429]:
        return True, "ok   a client cannot choose its address: two made-up ones were counted as one client"
    if statuses == [204, 429, 204]:
        return False, "FAIL the API counted the address the client wrote: set TRUST_FORWARDED_FOR to false"
    if statuses[:2] == [204, 204]:
        return False, "FAIL the second was taken: set IP_LIMIT_PER_DAY to 1, wait for the redeploy, run it again"
    return False, f"FAIL expected 204, 429, 429, got {statuses}: a redeploy starts the day's counts again"


def over_http(api: str) -> Post:
    """Posts to the API at ``api``."""

    def post(payload: dict[str, Any], forwarded: str) -> int:
        headers = {"content-type": "application/json", "x-forwarded-for": forwarded}
        body = json.dumps(payload).encode("utf-8")
        url = api.rstrip("/") + "/v1/aggregate"
        sent = urllib.request.Request(url, data=body, method="POST", headers=headers)  # noqa: S310 (http(s), main)
        try:
            with urllib.request.urlopen(sent, timeout=10) as answer:  # noqa: S310 (main allows http and https only)
                return int(answer.status)
        except urllib.error.HTTPError as error:
            return error.code

    return post


def main(argv: list[str]) -> int:
    """The check (header) against the API at ``argv[0]``."""
    if len(argv) != 1 or not argv[0].startswith(("https://", "http://")):
        print("usage: check_client_address.py https://<the API's domain>")
        return 2
    ok, said = check(over_http(argv[0]))
    print(said)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
