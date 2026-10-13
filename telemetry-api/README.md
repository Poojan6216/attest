# Attest telemetry API

Attest's one server. It takes the extension's opt-in daily usage numbers, stores them, and publishes their totals across all installs. Nothing else: no accounts, no cookies, no other route. The rules are [`agents/backend_engineer.md`](../agents/backend_engineer.md); the decisions are in [`Decisions.md`](../Decisions.md), under `[5.6]`, `[5.8]`, `[7.5]` and `[7.close]`.

| Route | What it does |
|---|---|
| `POST /v1/aggregate` | Takes one install's day, the payload of [`app/schema.py`](app/schema.py), sent as JSON and never read past 16 KB (413). A malformed payload is refused (422), and so is one about a day the API does not take: from two days before the server's UTC date to the day after ([`app/days.py`](app/days.py)), which holds every day the extension sends from any time zone. One over the day's limits (24 per install id, 240 per client, 5 install ids per client, an IPv6 client counted by its /64, and 100,000 stored a day in all) is refused (429). Neither is stored. An accepted one is stored as exactly `{payload, received_at}`, the arrival time to the hour, one document per install and day: the extension sends a day again when it did not see the answer, and a day already stored is answered the same (204) and not stored again. Each document is deleted 90 days after it arrived. |
| `GET /health` | 200 while the database answers, 503 otherwise. |
| `GET /v1/stats` | The public aggregates ([`app/stats.py`](app/stats.py)) of one closed calendar month, the latest whose reports are all in: from the fourth day of the next month, no report about it is taken, so its answer never changes, and no two answers can be subtracted to find one install's day. An install counts only when its reports about the month arrived on at least 3 days. Then the installs that count, and for each agent how many of them used it, its receipts, and its VERIFIED, NOT_FOUND and UNASKED counts and rates; never an install id. Nothing (204) while fewer than 50 installs count, and an agent used by fewer than 50 of them is `null`. The install ids are random ones the extension makes, which the server cannot verify: these floors make made-up installs slow to add, not impossible. The answer is made once for its month, by one read of the database however many ask; a client may keep it an hour (`Cache-Control: public, max-age=3600`), or until the next month is published if that is sooner, and may read it 240 times a day. `uv run python -m scripts.reliability_report <its address>` writes the monthly report from it ([`../launch/reliability-report-v0.md`](../launch/reliability-report-v0.md)), checking the answer again first. |

Every error answers `{"success": false, "data": null, "error": "<message>"}`, an error nobody planned for too (500), which is never handed on to the server's own log. A path with a final slash is not found (404), never redirected. CORS allows only the origins of the extension ids in `ALLOWED_EXT_IDS`. The client's address is used only to limit, as a salted hash kept in memory: it is never stored and never logged. The log is one JSON line per event, holding an event name and a status code.

## The payload

The payload schema is the extension's ([`extension/src/telemetry/schema.ts`](../extension/src/telemetry/schema.ts)). Both export the same JSON Schema, committed at [`tests/payload.schema.json`](tests/payload.schema.json), and a test on each side holds its own export to it. It allows counts, booleans, enum words, a UUID v4 install id, a version and a date, and no other string.

## Run it

```sh
uv sync                                  # Python 3.12, exactly the locked versions
uv run pytest                            # every test; no database needed
uv run ruff check . && uv run mypy app tests scripts
uv run pip-audit                         # known vulnerabilities in the dependencies
docker compose up --build --wait         # the API and Mongo, images pinned by digest
uv run python -m scripts.prove_flow      # the flow end to end against them, the sums on real Mongo
docker compose down -v
```

CI runs all of it (`.github/workflows/ci.yml`, jobs `telemetry-api` and `telemetry-api-flow`).

## Settings

From the environment only ([`app/settings.py`](app/settings.py)):

| Variable | Meaning |
|---|---|
| `MONGO_URL` | Where the aggregates are stored. Required. |
| `MONGO_DB` | The database, `attest_telemetry` by default. |
| `ALLOWED_EXT_IDS` | The extension ids allowed to post, comma-separated. |
| `TRUST_FORWARDED_FOR` | `true` behind a proxy that writes the client's address first in `X-Forwarded-For` and strips what the client sent there (Railway's edge says it does: [`Decisions.md`](../Decisions.md) `[5.8]`). [`scripts/check_client_address.py`](scripts/check_client_address.py) proves it on the deployed API. |
| `INSTALL_LIMIT_PER_DAY`, `IP_LIMIT_PER_DAY` | The daily limits, 24 and 240 by default. |
| `INSTALLS_PER_CLIENT_PER_DAY` | How many install ids one client may send for in a day, 5 by default. |
| `STATS_LIMIT_PER_DAY` | How many times one client may read `GET /v1/stats` in a day, 240 by default. |
| `STORE_LIMIT_PER_DAY`, `LIMIT_KEYS_PER_DAY` | What is stored in a day in all, and how many install ids and clients each limit counts in a day: 100,000 each by default. |

## Deploy

Railway builds the [`Dockerfile`](Dockerfile) and checks `/health` ([`railway.json`](railway.json)). The steps are in [`MANUAL.md`](../MANUAL.md), Sprint 5.
