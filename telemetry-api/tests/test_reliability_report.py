"""The reliability report's script (scripts/reliability_report.py; sprint_7 7.5, 7.6): the template
launch/reliability-report-v0.md filled from the API's own ``GET /v1/stats`` answer, every placeholder, one row per agent
with its counts and rates (a count alone with no rate), and nothing written when the endpoint publishes nothing (204,
fewer than 50 installs), answers something else, or is asked at an address that is not https or local.
"""

import asyncio
import json
from datetime import timedelta
from types import TracebackType
from typing import Any, Self

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from app.stats import MIN_INSTALLS, Stats
from scripts.reliability_report import TEMPLATE, NotPublishedError, fetch, render
from tests.memory import MemoryStore
from tests.test_stats import NOON, YESTERDAY, Clock, day_of


class Answer:
    """What ``urlopen`` returns: a status and a body."""

    def __init__(self, status: int, body: object) -> None:
        """An answer of ``status`` with ``body`` as JSON."""
        self.status = status
        self._body = json.dumps(body).encode()

    def read(self) -> bytes:
        """The body."""
        return self._body

    def __enter__(self) -> Self:
        """Itself."""
        return self

    def __exit__(self, *_: type[BaseException] | BaseException | TracebackType | None) -> None:
        """Nothing to close."""


def stats_answer(installs: int) -> tuple[int, Any]:
    """The API's own answer to ``GET /v1/stats`` over ``installs`` installs' yesterdays, each with Muse's receipts."""
    store = MemoryStore()
    for n in range(installs):
        asyncio.run(store.insert(day_of(n, YESTERDAY, VERIFIED=3, NOT_FOUND=1), NOON))
    clock = Clock()
    clock.at = NOON + timedelta(minutes=1)
    response = TestClient(create_app(Settings(mongo_url="mongodb://unused"), store, clock)).get("/v1/stats")
    return response.status_code, response.json() if response.content else None


def test_fills_every_placeholder_of_the_template_from_the_api_s_answer() -> None:
    status, body = stats_answer(MIN_INSTALLS)
    assert status == 200
    report = render(Stats.model_validate(body["data"]), TEMPLATE.read_text("utf-8"))
    assert "{{" not in report
    assert f"From {MIN_INSTALLS} Attest installs" in report
    assert f"over the days {body['data']['since']} to {YESTERDAY}" in report
    assert "| Muse | 200 | 150 (75.0%) | 50 (25.0%) | 0 (0.0%) |" in report
    assert "| Claude | 0 | 0 | 0 | 0 |" in report


def test_writes_nothing_when_the_endpoint_publishes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    status, _ = stats_answer(MIN_INSTALLS - 1)
    assert status == 204
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_k: Answer(204, None))
    with pytest.raises(NotPublishedError, match="fewer than 50 installs"):
        fetch("https://telemetry.example/v1/stats")


def test_reads_the_api_s_answer_and_refuses_anything_else(monkeypatch: pytest.MonkeyPatch) -> None:
    _, body = stats_answer(MIN_INSTALLS)
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_k: Answer(200, body))
    assert fetch("https://telemetry.example/v1/stats").installs == MIN_INSTALLS
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_k: Answer(200, {"success": False}))
    with pytest.raises(NotPublishedError, match="did not answer"):
        fetch("https://telemetry.example/v1/stats")
    with pytest.raises(NotPublishedError, match="https"):
        fetch("http://telemetry.example/v1/stats")
