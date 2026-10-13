"""Writes the monthly Agent Reliability Report from the public aggregates (sprint_7 7.5, 7.6; launch_engineer rule 1;
Sprint 7 close: security review SEC-3, tech review TECH-1 and TECH-12, QA review QA-6).

Run in telemetry-api/: ``uv run python -m scripts.reliability_report <stats address> [--out <file>] [--template
<file>]``. It reads ``GET <stats address>`` (the deployed API's ``/v1/stats``, app/stats.py) and fills the template,
launch/reliability-report-v0.md unless ``--template`` names another, from it: the month, the installs, and one row per
agent. Every number in the report is from that one answer, and the template's notes (``<!-- -->``) are left out.

It trusts the answer no further than it checks it. The address is https, or http to exactly ``localhost``,
``127.0.0.1`` or ``::1``, with no user name, and a redirect is never followed. The answer must be one whole calendar
month, with no fewer than 50 installs; each agent with no fewer than 50 installs of its own, or none published; every
count at least 0, and each rate its count's share of the receipts as the API rounds it. Anything else (nothing
published, as the API answers while fewer than 50 installs report; an error; an answer that is not that) writes
nothing, says why in one line on stderr and exits 1. Prints the report, or writes it to ``--out``.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from pydantic import ValidationError

from app.schema import AGENTS
from app.stats import MIN_INSTALLS, AgentStats, Stats, rate

TEMPLATE = Path(__file__).resolve().parents[2] / "launch" / "reliability-report-v0.md"
#: The agents as people know them.
NAMES = {"muse": "Muse", "chatgpt": "ChatGPT", "dots": "Dots", "claude": "Claude"}
#: The hosts a plain-http address may name: this machine's.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
#: A note in the template, for whoever edits it, never in a report.
NOTE = re.compile(r"<!--.*?-->\n*", re.DOTALL)


class NotPublishedError(Exception):
    """There is no report to write: the endpoint published nothing, or nothing this script can vouch for."""


class Refused(urllib.request.HTTPRedirectHandler):
    """Follows no redirect: urllib then answers the redirect itself as an error."""

    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        """No request to the address it names."""


OPENER = urllib.request.build_opener(Refused)


def checked(address: str) -> str:
    """``address``, when it is https, or http to this machine, with no user name (header)."""
    parts = urllib.parse.urlsplit(address)
    local = parts.scheme == "http" and parts.hostname in LOCAL_HOSTS
    if (parts.scheme != "https" and not local) or not parts.hostname or "@" in parts.netloc:
        message = "the stats address must be https, or http to this machine, with no user name"
        raise NotPublishedError(message)
    return address


def fetch(address: str) -> Stats:
    """The aggregates at ``address`` (header); ``NotPublishedError`` for anything but aggregates this script vouches
    for."""
    try:
        with OPENER.open(checked(address), timeout=30) as answer:
            status, body = answer.status, answer.read()
    except urllib.error.HTTPError as error:
        message = f"the endpoint answered {error.code}"
        raise NotPublishedError(message) from error
    except OSError as error:
        message = "the endpoint could not be reached"
        raise NotPublishedError(message) from error
    if status == 204:
        message = f"fewer than {MIN_INSTALLS} installs reported in the month, so there is no report"
        raise NotPublishedError(message)
    return vouched(aggregates_in(body))


def aggregates_in(body: bytes) -> Stats:
    """The aggregates an answer's ``body`` holds; ``NotPublishedError`` when it holds none."""
    message = "the endpoint did not answer with aggregates"
    try:
        parsed = json.loads(body)
    except ValueError as error:
        raise NotPublishedError(message) from error
    if not isinstance(parsed, dict) or parsed.get("success") is not True or "data" not in parsed:
        raise NotPublishedError(message)
    try:
        return Stats.model_validate(parsed["data"], strict=True)
    except ValidationError as error:
        raise NotPublishedError(message) from error


