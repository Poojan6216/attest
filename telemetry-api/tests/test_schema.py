"""The payload schema (sprint_5 5.6; agents/backend_engineer.md rules 1 and 2).

It accepts the valid payload of payload-cases.json and every change that keeps it valid, and refuses every change that
makes it invalid (each with why: an extra key, a free string, a number as a string, a count out of bounds, a day the
calendar does not have, ...). The extension's Zod schema judges the same cases alike
(extension/tests/unit/telemetry/schema.spec.ts). And no string can carry free text: every string the schema allows is
an enum value, a UUID v4, a version or a day.
"""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.schema import DAY, UUID_V4, VERSION, TelemetryPayload
from tests.schema_normal import normal_schema

CASES = json.loads((Path(__file__).parent / "payload-cases.json").read_text("utf-8"))


def changed(case: dict[str, Any]) -> object:
    """The valid payload with the case's change: a value set at its path, or the path deleted."""
    payload = copy.deepcopy(CASES["valid"])
    path: list[str] = case["set"] if "set" in case else case["delete"]
    *parents, last = path
    at = payload
    for key in parents:
        at = at[key]
    if "set" in case:
        at[last] = case["value"]
    else:
        del at[last]
    return payload


def test_accepts_the_valid_payload() -> None:
    assert TelemetryPayload.model_validate(CASES["valid"]).model_dump(mode="json") == CASES["valid"]


@pytest.mark.parametrize("case", CASES["alsoValid"], ids=[case["why"] for case in CASES["alsoValid"]])
def test_accepts_every_change_that_keeps_it_valid(case: dict[str, Any]) -> None:
    TelemetryPayload.model_validate(changed(case))


@pytest.mark.parametrize("case", CASES["invalid"], ids=[case["why"] for case in CASES["invalid"]])
def test_refuses_every_change_that_makes_it_invalid(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        TelemetryPayload.model_validate(changed(case))


def test_refuses_anything_but_an_object() -> None:
    payloads: tuple[object, ...] = ([], "payload", 1, None)
    for payload in payloads:
        with pytest.raises(ValidationError):
            TelemetryPayload.model_validate(payload)


def strings(schema: object, where: str = "payload") -> list[tuple[str, dict[str, Any]]]:
    """Every node of a normal-form schema that admits a string, with where it is."""
    if not isinstance(schema, dict):
        return []
    found = [(where, schema)] if schema.get("type") == "string" or "enum" in schema else []
    for name, sub in schema.get("properties", {}).items():
        found += strings(sub, f"{where}.{name}")
    for key in ("additionalProperties", "propertyNames"):
        found += strings(schema.get(key), f"{where}[{key}]")
    return found


def test_no_string_can_carry_free_text() -> None:
    schema: Any = normal_schema(TelemetryPayload.model_json_schema())
    found = strings(schema)
    # The install id, the version, the day, and the health map's keys and values.
    assert [where for where, _ in found] == [
        "payload.installId",
        "payload.extVersion",
        "payload.dayBucket",
        "payload.adapterHealth[additionalProperties]",
        "payload.adapterHealth[propertyNames]",
    ]
    for where, node in found:
        assert "enum" in node or node.get("pattern") in {UUID_V4, VERSION, DAY}, where
    # Every object names its keys: none takes a key it does not list.
    objects = [schema, *(schema["properties"][name] for name in schema["properties"])]
    for node in objects:
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False or "propertyNames" in node
