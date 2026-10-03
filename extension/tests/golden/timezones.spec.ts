/**
 * Host time-zone independence beyond `pnpm test:tz` (Hard Rule 4; docs/grading.md §1: "no `Intl`, no locale"; QA
 * Sprint 1 review, QA-G). `test:tz` reruns the suites under two zones (+14:00 and −03:30/−02:30). This file grades
 * every golden scenario once under the host zone and again under zones with the offsets and DST rules most likely to
 * expose a host-local `Date` getter: +05:45, −12:00, +13:45 with a DST hour, a 30-minute DST shift, two hour-DST
 * zones on either side of UTC, and +14:00. Every receipt of every scenario must be identical (canonical JSON).
 *
 * Node re-reads `process.env.TZ` when it is assigned, so the zone changes inside this worker; each test proves its
 * zone took effect before it grades. Scenarios are loaded again under each zone, so no per-object memo in
 * src/core carries a value across zones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/core/hash';
import { loadScenario, scenarioFiles } from './load';
import { runScenario } from './runner';

/** Generous: the whole golden suite is graded once per zone, and the machine may be loaded (rule 10: no retries). */
const ZONE_TIMEOUT_MS = 120_000;

/** Each zone and its UTC offset in minutes on 2026-01-15 and on 2026-07-15 (`-getTimezoneOffset()`). */
const ZONES: readonly (readonly [zone: string, january: number, july: number])[] = [
  ['Asia/Kathmandu', 345, 345],
  ['Etc/GMT+12', -720, -720],
  ['Pacific/Chatham', 825, 765],
  ['Australia/Lord_Howe', 660, 630],
  ['America/New_York', -300, -240],
  ['Europe/London', 0, 60],
  ['Pacific/Kiritimati', 840, 840],
];

const HOST_ZONE = process.env.TZ;

function useZone(zone: string | undefined): void {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
}

/** The host's UTC offset in minutes at `epochMs`, as a host-local `Date` getter would read it. */
function hostOffsetAt(epochMs: number): number {
  return 0 - new Date(epochMs).getTimezoneOffset();
}

/** Every receipt of every golden scenario, as canonical JSON, keyed by scenario file. */
async function gradeAll(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of scenarioFiles()) {
    const run = await runScenario(loadScenario(file));
    const receipts = [...run.receipts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.set(file, canonicalJson({ receipts, problems: run.problems }));
  }
  return out;
}

let baseline = new Map<string, string>();

beforeAll(async () => {
  baseline = await gradeAll();
}, ZONE_TIMEOUT_MS);

afterAll(() => {
  useZone(HOST_ZONE);
});

describe('grading does not depend on the host time zone (Hard Rule 4)', () => {
  it('the baseline grades every scenario', () => {
    expect(baseline.size).toBeGreaterThanOrEqual(94);
  });

  it.each(ZONES)(
    'under %s every golden receipt is identical to the host-zone run',
    async (zone, january, july) => {
      const expected = baseline;
      useZone(zone);
      try {
        expect([hostOffsetAt(Date.UTC(2026, 0, 15)), hostOffsetAt(Date.UTC(2026, 6, 15))]).toEqual([
          january,
          july,
        ]);
        const graded = await gradeAll();
        expect([...graded.keys()]).toEqual([...expected.keys()]);
        for (const [file, receipts] of graded)
          expect(receipts, `${file} under ${zone}`).toBe(expected.get(file));
      } finally {
        useZone(HOST_ZONE);
      }
    },
    ZONE_TIMEOUT_MS,
  );
});
