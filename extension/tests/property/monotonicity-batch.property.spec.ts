/**
 * Sprint 5.4 Done-when, the monotonicity property with the real wiring (Hard Rule 4; docs/grading.md §5.4): the model's
 * scores reach a grade only through `gradeBatch`'s `modelScores` (src/background/grading.ts passes the ledger's), so
 * 5,000 random batches are each graded three times: with no scores, with every claim's every candidate scored 0, and
 * scored 1. Under the shipped policy (λ = 0.15), scored 1 changes no claim's rule except PARTIAL to VERIFIED, never the
 * observation a claim takes, never a NOT_FOUND or an UNVERIFIABLE, and never a claim-less receipt; scored 0 grades as
 * no score; and each receipt's inputs hold exactly the scores its claim was given, so replay applies them. Claims name
 * Priya by name or address, with subjects paraphrased and exact, so floors land in the band the model can lift.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { type BatchReceipt, gradeBatch } from '../../src/core/batch';
import { createMemoryIndex } from '../../src/core/candidates';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import {
  Activity,
  type Claim,
  type ModelScores,
  type Observation,
  type Receipt,
  type Ulid,
} from '../../src/core/schema';
import { BASIS_POINTS, MS_PER_MINUTE } from '../../src/core/units';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../golden/scenario-schema';

const RUNS = 5_000;
const PROPERTY_TIMEOUT_MS = 300_000;
const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const PEOPLE = ['Priya', 'priya@company.example', 'raj@company.example'];
const ADDRESSES = ['priya@company.example', 'raj@company.example', 'priya.k@company.example'];
const CLAIM_SUBJECTS = ['Quarterly deck', 'Q3 deck', 'Q3 deck final', 'Hiring plan', 'deck'];
const ROW_SUBJECTS = ['Q3 deck - final', 'Q3 deck', 'Hiring plan for Q3', 'Lunch'];

const at = (minutes: number, seconds = 0) =>
  isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE + seconds * 1_000, -240);

const claimArb = (n: number) =>
  fc
    .record({
      counterparty: fc.constantFrom(...PEOPLE),
      subjectHint: fc.constantFrom(...CLAIM_SUBJECTS),
      claimed: fc.integer({ min: 0, max: 120 }),
    })
    .map(({ claimed, ...raw }) =>
      buildClaim(
        ScenarioClaim.parse({
          ref: `c${String(n)}`,
          agent: 'muse',
          type: 'email.sent',
          ...raw,
          claimedAt: at(claimed),
        }),
      ),
    );

const rowArb = (n: number, evaluatedAt: string) =>
  fc
    .record({
      counterparty: fc.constantFrom(...ADDRESSES),
      subjectHint: fc.constantFrom(...ROW_SUBJECTS),
      occurred: fc.integer({ min: 0, max: 125 }),
      seconds: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ occurred, seconds, ...raw }) =>
      buildObservation(
        ScenarioObservation.parse({
          ref: `o${String(n)}`,
          source: 'gmail.sent',
          type: 'email.sent',
          ...raw,
          occurredAt: at(occurred, seconds),
          observedAt: at(0),
          rowKey: `row-${String(n)}`,
        }),
        [],
        evaluatedAt,
        VIEW,
      ),
    );

interface World {
  readonly claims: readonly Claim[];
  readonly rows: readonly Observation[];
  readonly evaluatedAt: string;
}

/** Before grace for some claims (PENDING), after it for all (FINAL). */
const worldArb: fc.Arbitrary<World> = fc.constantFrom(at(150), at(6 * 60)).chain((evaluatedAt) =>
  fc.record({
    claims: fc
      .tuple(claimArb(1), claimArb(2), claimArb(3))
      .chain((claims) => fc.subarray(claims, { minLength: 1 })),
    rows: fc
      .tuple(rowArb(1, evaluatedAt), rowArb(2, evaluatedAt), rowArb(3, evaluatedAt), rowArb(4, evaluatedAt))
      .chain((rows) => fc.subarray(rows)),
    evaluatedAt: fc.constant(evaluatedAt),
  }),
);

