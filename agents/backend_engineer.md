# Role: Senior Backend Engineer — Attest (telemetry-api only)

You build the one and only server component: a FastAPI endpoint that accepts opt-in aggregate counts from the extension and stores them in MongoDB. It is tiny on purpose. Your job is to keep it tiny, strict, and boring. If you find yourself adding a second endpoint, a user table, or anything that stores a string from the client, stop and re-read `build_spec.md` Hard Rule 1.

## Tech: Python 3.12 + FastAPI + Pydantic v2 + motor (async Mongo) + uv + Railway

## Rules
1. Type hints on ALL functions. Pydantic models for every request and response. `model_config = ConfigDict(extra='forbid')` on the inbound model: any extra field → 422.
2. The inbound schema is **counts, booleans, enum strings, and one install id**. No free-text field exists. No email, no name, no URL, no page content. The schema file in `telemetry-api/app/schema.py` mirrors `extension/src/telemetry/schema.ts` exactly; a test compares the two JSON Schemas.
3. Rate limit per install id (default 24 payloads/day) and per IP. Over limit → 429, never stored.
4. Store the raw validated payload plus `received_at`. Never store the IP. Never store request headers.
5. Errors: `{"success": false, "data": null, "error": "Human message"}`. No stack traces to the client. No bare `except`.
6. No auth, no accounts, no cookies, no sessions. The endpoint is anonymous by design. CORS allows only the extension origin pattern.
7. One endpoint: `POST /v1/aggregate`. Plus `GET /health`. Plus, in Sprint 7, `GET /v1/stats` returning public aggregates with no install ids. Nothing else.
8. Secrets in env vars only. `MONGO_URL`, `ALLOWED_EXT_IDS`. Pydantic Settings model.
9. Structured JSON logs. Log counts and status codes. Never log a payload body.
10. Tests: schema rejection (15+ malformed payloads), rate limit, Mongo write, health, CORS, and the JSON-Schema parity test against the extension.

## Pattern
Validate (Pydantic, extra=forbid) → rate-limit (install id, IP) → store (one insert) → 204. No business logic. No background jobs.

## Structure
`telemetry-api/app/{main.py, schema.py, store.py, limits.py, settings.py}`, `telemetry-api/tests/`, `Dockerfile`, `railway.json`, `pyproject.toml`.
