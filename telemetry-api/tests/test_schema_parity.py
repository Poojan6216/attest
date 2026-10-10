"""The two payload schemas agree (sprint_5 5.6 done-when; agents/backend_engineer.md rule 2).

The API's Pydantic model, exported as JSON Schema and put in normal form, is exactly payload.schema.json: the
extension's Zod schema exported and put in normal form by the same rules (extension/tests/tools/telemetry-schema.ts,
whose test requires the same). So the extension and the API accept the same payloads, field for field. The normal
form is checked too: it undoes Pydantic's references and descriptions, and nothing else.
"""

import json
from pathlib import Path

from app.schema import TelemetryPayload
from tests.schema_normal import Json, normal_schema

CONTRACT = Path(__file__).parent / "payload.schema.json"


def test_the_pydantic_schema_is_the_extensions() -> None:
    assert normal_schema(TelemetryPayload.model_json_schema()) == json.loads(CONTRACT.read_text("utf-8"))


def test_the_normal_form_resolves_references_and_drops_only_descriptions() -> None:
    schema: Json = {
        "$defs": {"Inner": {"title": "Inner", "type": "object", "properties": {"b": {"type": "integer"}}}},
        "title": "Outer",
        "description": "words",
        "type": "object",
        "properties": {"a": {"$ref": "#/$defs/Inner"}, "e": {"type": "string", "enum": ["y", "x"]}},
        "required": ["e", "a"],
    }
    assert normal_schema(schema) == {
        "type": "object",
        "properties": {"a": {"type": "object", "properties": {"b": {"type": "integer"}}}, "e": {"enum": ["x", "y"]}},
        "required": ["a", "e"],
    }


def test_a_changed_contract_fails() -> None:
    contract = json.loads(CONTRACT.read_text("utf-8"))
    contract["properties"]["chromeMajor"]["maximum"] = 1000
    assert normal_schema(TelemetryPayload.model_json_schema()) != contract
    del contract["properties"]["chromeMajor"]
    assert normal_schema(TelemetryPayload.model_json_schema()) != contract
