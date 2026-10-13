"""What the documents say ``GET /v1/stats`` and the API do is what the code does (sprint_7 7.5; QA review, sprint 7;
Sprint 7 close): every floor of installs a document states is ``MIN_INSTALLS``, every count of days ``MIN_DAYS``, the
month published the one app/days.py publishes, from the day it says, the retention ``RETENTION_DAYS``, the install ids
per client and the reads per client the settings' defaults, and the time a client may keep an answer
``CACHE_SECONDS``; in the privacy policy, the privacy architecture, the API's README, the changelog, the report's
template, the launch kit's index and the report script's own refusal. So a change to a constant fails here until each
of them says it.
"""

import re
from datetime import date
from pathlib import Path

import pytest

from app.days import LATE_DAYS, published_month
from app.settings import Settings
from app.stats import CACHE_SECONDS, MIN_DAYS, MIN_INSTALLS
from app.store import RETENTION_DAYS
from scripts import reliability_report

ROOT = Path(__file__).resolve().parents[2]
INSTALLS_PER_CLIENT = Settings.model_fields["installs_per_client_per_day"].default
STATS_READS = Settings.model_fields["stats_limit_per_day"].default
MONTH = "one closed calendar month"
DAYS = f"at least {MIN_DAYS} days"
FLOOR = f"fewer than {MIN_INSTALLS} installs"

#: Each document that states the floor, and what else of the endpoint it states, as written.
STATEMENTS: dict[str, list[str]] = {
    "PRIVACY.md": [MONTH, DAYS, f"{FLOOR} count", f"deletes it {RETENTION_DAYS} days after it arrived"],
    "docs/privacy-architecture.md": [
        MONTH,
        DAYS,
        f"{FLOOR} count",
        "from the fourth day of the next month",
        f"from {'two' if LATE_DAYS == 2 else LATE_DAYS} days before its own UTC date to the day after",
        f"payloads for at most {INSTALLS_PER_CLIENT} install ids per client a day",
        f"deleted {RETENTION_DAYS} days after it arrived",
        "A client may keep the answer an hour",
    ],
    "telemetry-api/README.md": [
        MONTH,
        DAYS,
        f"{FLOOR} count",
        "from the fourth day of the next month",
        f"from {'two' if LATE_DAYS == 2 else LATE_DAYS} days before the server's UTC date to the day after",
        f"{INSTALLS_PER_CLIENT} install ids per client",
        f"read it {STATS_READS} times a day",
        f"deleted {RETENTION_DAYS} days after it arrived",
        f"max-age={CACHE_SECONDS}",
    ],
    "CHANGELOG.md": [MONTH, DAYS, f"{FLOOR} count", f"{INSTALLS_PER_CLIENT} install ids", f"{RETENTION_DAYS} days"],
    "launch/reliability-report-v0.md": [f"{FLOOR} report in the month", DAYS],
    "launch/README.md": [FLOOR, DAYS],
}


@pytest.mark.parametrize("document", sorted(STATEMENTS))
def test_each_document_states_what_the_code_does(document: str) -> None:
    text = " ".join((ROOT / document).read_text("utf-8").split())
    for statement in STATEMENTS[document]:
        assert statement in text, f"{document}: {statement}"
    floors = {int(n) for n in re.findall(r"fewer than (\d+) installs", text)}
    assert floors == {MIN_INSTALLS}, document


def test_a_month_is_published_from_the_fourth_day_after_it() -> None:
    assert published_month(date(2026, 11, 3))[0] == date(2026, 9, 1)
    assert published_month(date(2026, 11, 4))[0] == date(2026, 10, 1)


def test_an_hour_is_the_time_the_documents_call_an_hour() -> None:
    assert CACHE_SECONDS == 3_600


def test_the_script_s_refusal_names_the_floor() -> None:
    assert FLOOR in (reliability_report.__doc__ or "")
    source = Path(reliability_report.__file__).read_text("utf-8")
    assert {int(n) for n in re.findall(r"fewer than (\d+) installs", source)} == {MIN_INSTALLS}
