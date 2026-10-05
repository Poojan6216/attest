/**
 * Calendar first-look markers and stale views (docs/grading.md v1.10 §3, §6.1, §7; Sprint 2 wave D decisions 1 and
 * 2), each against a definition written out from the contract with Date.parse (1,000 runs each, qa_tester rule 4):
 *  1. A marker (a `gcal.event` point at a row's start, `lastSyncAt` = `changesSince` = the row's first sighting)
 *     removes from the orphan candidates exactly the rows that share its instant and first sighting, and adds none:
 *     orphans(with markers) = orphans(without) minus the marked rows, from `coveredObservations` and from
 *     `isOrphanCandidate` alike.
 *  2. Markers never make coverage full and never take it from full: full with them iff full without; partial stays
 *     partial; none can only become partial. (Markers of the passes' own account under a grant that binds it; a
 *     marker of a second account counts for §6.1's account rule like any entry, calendar-markers.spec.ts.)
 *  3. A `calendar.created` claim is NOT_FOUND only when the entries that synced at or after `end(p,t) + graceMin`
 *     contain its whole window; a view synced before that, however wide, never yields NOT_FOUND, and a fresh one
 *     still does. A `calendar.updated` or `calendar.deleted` claim is never NOT_FOUND (v1.11), even when entries that
 *     followed changes from its change span's start through its grace sync contain its window.
 * Each run's tallies are asserted, so no property can pass without reaching its cases.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { coveredObservations, isOrphanCandidate, seenWindows, visibleAt } from '../../src/core/batch-orphans';
import { createMemoryIndex } from '../../src/core/candidates';
import { coverageLevel } from '../../src/core/conditions';
import { grade } from '../../src/core/grade';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import type { Coverage, Observation } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../golden/build';
import { ScenarioClaim, type ScenarioCoverage, ScenarioObservation } from '../golden/scenario-schema';

const RUNS = 1_000;
const PROPERTY_TIMEOUT_MS = 120_000;
const VIEW = PolicyView.parse(defaultPolicyJson);
const BASE_MS = instantMs('2026-10-06T00:00:00-04:00');
const EVAL_MINUTES = 600;
const at = (minutes: number) => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, -240);
const EVAL = at(EVAL_MINUTES);
const EVAL_MS = instantMs(EVAL);
const TYPES = ['calendar.created', 'calendar.updated', 'calendar.deleted'] as const;
const STARTS = [1_440, 1_500, 2_880, 4_320] as const;

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

const passArb = fc.record({
  from: fc.integer({ min: -3_000, max: 4_400 }),
  length: fc.integer({ min: 0, max: 9_000 }),
  wide: fc.boolean(),
  sync: fc.integer({ min: 0, max: EVAL_MINUTES }),
  /** Minutes of followed changes before the sync; null: no `changesSince`. */
  followed: fc.option(fc.integer({ min: 0, max: 600 }), { nil: null }),
});

const rowArb = fc.record({
  type: fc.constantFrom(...TYPES),
  start: fc.constantFrom(...STARTS),
  subject: fc.constantFrom('Board dinner', 'Dentist'),
  seen: fc.integer({ min: 0, max: EVAL_MINUTES }),
  /** This row's pass stored it as a first sighting: it gets a marker. */
  marked: fc.boolean(),
});

/** A stray marker: a point and a first sighting of no particular row. */
const strayArb = fc.record({
  start: fc.constantFrom(...STARTS),
  seen: fc.integer({ min: 0, max: EVAL_MINUTES }),
});

function passEntry(pass: Generated<typeof passArb>): ScenarioCoverage {
  return {
    source: 'gcal.event',
    lastSyncAt: at(pass.sync),
    windowStart: at(pass.wide ? -3_000 : pass.from),
    windowEnd: at(pass.wide ? 9_000 : pass.from + pass.length),
    accountHash: 'acct-a',
    allCalendars: true,
    ...(pass.followed === null ? {} : { changesSince: at(pass.sync - pass.followed) }),
  };
}

