"""Structured logs (sprint_5 5.8; agents/backend_engineer.md rule 9): one JSON line per event on standard output, an
event name and counts or status codes only. Never a payload, an install id, an address or a header: the fields a
caller may pass are ints. The deployment collects standard output (Railway's log view).
"""

import json
import sys


def log(event: str, **fields: int) -> None:
    """Writes ``event`` with ``fields``, numbers only, as one JSON line."""
    sys.stdout.write(json.dumps({"event": event, **fields}, sort_keys=True) + "\n")
    sys.stdout.flush()
