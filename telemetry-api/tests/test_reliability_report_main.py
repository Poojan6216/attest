"""The reliability report's command (scripts/reliability_report.py ``main``; sprint_7 7.5, 7.6; QA review, sprint 7): on
the API's 204, or an answer that is not aggregates, it exits 1, says why on stderr and writes no file; on the API's
aggregates it writes the report to ``--out``, or prints it, every number from that one answer; and a template holding a
placeholder it does not fill is refused rather than published with the placeholder in it.
"""

import sys
from pathlib import Path

import pytest

from app.stats import MIN_INSTALLS, Stats
from scripts import reliability_report
from tests.test_reliability_report import Answer, stats_answer

ADDRESS = "https://telemetry.example/v1/stats"


def run(monkeypatch: pytest.MonkeyPatch, status: int, body: object, *extra: str) -> int:
    """``main`` with the command line ``ADDRESS *extra``, the API answering ``status`` with ``body``."""
    monkeypatch.setattr("urllib.request.urlopen", lambda *_a, **_k: Answer(status, body))
    monkeypatch.setattr(sys, "argv", ["reliability_report.py", ADDRESS, *extra])
    return reliability_report.main()


def test_exits_1_writing_nothing_when_the_api_publishes_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    status, _ = stats_answer(MIN_INSTALLS - 1)
    assert status == 204
    capsys.readouterr()  # the API's own log line
    out = tmp_path / "report.md"
    assert run(monkeypatch, 204, None, "--out", str(out)) == 1
    assert not out.exists()
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "fewer than 50 installs" in captured.err


def test_exits_1_writing_nothing_when_the_api_does_not_answer_with_aggregates(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    out = tmp_path / "report.md"
    assert run(monkeypatch, 200, {"success": False, "data": None, "error": "x"}, "--out", str(out)) == 1
    assert not out.exists()


def test_writes_the_report_from_the_api_s_answer(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _, body = stats_answer(MIN_INSTALLS)
    out = tmp_path / "report.md"
    assert run(monkeypatch, 200, body, "--out", str(out)) == 0
    report = out.read_text("utf-8")
    assert "{{" not in report
    assert f"From {MIN_INSTALLS} Attest installs" in report
    assert "| Muse | 200 | 150 (75.0%) | 50 (25.0%) | 0 (0.0%) |" in report


def test_prints_the_report_without_out(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    _, body = stats_answer(MIN_INSTALLS)
    capsys.readouterr()  # the API's own log line
    assert run(monkeypatch, 200, body) == 0
    printed = capsys.readouterr().out
    assert printed.startswith("# Agent Reliability Report, ")
    assert f"From {MIN_INSTALLS} Attest installs" in printed


def test_refuses_a_template_with_a_placeholder_it_does_not_fill() -> None:
    _, body = stats_answer(MIN_INSTALLS)
    stats = Stats.model_validate(body["data"])
    with pytest.raises(ValueError, match="placeholder"):
        reliability_report.render(stats, "{{installs}} installs, {{published}}")
    assert reliability_report.render(stats, "{{installs}} installs") == f"{MIN_INSTALLS} installs"