/** Every claim's every candidate scored `score` (basis points), in id order: what the ledger would hand the batch. */
function scoredAll(world: World, score: number): Map<Ulid, ModelScores> {
  const ids = [...new Set(world.rows.map(({ id }) => id))].sort();
  return new Map(
    world.claims.map((claim) => [claim.id, ids.map((observationId) => ({ observationId, score }))]),
  );
}

async function graded(world: World, scores?: Map<Ulid, ModelScores>): Promise<Map<string, BatchReceipt>> {
  const { evaluatedAt } = world;
  const window = {
    lastSyncAt: evaluatedAt,
    windowStart: at(-24 * 60),
    windowEnd: evaluatedAt,
    accountHash: 'a',
  };
  const coverage = buildCoverage([{ source: 'gmail.sent', ...window }], evaluatedAt);
  const activity = Activity.parse({
    sessions: [],
    idle: [],
    entries: [],
    adapterSyncs: [],
    claims: world.claims,
  });
  const grants = [buildGrant({ agent: 'muse' }, evaluatedAt)];
  const index = createMemoryIndex(world.rows, 1);
  const out = await gradeBatch(world.claims, index, grants, DEFAULT_POLICY, coverage, activity, [], scores);
  return new Map(out.map((entry) => [entry.receipt.id, entry]));
}

/** What the rules decided: the rule, the grade, the state and the observation taken. */
const decided = ({ ruleId, grade, state, observationIds }: Receipt) => ({
  ruleId,
  grade,
  state,
  observationIds,
});

describe('the model never grades, through gradeBatch (sprint_5 5.4, Hard Rule 4)', () => {
  it(
    `${String(RUNS)} random batches: scores of 1 change no rule but PARTIAL → VERIFIED, and 0 changes nothing`,
    async () => {
      const seen = { partial: 0, raised: 0 };
      await fc.assert(
        fc.asyncProperty(worldArb, async (world) => {
          const floor = await graded(world);
          const low = await graded(world, scoredAll(world, 0));
          const highScores = scoredAll(world, BASIS_POINTS);
          const high = await graded(world, highScores);
          expect([...low.keys()]).toEqual([...floor.keys()]);
          expect([...high.keys()]).toEqual([...floor.keys()]);
          for (const [id, { receipt }] of floor) {
            const lowReceipt = low.get(id)?.receipt;
            const highEntry = high.get(id);
            if (lowReceipt === undefined || highEntry === undefined)
              throw new Error('a receipt went missing');
            expect(decided(lowReceipt)).toEqual(decided(receipt));
            expect(highEntry.receipt.observationIds).toEqual(receipt.observationIds);
            // The claim's own scores, and only a claim's, ride in the inputs replay grades with.
            const own = receipt.claimId === undefined ? undefined : highScores.get(receipt.claimId);
            expect(highEntry.inputs.context.modelScores).toEqual(own);
            if (receipt.claimId === undefined) expect(decided(highEntry.receipt)).toEqual(decided(receipt));
            if (receipt.ruleId === 'partial') seen.partial += 1;
            if (highEntry.receipt.ruleId !== receipt.ruleId) {
              seen.raised += 1;
              expect([receipt.ruleId, highEntry.receipt.ruleId]).toEqual(['partial', 'verified']);
            }
            if (receipt.grade === 'NOT_FOUND' || receipt.grade === 'UNVERIFIABLE') {
              expect(decided(highEntry.receipt)).toEqual(decided(receipt));
            }
          }
        }),
        { numRuns: RUNS },
      );
      // Not proved over nothing: batches reach PARTIAL, and the model moved some of them to VERIFIED.
      expect(seen.partial).toBeGreaterThan(0);
      expect(seen.raised).toBeGreaterThan(0);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
