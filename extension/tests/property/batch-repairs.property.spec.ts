/**
 * Clock repairs through the grading batch (docs/grading.md §3 and §6.1, contract v1.16; S2-SIM2-1; Decisions [3.17];
 * Hard Rules 4 and 5; Sprint 3 QA review, qa_tester rule 4). The background grades every claim through `gradeBatch`
 * with the spans the ledger kept (`Coverage.repairs`), but grade.property.spec.ts and batch-oracle.property.spec.ts
 * never generate one. Over 1,000 random batches of calendar and email claims, rows first seen before and after each
 * claim's first-seen bound, and up to four spans around those bounds:
 *  - every claim receipt is `grade()` on its own candidates with the same coverage (the per-claim oracle replay plays);
 *  - the spans are a set: their order and repetition change no receipt, `inputsHash` included;
 *  - a span never makes a receipt NOT_FOUND that was not, and a `calendar.created` claim whose bound a span found by
 *    `evaluatedAt` holds is never NOT_FOUND;
 *  - spans change nothing but `inputsHash` for any other claim (another type, or a bound no span holds), and spans
 *    found after `evaluatedAt` change nothing at all.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { gradeBatch } from '../../src/core/batch';
import { createMemoryIndex } from '../../src/core/candidates';
import { canonicalJson } from '../../src/core/hash';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { firstSeenFromMs } from '../../src/core/order';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { Activity, type Claim, type Coverage, IsoTs, type Receipt } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import defaultPolicyJson from '../../../policy/default.json';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../golden/scenario-schema';
import { againstOracle, type World } from '../unit/core/batch-oracle';

const RUNS = 1_000;
const PROPERTY_TIMEOUT_MS = 300_000;
const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const EVAL_MINUTES = 360;
const VIEW = PolicyView.parse(defaultPolicyJson);
const TYPES = ['calendar.created', 'calendar.created', 'calendar.updated', 'email.sent'] as const;
const SUBJECTS = ['Q3 planning sync', 'Q3 planning', 'Design review'];

const at = (minutes: number): string => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, -240);
const EVAL = at(EVAL_MINUTES);

const claimArb = (n: number) =>
  fc
    .record({
      type: fc.constantFrom(...TYPES),
      subjectHint: fc.constantFrom(...SUBJECTS),
      claimed: fc.integer({ min: 0, max: 200 }),
      target: fc.integer({ min: -3_000, max: 3_000 }),
    })
    .map(({ claimed, target, ...raw }) =>
      buildClaim(
        ScenarioClaim.parse({
          ref: `c${String(n)}`,
          agent: 'muse',
          counterparty: 'priya@company.com',
          ...raw,
          claimedAt: at(claimed),
          ...(raw.type === 'email.sent' ? {} : { targetAt: at(target) }),
        }),
      ),
    );

/** A row of a claim's type, first seen anywhere from before the earliest claim's bound to just before grading. */
const rowArb = (n: number) =>
  fc
    .record({
      type: fc.constantFrom(...TYPES),
      subjectHint: fc.constantFrom(...SUBJECTS),
      occurred: fc.integer({ min: -3_000, max: 3_000 }),
      observed: fc.integer({ min: -60, max: EVAL_MINUTES - 1 }),
    })
    .map(({ occurred, observed, ...raw }) =>
      buildObservation(
        ScenarioObservation.parse({
          ref: `o${String(n)}`,
          source: raw.type === 'email.sent' ? 'gmail.sent' : 'gcal.event',
          counterparty: 'priya@company.com',
          ...raw,
          occurredAt: at(raw.type === 'email.sent' ? Math.abs(occurred) % 240 : occurred),
          observedAt: at(observed),
          rowKey: `row-${String(n)}`,
        }),
        [],
        EVAL,
        VIEW,
      ),
    );

/** A kept span: found (`from`) before or after grading, and as long as a clock jump might be. */
const spanArb = fc
  .record({
    from: fc.integer({ min: -60, max: EVAL_MINUTES + 60 }),
    length: fc.integer({ min: 0, max: 240 }),
  })
  .map(({ from, length }) => ({ from: IsoTs.parse(at(from)), to: IsoTs.parse(at(from + length)) }));

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;
type Span = Generated<typeof spanArb>;

