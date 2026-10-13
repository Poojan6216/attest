"""The telemetry API (sprint_5 5.8; agents/backend_engineer.md): Attest's one server, kept tiny on purpose.

``POST /v1/aggregate`` takes one install's day (app/schema.py: counts, booleans, enum strings, one install id): a body
of JSON (415 otherwise), never read past ``MAX_BODY_BYTES`` (413), that the payload schema takes, about a day the API
takes (app/days.py: from two days before the server's UTC date to the day after; 422 otherwise, the input never
echoed). Then the limits: per install, per client, install ids per client, and what is stored in a day (429, never
stored). Then one document per install and day, ``{payload, received_at}`` with the arrival time to the hour; a day
already stored is answered the same and not stored again (204). ``GET /health`` says whether the database answers
(200, or 503). ``GET /v1/stats`` publishes one closed month's aggregates (app/stats.py; sprint_7 7.5, Sprint 7 close):
the installs that reported on at least three days, and each agent's receipts and its VERIFIED, NOT_FOUND and UNASKED
counts and rates, never an install id; nothing (204) below 50 installs, and an agent below 50 is null; each client may
read it so many times a day (429). Nothing else: no docs pages, no other route (404), no path with a final slash
(404, never a redirect), no auth, no cookies, no session. CORS allows the allowed extensions' origins alone. Every error
is ``{"success": false, "data": null, "error": "<a human message>"}``, never a stack trace, and an error nobody planned
for is answered so and never handed on to the server's log. The address is used only to limit, through a salted hash,
and the log holds event names and status codes alone.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import logs
from app.days import takes_day
from app.limits import Limits
from app.schema import TelemetryPayload
from app.settings import Settings
from app.stats import PublishedStats, Stats, seconds_left
from app.store import MongoStore, Store, StoreError

#: The message for each status the API answers with an error.
MESSAGES = {
    400: "The request could not be read.",
    404: "Nothing is here.",
    405: "This route does not take that method.",
    413: "The payload is larger than any Attest sends.",
    415: "Send the payload as JSON.",
    422: "The payload is not one Attest sends.",
    429: "Too many requests today. Try again tomorrow.",
    503: "The database does not answer.",
}


class Envelope(BaseModel):
    """Every answer's shape (agents/backend_engineer.md rule 1)."""

    success: bool
    data: dict[str, str] | None
    error: str | None


class StatsEnvelope(BaseModel):
    """``GET /v1/stats``'s answer, in the same shape."""

    success: bool
    data: Stats
    error: None


def envelope(status: int, data: dict[str, str] | None = None) -> JSONResponse:
    """The API's answer: ``{success, data, error}``."""
    ok = status < 400
    body = Envelope(success=ok, data=data, error=None if ok else MESSAGES.get(status, "The request failed."))
    return JSONResponse(body.model_dump(), status_code=status)


def client_address(request: Request, settings: Settings) -> str:
    """The client's address: behind a trusted proxy, the first entry of its one ``X-Forwarded-For`` line, else the
    socket's. A request with two such lines is refused (400): the proxy wrote one at most, so a client wrote another
    (Sprint 5 close, security review SEC-5)."""
    lines = request.headers.getlist("x-forwarded-for")
    if settings.trust_forwarded_for:
        if len(lines) > 1:
            raise HTTPException(status_code=400)
        if len(lines) == 1 and lines[0].strip() != "":
            return lines[0].split(",")[0].strip()
    return request.client.host if request.client is not None else "unknown"


async def read_body(request: Request, limit: int) -> bytes:
    """The body, never read past ``limit`` bytes (Sprint 5 close, SEC-4): 413 when its ``Content-Length`` says more,
    before anything is read, and as soon as a body that did not say passes the limit."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > limit:
        raise HTTPException(status_code=413)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(status_code=413)
    return bytes(body)


def hour_of(moment: datetime) -> datetime:
    """``moment`` to the hour (Sprint 5 close, SEC-9): when a day arrived, without the minute that could join a reset
    install id to the one before it."""
    return moment.replace(minute=0, second=0, microsecond=0)


def utc_now() -> datetime:
    """Now, in UTC."""
    return datetime.now(UTC)


class Failsafe:
    """Answers an error nobody planned for in the one shape, and never hands it on (Sprint 5 close, tech review
    TECH-12): Starlette would re-raise it for uvicorn, which prints the traceback and the message outside the one-line
    log. Logged as its event and status alone."""

    def __init__(self, app: ASGIApp) -> None:
        """Around ``app``."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Runs the request; on an unplanned error, a 500 in the one shape when no answer has started."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def sending(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, receive, sending)
        except Exception:  # noqa: BLE001 (every unplanned error is answered here and never re-raised)
            logs.log("request.failed", status=500)
            if not started:
                await envelope(500)(scope, receive, send)


