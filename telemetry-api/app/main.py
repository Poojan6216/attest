"""The telemetry API (sprint_5 5.8; agents/backend_engineer.md): Attest's one server, kept tiny on purpose.

``POST /v1/aggregate`` takes one install's day (app/schema.py: counts, booleans, enum strings, one install id): a body
of JSON (415 otherwise), at most ``MAX_BODY_BYTES`` (413), that the payload schema takes (422 otherwise, the input
never echoed). Then the per-install and per-client limits (429, never stored), then one insert of exactly
``{payload, received_at}`` (204). ``GET /health`` says whether the database answers (200, or 503). Nothing else: no
docs pages, no other route (404), no auth, no cookies, no session. CORS allows the allowed extensions' origins alone.
Every error is ``{"success": false, "data": null, "error": "<a human message>"}``, never a stack trace. The address
is used only to limit, through a salted hash, and the log holds event names and status codes alone.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException

from app import logs
from app.limits import ClientKeys, DailyLimit
from app.schema import TelemetryPayload
from app.settings import Settings
from app.store import MongoStore, Store, StoreError

#: The message for each status the API answers with an error.
MESSAGES = {
    400: "The request could not be read.",
    404: "Nothing is here.",
    405: "This route does not take that method.",
    413: "The payload is larger than any Attest sends.",
    415: "Send the payload as JSON.",
    422: "The payload is not one Attest sends.",
    429: "Too many payloads today. Try again tomorrow.",
    503: "The database does not answer.",
}


def envelope(status: int, data: dict[str, str] | None = None) -> JSONResponse:
    """The API's answer: ``{success, data, error}``."""
    ok = status < 400
    body = {"success": ok, "data": data, "error": None if ok else MESSAGES.get(status, "The request failed.")}
    return JSONResponse(body, status_code=status)


def client_address(request: Request, settings: Settings) -> str:
    """The client's address: the first ``X-Forwarded-For`` entry behind a trusted proxy, else the socket's."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if settings.trust_forwarded_for and forwarded.strip() != "":
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client is not None else "unknown"


def utc_now() -> datetime:
    """Now, in UTC."""
    return datetime.now(UTC)


def create_app(settings: Settings, store: Store, now: Callable[[], datetime] = utc_now) -> FastAPI:
    """The API over ``store`` (header); ``now`` is the clock its limits and ``received_at`` read."""

    app = FastAPI(title="Attest telemetry", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["POST"],
        allow_headers=["content-type"],
        allow_credentials=False,
        max_age=86_400,
    )
    install_limit = DailyLimit(settings.install_limit_per_day)
    client_limit = DailyLimit(settings.ip_limit_per_day)
    clients = ClientKeys()

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
        logs.log("request.refused", status=error.status_code)
        return envelope(error.status_code)

    @app.exception_handler(Exception)
    async def failed(_request: Request, _error: Exception) -> JSONResponse:
        logs.log("request.failed", status=500)
        return envelope(500)

    @app.exception_handler(RequestValidationError)
    async def invalid(_request: Request, _error: RequestValidationError) -> JSONResponse:
        logs.log("request.refused", status=422)
        return envelope(422)

    @app.post("/v1/aggregate", status_code=204, response_class=Response)
    async def aggregate(request: Request) -> Response:
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise HTTPException(status_code=415)
        body = await request.body()
        if len(body) > settings.max_body_bytes:
            raise HTTPException(status_code=413)
        try:
            payload = TelemetryPayload.model_validate_json(body)
        except ValidationError:
            logs.log("aggregate.refused", status=422)
            return envelope(422)
        moment = now()
        today: date = moment.date()
        address = clients.of(client_address(request, settings))
        if not (install_limit.allows(payload.installId, today) and client_limit.allows(address, today)):
            logs.log("aggregate.refused", status=429)
            return envelope(429)
        # No await between asking and counting: one request's check and count are never split by another's.
        install_limit.count(payload.installId, today)
        client_limit.count(address, today)
        try:
            await store.insert(payload.model_dump(mode="json"), moment)
        except StoreError:
            logs.log("aggregate.store_failed", status=503)
            return envelope(503)
        logs.log("aggregate.stored", status=204)
        return Response(status_code=204)

    @app.get("/health")
    async def health() -> JSONResponse:
        if await store.ping():
            return envelope(200, {"status": "ok"})
        logs.log("health.database_down", status=503)
        return envelope(503)

    return app


def app_from_env() -> FastAPI:
    """The deployed app: settings from the environment, the aggregates in Mongo (``uvicorn --factory``)."""
    settings = Settings()
    return create_app(settings, MongoStore(settings.mongo_url, settings.mongo_db))
