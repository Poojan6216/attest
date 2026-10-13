# Attest telemetry API

Attest's one server. It takes the extension's opt-in daily usage numbers, stores them, and publishes their totals across all installs. Nothing else: no accounts, no cookies, no other route. The rules are [`agents/backend_engineer.md`](../agents/backend_engineer.md); the decisions are in [`Decisions.md`](../Decisions.md), under `[5.6]` and `[5.8]`.

| Route | What it does |
|---|---|
| `POST /v1/aggregate` | Takes one install's day, the payload of [`app/schema.py`](app/schema.py), sent as JSON and never read past 16 KB (413). A malformed payload is refused (422); one over the day's limits (24 per install id, 240 per client, an IPv6 client counted by its /64, and 100,000 stored a day in all) is refused (429). Neither is stored. An accepted one is stored as exactly `{payload, received_at}`, the arrival time to the hour, one document per install and day: the extension sends a day again when it did not see the answer, and a day already stored is answered the same (204) and not stored again. |
| `GET /health` | 200 while the database answers, 503 otherwise. |
| `GET /v1/stats` | The public aggregates ([`app/stats.py`](app/stats.py)): over the 30 days before today, each agent's receipts and its VERIFIED, NOT_FOUND and UNASKED counts and rates, and how many installs reported; never an install id. Nothing (204) while fewer than 50 installs report; each answer kept an hour (`Cache-Control: public, max-age=3600`). `uv run python scripts/reliability_report.py <its address>` writes the monthly report from it ([`../launch/reliability-report-v0.md`](../launch/reliability-report-v0.md)). |

Every error answers `{"success": false, "data": null, "error": "<message>"}`, an error nobody planned for too (500), which is never handed on to the server's own log. CORS allows only the origins of the extension ids in `ALLOWED_EXT_IDS`. The client's address is used only to limit, as a salted hash kept in memory: it is never stored and never logged. The log is one JSON line per event, holding an event name and a status code.

## The payload

The payload schema is the extension's ([`extension/src/telemetry/schema.ts`](../extension/src/telemetry/schema.ts)). Both export the same JSON Schema, committed at [`tests/payload.schema.json`](tests/payload.schema.json), and a test on each side holds its own export to it. It allows counts, booleans, enum words, a UUID v4 install id, a version and a date, and no other string.

## Run it

```sh
uv sync                                  # Python 3.12, exactly the locked versions
uv run pytest                            # every test; no database needed
uv run ruff check . && uv run mypy app tests scripts
uv run pip-audit                         # known vulnerabilities in the dependencies
docker compose up --build --wait         # the API and Mongo, images pinned by digest
uv run python scripts/prove_flow.py      # the flow end to end against them
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
| `STORE_LIMIT_PER_DAY`, `LIMIT_KEYS_PER_DAY` | What is stored in a day in all, and how many install ids and clients each limit counts in a day: 100,000 each by default. |

## Deploy

Railway builds the [`Dockerfile`](Dockerfile) and checks `/health` ([`railway.json`](railway.json)). The steps are in [`MANUAL.md`](../MANUAL.md), Sprint 5.
