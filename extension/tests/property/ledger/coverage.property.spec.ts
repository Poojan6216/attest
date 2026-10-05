/**
 * `coverageFor` decides exactly as the whole store would (docs/grading.md §6.1; src/ledger/coverage.ts header), and
 * merging passes is sound for every later batch. For random passes (three sources, two observers, three account keys,
 * every allCalendars value, overlapping, touching, disjoint and synced out of order), random claims and grants:
 *  - the coverage level, its caps and graceElapsed from `coverageForClaim` equal those from every stored interval,
 *    at any evaluatedAt (the result is a subset of the store, bounded by window and account);
 *  - at an evaluatedAt after every pass synced (any batch after the writes), they equal those from the raw passes
 *    as recorded, unmerged.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { coverageLevel, graceElapsed } from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import {
  type ActionType,
  type Claim,
  Coverage,
  Grant,
  type ObserverCoverageInput,
  ObserverCoverage,
} from '../../../src/core/schema';
import { coverageForClaim, readInterval, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { buildClaim, isoAt, MS_PER_MINUTE } from '../../tools/attest-world';
import { makeGrant, sha, uniqueDbName } from '../../unit/ledger/fixtures';

const RUNS = 300;
/** After every generated pass synced (600 + 120 + 120 minutes, + 1 ms): any batch after the writes. */
const AFTER_ALL = 900;
const BASE_MS = Date.parse('2026-10-06T00:00:00Z');
const at = (minutes: number, offset = 0, ms = 0) => isoAt(BASE_MS + minutes * MS_PER_MINUTE + ms, offset);
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
const ACCOUNTS = [undefined, sha(900), sha(901)] as const;
const TYPES: readonly ActionType[] = ['email.sent', 'calendar.created', 'purchase.made'];

/** Mostly one account on Gmail Sent (so `full` is reachable), sometimes any source and account. */
const mostly = <T>(usual: T, any: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: fc.constant(usual), weight: 4 }, { arbitrary: any, weight: 1 });

const passArb = fc.record({
  source: mostly<(typeof SOURCES)[number]>('gmail.sent', fc.constantFrom(...SOURCES)),
  observer: fc.constantFrom('gmail', 'gcal'),
  account: mostly(1, fc.nat({ max: 2 })),
  allCalendars: fc.constantFrom(true, false, undefined),
  /** On a 15-minute grid, so passes often touch (0 ms) or miss by 1 ms, the gap merging must never bridge. */
  startSlot: fc.nat({ max: 40 }),
  startJitterMs: fc.constantFrom(0, 1),
  lengthSlots: fc.nat({ max: 8 }),
  syncAfterMinutes: fc.integer({ min: 0, max: 120 }),
  offset: fc.constantFrom(-240, 0, 330),
});

