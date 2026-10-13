"""The reliability report's command (scripts/reliability_report.py ``main``; sprint_7 7.5, 7.6; QA review, sprint 7;
Sprint 7 close, QA-6 and TECH-12): on anything but aggregates it vouches for (the API's 204, an answer below the floor,
an HTTP error, an address that cannot be reached, a body that is not JSON or not aggregates, a template it cannot fill)
it exits 1, says why in one line on stderr and writes no file; on the API's aggregates it writes the report to
``--out``, or prints it, every number from that one answer, from ``--template`` when one is named.
"""

import urllib.error
from email.message import Message
from pathlib import Path
from typing import Any

import pytest

from app.stats import MIN_INSTALLS
from scripts import reliability_report
from tests.support import Answer, Opener, stats_answer

ADDRESS = "https://telemetry.example/v1/stats"


@pytest.fixture(scope="module")
def published() -> dict[str, Any]:
    """The API's whole answer over ``MIN_INSTALLS`` installs."""
    status, body = stats_answer(MIN_INSTALLS)
    assert status == 200
    answer: dict[str, Any] = body
    return answer


def run(monkeypatch: pytest.MonkeyPatch, opener: Opener, *extra: str) -> int:
    """``main`` with the command line ``ADDRESS *extra``, the API answering through ``opener``."""
    monkeypatch.setattr(reliability_report, "OPENER", opener)
    return reliability_report.main([ADDRESS, *extra])


def below_floor(published: dict[str, Any]) -> Answer:
    """The API's answer, with one install fewer than the floor."""
    return Answer(200, {**published, "data": {**published["data"], "installs": MIN_INSTALLS - 1}})


FAILURES: dict[str, Any] = {
    "nothing published": lambda _: Opener(Answer(204, b"")),
    "below the floor": lambda published: Opener(below_floor(published)),
    "an HTTP error": lambda _: Opener(
        error=urllib.error.HTTPError(ADDRESS, 503, "Service Unavailable", Message(), None)
    ),
    "no answer": lambda _: Opener(error=urllib.error.URLError("no such host")),
    "a time out": lambda _: Opener(error=TimeoutError("timed out")),
    "not JSON": lambda _: Opener(Answer(200, b"<html>")),
    "not aggregates": lambda _: Opener(Answer(200, {"success": True, "data": {"installs": "many"}, "error": None})),
    "an error answered": lambda _: Opener(Answer(200, {"success": False, "data": None, "error": "x"})),
}


@pytest.mark.parametrize("failure", sorted(FAILURES))
def test_exits_1_with_one_line_and_writes_nothing_on_every_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    published: dict[str, Any],
    failure: str,
) -> None:
    out = tmp_path / "report.md"
    capsys.readouterr()
    assert run(monkeypatch, FAILURES[failure](published), "--out", str(out)) == 1
    assert not out.exists()
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("reliability_report: ")
    assert captured.err.count("\n") == 1


def test_says_the_floor_when_the_api_publishes_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    capsys.readouterr()
    assert run(monkeypatch, Opener(Answer(204, b""))) == 1
    assert "fewer than 50 installs" in capsys.readouterr().err


def test_writes_the_report_from_the_api_s_answer(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, published: dict[str, Any]
) -> None:
    out = tmp_path / "report.md"
    assert run(monkeypatch, Opener(Answer(200, published)), "--out", str(out)) == 0
    report = out.read_text("utf-8")
    assert "{{" not in report
    assert f"From {MIN_INSTALLS} Attest installs" in report
    assert "| Muse | 50 | 600 | 450 (75.0%) | 150 (25.0%) | 0 (0.0%) |" in report


def test_prints_the_report_without_out(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], published: dict[str, Any]
) -> None:
    capsys.readouterr()
    assert run(monkeypatch, Opener(Answer(200, published))) == 0
    printed = capsys.readouterr().out
    assert printed.startswith("# Agent Reliability Report, October 2026")
    assert f"From {MIN_INSTALLS} Attest installs" in printed


def test_fills_the_template_it_is_given_and_refuses_one_it_cannot_fill(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str], published: dict[str, Any]
) -> None:
    template, out = tmp_path / "template.md", tmp_path / "report.md"
    template.write_text("<!-- a note -->\n{{installs}} installs in {{month}}\n", "utf-8")
    assert run(monkeypatch, Opener(Answer(200, published)), "--template", str(template), "--out", str(out)) == 0
    assert out.read_text("utf-8") == f"{MIN_INSTALLS} installs in October 2026\n"

    out.unlink()
    template.write_text("{{installs}} installs, {{published}}", "utf-8")
    capsys.readouterr()
    assert run(monkeypatch, Opener(Answer(200, published)), "--template", str(template), "--out", str(out)) == 1
    assert not out.exists()
    assert "placeholder" in capsys.readouterr().err
    assert run(monkeypatch, Opener(Answer(200, published)), "--template", str(tmp_path / "none.md")) == 1
