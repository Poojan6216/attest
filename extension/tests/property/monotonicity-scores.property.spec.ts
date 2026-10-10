/**
 * Sprint 5 QA review (Hard Rule 4: the model only proposes; docs/grading.md §5.4; qa_tester rule 4). The two
 * monotonicity properties (./monotonicity.spec.ts, ./monotonicity-batch.property.spec.ts) give every candidate the
 * same model score, so they cannot see a model score that changes which candidate is best or which observation a
 * claim takes: a uniform score keeps every ranking as it was. They also weigh the model at 0.15 alone. Here each
 * candidate gets its own score, or none, under every model weight the loader allows (0 up to just under its cap,
 * `features.modelScore` < (verified − partial) / (1 − partial)):
 *  - grade(): the observation taken never changes, and the rule changes only PARTIAL → VERIFIED; a NOT_FOUND or an
 *    UNVERIFIABLE never changes; scores that rise pointwise never lower the rule or the score (monotone in the
 *    model's score); a candidate other than the one taken may say anything: the receipt's rule, grade, state,
 *    observation and signals stay as they were; and grading with scores is deterministic, the scores hashed into the
 *    receipt's inputs (the determinism property's tuples never carry any).
 *  - gradeBatch: ./monotonicity-scores-batch.property.spec.ts.
 * Each property also checks it was not proved over nothing. Every value is invented.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { grade } from '../../src/core/grade';
import { instantMs } from '../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import { claimWindow, inClaimWindow } from '../../src/core/window';
import type { GradeContext, Receipt, Ulid } from '../../src/core/schema';
import { BASIS_POINTS } from '../../src/core/units';
import { buildCoverage, buildGrant, mergePatch } from '../golden/build';
import { type Tuple, tupleArb } from './grade-tuples';
import { at, claimArb, decided, maybeScore, rowArb } from './monotonicity-worlds';

const PROPERTY_TIMEOUT_MS = 300_000;
const GRADE_RUNS = 5_000;

/** `policy` with the model weighed at `lambda`: its document again, `features.modelScore` changed, loaded afresh. */
function weighed(policy: Policy, lambda: number): Policy {
  const document = Object.fromEntries(
    Object.entries(policy).filter(([key]) => key !== 'bp' && key !== 'policyHash'),
  );
  return loadPolicy(mergePatch(JSON.parse(JSON.stringify(document)), { features: { modelScore: lambda } }));
}

/**
 * Weights from 0 to just under each policy's cap, in basis points: the largest m with m·(1 − partial) < verified −
 * partial (6,999 under the shipped thresholds 0.85 and 0.5; 5,714 at 0.7 and 0.3), half of it, 0.05, 0.15 and 0.
 */
function lambdasFor(policy: Policy): readonly number[] {
  const { partial, verified } = policy.bp.thresholds;
  const capBp = Math.ceil(((verified - partial) * BASIS_POINTS) / (BASIS_POINTS - partial)) - 1;
  return [0, 500, 1_500, Math.round(capBp / 2), capBp].map((bp) => bp / BASIS_POINTS);
}

const WEIGHED = new Map<Policy, readonly Policy[]>();
function variantsOf(policy: Policy): readonly Policy[] {
  let variants = WEIGHED.get(policy);
  if (variants === undefined) {
    variants = lambdasFor(policy).map((lambda) => weighed(policy, lambda));
    WEIGHED.set(policy, variants);
  }
  return variants;
}

/**
 * Inputs aimed at the band the model can lift: an email claim to Priya, by name or address, with its subject exact
 * or paraphrased, and up to four sends around it, kept when they are §4.1 candidates of it (grade() refuses others).
 * Few of the general tuples land there (about 2 in 5,000), too few for the property to prove it saw a raise.
 */
const bandTupleArb: fc.Arbitrary<Tuple> = fc
  .record({
    evaluatedAt: fc.constantFrom(at(150), at(6 * 60)),
    claim: claimArb(1),
    rows: fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 4 }),
  })
  .chain(({ evaluatedAt, claim, rows }) =>
    fc.tuple(...rows.map((n) => rowArb(n, evaluatedAt))).map((candidates) => {
      const window = claimWindow(claim, DEFAULT_POLICY);
      const own =
        window === null ? [] : candidates.filter((row) => inClaimWindow(window, instantMs(row.occurredAt)));
      const coverageWindow = { lastSyncAt: evaluatedAt, windowStart: at(-24 * 60), windowEnd: evaluatedAt };
      return {
        claim,
        candidates: own,
        grant: buildGrant({ agent: 'muse' }, evaluatedAt),
        policy: DEFAULT_POLICY,
        coverage: buildCoverage([{ source: 'gmail.sent', accountHash: 'a', ...coverageWindow }], evaluatedAt),
        context: { priorSpendCents: 0 },
      };
    }),
  );

interface Scored {
  readonly tuple: Tuple;
  readonly policy: Policy;
  /** The distinct candidate ids, in id order. */
  readonly ids: readonly Ulid[];
  readonly low: readonly (number | undefined)[];
  /** Added to `low` (none read as 0), capped at 1: so `high` ≥ `low` candidate by candidate. */
  readonly rise: readonly number[];
  /** Scores for the candidates other than the one the floor took. */
  readonly noise: readonly (number | undefined)[];
}