const worldArb = fc.record({
  claims: fc.tuple(claimArb(1), claimArb(2), claimArb(3)).chain((all) => fc.subarray(all, { minLength: 1 })),
  rows: fc.tuple(rowArb(1), rowArb(2), rowArb(3), rowArb(4), rowArb(5)).chain((all) => fc.subarray(all)),
  spans: fc.array(spanArb, { minLength: 1, maxLength: 4 }),
});

/** Gmail's Sent list up to grading, and every calendar over every claim's window (± calendarDays), all followed. */
function coverageWith(repairs: readonly Span[]): Coverage {
  const sent = { source: 'gmail.sent' as const, lastSyncAt: EVAL, windowStart: at(-4_000), windowEnd: EVAL };
  const calendar = {
    source: 'gcal.event' as const,
    lastSyncAt: EVAL,
    windowStart: at(-8_000),
    windowEnd: at(8_000),
    allCalendars: true,
    changesSince: at(-8_000),
  };
  return buildCoverage(
    [
      { ...sent, accountHash: 'a' },
      { ...calendar, accountHash: 'a' },
    ],
    EVAL,
    repairs,
  );
}

/** Each claim's receipt of one batch over `claims` and `rows` with the spans `repairs`. */
async function batch(claims: readonly Claim[], rows: World['observations'], repairs: readonly Span[]) {
  const coverage = coverageWith(repairs);
  const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims });
  const world: World = {
    claims,
    observations: rows,
    grants: [buildGrant({ agent: 'muse' }, EVAL)],
    policy: DEFAULT_POLICY,
    coverage,
    activity,
  };
  const graded = await gradeBatch(
    claims,
    createMemoryIndex(rows, 1),
    world.grants,
    DEFAULT_POLICY,
    coverage,
    activity,
  );
  const byClaim = new Map<string, Receipt>();
  for (const { receipt } of graded) if (receipt.claimId !== undefined) byClaim.set(receipt.claimId, receipt);
  return { world, graded, byClaim };
}

/** Whether a span found by grading holds the claim's §4.1 first-seen bound (a `calendar.created` claim only). */
function boundRepaired(claim: Claim, repairs: readonly Span[]): boolean {
  const bound = firstSeenFromMs(claim, DEFAULT_POLICY);
  if (claim.type !== 'calendar.created' || bound === null) return false;
  return repairs.some(
    ({ from, to }) =>
      instantMs(from) <= instantMs(EVAL) && instantMs(from) <= bound && bound <= instantMs(to),
  );
}

const withoutHash = (receipt: Receipt | undefined): string => canonicalJson({ ...receipt, inputsHash: '' });

describe('clock repairs through the grading batch (§6.1 v1.16, S2-SIM2-1)', () => {
  it(
    `${String(RUNS)} random batches: the oracle, the spans as a set, never a NOT_FOUND from a span`,
    async () => {
      let saved = 0;
      await fc.assert(
        fc.asyncProperty(worldArb, async ({ claims, rows, spans }) => {
          const repaired = await batch(claims, rows, spans);
          for (const [id, ours, oracle] of await againstOracle(repaired.world, repaired.graded))
            expect(ours, id).toBe(oracle);
          const shuffled = await batch(claims, rows, [...spans].reverse().concat(spans.slice(0, 1)));
          expect(canonicalJson(shuffled.graded)).toBe(canonicalJson(repaired.graded));
          const bare = await batch(claims, rows, []);
          for (const claim of claims) {
            const [ours, before] = [repaired.byClaim.get(claim.id), bare.byClaim.get(claim.id)];
            if (ours?.grade === 'NOT_FOUND') expect(before?.grade, claim.type).toBe('NOT_FOUND');
            if (boundRepaired(claim, spans)) {
              expect(ours?.grade).not.toBe('NOT_FOUND');
              if (before?.grade === 'NOT_FOUND') saved += 1;
            } else expect(withoutHash(ours), claim.type).toBe(withoutHash(before));
          }
          const later = spans.filter(({ from }) => instantMs(from) > instantMs(EVAL));
          if (later.length > 0) {
            const unseen = await batch(claims, rows, later);
            expect(canonicalJson(unseen.graded)).toBe(canonicalJson(bare.graded));
          }
        }),
        { numRuns: RUNS },
      );
      // The batches reach the case S2-SIM2-1 is about: a claim NOT_FOUND without the span, not with it.
      expect(saved).toBeGreaterThan(RUNS / 20);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
