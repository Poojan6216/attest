/**
 * The calendar's followed changes (docs/grading.md v1.9 §3, §6.1, §7), each against a definition written out from the
 * contract with Date.parse (1,000 runs each, qa_tester rule 4):
 *  1. Orphans: a `gcal.event` row is an orphan candidate only when some `gcal.event` pass synced by evaluatedAt whose
 *     window holds its start had `changesSince` strictly before the row's first sighting and synced at or after it,
 *     and no such pass may have found it already there (its `changesSince` equal to that first sighting, or no
 *     `changesSince` and a `lastSyncAt` at or after it). Decided on each content hash's first sighting
 *     (`coveredObservations` over `visibleAt`), and the same answer from `isOrphanCandidate`, the predicate replay
 *     reads.
 *  2. Coverage (v1.11): a `calendar.updated` or `calendar.deleted` claim counts no `gcal.event` entry towards full
 *     coverage, followed or not: any overlapping entry makes it partial with `coverage.change_unprovable`, also when
 *     entries that followed changes over `[start(p,t) − beforeClaimMin, end(p,t) + graceMin]` contain its window (the
 *     v1.9 and v1.10 full case). A `calendar.created` claim never reads `changesSince`, and counts an entry only if it
 *     synced at or after `end(p,t) + graceMin` (v1.10); any other overlapping entry is `coverage.changes_unfollowed`.
 * Each run's tallies are asserted, so no property can pass without reaching its cases.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { coveredObservations, isOrphanCandidate, seenWindows, visibleAt } from '../../src/core/batch-orphans';
import { createMemoryIndex } from '../../src/core/candidates';
import { coverageLevel } from '../../src/core/conditions';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { type Coverage, Observation } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../golden/build';
import { ScenarioClaim, ScenarioCoverage, ScenarioObservation } from '../golden/scenario-schema';
import { calendarVerdict } from './orphan-oracle';

const RUNS = 1_000;
const PROPERTY_TIMEOUT_MS = 120_000;
const VIEW = PolicyView.parse(defaultPolicyJson);
const BASE_MS = instantMs('2026-10-06T00:00:00-04:00');
/** Every pass and sighting falls in [0, 600] minutes; evaluatedAt is minute 600. */
const EVAL_MINUTES = 600;
const at = (minutes: number, offset = -240) => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, offset);
const EVAL = at(EVAL_MINUTES);
const EVAL_MS = instantMs(EVAL);
const TYPES = ['calendar.created', 'calendar.updated', 'calendar.deleted'] as const;
/** Event starts: four, so rows often share a content hash (re-sightings of one event). */
const STARTS = [1_440, 1_500, 2_880, 4_320] as const;

/** The value type an arbitrary generates. */
type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

const rarely = <T>(arb: fc.Arbitrary<T>, nullWeight: number) =>
  fc.oneof({ arbitrary: fc.constant(null), weight: nullWeight }, { arbitrary: arb, weight: 1 });

const passArb = fc.record({
  /** Window start and length in minutes, around the event starts. */
  from: fc.integer({ min: -3_000, max: 4_400 }),
  length: fc.integer({ min: 0, max: 9_000 }),
  /** Often a view wide enough to hold every claim window (full coverage needs one). */
  wide: fc.boolean(),
  sync: fc.integer({ min: 0, max: EVAL_MINUTES + 30 }),
  /** Minutes of followed changes before the sync; null: a first look, no `changesSince`. */
  followed: rarely(fc.integer({ min: 0, max: 600 }), 1),
  /** Sometimes: comparisons began (or, without `changesSince`, the pass synced) exactly at row k's sighting. */
  pinned: rarely(fc.nat({ max: 11 }), 2),
});

const rowArb = fc.record({
  type: fc.constantFrom(...TYPES),
  start: fc.constantFrom(...STARTS),
  subject: fc.constantFrom('Board dinner', 'Dentist'),
  seen: fc.integer({ min: 0, max: EVAL_MINUTES + 30 }),
  /** Sometimes stored this many minutes after its sighting, which it keeps as `sightedAt` (§10). */
  later: rarely(fc.integer({ min: 1, max: 20 }), 2),
});

function buildRows(rows: readonly Generated<typeof rowArb>[]): Observation[] {
  return rows.map((row, i) => {
    const built = buildObservation(
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
    );
    if (row.later === null) return built;
    return Observation.parse({ ...built, observedAt: at(row.seen + row.later), sightedAt: at(row.seen) });
  });
}

/** When a row was first seen, written out (§4.1). */
const firstSeen = (o: Observation): number => Date.parse(o.sightedAt ?? o.observedAt);

