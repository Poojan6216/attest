"""Proves the telemetry flow on the running stack (sprint_5 5.8 done-when: "a local docker-compose proving the flow").

Start the stack with ``docker compose up --build --wait`` from telemetry-api/, then run
``uv run python scripts/prove_flow.py``. Against the real API and the real Mongo beside it:

1. ``GET /health`` answers 200 (the database answers).
2. A payload the extension sends, from the extension's origin, is taken (204), with CORS allowing that origin.
3. Mongo then holds exactly one document for it: ``_id``, ``payload`` (exactly what was sent) and ``received_at`` (a
   time). No other field, and no address anywhere in it (agents/backend_engineer.md rule 4).
4. A malformed payload is refused (422) and not stored.
5. The same install's 25th payload of the day is refused (429) and not stored: 24 documents, no more.

The payloads carry an install id made for each proof, and only documents with it are counted: nothing is deleted, so a
proof never touches what it did not write. ``PROVE_API``, ``PROVE_MONGO_URL`` and ``PROVE_MONGO_DB`` name another
stack (the defaults are docker-compose.yml's). Prints each step; exits 1 on the first that fails. Every value is
invented.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from pymongo import MongoClient

API = os.environ.get("PROVE_API", "http://127.0.0.1:8000")
MONGO_URL = os.environ.get("PROVE_MONGO_URL", "mongodb://127.0.0.1:27117")
MONGO_DB = os.environ.get("PROVE_MONGO_DB", "attest_telemetry")
ORIGIN = "chrome-extension://" + "a" * 32
CASES: dict[str, Any] = json.loads((Path(__file__).parent.parent / "tests" / "payload-cases.json").read_text("utf-8"))
ADDRESS = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b|:[0-9a-f]{0,4}:")


def request(method: str, path: str, body: object = None) -> tuple[int, dict[str, str], bytes]:
    """One request to the API from the extension's origin: its status, headers and body."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"origin": ORIGIN, **({} if data is None else {"content-type": "application/json"})}
    sent = urllib.request.Request(API + path, data=data, method=method, headers=headers)  # noqa: S310 (a local URL)
    try:
        with urllib.request.urlopen(sent, timeout=10) as answer:  # noqa: S310 (a local URL)
            return answer.status, dict(answer.headers.items()), answer.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()


def check(step: str, ok: bool) -> None:
    """Prints the step; stops with status 1 when it failed."""
    print(("ok   " if ok else "FAIL ") + step)
    if not ok:
        sys.exit(1)


def main() -> None:
    """The five steps (header)."""
    status, _, _ = request("GET", "/health")
    check("GET /health answers 200", status == 200)
    client: MongoClient[dict[str, Any]] = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5_000)
    aggregates = client[MONGO_DB]["aggregates"]
    payload = {**CASES["valid"], "installId": str(uuid.uuid4())}
    mine = {"payload.installId": payload["installId"]}
    status, headers, _ = request("POST", "/v1/aggregate", payload)
    check("a payload the extension sends is taken (204)", status == 204)
    check("CORS allows the extension's origin", headers.get("access-control-allow-origin") == ORIGIN)
    documents = list(aggregates.find(mine))
    check("Mongo holds one document for it", len(documents) == 1)
    [document] = documents
    check("it holds _id, payload and received_at, nothing else", sorted(document) == ["_id", "payload", "received_at"])
    check("its payload is exactly what was sent", document["payload"] == payload)
    # A time reads like part of an IPv6 address (06:30:12), so the time is checked for its type and the rest for text.
    check("received_at is a time", isinstance(document["received_at"], datetime))
    rest = json.dumps({**document, "received_at": None}, default=str)
    check("no address is anywhere else in it", ADDRESS.search(rest) is None)
    status, _, _ = request("POST", "/v1/aggregate", {**payload, "email": "someone@example.com"})
    stored = aggregates.count_documents(mine)
    check("a malformed payload is refused (422) and not stored", status == 422 and stored == 1)
    statuses = [request("POST", "/v1/aggregate", payload)[0] for _ in range(24)]
    check("the install's 25th payload of the day is refused (429)", statuses == [204] * 23 + [429])
    check("24 documents are stored for it, no more", aggregates.count_documents(mine) == 24)


if __name__ == "__main__":
    main()
