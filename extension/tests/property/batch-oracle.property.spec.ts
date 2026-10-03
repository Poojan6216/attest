/**
 * QA-R6 (Hard Rule 4): `gradeBatch`'s exact scores, assignment and best candidate equal the per-claim oracle
 * (`grade()` on `candidates()`, tests/unit/core/batch-oracle.ts) under random feature weights and windows, the
 * BigInt scores included: `calendarDays` up to a million days makes the timeProximity denominator ~8.6e13 ms, so
 * the weighted sums of calendar pairs leave the safe integers (batch-score.ts stores them as Ratios and compares them
 * in BigInt). 1,000 random batches of email and calendar claims and rows around them, each graded once.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { gradeBatch } from '../../src/core/batch';
import { createMemoryIndex } from '../../src/core/candidates';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { loadPolicy } from '../../src/core/policy';
import { Activity } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  mergePatch,
  PolicyView,
} from '../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../golden/scenario-schema';
import { againstOracle, type World } from '../unit/core/batch-oracle';

const RUNS = 1_000;
const PROPERTY_TIMEOUT_MS = 300_000;
const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const EVAL = isoWithOffset(BASE_MS + 6 * 60 * MS_PER_MINUTE, -240);
const VIEW = PolicyView.parse(defaultPolicyJson);
const TYPES = ['email.sent', 'calendar.updated', 'calendar.deleted'] as const;
const PEOPLE = ['priya@company.com', 'raj@company.com', 'priya+x@company.com', 'Priya'];
const SUBJECTS = ['Q3 planning sync', 'Q3 planning', 'planning review', 'Hiring plan'];
const WEIGHTED = [
  'timeProximity',
  'counterpartyExact',
  'counterpartyDomain',
  'counterpartyName',
  'subjectOverlap',
  'amountExact',
  'merchantMatch',
] as const;

const at = (minutes: number, seconds: number) =>
  isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE + seconds * 1_000, -240);

/** A loaded policy with random weights (1..10000 bp each) and a calendar window of 1 to a million days. */
const policyArb = fc
  .record({
    weights: fc.tuple(...WEIGHTED.map(() => fc.integer({ min: 1, max: 10_000 }))),
    calendarDays: fc.constantFrom(1, 3, 40, 1_000_000),
  })
  .map(({ weights, calendarDays }) =>
    loadPolicy(
      mergePatch(defaultPolicyJson, {
        features: Object.fromEntries(WEIGHTED.map((name, i) => [name, (weights[i] ?? 1) / 10_000])),
        windows: { calendarDays },
      }),
    ),
  );

const claimArb = (n: number) =>
  fc
    .record({
      type: fc.constantFrom(...TYPES),
      counterparty: fc.constantFrom(...PEOPLE),
      subjectHint: fc.constantFrom(...SUBJECTS),
      claimed: fc.integer({ min: 0, max: 200 }),
      target: fc.integer({ min: -3_000, max: 3_000 }),
    })
    .map(({ claimed, target, ...raw }) =>
      buildClaim(
        ScenarioClaim.parse({
          ref: `c${String(n)}`,
          agent: 'muse',
          ...raw,
          claimedAt: at(claimed, 0),
          ...(raw.type === 'email.sent' ? {} : { targetAt: at(target, 0) }),
        }),
      ),
    );

const rowArb = (n: number) =>
  fc
    .record({
      type: fc.constantFrom(...TYPES),
      counterparty: fc.constantFrom(...PEOPLE.filter((person) => person.includes('@'))),
      subjectHint: fc.constantFrom(...SUBJECTS),
      occurred: fc.integer({ min: -3_000, max: 3_000 }),
      seconds: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ occurred, seconds, ...raw }) =>
      buildObservation(
        ScenarioObservation.parse({
          ref: `o${String(n)}`,
          source: raw.type === 'email.sent' ? 'gmail.sent' : 'gcal.event',
          ...raw,
          occurredAt: at(raw.type === 'email.sent' ? Math.abs(occurred) % 240 : occurred, seconds),
          observedAt: at(0, 0),
          rowKey: `row-${String(n)}`,
        }),
        [],
        EVAL,
        VIEW,
      ),
    );

const worldArb = fc
  .record({
    policy: policyArb,
    claims: fc
      .tuple(claimArb(1), claimArb(2), claimArb(3))
      .chain((claims) => fc.subarray(claims, { minLength: 1 })),
    rows: fc.tuple(rowArb(1), rowArb(2), rowArb(3), rowArb(4), rowArb(5)).chain((rows) => fc.subarray(rows)),
  })
  .map(({ policy, claims, rows }): World => {
    const window = { lastSyncAt: EVAL, windowStart: at(-4_000, 0), windowEnd: EVAL, accountHash: 'a' };
    const coverage = buildCoverage(
      [
        { source: 'gmail.sent', ...window },
        { source: 'gcal.event', ...window, allCalendars: true },
      ],
      EVAL,
    );
    const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims });
    const grants = [buildGrant({ agent: 'muse' }, EVAL)];
    return { claims, observations: rows, grants, policy, coverage, activity };
  });

describe('gradeBatch equals the per-claim oracle under random weights and windows (QA-R6, Hard Rule 4)', () => {
  it(
    `${String(RUNS)} random batches: every claim receipt is grade() on its candidates()`,
    async () => {
      await fc.assert(
        fc.asyncProperty(worldArb, async (world) => {
          const index = createMemoryIndex(world.observations, 1);
          const { claims, grants, policy, coverage, activity } = world;
          const graded = await gradeBatch(claims, index, grants, policy, coverage, activity);
          for (const [id, batch, oracle] of await againstOracle(world, graded))
            expect(batch, id).toBe(oracle);
        }),
        { numRuns: RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
