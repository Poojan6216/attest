"""Rate limits (sprint_5 5.8; agents/backend_engineer.md rule 3; Sprint 5 close, security review SEC-5): per install id
and per client, each a fixed window of one UTC day, in memory, and a ceiling on what the API stores in a day. A client
is known only by a salted hash of its address, the salt random per process, so the address itself is never kept, even
here (rule 4). An IPv6 client is known by its /64, which one client holds whole, so rotating addresses inside it gains
nothing; an address that does not parse counts as one client with every other such address. Each limit counts at most
``max_keys`` keys a day, so a flood of new ones is refused instead of growing memory. A request over any limit is
refused (429), never stored and never counted.

Sprint 7 close: a client may send for at most so many install ids a day (security review SEC-2), so one address cannot
make up the installs that would pass the published floor in an afternoon; and each client may read the stats so many
times a day (SEC-4).
"""

import hashlib
import ipaddress
import secrets
from datetime import date

from app.settings import Settings

#: The key every address that does not parse shares.
UNPARSED = "unparsed"


class DailyLimit:
    """At most ``per_day`` per key per UTC day, over at most ``max_keys`` keys. The caller asks every limit first and
    counts only when all allow, so a payload one limit refuses counts against none."""

    def __init__(self, per_day: int, max_keys: int) -> None:
        """A limit of ``per_day`` for each of at most ``max_keys`` keys a day."""
        self._per_day = per_day
        self._max_keys = max_keys
        self._day: date | None = None
        self._counts: dict[str, int] = {}

    def _start(self, today: date) -> None:
        """Starts the count again when ``today`` is a new day."""
        if today != self._day:
            self._day = today
            self._counts.clear()

    def allows(self, key: str, today: date) -> bool:
        """Whether ``key`` may count one more on ``today``: under its limit, a key already counted or room for one."""
        self._start(today)
        count = self._counts.get(key)
        if count is None:
            return len(self._counts) < self._max_keys
        return count < self._per_day

    def count(self, key: str, today: date) -> None:
        """Counts one for ``key`` on ``today``."""
        self._start(today)
        self._counts[key] = self._counts.get(key, 0) + 1


def client_of(address: str) -> str:
    """The client an address belongs to (header): an IPv4 address itself, an IPv6 address's /64, else ``UNPARSED``."""
    try:
        parsed = ipaddress.ip_address(address.strip())
    except ValueError:
        return UNPARSED
    if isinstance(parsed, ipaddress.IPv6Address):
        if parsed.ipv4_mapped is not None:
            return str(parsed.ipv4_mapped)
        return str(ipaddress.IPv6Network((parsed, 64), strict=False))
    return str(parsed)


class ClientKeys:
    """A client's key: a salted SHA-256 of its client (``client_of``), the salt this process's own."""

    def __init__(self) -> None:
        """A fresh salt."""
        self._salt = secrets.token_bytes(16)

    def of(self, address: str) -> str:
        """The key for ``address``."""
        return hashlib.sha256(self._salt + client_of(address).encode("utf-8")).hexdigest()


class DailyIds:
    """At most ``per_day`` distinct ids per key per UTC day, over at most ``max_keys`` keys. An id a key has already
    sent is always allowed again: how often it may send is ``DailyLimit``'s."""

    def __init__(self, per_day: int, max_keys: int) -> None:
        """A limit of ``per_day`` ids for each of at most ``max_keys`` keys a day."""
        self._per_day = per_day
        self._max_keys = max_keys
        self._day: date | None = None
        self._ids: dict[str, set[str]] = {}

    def _start(self, today: date) -> None:
        """Starts again when ``today`` is a new day."""
        if today != self._day:
            self._day = today
            self._ids.clear()

    def allows(self, key: str, value: str, today: date) -> bool:
        """Whether ``key`` may send ``value`` on ``today``: one of its ids already, or room for one more."""
        self._start(today)
        ids = self._ids.get(key)
        if ids is None:
            return len(self._ids) < self._max_keys
        return value in ids or len(ids) < self._per_day

    def count(self, key: str, value: str, today: date) -> None:
        """Counts ``value`` among ``key``'s ids on ``today``."""
        self._start(today)
        self._ids.setdefault(key, set()).add(value)


class Limits:
    """The API's limits (header): per install id, per client, install ids per client, what is stored in a day, and
    reads of the stats per client."""

    def __init__(self, settings: Settings) -> None:
        """The limits ``settings`` set, each counting at most its ``limit_keys_per_day`` keys a day."""
        keys = settings.limit_keys_per_day
        self._install = DailyLimit(settings.install_limit_per_day, keys)
        self._client = DailyLimit(settings.ip_limit_per_day, keys)
        self._installs = DailyIds(settings.installs_per_client_per_day, keys)
        self._stored = DailyLimit(settings.store_limit_per_day, 1)
        self._reads = DailyLimit(settings.stats_limit_per_day, keys)
        self._keys = ClientKeys()

    def admit(self, install_id: str, address: str, today: date) -> bool:
        """Whether a payload of ``install_id`` from ``address`` may be stored ``today``; counted against every limit
        only when every one allows it. No ``await`` runs between asking and counting, so requests never interleave
        here."""
        client = self._keys.of(address)
        allowed = (
            self._install.allows(install_id, today)
            and self._client.allows(client, today)
            and self._installs.allows(client, install_id, today)
            and self._stored.allows("stored", today)
        )
        if allowed:
            self._install.count(install_id, today)
            self._client.count(client, today)
            self._installs.count(client, install_id, today)
            self._stored.count("stored", today)
        return allowed

    def admit_read(self, address: str, today: date) -> bool:
        """Whether ``address`` may read the stats ``today``, counted when it may."""
        client = self._keys.of(address)
        if not self._reads.allows(client, today):
            return False
        self._reads.count(client, today)
        return True
