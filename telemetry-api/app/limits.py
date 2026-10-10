"""Rate limits (sprint_5 5.8; agents/backend_engineer.md rule 3): per install id and per client, each a fixed window of
one UTC day, in memory. A client is known only by a salted hash of its address, the salt random per process, so the
address itself is never kept, even here (rule 4). A request over either limit is refused (429), never stored and never
counted.
"""

import hashlib
import secrets
from datetime import date


class DailyLimit:
    """At most ``per_day`` per key per UTC day. The caller asks every limit first and counts only when all allow, so a
    payload one limit refuses counts against none."""

    def __init__(self, per_day: int) -> None:
        """A limit of ``per_day``."""
        self._per_day = per_day
        self._day: date | None = None
        self._counts: dict[str, int] = {}

    def _start(self, today: date) -> None:
        """Starts the count again when ``today`` is a new day."""
        if today != self._day:
            self._day = today
            self._counts.clear()

    def allows(self, key: str, today: date) -> bool:
        """Whether ``key`` may count one more on ``today``."""
        self._start(today)
        return self._counts.get(key, 0) < self._per_day

    def count(self, key: str, today: date) -> None:
        """Counts one for ``key`` on ``today``."""
        self._start(today)
        self._counts[key] = self._counts.get(key, 0) + 1


class ClientKeys:
    """A client's key: a salted SHA-256 of its address, the salt this process's own."""

    def __init__(self) -> None:
        """A fresh salt."""
        self._salt = secrets.token_bytes(16)

    def of(self, address: str) -> str:
        """The key for ``address``."""
        return hashlib.sha256(self._salt + address.encode("utf-8")).hexdigest()
