"""Proves the telemetry flow on the running stack (sprint_5 5.8 done-when: "a local docker-compose proving the flow";
Sprint 7 close: the days taken, the indexes, the stats and the sums on MongoDB itself, QA review QA-12).

Start the stack with ``docker compose up --build --wait`` from telemetry-api/, then run
``uv run python -m scripts.prove_flow``. Against the real API and the real Mongo beside it:

1. ``GET /health`` answers 200 (the database answers).
2. A payload the extension sends, about yesterday, from the extension's origin, is taken (204), with CORS allowing
   that origin.
3. Mongo then holds exactly one document for it: ``_id``, ``payload`` (exactly what was sent) and ``received_at`` (a
   time, to the hour). No other field, and no address anywhere in it (agents/backend_engineer.md rule 4).
4. A malformed payload is refused (422) and not stored; so is a payload about a day the API does not take.
5. The same day sent again, as the extension does when it did not see the answer, is taken (204) and stored once.
6. The install's other days the API takes are taken, then the same days again, and its 25th payload of the UTC day is
   refused (429) and not stored: 4 documents for it, no more.
7. Mongo holds the index that deletes a document 90 days after it arrived, and the one on the payload's day.
8. ``GET /v1/stats`` answers in its shape: 204 with no body, or 200 with the aggregates, kept by a client an hour at
   most.
9. The month's sums, run by MongoDB itself on invented reports in a database the proof makes for them and drops after:
   exactly what the tests' store sums (tests/memory.py), which mirrors MongoDB's rules: installs that reported on fewer
   than 3 dates, a day outside the month and a count that is not a number all left out.

The payloads carry an install id made for each proof, and only documents with it are counted: nothing is deleted but
the database the proof made, so a proof never touches what it did not write. The API takes payloads for 5 install ids
from one client a day, so a sixth proof against one stack in one UTC day is refused at step 2. ``PROVE_API``,
``PROVE_MONGO_URL`` and ``PROVE_MONGO_DB`` name another stack (the defaults are docker-compose.yml's). Prints each
step; exits 1 on the first that fails. Every value is invented.
"""

import asyncio
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from pymongo import MongoClient
from pymongo.collection import Collection

from app.days import Month, published_month
from app.schema import AGENTS, GRADES
from app.stats import MIN_DAYS, Stats
from app.store import RETENTION_DAYS, MongoStore, Totals
from tests.memory import MemoryStore

API = os.environ.get("PROVE_API", "http://127.0.0.1:8000")
MONGO_URL = os.environ.get("PROVE_MONGO_URL", "mongodb://127.0.0.1:27117")
MONGO_DB = os.environ.get("PROVE_MONGO_DB", "attest_telemetry")
ORIGIN = "chrome-extension://" + "a" * 32
CASES: dict[str, Any] = json.loads((Path(__file__).parent.parent / "tests" / "payload-cases.json").read_text("utf-8"))
ADDRESS = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b|:[0-9a-f]{0,4}:")

type Documents = Collection[dict[str, Any]]


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


def stored(aggregates: Documents, payload: dict[str, Any]) -> None:
    """Steps 2 to 5 (header)."""
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
    received = document["received_at"]
    check(
        "received_at is a time, to the hour", isinstance(received, datetime) and received.minute == received.second == 0
    )
    rest = json.dumps({**document, "received_at": None}, default=str)
    check("no address is anywhere else in it", ADDRESS.search(rest) is None)
    status, _, _ = request("POST", "/v1/aggregate", {**payload, "email": "someone@example.com"})
    check(
        "a malformed payload is refused (422) and not stored", status == 422 and aggregates.count_documents(mine) == 1
    )
    today = datetime.now(UTC).date()
    status, _, _ = request("POST", "/v1/aggregate", {**payload, "dayBucket": (today - timedelta(days=3)).isoformat()})
    check("a day the API does not take is refused (422) and not stored", status == 422)
    check("so it holds one document still", aggregates.count_documents(mine) == 1)
    status, _, _ = request("POST", "/v1/aggregate", payload)
    check("the same day sent again is taken (204) and stored once", status == 204)
    check("so it holds one document still", aggregates.count_documents(mine) == 1)


def limited(aggregates: Documents, payload: dict[str, Any]) -> None:
    """Step 6 (header): two payloads of the install are counted already."""
    today = datetime.now(UTC).date()
    days = [(today + timedelta(days=n)).isoformat() for n in (-2, 0, 1)]
    sends = [{**payload, "dayBucket": days[n % 3]} for n in range(22)] + [payload]
    statuses = [request("POST", "/v1/aggregate", send)[0] for send in sends]
    check(
        "the install's other days, then the same again, are taken; its 25th payload is refused",
        statuses[-2:] == [204, 429],
    )
    check("all 22 before it were taken (204)", statuses[:-1] == [204] * 22)
    check(
        "4 documents are stored for it, no more",
        aggregates.count_documents({"payload.installId": payload["installId"]}) == 4,
    )


