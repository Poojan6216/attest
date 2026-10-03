/**
 * Task 1.6 Done-when, part two: "a PENDING receipt with fresh coverage finalises to NOT_FOUND only after grace,
 * never before" — an integration test of grade() and transition() (docs/grading.md §6.1 graceElapsed, §8).
 *
 * One email claim at 14:02 (minute precision, so end(p,t) = 14:03) with no evidence, graded again and again as
 * the Gmail Sent observer syncs: each pass is fresh (it saw everything from 12:00 up to its own sync). grade()
 * decides the state; transition() only installs each regrade in place of the PENDING row. Before the sync
 * reaches end + max(graceMin, afterClaimMin) (14:48, golden 43) the receipt is PENDING by rule `pending`; at that
 * sync it is FINAL NOT_FOUND, and from then on a regrade is refused. The clock is the observer's sync, never the
 * evaluation time: a late evaluation over a stale sync stays PENDING. Here coverage becomes full at the same
 * sync that ends grace; state-grace-full.spec.ts covers claims whose coverage is full well before grace.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { Receipt } from '../../../src/core/schema';
import { IllegalTransitionError, transition } from '../../../src/core/state';
import { buildClaim, buildCoverage, buildGrant } from '../../golden/load';
import { instantMs, shiftIso } from '../../golden/time';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const CLAIMED_AT = '2026-10-06T14:02:00-04:00';
const COVERAGE_FROM = '2026-10-06T12:00:00-04:00';
const CLAIM = buildClaim({
  ref: 'c1',
  agent: 'muse',
  type: 'email.sent',
  counterparty: 'priya@company.com',
  subjectHint: 'Q3 deck',
  claimedAt: CLAIMED_AT,
});
const GRANT = buildGrant({ agent: 'muse' }, CLAIMED_AT);

/** end(p,t) for a minute-precision claim at a whole minute, plus the later of graceMin and afterClaimMin. */
const { graceMin, afterClaimMin } = DEFAULT_POLICY.windows;
const GRACE_AT = shiftIso(CLAIMED_AT, MS_PER_MINUTE + Math.max(graceMin, afterClaimMin) * MS_PER_MINUTE);

/** grade() at `evaluatedAt`, with one Gmail Sent pass that synced at `syncedAt` and saw [12:00, syncedAt]. */
function gradeAt(evaluatedAt: string, syncedAt: string = evaluatedAt): Receipt {
  const coverage = buildCoverage(
    [
      {
        source: 'gmail.sent',
        lastSyncAt: syncedAt,
        windowStart: COVERAGE_FROM,
        windowEnd: syncedAt,
        accountHash: 'acct-a',
      },
    ],
    evaluatedAt,
  );
  return grade(CLAIM, [], GRANT, DEFAULT_POLICY, coverage, { priorSpendCents: 0 });
}

function expectPending(receipt: Receipt, evaluatedAt: string): void {
  expect(receipt).toMatchObject({ state: 'PENDING', ruleId: 'pending', grade: 'UNVERIFIABLE' });
  expect(receipt.computedAt).toBe(evaluatedAt);
  expect(receipt.finalAt).toBeUndefined();
  expect(receipt.reasons.map((reason) => reason.code)).toContain('grace.waiting');
}

