/**
 * SEC-5 (Hard Rules 4, 5, 6): `grade()` accepts exactly the candidates `candidates()` returns for a claim
 * (docs/grading.md §4.1; grade-guard.ts). For random claims of every type and precision, with and without
 * `targetAt`, and random lists of distinct rows of every type and source around the window edges, grade() throws
 * `GradeError('foreign_candidate')` (the same way twice) iff some row is not among the claim's `candidates()` from an
 * index of those rows; otherwise it grades. The lists are duplicate-free by `contentHash`, so the two decide each
 * row alone (a duplicate's first sighting is a property of the group, which `grade` never sees whole).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { candidates, createMemoryIndex } from '../../src/core/candidates';
import { grade, GradeError } from '../../src/core/grade';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import { ActionType, type Claim, type Observation, type Receipt } from '../../src/core/schema';
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

const RUNS = 2_000;
const PROPERTY_TIMEOUT_MS = 300_000;
const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const EVALUATED_AT = isoWithOffset(BASE_MS + 5 * 24 * 60 * MS_PER_MINUTE, -240);
const VIEW = PolicyView.parse(defaultPolicyJson);
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
const OFFSETS = [-240, 0, 345];

const POLICIES: readonly Policy[] = [
  DEFAULT_POLICY,
  loadPolicy(
    mergePatch(defaultPolicyJson, {
      windows: { beforeClaimMin: 5, afterClaimMin: 5, toleranceMin: 0, calendarDays: 1 },
    }),
  ),
];

/** An instant `minutes` (and `seconds`) from the base, in one of a few offsets. */
const iso = (min: number, max: number) =>
  fc
    .tuple(fc.integer({ min, max }), fc.integer({ min: 0, max: 59 }), fc.constantFrom(...OFFSETS))
    .map(([minutes, seconds, offset]) =>
      isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE + seconds * 1_000, offset),
    );

const claimArb = fc
  .record({
    type: fc.constantFrom(...ActionType.options),
    claimedAt: iso(0, 240),
    claimedAtPrecision: fc.constantFrom('minute', 'hour', 'day'),
    targetAt: fc.option(iso(-3_000, 3_000), { nil: undefined }),
  })
  .map(({ targetAt, ...raw }) =>
    buildClaim(
      ScenarioClaim.parse({
        ref: 'c1',
        agent: 'muse',
        counterparty: 'priya@company.com',
        ...raw,
        ...(targetAt === undefined ? {} : { targetAt }),
      }),
    ),
  );

/** A row near the claim, of the claim's type half the time; `n` keeps every row's content distinct. */
const rowArb = (claim: Claim, n: number) =>
  fc
    .record({
      sameType: fc.boolean(),
      type: fc.constantFrom(...ActionType.options),
      source: fc.constantFrom(...SOURCES),
      occurredAt: iso(-4_400, 4_400),
      observedAt: iso(-300, 600),
    })
    .map(({ sameType, type, ...raw }) =>
      buildObservation(
        ScenarioObservation.parse({
          ref: `o${String(n)}`,
          type: sameType ? claim.type : type,
          counterparty: `p${String(n)}@company.com`,
          subjectHint: `row ${String(n)}`,
          ...raw,
        }),
        [],
        EVALUATED_AT,
        VIEW,
      ),
    );

const caseArb = claimArb.chain((claim) =>
  fc.record({
    claim: fc.constant(claim),
    rows: fc.tuple(rowArb(claim, 1), rowArb(claim, 2), rowArb(claim, 3)).chain((rows) => fc.subarray(rows)),
    policy: fc.constantFrom(...POLICIES),
  }),
);

const GRANT = buildGrant({ agent: 'muse' }, EVALUATED_AT);
const COVERAGE = buildCoverage([], EVALUATED_AT);

/** grade()'s outcome: the receipt, or the refusal's code (anything else is thrown on). */
function outcome(claim: Claim, rows: readonly Observation[], policy: Policy): Receipt | 'foreign_candidate' {
  try {
    return grade(claim, rows, GRANT, policy, COVERAGE, { priorSpendCents: 0 });
  } catch (error) {
    if (error instanceof GradeError && error.code === 'foreign_candidate') return error.code;
    throw error;
  }
}

describe('grade() accepts exactly the candidates candidates() returns (SEC-5, §4.1)', () => {
  it(
    `${String(RUNS)} random claims and row lists: refused iff some row is not a candidate`,
    async () => {
      let refused = 0;
      await fc.assert(
        fc.asyncProperty(caseArb, async ({ claim, rows, policy }) => {
          const index = createMemoryIndex(rows, 1);
          const found = new Set((await candidates(claim, index, policy)).map((row) => row.contentHash));
          const foreign = rows.some((row) => !found.has(row.contentHash));
          const first = outcome(claim, rows, policy);
          expect(outcome(claim, rows, policy)).toEqual(first);
          expect(first === 'foreign_candidate').toBe(foreign);
          if (foreign) refused += 1;
        }),
        { numRuns: RUNS },
      );
      // Both sides are reached often: the property is not proved on refusals alone, nor on acceptances alone.
      expect(refused).toBeGreaterThan(RUNS / 10);
      expect(refused).toBeLessThan(RUNS - RUNS / 10);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
