"""The opt-in telemetry payload (sprint_5 5.6; agents/backend_engineer.md rules 1 and 2; Hard Rule 1).

The same schema as extension/src/telemetry/schema.ts (Zod): counts and booleans, enum strings and one install id, and
nothing else. Both export to the JSON Schema committed at tests/payload.schema.json, and a test on each side holds its
own export to that file (tests/test_schema_parity.py; extension/tests/unit/telemetry/schema-parity.spec.ts), so the two
cannot drift.

Every string is an enum value, the install id (a UUID v4), the extension's version (digits and dots) or the day
(``YYYY-MM-DD``, a real date): free text is impossible by schema. Every model forbids extra keys (``extra='forbid'``),
every value is strict (no ``"5"`` read as 5, no 1 read as true), and every count is a bounded integer. The patterns use
ASCII classes alone, so Python and JavaScript read them alike.
"""

import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

UUID_V4 = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
VERSION = r"^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$"
DAY = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"

#: The most receipts one agent can have counted for one grade in a day (extension: TELEMETRY_COUNT_MAX).
COUNT_MAX = 100_000

Count = Annotated[int, Field(ge=0, le=COUNT_MAX)]
Hours = Annotated[int, Field(ge=0, le=24)]
Component = Literal["gmail.sent", "gmail.receipt", "gcal.event", "muse.chat"]
Health = Literal["OK", "DEGRADED"]


class Strict(BaseModel):
    """A model that refuses a key it does not name, and reads every value as exactly its type."""

    model_config = ConfigDict(extra="forbid", strict=True)


class GradeCounts(Strict):
    """One agent's receipts of the day, by grade."""

    VERIFIED: Count
    PARTIAL: Count
    NOT_FOUND: Count
    UNASKED: Count
    OVER_SCOPE: Count
    UNVERIFIABLE: Count


class AgentCounts(Strict):
    """The day's counts of each agent."""

    muse: GradeCounts
    chatgpt: GradeCounts
    dots: GradeCounts
    claude: GradeCounts


#: The agents and the grades a payload counts, read from the models (Sprint 7 close, tech review TECH-4): the sums and
#: the published answer list exactly these, so an agent added here is summed and published, never dropped.
AGENTS: tuple[str, ...] = tuple(AgentCounts.model_fields)
GRADES: tuple[str, ...] = tuple(GradeCounts.model_fields)


class AdaptersEnabled(Strict):
    """Which agent readers are on."""

    muse: bool
    chatgpt: bool
    dots: bool
    claude: bool


class ObserversEnabled(Strict):
    """Which page readers are on."""

    gmail: bool
    gcal: bool


class CoverageHours(Strict):
    """How many hours of the day each page reader covered."""

    gmail: Hours
    gcal: Hours


class TelemetryPayload(Strict):
    """One install's day: the only thing the API accepts."""

    installId: Annotated[str, Field(pattern=UUID_V4)]
    extVersion: Annotated[str, Field(pattern=VERSION)]
    chromeMajor: Annotated[int, Field(ge=1, le=999)]
    dayBucket: Annotated[str, Field(pattern=DAY)]
    adaptersEnabled: AdaptersEnabled
    observersEnabled: ObserversEnabled
    counts: AgentCounts
    adapterHealth: dict[Component, Health]
    coverageHours: CoverageHours

    @field_validator("dayBucket")
    @classmethod
    def real_day(cls, day: str) -> str:
        """Refuses a day the calendar does not have (2026-02-30)."""
        datetime.date.fromisoformat(day)
        return day