function expectRefusedRegrade(receipt: Receipt, next: Receipt): void {
  let error: unknown;
  try {
    transition(receipt, { event: 'regrade', next });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(IllegalTransitionError);
  expect(error).toMatchObject({ code: 'regrade_final', from: 'FINAL' });
}

describe('grace: a PENDING receipt with fresh coverage finalises to NOT_FOUND only after grace', () => {
  it('the grace instant under the default policy is 14:48 (golden 43)', () => {
    expect(GRACE_AT).toBe('2026-10-06T14:48:00-04:00');
  });

  it('PENDING at every fresh sync before grace, FINAL NOT_FOUND at grace, then never regraded', () => {
    let receipt = gradeAt(CLAIMED_AT);
    expectPending(receipt, CLAIMED_AT);
    const steps = (instantMs(GRACE_AT) - instantMs(CLAIMED_AT)) / MS_PER_MINUTE;
    for (let minute = 1; minute < steps; minute += 1) {
      const at = shiftIso(CLAIMED_AT, minute * MS_PER_MINUTE);
      const next = gradeAt(at);
      expectPending(next, at);
      receipt = transition(receipt, { event: 'regrade', next });
      expect(receipt).toStrictEqual(next);
    }
    const lastBefore = gradeAt(shiftIso(GRACE_AT, -MS_PER_SECOND));
    expectPending(lastBefore, shiftIso(GRACE_AT, -MS_PER_SECOND));
    receipt = transition(receipt, { event: 'regrade', next: lastBefore });

    const final = gradeAt(GRACE_AT);
    expect(final).toMatchObject({
      state: 'FINAL',
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      finalAt: GRACE_AT,
    });
    expect(final.id).toBe(receipt.id);
    receipt = transition(receipt, { event: 'regrade', next: final });
    expect(receipt).toStrictEqual(final);

    const later = gradeAt(shiftIso(GRACE_AT, MS_PER_HOUR));
    expect(later.state).toBe('FINAL');
    expectRefusedRegrade(receipt, later);
    expectRefusedRegrade(receipt, gradeAt(shiftIso(GRACE_AT, -MS_PER_MINUTE)));
    expect(receipt).toStrictEqual(final);
  });

  it('a late evaluation over a stale sync stays PENDING: grace is measured by the sync, not the clock', () => {
    const stale = shiftIso(GRACE_AT, -MS_PER_MINUTE);
    const at = shiftIso(GRACE_AT, 2 * MS_PER_HOUR);
    expectPending(gradeAt(at, stale), at);
  });
});

describe('grace: an override and its revert never regrade a FINAL receipt', () => {
  it('a FINAL NOT_FOUND can be overridden and reverted, and is still never regraded', () => {
    const final = gradeAt(GRACE_AT);
    const event = {
      event: 'override',
      grade: 'VERIFIED',
      reason: 'Sent it from my phone',
      at: GRACE_AT,
    } as const;
    const overridden = transition(final, event);
    expect(overridden).toMatchObject({ state: 'USER_OVERRIDDEN', grade: 'NOT_FOUND', finalAt: GRACE_AT });
    const reverted = transition(overridden, { event: 'revert', at: GRACE_AT });
    const { reverted: kept, ...rest } = reverted;
    expect(rest).toStrictEqual(final);
    expect(kept).toEqual([
      {
        grade: 'VERIFIED',
        at: GRACE_AT,
        revertedAt: GRACE_AT,
        previousState: 'FINAL',
        computedAt: final.computedAt,
        observationIds: final.observationIds,
      },
    ]);
    expectRefusedRegrade(reverted, gradeAt(shiftIso(GRACE_AT, MS_PER_HOUR)));
  });
});

describe('grace: never before, at any second', () => {
  const window = instantMs(GRACE_AT) - instantMs(CLAIMED_AT);

  it('any fresh sync in [claimedAt, grace) is PENDING; any in [grace, grace + 7 days] is FINAL NOT_FOUND', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: window / MS_PER_SECOND - 1 }),
        fc.integer({ min: 0, max: (7 * 24 * MS_PER_HOUR) / MS_PER_SECOND }),
        (beforeS, afterS) => {
          const before = shiftIso(CLAIMED_AT, beforeS * MS_PER_SECOND);
          expectPending(gradeAt(before), before);
          const after = shiftIso(GRACE_AT, afterS * MS_PER_SECOND);
          expect(gradeAt(after)).toMatchObject({ state: 'FINAL', grade: 'NOT_FOUND', finalAt: after });
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
