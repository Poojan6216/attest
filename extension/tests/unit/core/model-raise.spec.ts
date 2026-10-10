/**
 * The model's score in a grade (src/core/model-raise.ts; docs/grading.md §5.4, v1.19), on hand-computed values under
 * the shipped policy (λ = 0.15, partial 0.5, verified 0.85): a floor at or above `partial` rises to
 * max(S, (1 − λ)·S + λ·m), exactly; a floor below `partial` never moves; a model score never lowers a score; the
 * model's score is shown with the candidate's signals whenever the context holds one for it. Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import type { BestCandidate } from '../../../src/core/grade-best';
import { raisedBest } from '../../../src/core/model-raise';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { compareRatio, ratio, type Ratio } from '../../../src/core/ratio';
import type { GradeContext, Observation, Ulid } from '../../../src/core/schema';
import defaultPolicyJson from '../../../../policy/default.json';
import { makeObservation } from '../ledger/fixtures';

const observation = makeObservation({}) as Observation;
const ID = observation.id;

const best = (score: Ratio): BestCandidate => ({
  observation,
  score,
  signals: { subjectOverlap: 1, score: Number(score.num) / Number(score.den) },
  reasonCodes: [],
});
const context = (score: number): GradeContext => ({
  priorSpendCents: 0,
  modelScores: [{ observationId: ID, score }],
});
const scoreOf = (raised: BestCandidate | null): Ratio => {
  if (raised === null) throw new Error('no candidate');
  return raised.score;
};

describe('raisedBest under the shipped policy (λ = 0.15)', () => {
  it('raises a floor at partial or above: 0.8 and m = 1 give 0.83, short of verified', () => {
    const raised = raisedBest(best(ratio(4, 5)), context(10_000), DEFAULT_POLICY);
    expect(compareRatio(scoreOf(raised), ratio(83, 100))).toBe(0);
    expect(raised?.signals).toEqual({ subjectOverlap: 1, score: 0.83, modelScore: 1 });
  });

  it('carries a floor of 0.83 to verified with m = 1: 0.85 · 0.83 + 0.15 = 0.8555', () => {
    const raised = raisedBest(best(ratio(83, 100)), context(10_000), DEFAULT_POLICY);
    expect(compareRatio(scoreOf(raised), ratio(8555, 10_000))).toBe(0);
  });

  it('never lowers a score: 0.8 and m = 0 stay 0.8, the model score shown', () => {
    const floor = best(ratio(4, 5));
    const raised = raisedBest(floor, context(0), DEFAULT_POLICY);
    expect(raised?.score).toBe(floor.score);
    expect(raised?.signals).toEqual({ ...floor.signals, modelScore: 0 });
  });

  it('never lifts a floor below partial: 0.49 and m = 1 stay 0.49', () => {
    const floor = best(ratio(49, 100));
    expect(raisedBest(floor, context(10_000), DEFAULT_POLICY)?.score).toBe(floor.score);
  });

  it('raises exactly at the partial floor: 0.5 and m = 1 give 0.575', () => {
    const raised = raisedBest(best(ratio(1, 2)), context(10_000), DEFAULT_POLICY);
    expect(compareRatio(scoreOf(raised), ratio(575, 1_000))).toBe(0);
  });

  it('bounds any answer, a hint that steered the model to 1 included: verified only from a floor of 14/17 (SEC-11)', () => {
    // The model's input carries subject hints an agent or a sender wrote; whatever they make it say, its score is at
    // most 1, and 0.85 · S + 0.15 reaches verified (0.85) only for S ≥ 14/17, about 0.8235: the cap is the control.
    const edge = raisedBest(best(ratio(14, 17)), context(10_000), DEFAULT_POLICY);
    expect(compareRatio(scoreOf(edge), ratio(85, 100))).toBe(0);
    const below = raisedBest(best(ratio(8_235, 10_000)), context(10_000), DEFAULT_POLICY);
    expect(compareRatio(scoreOf(below), ratio(85, 100))).toBe(-1);
  });
});

describe('raisedBest without a model score, or without a weight', () => {
  it('returns the best candidate itself when the context holds no score for it, and null for none', () => {
    const floor = best(ratio(4, 5));
    expect(raisedBest(floor, { priorSpendCents: 0 }, DEFAULT_POLICY)).toBe(floor);
    const other = {
      priorSpendCents: 0,
      modelScores: [{ observationId: '0'.repeat(26) as Ulid, score: 10_000 }],
    };
    expect(raisedBest(floor, other, DEFAULT_POLICY)).toBe(floor);
    expect(raisedBest(null, context(10_000), DEFAULT_POLICY)).toBeNull();
  });

  it('never raises under a policy that weighs the model 0, but shows its score', () => {
    const noWeight = loadPolicy({
      ...defaultPolicyJson,
      features: { ...defaultPolicyJson.features, modelScore: 0 },
    });
    const floor = best(ratio(4, 5));
    const raised = raisedBest(floor, context(10_000), noWeight);
    expect(raised?.score).toBe(floor.score);
    expect(raised?.signals.modelScore).toBe(1);
  });
});