def whole_month(since: str, until: str) -> bool:
    """Whether ``since`` to ``until`` is one whole calendar month."""
    try:
        first, last = date.fromisoformat(since), date.fromisoformat(until)
    except ValueError:
        return False
    return first.day == 1 and last == (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def agent_holds(stats: AgentStats, installs: int) -> bool:
    """Whether one agent's month is one the API could have answered, among ``installs`` installs."""
    counts = (stats.verified, stats.not_found, stats.unasked)
    rates = (stats.verified_rate, stats.not_found_rate, stats.unasked_rate)
    return (
        MIN_INSTALLS <= stats.installs <= installs
        and stats.receipts >= max(stats.installs, sum(counts))
        and min(counts) >= 0
        and all(given == rate(count, stats.receipts) for count, given in zip(counts, rates, strict=True))
    )


def vouched(stats: Stats) -> Stats:
    """``stats``, when it is an answer the API could have given (header); ``NotPublishedError`` otherwise."""
    if stats.installs < MIN_INSTALLS:
        message = f"the endpoint answered for fewer than {MIN_INSTALLS} installs, so there is no report"
        raise NotPublishedError(message)
    if not whole_month(stats.since, stats.until):
        message = "the endpoint did not answer for one whole month"
        raise NotPublishedError(message)
    if sorted(stats.agents) != sorted(AGENTS):
        message = "the endpoint did not answer for exactly Attest's agents"
        raise NotPublishedError(message)
    for agent, month in stats.agents.items():
        if month is not None and not agent_holds(month, stats.installs):
            message = f"the endpoint's numbers for {NAMES[agent]} do not add up"
            raise NotPublishedError(message)
    return stats


def share(count: int, of: float | None) -> str:
    """A count and its rate as a percentage; the count alone when there is no rate."""
    return str(count) if of is None else f"{count} ({of * 100:.1f}%)"


def row(agent: str, stats: AgentStats | None) -> str:
    """One agent's line of the table; no numbers for an agent too few installs used."""
    if stats is None:
        cells = [NAMES[agent], f"fewer than {MIN_INSTALLS}", *["not published"] * 4]
    else:
        cells = [
            NAMES[agent],
            str(stats.installs),
            str(stats.receipts),
            share(stats.verified, stats.verified_rate),
            share(stats.not_found, stats.not_found_rate),
            share(stats.unasked, stats.unasked_rate),
        ]
    return f"| {' | '.join(cells)} |"


def render(stats: Stats, template: str) -> str:
    """The report: ``template`` without its notes, every placeholder filled from ``stats``, the agents in the schema's
    order; ``NotPublishedError`` when the template holds a placeholder this script does not fill."""
    filled = (
        NOTE.sub("", template)
        .replace("{{month}}", f"{date.fromisoformat(stats.since):%B %Y}")
        .replace("{{since}}", stats.since)
        .replace("{{until}}", stats.until)
        .replace("{{installs}}", str(stats.installs))
        .replace("{{agents}}", "\n".join(row(agent, stats.agents[agent]) for agent in AGENTS))
    )
    if "{{" in filled or "<!--" in filled:
        message = "the template holds a placeholder or a note this script does not fill or remove"
        raise NotPublishedError(message)
    return filled


def report(address: str, template: Path) -> str:
    """The report from the answer at ``address`` and the template at ``template``."""
    try:
        text = template.read_text("utf-8")
    except OSError as error:
        message = f"the template {template} could not be read"
        raise NotPublishedError(message) from error
    return render(fetch(address), text)


def main(argv: list[str] | None = None) -> int:
    """Reads the address, writes the report (header)."""
    parser = argparse.ArgumentParser(description="Writes the Agent Reliability Report from GET /v1/stats.")
    parser.add_argument("address", help="the deployed API's /v1/stats address")
    parser.add_argument("--out", type=Path, help="where to write the report; printed when absent")
    parser.add_argument("--template", type=Path, default=TEMPLATE, help="the report's template")
    arguments = parser.parse_args(argv)
    try:
        written = report(arguments.address, arguments.template)
    except NotPublishedError as error:
        sys.stderr.write(f"reliability_report: {error}\n")
        return 1
    if arguments.out is None:
        sys.stdout.write(written)
    else:
        arguments.out.write_text(written, "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