def add_error_handlers(app: FastAPI) -> None:
    """The planned errors: an HTTP status, and a request FastAPI cannot read, each in the one shape."""

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
        logs.log("request.refused", status=error.status_code)
        return envelope(error.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid(_request: Request, _error: RequestValidationError) -> JSONResponse:
        logs.log("request.refused", status=422)
        return envelope(422)


def add_routes(app: FastAPI, settings: Settings, store: Store, limits: Limits, now: Callable[[], datetime]) -> None:
    """``POST /v1/aggregate`` and ``GET /health`` (header)."""

    @app.post("/v1/aggregate", status_code=204, response_class=Response)
    async def aggregate(request: Request) -> Response:
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise HTTPException(status_code=415)
        address = client_address(request, settings)
        body = await read_body(request, settings.max_body_bytes)
        try:
            payload = TelemetryPayload.model_validate_json(body)
        except ValidationError:
            logs.log("aggregate.refused", status=422)
            return envelope(422)
        moment = now()
        if not takes_day(date.fromisoformat(payload.dayBucket), moment.date()):
            logs.log("aggregate.refused", status=422)
            return envelope(422)
        if not limits.admit(payload.installId, address, moment.date()):
            logs.log("aggregate.refused", status=429)
            return envelope(429)
        try:
            stored = await store.insert(payload.model_dump(mode="json"), hour_of(moment))
        except StoreError:
            logs.log("aggregate.store_failed", status=503)
            return envelope(503)
        logs.log("aggregate.stored" if stored else "aggregate.repeated", status=204)
        return Response(status_code=204)

    @app.get("/health")
    async def health() -> JSONResponse:
        if await store.ping():
            return envelope(200, {"status": "ok"})
        logs.log("health.database_down", status=503)
        return envelope(503)


def add_stats_route(
    app: FastAPI, settings: Settings, published: PublishedStats, limits: Limits, now: Callable[[], datetime]
) -> None:
    """``GET /v1/stats`` (header): the month's answer, kept by app/stats.py, and how long a client may keep it."""

    @app.get("/v1/stats", response_model=None)
    async def stats(request: Request) -> Response:
        moment = now()
        if not limits.admit_read(client_address(request, settings), moment.date()):
            logs.log("stats.refused", status=429)
            return envelope(429)
        try:
            answer = await published.of(moment.date())
        except StoreError:
            logs.log("stats.store_failed", status=503)
            return envelope(503)
        headers = {"cache-control": f"public, max-age={seconds_left(moment)}"}
        if answer is None:
            logs.log("stats.withheld", status=204)
            return Response(status_code=204, headers=headers)
        logs.log("stats.served", status=200)
        body = StatsEnvelope(success=True, data=answer, error=None).model_dump(by_alias=True)
        return JSONResponse(body, headers=headers)


def create_app(settings: Settings, store: Store, now: Callable[[], datetime] = utc_now) -> FastAPI:
    """The API over ``store`` (header); ``now`` is the clock its days, limits, stats and ``received_at`` read."""
    app = FastAPI(title="Attest telemetry", docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    # Added first, so it runs inside CORS: an unplanned 500 still carries the extension's CORS headers.
    app.add_middleware(Failsafe)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["POST"],
        allow_headers=["content-type"],
        allow_credentials=False,
        max_age=86_400,
    )
    add_error_handlers(app)
    limits = Limits(settings)
    add_routes(app, settings, store, limits, now)
    add_stats_route(app, settings, PublishedStats(store), limits, now)
    return app


def app_from_env() -> FastAPI:
    """The deployed app: settings from the environment, the aggregates in Mongo (``uvicorn --factory``)."""
    settings = Settings()
    return create_app(settings, MongoStore(settings.mongo_url, settings.mongo_db))