function passEntry(pass: Generated<typeof passArb>, rows: readonly Observation[]): ScenarioCoverage {
  const pinned = pass.pinned === null ? undefined : rows[pass.pinned % rows.length];
  const pinnedMinutes = pinned === undefined ? null : (firstSeen(pinned) - BASE_MS) / MS_PER_MINUTE;
  let sync = pass.sync;
  let since = pass.followed === null ? null : pass.sync - pass.followed;
  if (pinnedMinutes !== null && since === null) sync = pinnedMinutes;
  else if (pinnedMinutes !== null) [since, sync] = [pinnedMinutes, Math.max(sync, pinnedMinutes)];
  return ScenarioCoverage.parse({
    source: 'gcal.event',
    lastSyncAt: at(sync),
    windowStart: at(pass.wide ? -3_000 : pass.from),
    windowEnd: at(pass.wide ? 9_000 : pass.from + pass.length),
    accountHash: 'acct-a',
    allCalendars: true,
    ...(since === null ? {} : { changesSince: at(since, 330) }),
  });
}

const tally = {
  changed: 0,
  unfollowed: 0,
  firstLook: 0,
  full: 0,
  changeFull: 0,
  changeFollowedWhole: 0,
  capped: 0,
  created: 0,
  createdFull: 0,
  createdStale: 0,
};

/** §3 v1.9 for one row (the first sighting of its content hash), counted by verdict. */
function orphanOracle(o: Observation, coverage: Coverage): boolean {
  const covered = coverage.observers.some(
    (e) =>
      Date.parse(e.lastSyncAt) <= EVAL_MS &&
      Date.parse(e.windowStart) <= Date.parse(o.occurredAt) &&
      Date.parse(o.occurredAt) <= Date.parse(e.windowEnd),
  );
  if (!covered) return false;
  const verdict = calendarVerdict(o, coverage, EVAL_MS);
  tally[verdict] += 1;
  return verdict === 'changed';
}

/** One row per content hash, visible at evaluatedAt: the earliest first sighting, then the earliest store. */
function firstSightings(rows: readonly Observation[]): Observation[] {
  const kept = new Map<string, Observation>();
  for (const o of rows) {
    if (Date.parse(o.observedAt) > EVAL_MS) continue;
    const held = kept.get(o.contentHash);
    const earlier =
      held === undefined ||
      firstSeen(o) - firstSeen(held) < 0 ||
      (firstSeen(o) === firstSeen(held) && Date.parse(o.observedAt) < Date.parse(held.observedAt));
    if (earlier) kept.set(o.contentHash, o);
  }
  return [...kept.values()];
}

describe('calendar orphans are changes a pass followed (§3, §7 v1.9)', () => {
  it(
    'coveredObservations and isOrphanCandidate equal the contract written out',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(rowArb, { minLength: 1, maxLength: 12 }),
          fc.array(passArb, { minLength: 1, maxLength: 5 }),
          async (generated, passes) => {
            const rows = buildRows(generated);
            const coverage = buildCoverage(
              passes.map((pass) => passEntry(pass, rows)),
              EVAL,
            );
            const firsts = firstSightings(rows);
            const expected = firsts
              .filter((o) => orphanOracle(o, coverage))
              .map((o) => o.id)
              .sort();
            const index = visibleAt(createMemoryIndex(rows, 15), EVAL_MS);
            const found = await coveredObservations(index, coverage, DEFAULT_POLICY);
            expect(found.map((row) => row.observation.id).sort()).toEqual(expected);
            const windows = seenWindows(coverage);
            for (const o of firsts) {
              expect(isOrphanCandidate(o, windows, DEFAULT_POLICY), o.id).toBe(expected.includes(o.id));
            }
          },
        ),
        { numRuns: RUNS },
      );
      expect(tally.changed).toBeGreaterThan(RUNS / 5);
      expect(tally.unfollowed).toBeGreaterThan(RUNS / 5);
      expect(tally.firstLook).toBeGreaterThan(RUNS / 10);
    },
    PROPERTY_TIMEOUT_MS,
  );
});

const claimArb = fc.record({
  type: fc.constantFrom(...TYPES),
  claimed: fc.integer({ min: 0, max: 400 }),
  precision: fc.constantFrom('minute', 'hour'),
  target: fc.constantFrom(...STARTS),
});

type Entry = Coverage['observers'][number];

/** True iff the union of the entries' closed windows contains [from, to]. */
function reaches(entries: readonly Entry[], from: number, to: number): boolean {
  const ordered = [...entries].sort((a, b) => Date.parse(a.windowStart) - Date.parse(b.windowStart));
  let reached = from;
  for (const e of ordered) {
    if (Date.parse(e.windowStart) > reached) break;
    reached = Math.max(reached, Date.parse(e.windowEnd));
  }
  return reached >= to;
}

