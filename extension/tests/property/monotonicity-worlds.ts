/**
 * Inputs for the Sprint 5 QA monotonicity properties (./monotonicity-scores.property.spec.ts,
 * ./monotonicity-scores-batch.property.spec.ts): email claims to Priya, by name or address, with subjects exact and
 * paraphrased, and Gmail sends around them, built by the golden loader's builders, so floors land in the band the
 * advisory model can lift (docs/grading.md §5.4); the instants near one base, in New York's summer offset; and what the
 * rules decided of a receipt. Every value is invented.
 */
import fc from 'fast-check';

import defaultPolicyJson from '../../../policy/default.json';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import type { Receipt } from '../../src/core/schema';
import { BASIS_POINTS, MS_PER_MINUTE } from '../../src/core/units';
import { buildClaim, buildObservation, PolicyView } from '../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../golden/scenario-schema';

const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const PEOPLE = ['Priya', 'priya@company.example', 'raj@company.example'];
const ADDRESSES = ['priya@company.example', 'raj@company.example', 'priya.k@company.example'];
const CLAIM_SUBJECTS = ['Quarterly deck', 'Q3 deck', 'Q3 deck final', 'Hiring plan', 'deck'];
const ROW_SUBJECTS = ['Q3 deck - final', 'Q3 deck', 'Hiring plan for Q3', 'Lunch'];

export const at = (minutes: number, seconds = 0) =>
  isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE + seconds * 1_000, -240);

export const claimArb = (n: number) =>
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

export const rowArb = (n: number, evaluatedAt: string) =>
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

/** A score in basis points, or none. */
export const maybeScore = fc.option(fc.integer({ min: 0, max: BASIS_POINTS }), { nil: undefined });

/** What the rules decided: the rule, the grade, the state and the observation taken. */
export const decided = ({ ruleId, grade, state, observationIds }: Receipt) => ({
  ruleId,
  grade,
  state,
  observationIds,
});
