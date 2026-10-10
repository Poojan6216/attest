/**
 * The telemetry payload schema (sprint_5 5.6; src/telemetry/schema.ts): it accepts the valid payload of
 * telemetry-api/tests/payload-cases.json and every change that keeps it valid, and refuses every change that makes it
 * invalid, each with why: the same cases, judged alike, as the API's Pydantic schema
 * (telemetry-api/tests/test_schema.py). No string can carry free text: every string the schema allows is an enum value,
 * a UUID v4, a version or a day. Every value is invented.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TelemetryPayload } from '../../../src/telemetry/schema';
import { payloadSchema } from '../../tools/telemetry-schema';

interface Change {
  readonly why: string;
  readonly set?: readonly string[];
  readonly delete?: readonly string[];
  readonly value?: unknown;
}

const CASES = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../../../telemetry-api/tests/payload-cases.json'), 'utf8'),
) as { valid: Record<string, unknown>; alsoValid: Change[]; invalid: Change[] };

/** The valid payload with the change: a value set at its path, or the path deleted. */
function changed(change: Change): unknown {
  const payload = structuredClone(CASES.valid);
  const route = change.set ?? change.delete ?? [];
  let at: Record<string, unknown> = payload;
  for (const key of route.slice(0, -1)) at = at[key] as Record<string, unknown>;
  const last = route.at(-1) ?? '';
  if (change.set === undefined) Reflect.deleteProperty(at, last);
  else at[last] = change.value;
  return payload;
}

describe('the telemetry payload schema', () => {
  it('accepts the valid payload as it is', () => {
    expect(TelemetryPayload.parse(CASES.valid)).toEqual(CASES.valid);
  });

  it.each(CASES.alsoValid.map((change) => [change.why, change] as const))('accepts %s', (_, change) => {
    expect(TelemetryPayload.safeParse(changed(change)).success).toBe(true);
  });

  it.each(CASES.invalid.map((change) => [change.why, change] as const))('refuses %s', (_, change) => {
    expect(TelemetryPayload.safeParse(changed(change)).success).toBe(false);
  });

  it('refuses anything but an object', () => {
    for (const payload of [[], 'payload', 1, null])
      expect(TelemetryPayload.safeParse(payload).success).toBe(false);
  });

  it('lets no string carry free text: only enums, the install id, the version and the day', () => {
    const contract = payloadSchema() as { properties: Record<string, Record<string, unknown>> };
    const { installId, extVersion, dayBucket, adapterHealth } = contract.properties;
    expect(
      [installId?.pattern, extVersion?.pattern, dayBucket?.pattern].every((p) => typeof p === 'string'),
    ).toBe(true);
    expect(adapterHealth).toMatchObject({
      additionalProperties: { enum: ['DEGRADED', 'OK'] },
      propertyNames: { enum: ['gcal.event', 'gmail.receipt', 'gmail.sent', 'muse.chat'] },
    });
    const text = JSON.stringify(contract);
    // Exactly three string fields with a pattern; every other string is an enum value.
    expect(text.match(/"type":"string"/gu)).toHaveLength(3);
    expect(text).not.toContain('"additionalProperties":true');
  });
});
