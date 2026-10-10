# Attest's telemetry API (sprint_5 5.8; agents/backend_engineer.md). Every base image is pinned by digest (Hard Rule 9),
# the dependencies are exactly the lockfile's, and the server runs as an unprivileged user.
FROM ghcr.io/astral-sh/uv:0.11.1@sha256:fc93e9ecd7218e9ec8fba117af89348eef8fd2463c50c13347478769aaedd0ce AS uv

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY app ./app
RUN useradd --system --no-create-home telemetry
USER telemetry
EXPOSE 8000
# Railway sets PORT. No access log: uvicorn's would print each client's address (agents/backend_engineer.md rule 4).
# No proxy headers: uvicorn would otherwise put X-Forwarded-For in place of the socket's address for some peers, and the
# API's TRUST_FORWARDED_FOR alone decides which address its per-client limit counts (scripts/check_client_address.py).
CMD ["sh", "-c", "exec /srv/.venv/bin/uvicorn app.main:app_from_env --factory --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --no-proxy-headers"]
