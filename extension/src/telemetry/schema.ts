/**
 * The opt-in telemetry payload (sprint_5 5.6; agents/backend_engineer.md rules 1 and 2; Hard Rule 1): at most once a
 * day, and only while the person has telemetry on, counts and booleans, enum strings and one install id, and nothing
 * else. telemetry-api/app/schema.py holds the same schema in Pydantic. Both export to the JSON Schema committed at
 * telemetry-api/tests/payload.schema.json, and a test on each side holds its own export to that file
 * (tests/unit/telemetry/schema-parity.spec.ts, telemetry-api/tests/test_schema_parity.py), so the two cannot drift.
 *
 * Every string is an enum value, the install id (a UUID v4), the extension's version (digits and dots) or the day
 * (`YYYY-MM-DD`, a real date): free text is impossible by schema. Every object refuses a key it does not name, every
 * count is a bounded integer, and each pattern uses ASCII classes alone, so JavaScript and Python read it alike.
 */
import { z } from 'zod';

import type { AgentId, Grade } from '../core/schema';
import { DAY_PATTERN } from '../core/schema-primitives';

/** The pages whose readers report health (src/observers, src/adapters): the keys `adapterHealth` may carry. */
export const TELEMETRY_COMPONENTS = ['gmail.sent', 'gmail.receipt', 'gcal.event', 'muse.chat'] as const;

/** A UUID v4 as `crypto.randomUUID` writes it: lower case (src/ledger/install-id.ts). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The extension's version: three numbers, no letters. */
const VERSION = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;
/** A day, `YYYY-MM-DD`; `realDay` holds it to the calendar. */
const DAY = DAY_PATTERN;

/** The most receipts one agent can have counted for one grade in a day, far above any person's. */
export const TELEMETRY_COUNT_MAX = 100_000;
const count = z.number().int().min(0).max(TELEMETRY_COUNT_MAX);
const hours = z.number().int().min(0).max(24);

/** Whether `day` is a date the calendar has (2026-02-30 is not). */
function realDay(day: string): boolean {
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
}

const GradeCounts = z.strictObject({
  VERIFIED: count,
  PARTIAL: count,
  NOT_FOUND: count,
  UNASKED: count,
  OVER_SCOPE: count,
  UNVERIFIABLE: count,
} satisfies Record<Grade, typeof count>);

export const TelemetryPayload = z.strictObject({
  installId: z.string().regex(UUID_V4),
  extVersion: z.string().regex(VERSION),
  chromeMajor: z.number().int().min(1).max(999),
  dayBucket: z.string().regex(DAY).refine(realDay, 'not a calendar day'),
  adaptersEnabled: z.strictObject({
    muse: z.boolean(),
    chatgpt: z.boolean(),
    dots: z.boolean(),
    claude: z.boolean(),
  }),
  observersEnabled: z.strictObject({ gmail: z.boolean(), gcal: z.boolean() }),
  counts: z.strictObject({
    muse: GradeCounts,
    chatgpt: GradeCounts,
    dots: GradeCounts,
    claude: GradeCounts,
  } satisfies Record<AgentId, typeof GradeCounts>),
  adapterHealth: z.partialRecord(z.enum(TELEMETRY_COMPONENTS), z.enum(['OK', 'DEGRADED'])),
  coverageHours: z.strictObject({ gmail: hours, gcal: hours }),
});

export type TelemetryPayload = z.infer<typeof TelemetryPayload>;
