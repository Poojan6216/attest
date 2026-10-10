"""scripts/check_client_address.py (Decisions.md [5.8]) judged on the API in this process, behind no proxy: the address
a client writes in ``X-Forwarded-For`` is the first entry. Reading the socket, the API counts every send as one client,
and the check says ok. Trusting the header with no proxy that strips it, the API counts the made-up addresses as the
client's, and the check says FAIL and names the setting. With a limit above 1, it says the limit is the cause.
"""

import json
from typing import Any

from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from app.store import MemoryStore
from scripts.check_client_address import Post, check


def through(*, trust_forwarded_for: bool, ip_limit_per_day: int = 1) -> tuple[Post, MemoryStore]:
    """Posts to the API in this process (header); its store."""
    settings = Settings(
        mongo_url="mongodb://unused",
        allowed_ext_ids="a" * 32,
        trust_forwarded_for=trust_forwarded_for,
        ip_limit_per_day=ip_limit_per_day,
    )
    store = MemoryStore()
    api = TestClient(create_app(settings, store))

    def post(payload: dict[str, Any], forwarded: str) -> int:
        headers = {"content-type": "application/json", "x-forwarded-for": forwarded}
        status: int = api.post("/v1/aggregate", content=json.dumps(payload), headers=headers).status_code
        return status

    return post, store


def test_says_ok_when_the_client_cannot_choose_its_address() -> None:
    post, store = through(trust_forwarded_for=False)
    ok, said = check(post)
    assert ok
    assert said.startswith("ok ")
    assert len(store.documents) == 1


def test_says_fail_and_names_the_setting_when_the_client_can() -> None:
    post, _ = through(trust_forwarded_for=True)
    ok, said = check(post)
    assert not ok
    assert said == "FAIL the API counted the address the client wrote: set TRUST_FORWARDED_FOR to false"


def test_says_when_the_limit_is_not_one() -> None:
    post, _ = through(trust_forwarded_for=False, ip_limit_per_day=240)
    ok, said = check(post)
    assert not ok
    assert "IP_LIMIT_PER_DAY to 1" in said


def test_says_what_it_got_when_the_day_is_used() -> None:
    post, _ = through(trust_forwarded_for=False)
    check(post)
    ok, said = check(post)
    assert not ok
    assert said == "FAIL expected 204, 429, 429, got [429, 429, 429]: a redeploy starts the day's counts again"
