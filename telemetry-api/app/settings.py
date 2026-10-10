"""The API's settings, from the environment only (sprint_5 5.8; agents/backend_engineer.md rule 8).

``MONGO_URL`` (required: where the aggregates are stored), ``MONGO_DB``, ``ALLOWED_EXT_IDS`` (the extension ids whose
origin may post, comma-separated: CORS allows ``chrome-extension://<id>`` for each and nothing else), the two daily
limits, the ceiling on what is stored in a day and how many keys each limit counts in a day (Sprint 5 close, security
review SEC-5), ``TRUST_FORWARDED_FOR`` (true behind a proxy that writes the client's address first in
``X-Forwarded-For`` and strips what the client sent there, as Railway's edge says it does;
scripts/check_client_address.py proves it) and the largest body read. A value the settings refuse stops the app at
start, never later.
"""

import re

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: A Chrome extension id: 32 letters from a to p.
EXTENSION_ID = re.compile(r"^[a-p]{32}$")


class Settings(BaseSettings):
    """Everything the API reads from its environment."""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    mongo_url: str = Field(min_length=1)
    mongo_db: str = Field(default="attest_telemetry", min_length=1)
    allowed_ext_ids: str = ""
    install_limit_per_day: int = Field(default=24, ge=1)
    ip_limit_per_day: int = Field(default=240, ge=1)
    store_limit_per_day: int = Field(default=100_000, ge=1)
    limit_keys_per_day: int = Field(default=100_000, ge=1)
    trust_forwarded_for: bool = False
    max_body_bytes: int = Field(default=16_384, ge=1_024)

    @field_validator("allowed_ext_ids")
    @classmethod
    def extension_ids(cls, value: str) -> str:
        """Refuses anything but extension ids."""
        for ext_id in (part.strip() for part in value.split(",")):
            if ext_id != "" and EXTENSION_ID.match(ext_id) is None:
                message = "ALLOWED_EXT_IDS holds something that is not a Chrome extension id"
                raise ValueError(message)
        return value

    @property
    def allowed_origins(self) -> list[str]:
        """The origins CORS allows: each allowed extension's own."""
        ids = (part.strip() for part in self.allowed_ext_ids.split(","))
        return [f"chrome-extension://{ext_id}" for ext_id in ids if ext_id != ""]
