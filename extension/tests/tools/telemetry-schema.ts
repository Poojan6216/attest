/**
 * The telemetry payload's JSON Schema contract (sprint_5 5.6; agents/backend_engineer.md rule 2): the extension's Zod
 * schema (src/telemetry/schema.ts) exported with `z.toJSONSchema`, in normal form, written to
 * telemetry-api/tests/payload.schema.json. The API's tests export its Pydantic schema, put it in the same normal form
 * (telemetry-api/tests/schema_normal.py, the same rules as `normalSchema` below) and require the same file, and
 * tests/unit/telemetry/schema-parity.spec.ts requires this export to be the file: so the two schemas accept the same
 * payloads, field for field. Run `pnpm exec tsx tests/tools/telemetry-schema.ts` from extension/ after changing the
 * schema, then change the Pydantic model until its test passes.
 *
 * Normal form, the same in both languages: a `$ref` to `#/$defs/<name>` is replaced by what it names; `$schema`,
 * `$defs`, `$id`, `title`, `description`, `default` and `examples` are dropped (they describe, never constrain);
 * `required` and `enum` are sorted; and `type: "string"` beside an `enum` of strings is dropped (the enum says it).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';

import { TelemetryPayload } from '../../src/telemetry/schema';

export const PAYLOAD_SCHEMA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../telemetry-api/tests/payload.schema.json',
);

/** Keys that describe a schema and never constrain it. */
const DESCRIPTIVE = new Set(['$schema', '$defs', '$id', 'title', 'description', 'default', 'examples']);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What `ref` (`#/$defs/<name>`) names in `root`. */
function resolved(root: Record<string, Json>, ref: string): Record<string, Json> {
  const name = /^#\/\$defs\/([A-Za-z0-9_]+)$/u.exec(ref)?.[1];
  const defs = root.$defs;
  const target = name === undefined || !isObject(defs) ? undefined : defs[name];
  if (!isObject(target)) throw new Error(`cannot resolve ${ref}`);
  return target;
}

/** A value's text for sorting: a string itself, anything else its JSON (Python sorts by `str`, the same for strings). */
const sortText = (value: Json): string => (typeof value === 'string' ? value : JSON.stringify(value));

function sortedStrings(values: Json): Json {
  return Array.isArray(values) ? [...values].sort((a, b) => (sortText(a) < sortText(b) ? -1 : 1)) : values;
}

/** `schema` in normal form (header), `root` holding its `$defs`. */
export function normalSchema(schema: unknown, root: unknown = schema): Json {
  if (!isObject(schema) || !isObject(root)) return schema as Json;
  const { $ref, ...rest } = schema;
  if (typeof $ref === 'string') return normalSchema({ ...resolved(root, $ref), ...rest }, root);
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DESCRIPTIVE.has(key)) continue;
    if (key === 'properties' && isObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, normalSchema(sub, root)]),
      );
    } else if (['additionalProperties', 'propertyNames', 'items'].includes(key) && isObject(value)) {
      out[key] = normalSchema(value, root);
    } else {
      out[key] = key === 'required' || key === 'enum' ? sortedStrings(value) : value;
    }
  }
  const { enum: members } = out;
  if (
    out.type === 'string' &&
    Array.isArray(members) &&
    members.every((member) => typeof member === 'string')
  ) {
    delete out.type;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The extension's payload schema, exported and in normal form. */
export function payloadSchema(): Json {
  return normalSchema(z.toJSONSchema(TelemetryPayload));
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedAs)).href) {
  writeFileSync(PAYLOAD_SCHEMA_FILE, `${JSON.stringify(payloadSchema(), null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), PAYLOAD_SCHEMA_FILE)}`);
}
