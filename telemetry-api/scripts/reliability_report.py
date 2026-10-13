"""Writes the monthly Agent Reliability Report from the public aggregates (sprint_7 7.5, 7.6; launch_engineer rule 1).

``uv run python scripts/reliability_report.py <stats address> [--out <file>]`` reads ``GET <stats address>`` (the
deployed API's ``/v1/stats``, app/stats.py) and fills launch/reliability-report-v0.md with it: the window, the installs,
and one row per agent with its receipts and its VERIFIED, NOT_FOUND and UNASKED counts and rates. Every number in the
report is from that one answer. When the endpoint publishes nothing (204: fewer than 50 installs), or answers anything
but a valid aggregate, nothing is written and the script exits 1. Prints the report, or writes it to ``--out``.
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

from app.stats import AGENTS, AgentStats, Stats

TEMPLATE = Path(__file__).resolve().parents[2] / "launch" / "reliability-report-v0.md"
#: The agents as people know them.
NAMES = {"muse": "Muse", "chatgpt": "ChatGPT", "dots": "Dots", "claude": "Claude"}


class NotPublishedError(Exception):
    """The endpoint published nothing, or nothing this script reads."""


def fetch(address: str) -> Stats:
    """The aggregates at ``address``; ``NotPublishedError`` on a 204 or on anything but a valid answer."""
    if not address.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        message = "the stats address must be https (or a local API)"
        raise NotPublishedError(message)
    with urllib.request.urlopen(address, timeout=30) as answer:  # noqa: S310 (the scheme is checked above)
        if answer.status == 204:
            message = "fewer than 50 installs reported in the window, so there is no report"
            raise NotPublishedError(message)
        body = json.loads(answer.read())
    if not isinstance(body, dict) or body.get("success") is not True:
        message = "the endpoint did not answer with aggregates"
        raise NotPublishedError(message)
    return Stats.model_validate(body["data"])


def share(count: int, rate: float | None) -> str:
    """A count and its rate as a percentage; the count alone when there is no rate."""
    return str(count) if rate is None else f"{count} ({rate * 100:.1f}%)"


def row(agent: str, stats: AgentStats) -> str:
    """One agent's line of the table."""
    cells = [
        NAMES[agent],
        str(stats.receipts),
        share(stats.verified, stats.verifiedRate),
        share(stats.notFound, stats.notFoundRate),
        share(stats.unasked, stats.unaskedRate),
    ]
    return f"| {' | '.join(cells)} |"


def render(stats: Stats, template: str) -> str:
    """The report: ``template`` with every placeholder filled from ``stats``, the agents in a fixed order."""
    filled = (
        template.replace("{{since}}", stats.since)
        .replace("{{until}}", stats.until)
        .replace("{{installs}}", str(stats.installs))
        .replace("{{agents}}", "\n".join(row(agent, stats.agents[agent]) for agent in AGENTS))
    )
    if "{{" in filled:
        message = "the template holds a placeholder this script does not fill"
        raise ValueError(message)
    return filled


def main() -> int:
    """Reads the address, writes the report (header)."""
    parser = argparse.ArgumentParser(description="Writes the Agent Reliability Report from GET /v1/stats.")
    parser.add_argument("address", help="the deployed API's /v1/stats address")
    parser.add_argument("--out", type=Path, help="where to write the report; printed when absent")
    arguments = parser.parse_args()
    try:
        report = render(fetch(arguments.address), TEMPLATE.read_text("utf-8"))
    except NotPublishedError as error:
        sys.stderr.write(f"reliability_report: {error}\n")
        return 1
    if arguments.out is None:
        sys.stdout.write(report)
    else:
        arguments.out.write_text(report, "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
