"""The image and the stack (Dockerfile, docker-compose.yml; Decisions.md [5.8]). uvicorn starts without its access log,
which would print each client's address (agents/backend_engineer.md rule 4), and without proxy headers, with which it
put a client's own ``X-Forwarded-For`` in place of the socket's address before ``TRUST_FORWARDED_FOR`` was read
(scripts/check_client_address.py caught it over real HTTP; the in-process tests never pass through uvicorn). Every
image is pinned by digest (Hard Rule 9).
"""

import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DIGEST = re.compile(r"@sha256:[0-9a-f]{64}\b")


def test_uvicorn_starts_without_access_log_or_proxy_headers() -> None:
    [command] = [line for line in (ROOT / "Dockerfile").read_text("utf-8").splitlines() if line.startswith("CMD ")]
    assert "--no-access-log" in command
    assert "--no-proxy-headers" in command
    assert "--forwarded-allow-ips" not in command
    assert "--proxy-headers" not in command.replace("--no-proxy-headers", "")


def test_every_image_is_pinned_by_digest() -> None:
    froms = [line for line in (ROOT / "Dockerfile").read_text("utf-8").splitlines() if line.startswith("FROM ")]
    images = [line for line in (ROOT / "docker-compose.yml").read_text("utf-8").splitlines() if "image:" in line]
    assert len(froms) == 2
    assert len(images) == 1
    for line in froms + images:
        assert DIGEST.search(line), line
