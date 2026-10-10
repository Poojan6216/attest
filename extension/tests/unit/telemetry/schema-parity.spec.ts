/**
 * The two payload schemas agree (sprint_5 5.6 done-when; agents/backend_engineer.md rule 2): the extension's Zod schema,
 * exported with `z.toJSONSchema` and put in normal form, is exactly telemetry-api/tests/payload.schema.json, which the
 * API's test requires its Pydantic export to be too (telemetry-api/tests/test_schema_parity.py). The normal form
 * undoes references and descriptions and nothing else, and a changed contract fails.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { normalSchema, PAYLOAD_SCHEMA_FILE, payloadSchema } from '../../tools/telemetry-schema';

const contract = (): Record<string, unknown> =>
  JSON.parse(readFileSync(PAYLOAD_SCHEMA_FILE, 'utf8')) as Record<string, unknown>;

describe('the telemetry payload contract', () => {
  it('is the Zod schema’s export (run tests/tools/telemetry-schema.ts after changing the schema)', () => {
    expect(contract()).toEqual(payloadSchema());
  });

  it('fails when the contract changes', () => {
    const changed = structuredClone(contract());
    const properties = changed.properties as Record<string, Record<string, unknown>>;
    if (properties.chromeMajor === undefined) throw new Error('no chromeMajor');
    properties.chromeMajor.maximum = 1000;
    expect(changed).not.toEqual(payloadSchema());
  });

  it('puts a schema in normal form: references resolved, descriptions dropped, sets sorted', () => {
    const schema = {
      $defs: { Inner: { title: 'Inner', type: 'object', properties: { b: { type: 'integer' } } } },
      title: 'Outer',
      description: 'words',
      type: 'object',
      properties: { a: { $ref: '#/$defs/Inner' }, e: { type: 'string', enum: ['y', 'x'] } },
      required: ['e', 'a'],
    };
    expect(normalSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'object', properties: { b: { type: 'integer' } } }, e: { enum: ['x', 'y'] } },
      required: ['a', 'e'],
    });
  });
});
