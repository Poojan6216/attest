/**
 * Merging Calendar coverage never says more than the passes did (src/ledger/coverage-merge.ts; docs/grading.md §6.1;
 * Hard Rule 5). §6.1 counts a `gcal.event` entry towards a calendar claim's full coverage only if it synced at or
 * after the claim's `end(p,t) + graceMin`, so a union must never carry a later sync over days only an earlier pass
 * saw. For random Calendar passes (runs of whole days, synced out of order, with and without `changesSince`, two
 * accounts) and random `calendar.created` claims, a third of the cases with a pass that covers the claim so that full
 * coverage is checked often (`caseArb`):
 *  - after every pass synced, the coverage level and grace read from the stored (merged) intervals equal those read
 *    from the raw passes as recorded, unmerged;
 *  - `coverageForClaim` decides exactly as every stored interval would.
 * Plus the case that broke the rule before it: an older week next to a newer one (unit test below).
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { coverageLevel, graceElapsed } from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { type Claim, Coverage, Grant, ObserverCoverage } from '../../../src/core/schema';
import { coverageForClaim, readInterval, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { buildClaim, isoAt, MS_PER_MINUTE } from '../../tools/attest-world';
import { makeGrant, sha, uniqueDbName } from '../../unit/ledger/fixtures';

const RUNS = 200;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
/** Sun 4 Oct 2026, 00:00 in New York: day 0 of the grid the passes show. */
const DAY0_MS = Date.parse('2026-10-04T00:00:00-04:00');
/** Sat 3 Oct 2026, noon in New York: minute 0 of the clock passes sync and claims are made on. */
const NOON_MS = Date.parse('2026-10-03T12:00:00-04:00');
const AFTER_ALL = 900;
const day = (d: number) => isoAt(DAY0_MS + d * MS_PER_DAY, -240);
const clock = (minutes: number) => isoAt(NOON_MS + minutes * MS_PER_MINUTE, -240);

const passArb = fc.record({
  startDay: fc.nat({ max: 10 }),
  lengthDays: fc.integer({ min: 1, max: 7 }),
  syncMinutes: fc.nat({ max: 600 }),
  /** Most passes compared nothing; some follow changes since one of two instants. */
  since: fc.constantFrom(null, null, 0, 60),
  account: fc.constantFrom(0, 0, 0, 1),
});

