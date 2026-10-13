"""What the documents say ``GET /v1/stats`` does is what app/stats.py does (sprint_7 7.5; QA review, sprint 7): every
floor of installs a document states is ``MIN_INSTALLS``, every window ``WINDOW_DAYS``, and the time an answer is kept
``CACHE_SECONDS``, in the privacy policy, the privacy architecture, the API's README, the report's template, the launch
kit's index and the report script's own refusal; so a change to a constant fails here until each of them says it.
"""

import re
from pathlib import Path

import pytest

from app.stats import CACHE_SECONDS, MIN_INSTALLS, WINDOW_DAYS
from scripts import reliability_report

ROOT = Path(__file__).resolve().parents[2]

#: Each document that states the floor, and what else of the endpoint it states, as written.
STATEMENTS: dict[str, list[str]] = {
    "PRIVACY.md": [f"over the last {WINDOW_DAYS} days", f"fewer than {MIN_INSTALLS} installs report"],
    "docs/privacy-architecture.md": [
        f"days of the {WINDOW_DAYS} before today",
        f"fewer than {MIN_INSTALLS} installs report in the window",
        "an answer is kept an hour",
    ],
    "telemetry-api/README.md": [
        f"over the {WINDOW_DAYS} days before today",
        f"fewer than {MIN_INSTALLS} installs report",
        f"max-age={CACHE_SECONDS}",
    ],
    "launch/reliability-report-v0.md": [f"fewer than {MIN_INSTALLS} installs in the window"],
    "launch/README.md": [f"fewer than {MIN_INSTALLS} installs"],
}


@pytest.mark.parametrize("document", sorted(STATEMENTS))
def test_each_document_states_the_endpoint_s_floor_window_and_hour(document: str) -> None:
    text = " ".join((ROOT / document).read_text("utf-8").split())
    for statement in STATEMENTS[document]:
        assert statement in text, f"{document}: {statement}"
    floors = {int(n) for n in re.findall(r"fewer than (\d+) installs", text)}
    assert floors == {MIN_INSTALLS}, document


def test_an_hour_is_the_cache_the_documents_call_an_hour() -> None:
    assert CACHE_SECONDS == 3_600


def test_the_script_s_refusal_names_the_floor() -> None:
    assert f"fewer than {MIN_INSTALLS} installs" in (reliability_report.__doc__ or "")
    source = Path(reliability_report.__file__).read_text("utf-8")
    assert {int(n) for n in re.findall(r"fewer than (\d+) installs", source)} == {MIN_INSTALLS}
