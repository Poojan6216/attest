"""A JSON Schema in normal form (sprint_5 5.6): the rules of extension/tests/tools/telemetry-schema.ts `normalSchema`.

A ``$ref`` to ``#/$defs/<name>`` is replaced by what it names; ``$schema``, ``$defs``, ``$id``, ``title``,
``description``, ``default`` and ``examples`` are dropped (they describe, never constrain); ``required`` and ``enum``
are sorted; and ``type: "string"`` beside an ``enum`` of strings is dropped (the enum says it). Two schemas that agree
in normal form accept the same payloads.
"""

import re

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None

DESCRIPTIVE = frozenset({"$schema", "$defs", "$id", "title", "description", "default", "examples"})
REF = re.compile(r"^#/\$defs/([A-Za-z0-9_]+)$")


def _resolved(root: dict[str, Json], ref: str) -> dict[str, Json]:
    match = REF.match(ref)
    defs = root.get("$defs")
    target = defs.get(match.group(1)) if match is not None and isinstance(defs, dict) else None
    if not isinstance(target, dict):
        message = f"cannot resolve {ref}"
        raise TypeError(message)
    return target


def normal_schema(schema: Json, root: Json = None) -> Json:
    """``schema`` in normal form, ``root`` holding its ``$defs``."""
    root = schema if root is None else root
    if not isinstance(schema, dict) or not isinstance(root, dict):
        return schema
    ref = schema.get("$ref")
    if isinstance(ref, str):
        rest = {key: value for key, value in schema.items() if key != "$ref"}
        return normal_schema({**_resolved(root, ref), **rest}, root)
    out: dict[str, Json] = {}
    for key, value in schema.items():
        if key in DESCRIPTIVE:
            continue
        if key == "properties" and isinstance(value, dict):
            out[key] = {name: normal_schema(sub, root) for name, sub in value.items()}
        elif key in ("additionalProperties", "propertyNames", "items") and isinstance(value, dict):
            out[key] = normal_schema(value, root)
        elif key in ("required", "enum") and isinstance(value, list):
            out[key] = sorted(value, key=str)
        else:
            out[key] = value
    members = out.get("enum")
    if out.get("type") == "string" and isinstance(members, list) and all(isinstance(m, str) for m in members):
        del out["type"]
    return dict(sorted(out.items()))