/** §3 v1.10: the first-look marker of a row starting at minute `start`, first seen at minute `seen`. */
function markerEntry(start: number, seen: number): ScenarioCoverage {
  return {
    source: 'gcal.event',
    lastSyncAt: at(seen),
    windowStart: at(start),
    windowEnd: at(start),
    accountHash: 'acct-a',
    allCalendars: true,
    changesSince: at(seen),
  };
}

function buildRows(rows: readonly Generated<typeof rowArb>[]): Observation[] {
  return rows.map((row, i) =>
    buildObservation(
      ScenarioObservation.parse({
        ref: `o${String(i)}`,
        source: 'gcal.event',
        type: row.type,
        subjectHint: row.subject,
        occurredAt: at(row.start),
        observedAt: at(row.seen),
      }),
      [],
      EVAL,
      VIEW,
    ),
  );
}

async function orphanIds(rows: readonly Observation[], coverage: Coverage): Promise<string[]> {
  const index = visibleAt(createMemoryIndex(rows, 15), EVAL_MS);
  const found = await coveredObservations(index, coverage, DEFAULT_POLICY);
  return found.map((keyed) => keyed.observation.id).sort();
}

/** The row of `id` a batch decides on: its first sighting (§4.1; these rows carry no `sightedAt`). */
function firstSighting(rows: readonly Observation[], id: string): Observation {
  const sorted = rows
    .filter((o) => o.id === id)
    .sort((a, b) => instantMs(a.observedAt) - instantMs(b.observedAt));
  const first = sorted[0];
  if (first === undefined) throw new Error(`no row ${id}`);
  return first;
}

/** Some marker holds `o`'s start and began comparing at its first sighting. */
const marks = (markers: readonly ScenarioCoverage[], o: Observation): boolean =>
  markers.some(
    (m) =>
      instantMs(m.windowStart) === instantMs(o.occurredAt) &&
      m.changesSince !== undefined &&
      instantMs(m.changesSince) === instantMs(o.observedAt),
  );

const tally = {
  blocked: 0,
  kept: 0,
  full: 0,
  partialFromNone: 0,
  notFound: 0,
  staleWhole: 0,
  changeFollowedWhole: 0,
};

describe('a first-look marker removes exactly its rows from the orphans (§3 v1.10)', () => {
  it(
    'orphans with markers = orphans without, minus the rows sharing a marker instant and first sighting',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(rowArb, { minLength: 1, maxLength: 10 }),
          fc.array(passArb, { minLength: 1, maxLength: 4 }),
          fc.array(strayArb, { maxLength: 3 }),
          async (generated, passes, strays) => {
            const rows = buildRows(generated);
            const plain = passes.map(passEntry);
            const markers = [
              ...generated.flatMap((row) => (row.marked ? [markerEntry(row.start, row.seen)] : [])),
              ...strays.map((stray) => markerEntry(stray.start, stray.seen)),
            ];
            const without = await orphanIds(rows, buildCoverage(plain, EVAL));
            const coverage = buildCoverage([...plain, ...markers], EVAL);
            const expected = without.filter((id) => !marks(markers, firstSighting(rows, id)));
            expect(await orphanIds(rows, coverage)).toEqual(expected);
            const windows = seenWindows(coverage);
            for (const id of without) {
              const kept = expected.includes(id);
              expect(isOrphanCandidate(firstSighting(rows, id), windows, DEFAULT_POLICY), id).toBe(kept);
              tally[kept ? 'kept' : 'blocked'] += 1;
            }
          },
        ),
        { numRuns: RUNS },
      );
      expect(tally.blocked).toBeGreaterThan(RUNS / 10);
      expect(tally.kept).toBeGreaterThan(RUNS / 10);
    },
    PROPERTY_TIMEOUT_MS,
  );
});

const claimArb = fc.record({
  type: fc.constantFrom(...TYPES),
  claimed: fc.integer({ min: 0, max: 400 }),
  target: fc.constantFrom(...STARTS),
});

function claimOf(raw: Generated<typeof claimArb>) {
  return buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type: raw.type,
      subjectHint: 'Board dinner',
      claimedAt: at(raw.claimed),
      targetAt: at(raw.target),
    }),
  );
}

const grant = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);