const claimArb = fc.record({
  targetDay: fc.integer({ min: 2, max: 11 }),
  targetHour: fc.nat({ max: 23 }),
  claimedMinutes: fc.nat({ max: 600 }),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;
type Pass = Generated<typeof passArb>;
type ClaimShape = Generated<typeof claimArb>;

/** A pass that shows the claim's day, synced last, on the granted account, comparing nothing. */
const coveringPassArb = (targetDay: number): fc.Arbitrary<Pass> =>
  fc
    .integer({ min: Math.max(0, targetDay - 6), max: Math.min(10, targetDay) })
    .map((startDay) => ({ startDay, lengthDays: 7, syncMinutes: 600, since: null, account: 0 }));

/**
 * Random passes and a random claim; a third of the cases also hold, at a random place among up to five random
 * passes, one pass that covers the claim. Fully random cases reach full coverage about 6% of the time (1,192 of
 * 20,000 sampled), so 200 runs fell to 3 such cases once (a pre-push run on 2026-10-07) under the tally's floor
 * below; these cases reach it about a third of the time, every other case stays random.
 */
const caseArb: fc.Arbitrary<[Pass[], ClaimShape]> = fc.oneof(
  { weight: 2, arbitrary: fc.tuple(fc.array(passArb, { minLength: 1, maxLength: 6 }), claimArb) },
  {
    weight: 1,
    arbitrary: claimArb.chain((claim) =>
      fc.tuple(
        fc
          .tuple(coveringPassArb(claim.targetDay), fc.array(passArb, { maxLength: 5 }), fc.nat())
          .map(([cover, rest, at]): Pass[] => {
            const i = at % (rest.length + 1);
            return [...rest.slice(0, i), cover, ...rest.slice(i)];
          }),
        fc.constant(claim),
      ),
    ),
  },
);

function toPass(p: Generated<typeof passArb>): ObserverCoverage {
  const lastSyncAt = clock(p.syncMinutes);
  const since = p.since === null || p.since > p.syncMinutes ? null : clock(p.since);
  return ObserverCoverage.parse({
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt,
    windowStart: day(p.startDay),
    windowEnd: day(p.startDay + p.lengthDays),
    accountHash: p.account === 0 ? sha(900) : sha(901),
    allCalendars: true,
    ...(since === null ? {} : { changesSince: since }),
  });
}

function toClaim(c: Generated<typeof claimArb>): Claim {
  const claimedAt = clock(c.claimedMinutes);
  return buildClaim(1, {
    agent: 'muse',
    type: 'calendar.created',
    claimedAt,
    claimedAtPrecision: 'minute',
    observedAt: claimedAt,
    targetAt: isoAt(DAY0_MS + c.targetDay * MS_PER_DAY + c.targetHour * 60 * MS_PER_MINUTE, -240),
    subjectHint: 'Dinner',
  });
}

const GRANT = Grant.parse(
  makeGrant({ allowedTypes: ['calendar.created'], accounts: { 'gcal.event': [sha(900)] } }),
);

function level(claim: Claim, coverage: Coverage) {
  return {
    level: coverageLevel(claim, GRANT, coverage, DEFAULT_POLICY).level,
    grace: graceElapsed(claim, GRANT, coverage, DEFAULT_POLICY),
  };
}

let db: LedgerDb;
beforeAll(async () => {
  db = await openLedger(uniqueDbName('coverage-calendar-property'));
});
afterAll(() => {
  db.close();
});
beforeEach(async () => {
  await db.coverageIntervals.clear();
});

const stored = async (): Promise<ObserverCoverage[]> =>
  (await db.coverageIntervals.toArray()).flatMap((row) => readInterval(row)?.entry ?? []);

describe('merged Calendar coverage decides as the raw passes (property)', () => {
  it('level and grace after the last sync equal those of the unmerged passes; coverageFor equals the store', async () => {
    const tally = { full: 0, partial: 0, merged: 0, kept: 0 };
    await fc.assert(
      fc.asyncProperty(caseArb, async ([generated, c]) => {
        await db.coverageIntervals.clear();
        const passes = generated.map(toPass);
        for (const p of passes) await recordCoverage(db, p);
        const held = await stored();
        const claim = toClaim(c);
        const evaluatedAt = clock(AFTER_ALL);
        const raw = level(claim, Coverage.parse({ evaluatedAt, observers: passes }));
        const merged = level(claim, Coverage.parse({ evaluatedAt, observers: held }));
        expect(merged).toEqual(raw);
        const viaStore = await coverageForClaim(db, claim, evaluatedAt, DEFAULT_POLICY);
        const whole = Coverage.parse({ evaluatedAt, observers: held });
        expect(coverageLevel(claim, GRANT, viaStore, DEFAULT_POLICY)).toEqual(
          coverageLevel(claim, GRANT, whole, DEFAULT_POLICY),
        );
        if (merged.level === 'full') tally.full += 1;
        if (merged.level === 'partial') tally.partial += 1;
        if (held.length < passes.length) tally.merged += 1;
        if (held.length > 1) tally.kept += 1;
      }),
      { numRuns: RUNS },
    );
    for (const key of ['full', 'partial', 'merged', 'kept'] as const) {
      expect(tally[key], key).toBeGreaterThan(RUNS / 50);
    }
  }, 120_000);
});

describe('a Calendar union never moves a sync over days the later pass did not see', () => {
  const week = (startDay: number, syncMinutes: number) =>
    toPass({ startDay, lengthDays: 7, syncMinutes, since: null, account: 0 });

  it('an older week and a newer neighbouring week stay two intervals: no false NOT_FOUND on the older one', async () => {
    await recordCoverage(db, week(0, 0));
    await recordCoverage(db, week(7, 120));
    expect(await stored()).toEqual([week(0, 0), week(7, 120)]);
    // "Created" Fri 9 Oct at 13:00 at 12:30: the first week was last looked at before that.
    const claim = toClaim({ targetDay: 5, targetHour: 13, claimedMinutes: 30 });
    const coverage = Coverage.parse({ evaluatedAt: clock(AFTER_ALL), observers: await stored() });
    expect(level(claim, coverage)).toEqual({ level: 'partial', grace: true });
  });

  it('a newer pass absorbs an older one whose days it saw again; a newer narrower one does not', async () => {
    await recordCoverage(db, toPass({ startDay: 2, lengthDays: 2, syncMinutes: 0, since: null, account: 0 }));
    await recordCoverage(db, week(0, 60));
    expect(await stored()).toEqual([week(0, 60)]);
    await recordCoverage(
      db,
      toPass({ startDay: 1, lengthDays: 3, syncMinutes: 120, since: null, account: 0 }),
    );
    expect(await stored()).toHaveLength(2);
  });

  it('a union is checked as it grows: one taken in at its own sync never lends a later sync to its days', async () => {
    const plain = (startDay: number, lengthDays: number, syncMinutes: number) =>
      toPass({ startDay, lengthDays, syncMinutes, since: null, account: 0 });
    await recordCoverage(db, plain(1, 2, 20));
    await recordCoverage(db, plain(3, 2, 30));
    // A second pass at 20 (another range, same instant) over day 3: it unites with days 1–2 (one sync), and that
    // union must then stay apart from days 3–4 seen at 30, which never saw days 1–2 again (coverage-merge.ts absorb).
    await recordCoverage(db, plain(3, 1, 20));
    const byStart = (await stored()).sort((x, y) => x.windowStart.localeCompare(y.windowStart));
    expect(byStart).toEqual([plain(1, 3, 20), plain(3, 2, 30)]);
  });

  it('windows synced at one instant unite, whatever their days', async () => {
    await recordCoverage(
      db,
      toPass({ startDay: 0, lengthDays: 2, syncMinutes: 30, since: null, account: 0 }),
    );
    await recordCoverage(
      db,
      toPass({ startDay: 2, lengthDays: 3, syncMinutes: 30, since: null, account: 0 }),
    );
    expect(await stored()).toEqual([
      toPass({ startDay: 0, lengthDays: 5, syncMinutes: 30, since: null, account: 0 }),
    ]);
  });
});
