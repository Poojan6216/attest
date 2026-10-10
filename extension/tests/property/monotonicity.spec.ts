/**
 * Sprint 5.0 Done-when (Hard Rule 4: the model only proposes; docs/grading.md §5.4, v1.19; ledger_engineer rule 10):
 * 20,000 random grading inputs, each graded with no model score, with every candidate's model score at 0, and at 1
 * (the two ends of what the advisory matcher may propose). The scores at 1 never change the rule, except PARTIAL to
 * VERIFIED from a floor at or above `thresholds.partial`; a NOT_FOUND or an UNVERIFIABLE never changes at all; the
 * observation the claim takes never changes; and a score of 0 grades as no score. The tuples are the determinism
 * property's (./grade-tuples.ts), under the shipped policy and five variants of it, each weighing the model at 0.15.
 * Few random tuples land in the narrow band the model can lift (a floor from about 0.82 to 0.85): about 3 in 5,000, so
 * at 5,000 a run saw none about one time in 25 and failed its own check that the inputs reach a raise (a full run of
 * 2026-10-10 did). At 20,000 about 13 do, and a run with none comes about once in 360,000 runs.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { grade } from '../../src/core/grade';
import type { GradeContext, Receipt } from '../../src/core/schema';
import { BASIS_POINTS } from '../../src/core/units';
import { type Tuple, tupleArb } from './grade-tuples';

/** The property builds and grades three times per run; a busy machine must not turn a timeout into a failure. */
const PROPERTY_TIMEOUT_MS = 300_000;
const RUNS = 20_000;

/** The tuple's context with every candidate given the model score `score` (basis points), in id order. */
function scored(t: Tuple, score: number): GradeContext {
  const ids = [...new Set(t.candidates.map(({ id }) => id))].sort();
  return { ...t.context, modelScores: ids.map((observationId) => ({ observationId, score })) };
}

const gradeWith = (t: Tuple, context: GradeContext): Receipt =>
  grade(t.claim, t.candidates, t.grant, t.policy, t.coverage, context);

/** What the rules decided: the rule, the grade, the state and the observation taken. */
const decided = ({ ruleId, grade: g, state, observationIds }: Receipt) => ({
  ruleId,
  grade: g,
  state,
  observationIds,
});

describe('the model never grades (sprint_5 5.0, Hard Rule 4)', () => {
  it(
    `${String(RUNS)} random inputs: a model score of 1 changes no rule but PARTIAL → VERIFIED, and 0 changes nothing`,
    () => {
      const seen = { partial: 0, raised: 0 };
      fc.assert(
        fc.property(tupleArb, (t) => {
          const floor = gradeWith(t, t.context);
          const low = gradeWith(t, scored(t, 0));
          const high = gradeWith(t, scored(t, BASIS_POINTS));
          expect(decided(low)).toEqual(decided(floor));
          expect(high.observationIds).toEqual(floor.observationIds);
          if (floor.ruleId === 'partial') seen.partial += 1;
          if (high.ruleId !== floor.ruleId) {
            seen.raised += 1;
            expect([floor.ruleId, high.ruleId]).toEqual(['partial', 'verified']);
          }
          if (floor.grade === 'NOT_FOUND' || floor.grade === 'UNVERIFIABLE') {
            expect(decided(high)).toEqual(decided(floor));
          }
        }),
        { numRuns: RUNS },
      );
      // Not proved over nothing: the inputs reach PARTIAL, and the model moved some of them to VERIFIED.
      expect(seen.partial).toBeGreaterThan(0);
      expect(seen.raised).toBeGreaterThan(0);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