describe('markers never make coverage full (§6.1 v1.10)', () => {
  it('full with markers iff full without; partial stays partial; none can only become partial', () => {
    fc.assert(
      fc.property(
        claimArb,
        fc.array(passArb, { maxLength: 4 }),
        fc.array(strayArb, { minLength: 1, maxLength: 6 }),
        (raw, passes, strays) => {
          const claim = claimOf(raw);
          const plain = passes.map(passEntry);
          const markers = strays.map((stray) => markerEntry(stray.start, stray.seen));
          const before = coverageLevel(claim, grant, buildCoverage(plain, EVAL), DEFAULT_POLICY).level;
          const after = coverageLevel(
            claim,
            grant,
            buildCoverage([...plain, ...markers], EVAL),
            DEFAULT_POLICY,
          ).level;
          expect(after === 'full').toBe(before === 'full');
          if (before === 'partial') expect(after).toBe('partial');
          if (after === 'none') expect(before).toBe('none');
          if (before === 'full') tally.full += 1;
          if (before === 'none' && after === 'partial') tally.partialFromNone += 1;
        },
      ),
      { numRuns: RUNS },
    );
    expect(tally.full).toBeGreaterThan(RUNS / 20);
    expect(tally.partialFromNone).toBeGreaterThan(RUNS / 20);
  });
});

/**
 * §6.1 v1.10 written out: the entries synced at or after the grace sync (and, for a change claim, following changes
 * from the old change span's start) contain the whole window of `raw`.
 */
function freshContains(raw: Generated<typeof claimArb>, entries: readonly ScenarioCoverage[]): boolean {
  const graceSync = BASE_MS + (raw.claimed + 1 + 30) * MS_PER_MINUTE;
  const spanFrom = BASE_MS + (raw.claimed - 2) * MS_PER_MINUTE;
  const from = BASE_MS + (raw.target - 3 * 1_440) * MS_PER_MINUTE;
  const to = BASE_MS + (raw.target + 3 * 1_440) * MS_PER_MINUTE;
  const counted = entries
    .filter((e) => Date.parse(e.lastSyncAt) >= graceSync)
    .filter(
      (e) =>
        raw.type === 'calendar.created' ||
        (e.changesSince !== undefined && Date.parse(e.changesSince) <= spanFrom),
    )
    .sort((a, b) => Date.parse(a.windowStart) - Date.parse(b.windowStart));
  let reached = from;
  for (const e of counted) {
    if (Date.parse(e.windowStart) > reached) return false;
    reached = Math.max(reached, Date.parse(e.windowEnd));
    if (reached >= to) return true;
  }
  return false;
}

describe('a stale view never yields NOT_FOUND for a calendar claim; a fresh one still can (§6.1 v1.10, v1.11)', () => {
  it('NOT_FOUND exactly for a created claim whose fresh entries contain the whole window, never for a change', () => {
    fc.assert(
      fc.property(claimArb, fc.array(passArb, { minLength: 1, maxLength: 4 }), (raw, passes) => {
        const entries = passes.map(passEntry);
        const coverage = buildCoverage(entries, EVAL);
        const receipt = grade(claimOf(raw), [], grant, DEFAULT_POLICY, coverage, { priorSpendCents: 0 });
        const fresh = freshContains(raw, entries);
        const created = raw.type === 'calendar.created';
        expect(receipt.grade === 'NOT_FOUND').toBe(fresh && created);
        if (fresh && created) tally.notFound += 1;
        if (fresh && !created) tally.changeFollowedWhole += 1;
        const graceSync = BASE_MS + (raw.claimed + 1 + 30) * MS_PER_MINUTE;
        const wholeButStale = entries.some(
          (e) => e.windowStart === at(-3_000) && Date.parse(e.lastSyncAt) < graceSync,
        );
        if (wholeButStale && !fresh) tally.staleWhole += 1;
      }),
      { numRuns: RUNS },
    );
    expect(tally.notFound).toBeGreaterThan(RUNS / 40);
    expect(tally.changeFollowedWhole).toBeGreaterThan(RUNS / 40);
    expect(tally.staleWhole).toBeGreaterThan(RUNS / 20);
  });
});