/**
 * §6.1 v1.11 written out: every entry is eligible and uncapped but for the calendar caps. A change claim's overlapping
 * entries are all `unprovable`; a created claim's stale ones (synced before the grace sync) `unfollowed`, named only
 * for a span no fresh one saw (v1.14).
 * `followedWhole`: the change claim's window is held by entries that followed changes over its change span and
 * synced at or after its end, the case v1.9 and v1.10 called full.
 */
function levelOracle(
  claim: Generated<typeof claimArb>,
  coverage: Coverage,
): { level: string; cap: string | null; followedWhole: boolean } {
  const unit = claim.precision === 'minute' ? 1 : 60;
  const unitStart = Math.floor(claim.claimed / unit) * unit;
  const spanFrom = BASE_MS + (unitStart - 2) * MS_PER_MINUTE;
  const spanTo = BASE_MS + (unitStart + unit + 30) * MS_PER_MINUTE;
  const from = BASE_MS + (claim.target - 3 * 1_440) * MS_PER_MINUTE;
  const to = BASE_MS + (claim.target + 3 * 1_440) * MS_PER_MINUTE;
  const overlapping = coverage.observers.filter(
    (e) => Date.parse(e.windowStart) <= to && Date.parse(e.windowEnd) >= from,
  );
  if (overlapping.length === 0) return { level: 'none', cap: null, followedWhole: false };
  const fresh = (e: Entry) => Date.parse(e.lastSyncAt) >= spanTo;
  if (claim.type !== 'calendar.created') {
    const followed = overlapping.filter(
      (e) => fresh(e) && e.changesSince !== undefined && Date.parse(e.changesSince) <= spanFrom,
    );
    return {
      level: 'partial',
      cap: 'coverage.change_unprovable',
      followedWhole: reaches(followed, from, to),
    };
  }
  const freshOnes = overlapping.filter(fresh);
  if (reaches(freshOnes, from, to)) return { level: 'full', cap: null, followedWhole: false };
  // A stale view names its cap only for a span no fresh view saw (v1.14).
  const stale = overlapping.some(
    (e) =>
      !fresh(e) &&
      !reaches(freshOnes, Math.max(Date.parse(e.windowStart), from), Math.min(Date.parse(e.windowEnd), to)),
  );
  return { level: 'partial', cap: stale ? 'coverage.changes_unfollowed' : null, followedWhole: false };
}

describe('created claims are fully covered only by views synced after grace, change claims never (§6.1)', () => {
  it('coverageLevel equals the contract written out; created claims never read changesSince', () => {
    fc.assert(
      fc.property(claimArb, fc.array(passArb, { minLength: 1, maxLength: 4 }), (raw, passes) => {
        const claim = buildClaim(
          ScenarioClaim.parse({
            ref: 'c1',
            agent: 'muse',
            type: raw.type,
            subjectHint: 'Board dinner',
            claimedAt: at(raw.claimed),
            claimedAtPrecision: raw.precision,
            targetAt: at(raw.target),
          }),
        );
        const coverage = buildCoverage(
          passes.map((pass) => passEntry({ ...pass, pinned: null }, [])),
          at(EVAL_MINUTES + 60),
        );
        const grant = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);
        const result = coverageLevel(claim, grant, coverage, DEFAULT_POLICY);
        const expected = levelOracle(raw, coverage);
        expect(result.level).toBe(expected.level);
        expect(result.capReasons).toEqual(
          expected.cap === null ? [] : [{ code: expected.cap, source: 'gcal.event' }],
        );
        const capped = expected.cap !== null;
        if (result.level === 'full') tally.full += 1;
        if (result.level === 'full' && raw.type !== 'calendar.created') tally.changeFull += 1;
        if (expected.followedWhole) tally.changeFollowedWhole += 1;
        if (capped) tally.capped += 1;
        if (raw.type === 'calendar.created' && result.level !== 'none') tally.created += 1;
        if (raw.type === 'calendar.created' && result.level === 'full') tally.createdFull += 1;
        if (raw.type === 'calendar.created' && capped) tally.createdStale += 1;
      }),
      { numRuns: RUNS },
    );
    expect(tally.full).toBeGreaterThan(RUNS / 20);
    expect(tally.changeFull).toBe(0);
    expect(tally.changeFollowedWhole).toBeGreaterThan(RUNS / 50);
    expect(tally.capped).toBeGreaterThan(RUNS / 5);
    expect(tally.created).toBeGreaterThan(RUNS / 10);
    expect(tally.createdFull).toBeGreaterThan(RUNS / 50);
    expect(tally.createdStale).toBeGreaterThan(RUNS / 50);
  });
});
