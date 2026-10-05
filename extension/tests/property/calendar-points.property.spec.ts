/**
 * One orphan rule for every `gcal.event` entry, whatever the length of its window (docs/grading.md §3: "a point,
 * `windowStart = windowEnd`, is one"; v1.10). batch-orphans.ts files one-instant entries (first-look markers) by
 * instant and reads them by lookup, the longer windows by a scan; this pins that the lookup reads a point with the very
 * rule the scan applies: a point that followed changes over a row's first sighting satisfies rule (a) like a wider
 * window, a point that began comparing at it (a marker) or compared nothing and synced at or after it fails rule (b),
 * and anything else says nothing. Against the written-out oracle (orphan-oracle.ts), 1,000 runs (qa_tester rule 4),
 * from `isOrphanCandidate` and `coveredObservations` alike; the tallies prove a point alone decided rule (a) and rule (b)
 * in many runs.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { coveredObservations, isOrphanCandidate, seenWindows, visibleAt } from '../../src/core/batch-orphans';
import { createMemoryIndex } from '../../src/core/candidates';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import type { Coverage, Observation, ObserverCoverage } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import { buildCoverage, buildObservation, PolicyView } from '../golden/build';
import { type ScenarioCoverage, ScenarioObservation } from '../golden/scenario-schema';
import { calendarVerdict, orphanOracle, seenByOwnSource } from './orphan-oracle';

const RUNS = 1_000;
const PROPERTY_TIMEOUT_MS = 120_000;
const VIEW = PolicyView.parse(defaultPolicyJson);
const BASE_MS = instantMs('2026-10-06T00:00:00-04:00');
const EVAL_MINUTES = 600;
const at = (minutes: number) => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, -240);
const EVAL = at(EVAL_MINUTES);
const EVAL_MS = instantMs(EVAL);
const STARTS = [1_440, 1_500, 2_880] as const;

const rowArb = fc.record({
  type: fc.constantFrom('calendar.created', 'calendar.updated', 'calendar.deleted'),
  start: fc.constantFrom(...STARTS),
  seen: fc.integer({ min: 0, max: EVAL_MINUTES }),
});

/** A window `length` minutes long (0: a point) at or around an event start, of any shape. */
const entryArb = fc.record({
  start: fc.constantFrom(...STARTS),
  length: fc.constantFrom(0, 0, 0, 60, 4_000),
  sync: fc.integer({ min: 0, max: EVAL_MINUTES }),
  /** Minutes of followed changes before the sync (0: a marker's shape); null: no `changesSince`. */
  followed: fc.option(fc.constantFrom(0, 1, 30, 300, 600), { nil: null }),
  /** The entry is pinned to a row: it began comparing (or, without `changesSince`, synced) at its sighting. */
  pinned: fc.option(fc.nat({ max: 7 }), { nil: null }),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

function buildRows(rows: readonly Generated<typeof rowArb>[]): Observation[] {
  return rows.map((row, i) =>
    buildObservation(
      ScenarioObservation.parse({
        ref: `o${String(i)}`,
        source: 'gcal.event',
        type: row.type,
        subjectHint: 'Board dinner',
        occurredAt: at(row.start),
        observedAt: at(row.seen),
      }),
      [],
      EVAL,
      VIEW,
    ),
  );
}

function entryOf(
  raw: Generated<typeof entryArb>,
  rows: readonly Generated<typeof rowArb>[],
): ScenarioCoverage {
  const pinned = raw.pinned === null ? undefined : rows[raw.pinned % rows.length];
  const sync = pinned === undefined ? raw.sync : Math.max(raw.sync, pinned.seen);
  const since = pinned === undefined ? (raw.followed === null ? null : sync - raw.followed) : pinned.seen;
  const half = Math.floor(raw.length / 2);
  return {
    source: 'gcal.event',
    lastSyncAt: at(pinned !== undefined && raw.followed === null ? pinned.seen : sync),
    windowStart: at(raw.start - half),
    windowEnd: at(raw.start - half + raw.length),
    accountHash: 'acct-a',
    allCalendars: true,
    ...(since === null || (pinned !== undefined && raw.followed === null) ? {} : { changesSince: at(since) }),
  };
}

/** The earliest sighting of each id (these rows carry no `sightedAt`): the row a batch decides on (§4.1). */
const earliest = (rows: readonly Observation[]): Observation | undefined =>
  [...rows].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))[0];

const isPoint = (e: ObserverCoverage): boolean => Date.parse(e.windowStart) === Date.parse(e.windowEnd);

/** Every entry holding `o`'s start that `test` accepts is a point, and there is one. */
function decidedByPoints(
  o: Observation,
  coverage: Coverage,
  test: (e: ObserverCoverage) => boolean,
): boolean {
  const t = Date.parse(o.occurredAt);
  const holding = coverage.observers.filter(
    (e) => Date.parse(e.windowStart) <= t && t <= Date.parse(e.windowEnd) && test(e),
  );
  return holding.length > 0 && holding.every(isPoint);
}

const tally = { followedByPointOnly: 0, foundByPointOnly: 0 };

describe('every gcal.event entry is read by one rule, whatever its length (§3, v1.10)', () => {
  it(
    'with points of any shape, the orphan candidates are exactly the oracle’s',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(rowArb, { minLength: 1, maxLength: 8 }),
          fc.array(entryArb, { minLength: 1, maxLength: 6 }),
          async (generated, raw) => {
            const rows = buildRows(generated);
            const coverage = buildCoverage(
              raw.map((entry) => entryOf(entry, generated)),
              EVAL,
            );
            const index = visibleAt(createMemoryIndex(rows, 15), EVAL_MS);
            const found = await coveredObservations(index, coverage, DEFAULT_POLICY);
            const oracle = orphanOracle(rows, coverage, DEFAULT_POLICY, EVAL_MS, earliest);
            expect(found.map((k) => k.observation.id)).toEqual(oracle.map((k) => k.observation.id));
            const windows = seenWindows(coverage);
            for (const id of new Set(rows.map((o) => o.id))) {
              const first = earliest(rows.filter((o) => o.id === id));
              if (first === undefined) continue;
              const verdict = calendarVerdict(first, coverage, EVAL_MS);
              const expected = seenByOwnSource(first, coverage, EVAL_MS) && verdict === 'changed';
              expect(isOrphanCandidate(first, windows, DEFAULT_POLICY), id).toBe(expected);
              const seen = Date.parse(first.observedAt);
              const followed = (e: ObserverCoverage) =>
                e.changesSince !== undefined &&
                Date.parse(e.changesSince) < seen &&
                seen <= Date.parse(e.lastSyncAt);
              const foundThere = (e: ObserverCoverage) =>
                e.changesSince === undefined
                  ? Date.parse(e.lastSyncAt) >= seen
                  : Date.parse(e.changesSince) === seen;
              if (verdict === 'changed' && decidedByPoints(first, coverage, followed))
                tally.followedByPointOnly += 1;
              if (verdict === 'firstLook' && decidedByPoints(first, coverage, foundThere))
                tally.foundByPointOnly += 1;
            }
          },
        ),
        { numRuns: RUNS },
      );
      expect(tally.followedByPointOnly).toBeGreaterThan(RUNS / 20);
      expect(tally.foundByPointOnly).toBeGreaterThan(RUNS / 20);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