const claimArb = fc.record({
  type: mostly<ActionType>('email.sent', fc.constantFrom(...TYPES)),
  minutes: fc.integer({ min: -60, max: 660 }),
  /** Mostly: claimed inside one of the passes (`pick`, at `withinPermille` of its span), so `full` is reached. */
  anchored: mostly(true, fc.boolean()),
  pick: fc.nat(),
  withinPermille: fc.integer({ min: 0, max: 1_000 }),
  precision: fc.constantFrom('minute', 'hour'),
  target: fc.boolean(),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

function toPass(p: Generated<typeof passArb>): ObserverCoverageInput {
  const start = p.startSlot * 15;
  const end = start + p.lengthSlots * 15;
  const account = ACCOUNTS[p.account];
  return ObserverCoverage.parse({
    observerId: p.observer,
    source: p.source,
    lastSyncAt: at(end + p.syncAfterMinutes, p.offset, p.startJitterMs),
    windowStart: at(start, p.offset, p.startJitterMs),
    windowEnd: at(end, p.offset, p.startJitterMs + (p.lengthSlots === 0 ? 0 : -p.startJitterMs)),
    ...(account === undefined ? {} : { accountHash: account }),
    ...(p.source === 'gcal.event' && p.allCalendars !== undefined ? { allCalendars: p.allCalendars } : {}),
  });
}

/** The claim's minute: free, or inside a generated pass. */
function claimMinutes(c: Generated<typeof claimArb>, passes: readonly Generated<typeof passArb>[]): number {
  const pass = passes[c.pick % passes.length];
  if (!c.anchored || pass === undefined) return c.minutes;
  const span = pass.lengthSlots * 15;
  return pass.startSlot * 15 + Math.floor((span * c.withinPermille) / 1_000);
}

function toClaim(c: Generated<typeof claimArb>, minutes: number): Claim {
  const claimedAt = at(minutes);
  const target = c.type.startsWith('calendar.') && c.target ? { targetAt: at(minutes + 30) } : {};
  const counterparty =
    c.type === 'email.sent' ? { counterparty: 'priya@company.com' } : { counterparty: 'Acme' };
  return buildClaim(1, {
    agent: 'muse',
    type: c.type,
    claimedAt,
    claimedAtPrecision: c.precision,
    observedAt: claimedAt,
    ...counterparty,
    ...target,
  });
}

const GRANTS = [
  Grant.parse(makeGrant({ allowedTypes: [...TYPES] })),
  Grant.parse(
    makeGrant({ allowedTypes: [...TYPES], accounts: { 'gmail.sent': [sha(900)], 'gcal.event': [sha(901)] } }),
  ),
];

/** What grading reads of a coverage: the level with its caps, and grace. */
function decide(claim: Claim, grant: Grant, coverage: Coverage) {
  return {
    level: coverageLevel(claim, grant, coverage, DEFAULT_POLICY),
    grace: graceElapsed(claim, grant, coverage, DEFAULT_POLICY),
  };
}

let db: LedgerDb;
beforeAll(async () => {
  db = await openLedger(uniqueDbName('coverage-property'));
});
afterAll(() => {
  db.close();
});

const tally = { none: 0, partial: 0, full: 0, merged: 0, bounded: 0 };

describe('coverageFor decides as the whole store (property)', () => {
  it('level, caps and grace equal those of every stored interval, and of the raw passes after the last sync', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(passArb, { minLength: 1, maxLength: 6 }),
        claimArb,
        fc.nat({ max: 1 }),
        fc.integer({ min: 0, max: AFTER_ALL }),
        async (generated, c, g, evaluatedMinutes) => {
          await db.coverageIntervals.clear();
          const passes = generated.map(toPass);
          for (const p of passes) await recordCoverage(db, p);
          const stored = (await db.coverageIntervals.toArray()).flatMap(
            (row) => readInterval(row)?.entry ?? [],
          );
          const claim = toClaim(c, claimMinutes(c, generated));
          const grant = GRANTS[g] ?? GRANTS[0];
          if (grant === undefined) throw new Error('no grant');
          for (const evaluatedAt of [at(evaluatedMinutes), at(AFTER_ALL)]) {
            const viaStore = await coverageForClaim(db, claim, evaluatedAt, DEFAULT_POLICY);
            const whole = Coverage.parse({ evaluatedAt, observers: stored });
            expect(decide(claim, grant, viaStore)).toEqual(decide(claim, grant, whole));
            if (viaStore.observers.length < stored.length) tally.bounded += 1;
          }
          const raw = Coverage.parse({ evaluatedAt: at(AFTER_ALL), observers: passes });
          const decided = decide(
            claim,
            grant,
            Coverage.parse({ evaluatedAt: at(AFTER_ALL), observers: stored }),
          );
          expect(decided).toEqual(decide(claim, grant, raw));
          tally[decided.level.level] += 1;
          if (stored.length < passes.length) tally.merged += 1;
        },
      ),
      { numRuns: RUNS },
    );
    console.log(`coverage property tally: ${JSON.stringify(tally)}`);
    for (const key of ['none', 'partial', 'full', 'merged', 'bounded'] as const) {
      expect(tally[key], key).toBeGreaterThan(RUNS / 50);
    }
  }, 120_000);
});