def indexed(aggregates: Documents) -> None:
    """Step 7 (header): the indexes app/store.py makes, by their default names."""
    indexes = aggregates.index_information()
    ttl = indexes.get("received_at_1", {}).get("expireAfterSeconds")
    check(f"a document is deleted {RETENTION_DAYS} days after it arrived", ttl == RETENTION_DAYS * 86_400)
    check("the payload's day is indexed", "payload.dayBucket_1" in indexes)


def published() -> None:
    """Step 8 (header)."""
    status, headers, body = request("GET", "/v1/stats")
    age = re.fullmatch(r"public, max-age=(\d+)", headers.get("cache-control", ""))
    check("GET /v1/stats answers 204 or 200", status in (204, 200))
    check("a client may keep it an hour at most", age is not None and 0 < int(age.group(1)) <= 3_600)
    if status == 204:
        check("204 has no body", body == b"")
        return
    try:
        parsed = json.loads(body)
        Stats.model_validate(parsed["data"], strict=True)
    except (ValueError, KeyError, TypeError):
        parsed = None
    check("200 holds the aggregates", isinstance(parsed, dict) and parsed.get("success") is True)


def reports(month: Month) -> list[tuple[dict[str, Any], datetime]]:
    """Step 9's invented reports about ``month``, each with when it arrived (header): five installs that count, one
    that reported on two dates, one whose reports all arrived on one date, a day after the month, and a count of
    ``true`` and one of text, which MongoDB's sums leave out."""
    first, last = month

    def report(n: int, day: date, arrived: datetime, **muse: object) -> tuple[dict[str, Any], datetime]:
        counts: dict[str, dict[str, object]] = {agent: dict.fromkeys(GRADES, 0) for agent in AGENTS}
        counts["muse"].update(muse)
        install = f"{n:08x}-0000-4000-8000-000000000000"
        return {**CASES["valid"], "installId": install, "dayBucket": day.isoformat(), "counts": counts}, arrived

    def after(day: date) -> datetime:
        return datetime.combine(day + timedelta(days=1), time(6), UTC)

    days = [first + timedelta(days=d) for d in range(MIN_DAYS + 1)]
    counted = [
        report(n, day, after(day), VERIFIED=n + 1, NOT_FOUND=1) for n in range(5) for day in days[: MIN_DAYS + n % 2]
    ]
    one_date = datetime.combine(days[-1], time(6), UTC)
    return [
        *counted,
        *(report(10, day, after(day), VERIFIED=9) for day in days[: MIN_DAYS - 1]),
        *(report(11, day, one_date + timedelta(hours=h), VERIFIED=9) for h, day in enumerate(days)),
        report(12, last + timedelta(days=1), after(last + timedelta(days=1)), VERIFIED=9),
        report(0, days[-1] + timedelta(days=5), after(days[-1] + timedelta(days=5)), VERIFIED=True, UNASKED="7"),
    ]


def summed(client: MongoClient[dict[str, Any]]) -> None:
    """Step 9 (header), about the month published today, so no report is old enough for the database to delete."""
    month = published_month(datetime.now(UTC).date())
    since, until = (day.isoformat() for day in month)
    scratch = f"{MONGO_DB}_proof_{uuid.uuid4().hex[:12]}"
    memory = MemoryStore()
    try:
        for payload, arrived in reports(month):
            client[scratch]["aggregates"].insert_one(
                {"_id": uuid.uuid4().hex, "payload": payload, "received_at": arrived}
            )
            asyncio.run(memory.insert(payload, arrived))

        async def both() -> tuple[Totals, Totals]:
            mongo = MongoStore(MONGO_URL, scratch)
            return await mongo.totals(since, until, MIN_DAYS), await memory.totals(since, until, MIN_DAYS)

        from_mongo, from_memory = asyncio.run(both())
        check("MongoDB sums the month as the tests' store does", from_mongo == from_memory)
        check("five installs count, and the others are left out", from_mongo.installs == 5)
    finally:
        client.drop_database(scratch)


def main() -> None:
    """The nine steps (header)."""
    status, _, _ = request("GET", "/health")
    check("GET /health answers 200", status == 200)
    client: MongoClient[dict[str, Any]] = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5_000)
    aggregates = client[MONGO_DB]["aggregates"]
    yesterday = datetime.now(UTC).date() - timedelta(days=1)
    payload = {**CASES["valid"], "installId": str(uuid.uuid4()), "dayBucket": yesterday.isoformat()}
    stored(aggregates, payload)
    limited(aggregates, payload)
    indexed(aggregates)
    published()
    summed(client)


if __name__ == "__main__":
    main()
