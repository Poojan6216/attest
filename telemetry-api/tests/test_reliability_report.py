"""The reliability report's script (scripts/reliability_report.py; sprint_7 7.5, 7.6; Sprint 7 close): the template
launch/reliability-report-v0.md filled from the API's own ``GET /v1/stats`` answer, every placeholder, one row per agent
the schema counts (no numbers for one too few installs used), its notes left out and its links absolute (tech review
TECH-1). An address that is not https or this machine's is refused and a redirect never followed (security review
SEC-3), and an answer the API could not have given is refused (QA-6): too few installs, not one whole month, not
Attest's agents, numbers that do not add up, a count written as text. Every value is invented.
"""

import copy
import re
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, cast

import pytest

from app.schema import AGENTS
from app.stats import MIN_INSTALLS, Stats
from scripts import reliability_report
from scripts.reliability_report import NAMES, TEMPLATE, NotPublishedError, fetch, render
from tests.support import Answer, Opener, stats_answer

ADDRESS = "https://telemetry.example/v1/stats"


@pytest.fixture(scope="module")
def published() -> dict[str, Any]:
    """The API's answer over ``MIN_INSTALLS`` installs (tests/support.py ``stats_answer``)."""
    status, body = stats_answer(MIN_INSTALLS)
    assert status == 200
    data: dict[str, Any] = body["data"]
    return data


def answering(monkeypatch: pytest.MonkeyPatch, answer: Answer) -> Opener:
    """The script's opener, answering ``answer``."""
    opener = Opener(answer)
    monkeypatch.setattr(reliability_report, "OPENER", opener)
    return opener


def test_fills_every_placeholder_of_the_template_from_the_api_s_answer(published: dict[str, Any]) -> None:
    report = render(Stats.model_validate(published), TEMPLATE.read_text("utf-8"))
    assert "{{" not in report
    assert report.startswith(f"# Agent Reliability Report, October 2026\n\nFrom {MIN_INSTALLS} Attest installs")
    assert "each on at least 3 days from 2026-10-01 to 2026-10-31" in report
    assert "| Muse | 50 | 600 | 450 (75.0%) | 150 (25.0%) | 0 (0.0%) |" in report
    assert "| Claude | fewer than 50 | not published | not published | not published | not published |" in report
    assert len(re.findall(r"^\| (?:Muse|ChatGPT|Dots|Claude) \|", report, re.MULTILINE)) == len(AGENTS)


def test_leaves_the_template_s_notes_out_and_links_absolutely(published: dict[str, Any]) -> None:
    report = render(Stats.model_validate(published), TEMPLATE.read_text("utf-8"))
    assert "<!--" not in report
    assert "Purpose" not in report
    assert "scripts.reliability_report" not in report
    links = re.findall(r"\]\(([^)]+)\)", report)
    assert links
    assert all(link.startswith("https://github.com/") for link in links)


def test_names_every_agent_the_schema_counts() -> None:
    assert sorted(NAMES) == sorted(AGENTS)


@pytest.mark.parametrize(
    "address",
    [
        "http://telemetry.example/v1/stats",
        "http://localhost.attacker.example/v1/stats",
        "http://127.0.0.1.attacker.example/v1/stats",
        "http://localhost@attacker.example/v1/stats",
        "https://someone@telemetry.example/v1/stats",
        "ftp://telemetry.example/v1/stats",
        "https:///v1/stats",
        "telemetry.example/v1/stats",
    ],
)
def test_refuses_an_address_that_is_not_https_or_this_machine_s(
    monkeypatch: pytest.MonkeyPatch, published: dict[str, Any], address: str
) -> None:
    opener = answering(monkeypatch, Answer(200, {"success": True, "data": published, "error": None}))
    with pytest.raises(NotPublishedError, match="https, or http to this machine"):
        fetch(address)
    assert opener.opened == []


@pytest.mark.parametrize(
    "address",
    [ADDRESS, "http://localhost:8000/v1/stats", "http://127.0.0.1:8000/v1/stats", "http://[::1]:8000/v1/stats"],
)
def test_reads_an_https_address_or_this_machine_s(
    monkeypatch: pytest.MonkeyPatch, published: dict[str, Any], address: str
) -> None:
    answering(monkeypatch, Answer(200, {"success": True, "data": published, "error": None}))
    assert fetch(address).installs == MIN_INSTALLS


@pytest.fixture
def redirecting() -> Iterator[tuple[str, list[str]]]:
    """A server on this machine that answers every read with a 307 to another of its addresses; its address, and the
    paths it was asked for."""
    asked: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            asked.append(self.path)
            self.send_response(307)
            port = cast("tuple[str, int]", self.server.server_address)[1]
            self.send_header("location", f"http://127.0.0.1:{port}/elsewhere")
            self.end_headers()

        def log_message(self, *_args: object) -> None:
            """Logs nothing."""

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/v1/stats", asked
    finally:
        server.shutdown()
        server.server_close()


def test_never_follows_a_redirect(redirecting: tuple[str, list[str]]) -> None:
    address, asked = redirecting
    with pytest.raises(NotPublishedError, match="answered 307"):
        fetch(address)
    assert asked == ["/v1/stats"]


def test_writes_nothing_when_the_endpoint_publishes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    status, _ = stats_answer(MIN_INSTALLS - 1)
    assert status == 204
    answering(monkeypatch, Answer(204, b""))
    with pytest.raises(NotPublishedError, match="fewer than 50 installs"):
        fetch(ADDRESS)


def changed(path: str, value: object) -> Callable[[dict[str, Any]], None]:
    """A change setting the answer's ``path`` (keys joined by dots) to ``value``, or deleting it for ``...``."""

    def change(data: dict[str, Any]) -> None:
        *parents, last = path.split(".")
        at = data
        for key in parents:
            at = at[key]
        if value is ...:
            del at[last]
        else:
            at[last] = value

    return change


@pytest.mark.parametrize(
    ("change", "says"),
    [
        (changed("installs", MIN_INSTALLS - 1), "fewer than 50 installs"),
        (changed("since", "2026-10-02"), "one whole month"),
        (changed("until", "2026-10-30"), "one whole month"),
        (changed("since", "2026-09-01"), "one whole month"),
        (changed("until", "[a link](https://example.com)"), "one whole month"),
        (changed("agents.dots", ...), "exactly Attest's agents"),
        (changed("agents.instinct", None), "exactly Attest's agents"),
        (changed("agents.muse.installs", MIN_INSTALLS - 1), "Muse do not add up"),
        (changed("agents.muse.installs", MIN_INSTALLS + 1), "Muse do not add up"),
        (changed("agents.muse.unasked", -5), "Muse do not add up"),
        (changed("agents.muse.verifiedRate", 7.5), "Muse do not add up"),
        (changed("agents.muse.verified", 700), "Muse do not add up"),
        (changed("agents.muse.receipts", 10), "Muse do not add up"),
        (changed("agents.muse.receipts", "600"), "did not answer with aggregates"),
        (changed("agents.muse.note", "a note"), "did not answer with aggregates"),
        (changed("installs", ...), "did not answer with aggregates"),
    ],
)
def test_refuses_an_answer_the_api_could_not_have_given(
    monkeypatch: pytest.MonkeyPatch, published: dict[str, Any], change: Callable[[dict[str, Any]], None], says: str
) -> None:
    data = copy.deepcopy(published)
    change(data)
    answering(monkeypatch, Answer(200, {"success": True, "data": data, "error": None}))
    with pytest.raises(NotPublishedError, match=says):
        fetch(ADDRESS)