const scoredArb: fc.Arbitrary<Scored> = fc.oneof(tupleArb, bandTupleArb).chain((tuple) => {
  const ids = [...new Set(tuple.candidates.map(({ id }) => id))].sort();
  const n = ids.length;
  return fc.record({
    tuple: fc.constant(tuple),
    policy: fc.constantFrom(...variantsOf(tuple.policy)),
    ids: fc.constant(ids),
    low: fc.array(maybeScore, { minLength: n, maxLength: n }),
    rise: fc.array(fc.integer({ min: 0, max: BASIS_POINTS }), { minLength: n, maxLength: n }),
    noise: fc.array(maybeScore, { minLength: n, maxLength: n }),
  });
});

/** The context with `scores` (none where undefined), in id order as the schema requires. */
function withScores(t: Tuple, ids: readonly Ulid[], scores: readonly (number | undefined)[]): GradeContext {
  const modelScores = ids.flatMap((observationId, i) => {
    const score = scores[i];
    return score === undefined ? [] : [{ observationId, score }];
  });
  return { ...t.context, modelScores };
}

const gradeWith = (s: Scored, context: GradeContext): Receipt =>
  grade(s.tuple.claim, s.tuple.candidates, s.tuple.grant, s.policy, s.tuple.coverage, context);

/** VERIFIED above everything else the model can touch: the only move it may make. */
const rank = (receipt: Receipt): number => (receipt.ruleId === 'verified' ? 1 : 0);

interface Seen {
  raised: number;
  between: number;
  noised: number;
  readonly weights: Set<number>;
}

/** One run's checks (header), counting what it saw. */
function checkScored(s: Scored, seen: Seen): void {
  seen.weights.add(s.policy.bp.features.modelScore);
  const floor = gradeWith(s, s.tuple.context);
  const high = s.low.map((score, i) => Math.min(BASIS_POINTS, (score ?? 0) + (s.rise[i] ?? 0)));
  const lowReceipt = gradeWith(s, withScores(s.tuple, s.ids, s.low));
  const highReceipt = gradeWith(s, withScores(s.tuple, s.ids, high));
  // Deterministic with scores in the context (the determinism property's tuples carry none), and the scores
  // are inputs: a context holding any is hashed apart from one holding none, so replay grades with them.
  expect(gradeWith(s, withScores(s.tuple, s.ids, s.low))).toEqual(lowReceipt);
  if (s.low.some((score) => score !== undefined)) {
    expect(lowReceipt.inputsHash).not.toBe(floor.inputsHash);
  }
  for (const receipt of [lowReceipt, highReceipt]) {
    // The observation a claim takes is the floor's, whatever any candidate's score.
    expect(receipt.observationIds).toEqual(floor.observationIds);
    if (receipt.ruleId !== floor.ruleId) {
      expect([floor.ruleId, receipt.ruleId]).toEqual(['partial', 'verified']);
    }
    if (floor.grade === 'NOT_FOUND' || floor.grade === 'UNVERIFIABLE') {
      expect(decided(receipt)).toEqual(decided(floor));
    }
  }
  // Monotone: higher scores never lower the rule, nor the score, which never falls below the floor's.
  expect(rank(highReceipt)).toBeGreaterThanOrEqual(rank(lowReceipt));
  const [floorScore, lowScore, highScore] = [floor, lowReceipt, highReceipt].map(
    (receipt) => receipt.signals.score,
  );
  if (floorScore !== undefined) {
    expect(lowScore).toBeGreaterThanOrEqual(floorScore);
    expect(highScore).toBeGreaterThanOrEqual(lowScore ?? floorScore);
  }
  if (rank(highReceipt) > rank(floor)) seen.raised += 1;
  if (rank(highReceipt) > rank(lowReceipt)) seen.between += 1;
  // Only the candidate the floor took counts: every other may be scored anything, or nothing.
  const [taken, ...more] = floor.observationIds;
  if (s.tuple.claim !== null && taken !== undefined && more.length === 0) {
    const noisy = s.ids.map((id, i) => (id === taken ? s.low[i] : s.noise[i]));
    const noisyReceipt = gradeWith(s, withScores(s.tuple, s.ids, noisy));
    expect(decided(noisyReceipt)).toEqual(decided(lowReceipt));
    expect(noisyReceipt.signals).toEqual(lowReceipt.signals);
    if (s.ids.length > 1) seen.noised += 1;
  }
}

describe('the model never grades, candidate by candidate (Sprint 5 QA; Hard Rule 4)', () => {
  it(
    `${String(GRADE_RUNS)} random inputs under every allowed weight: no observation moves, no rule but PARTIAL → VERIFIED, monotone in the score, and only the taken candidate's score counts`,
    () => {
      const seen: Seen = { raised: 0, between: 0, noised: 0, weights: new Set<number>() };
      fc.assert(
        fc.property(scoredArb, (s) => {
          checkScored(s, seen);
        }),
        { numRuns: GRADE_RUNS },
      );
      // Not proved over nothing: raises happen, some only at the higher scores, and other candidates are scored.
      expect(seen.raised).toBeGreaterThan(0);
      expect(seen.between).toBeGreaterThan(0);
      expect(seen.noised).toBeGreaterThan(0);
      expect(seen.weights.size).toBeGreaterThan(4);
    },
    PROPERTY_TIMEOUT_MS,
  );

  it('the weights are every one the loader allows: 0, the shipped 0.15, and up to just under the cap', () => {
    expect(variantsOf(DEFAULT_POLICY).map((policy) => policy.bp.features.modelScore)).toEqual([
      0, 500, 1_500, 3_500, 6_999,
    ]);
    // At the cap the loader refuses the policy: the model alone would verify a match at the partial floor.
    expect(() => weighed(DEFAULT_POLICY, 0.7)).toThrow();
  });
});
