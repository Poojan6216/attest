/**
 * Task 1.6 Done-when, part two, where only grace can hold a receipt back (docs/grading.md §6.1 graceElapsed, §8):
 * "a PENDING receipt with fresh coverage finalises to NOT_FOUND only after grace, never before".
 *
 * In state-grace.spec.ts an email claim's coverage becomes full at the same sync that ends grace (14:48: the
 * window ends at end(p,t) + afterClaimMin, and afterClaimMin > graceMin), so a grace bug can hide behind the
 * coverage rule. Here coverage is fresh AND full well before grace, so a NOT_FOUND before grace would be a grace
 * bug and nothing else:
 *  - an email claim under a policy with graceMin 60 > afterClaimMin 45: coverage is full from the 14:48 sync,
 *    grace is end(p,t) + max(60, 45) = 15:03.
 * A calendar claim whose view shows the whole ±calendarDays window from the first sync is walked too: grace is
 * end(p,t) + graceMin = 14:03 + 30 = 14:33 (calendar types do not wait for afterClaimMin). Since v1.10 (§6.1) its
 * coverage is full only from that same sync: a view last synced before end(p,t) + graceMin is capped
 * (`coverage.changes_unfollowed`), because it cannot say the event was never created.
 * Each case walks minute by minute: PENDING by rule `pending` until grace (installed by regrade), FINAL NOT_FOUND
 * at grace, and then a regrade of the FINAL receipt is refused.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { coverageLevel } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import type { Claim, Coverage, Receipt } from '../../../src/core/schema';
import { IllegalTransitionError, transition } from '../../../src/core/state';
import { buildClaim, buildCoverage, buildGrant, mergePatch } from '../../golden/load';
import { instantMs, shiftIso } from '../../golden/time';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const CLAIMED_AT = '2026-10-06T14:02:00-04:00';
const GRANT = buildGrant({ agent: 'muse' }, CLAIMED_AT);

interface GraceCase {
  readonly label: string;
  readonly claim: Claim;
  readonly policy: Policy;
  /** One fresh observer pass that synced at `syncedAt`, evaluated at `syncedAt`. */
  readonly coverageAt: (syncedAt: string) => Coverage;
  /** The first sync whose coverage of the claim window is full (computed by hand from §4.1). */
  readonly fullFrom: string;
  /** The grace instant (computed by hand from §6.1). */
  readonly graceAt: string;
}

const CALENDAR: GraceCase = {
  label: 'calendar claim, calendar view covering the whole window from the first sync',
  claim: buildClaim({
    ref: 'c2',
    agent: 'muse',
    type: 'calendar.created',
    subjectHint: 'Q3 review',
    claimedAt: CLAIMED_AT,
    targetAt: '2026-10-08T14:00:00-04:00',
  }),
  policy: DEFAULT_POLICY,
  coverageAt: (syncedAt) =>
    buildCoverage(
      [
        {
          source: 'gcal.event',
          lastSyncAt: syncedAt,
          windowStart: '2026-10-01T00:00:00-04:00',
          windowEnd: '2026-11-01T00:00:00-04:00',
          accountHash: 'acct-a',
          allCalendars: true,
        },
      ],
      syncedAt,
    ),
  // v1.10 (§6.1): a view synced before end(p,t) + graceMin is capped, so full only from the grace sync.
  fullFrom: '2026-10-06T14:33:00-04:00',
  graceAt: '2026-10-06T14:33:00-04:00',
};

const EMAIL_LONG_GRACE: GraceCase = {
  label: 'email claim, graceMin 60 > afterClaimMin 45',
  claim: buildClaim({
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: CLAIMED_AT,
  }),
  policy: loadPolicy(mergePatch(defaultPolicyJson, { windows: { graceMin: 60 } })),
  coverageAt: (syncedAt) =>
    buildCoverage(
      [
        {
          source: 'gmail.sent',
          lastSyncAt: syncedAt,
          windowStart: '2026-10-06T12:00:00-04:00',
          windowEnd: syncedAt,
          accountHash: 'acct-a',
        },
      ],
      syncedAt,
    ),
  fullFrom: '2026-10-06T14:48:00-04:00',
  graceAt: '2026-10-06T15:03:00-04:00',
};

const CASES = [CALENDAR, EMAIL_LONG_GRACE];

function gradeAt(c: GraceCase, syncedAt: string): Receipt {
  return grade(c.claim, [], GRANT, c.policy, c.coverageAt(syncedAt), { priorSpendCents: 0 });
}

const coverageAt = (c: GraceCase, syncedAt: string): string =>
  coverageLevel(c.claim, GRANT, c.coverageAt(syncedAt), c.policy).level;

/** PENDING by rule `pending`, waiting for grace; and, once the window is fully covered, coverage says `full`. */
function expectPendingDespiteCoverage(c: GraceCase, receipt: Receipt, syncedAt: string): void {
  expect(receipt).toMatchObject({ state: 'PENDING', ruleId: 'pending', grade: 'UNVERIFIABLE' });
  expect(receipt.computedAt).toBe(syncedAt);
  expect(receipt.finalAt).toBeUndefined();
  expect(receipt.reasons.map((reason) => reason.code)).toContain('grace.waiting');
  if (instantMs(syncedAt) >= instantMs(c.fullFrom)) expect(coverageAt(c, syncedAt)).toBe('full');
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

describe('grace, not coverage, holds a fully covered receipt at PENDING', () => {
  it.each([EMAIL_LONG_GRACE])('$label: coverage is full before grace', (c) => {
    expect(instantMs(c.fullFrom)).toBeLessThan(instantMs(c.graceAt));
    expect(coverageAt(c, c.fullFrom)).toBe('full');
    expect(coverageAt(c, shiftIso(c.graceAt, -MS_PER_SECOND))).toBe('full');
  });

  const walk = '$label: PENDING at every sync before grace, FINAL NOT_FOUND at grace';
  it.each(CASES)(walk, (c) => {
    let receipt = gradeAt(c, CLAIMED_AT);
    expectPendingDespiteCoverage(c, receipt, CLAIMED_AT);
    const steps = (instantMs(c.graceAt) - instantMs(CLAIMED_AT)) / MS_PER_MINUTE;
    const syncs = Array.from({ length: steps - 1 }, (_, i) => shiftIso(CLAIMED_AT, (i + 1) * MS_PER_MINUTE));
    for (const at of [...syncs, shiftIso(c.graceAt, -MS_PER_SECOND)]) {
      const next = gradeAt(c, at);
      expectPendingDespiteCoverage(c, next, at);
      receipt = transition(receipt, { event: 'regrade', next });
      expect(receipt).toStrictEqual(next);
    }

    const final = gradeAt(c, c.graceAt);
    expect(final).toMatchObject({
      id: receipt.id,
      state: 'FINAL',
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      finalAt: c.graceAt,
    });
    receipt = transition(receipt, { event: 'regrade', next: final });
    expect(receipt).toStrictEqual(final);
    expectRefusedRegrade(receipt, gradeAt(c, shiftIso(c.graceAt, MS_PER_HOUR)));
    expect(receipt).toStrictEqual(final);
  });

  it('property: any sync in [claimedAt, grace) is PENDING; any in [grace, grace + 7 days] is FINAL NOT_FOUND', () => {
    const arb = fc.constantFrom(...CASES).chain((c) =>
      fc.record({
        c: fc.constant(c),
        beforeS: fc.integer({
          min: 0,
          max: (instantMs(c.graceAt) - instantMs(CLAIMED_AT)) / MS_PER_SECOND - 1,
        }),
        afterS: fc.integer({ min: 0, max: (7 * 24 * MS_PER_HOUR) / MS_PER_SECOND }),
      }),
    );
    fc.assert(
      fc.property(arb, ({ c, beforeS, afterS }) => {
        const before = shiftIso(CLAIMED_AT, beforeS * MS_PER_SECOND);
        expectPendingDespiteCoverage(c, gradeAt(c, before), before);
        const after = shiftIso(c.graceAt, afterS * MS_PER_SECOND);
        expect(gradeAt(c, after)).toMatchObject({ state: 'FINAL', grade: 'NOT_FOUND', finalAt: after });
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('a calendar claim: coverage and grace arrive at the same sync (§6.1 v1.10)', () => {
  it('a view synced before end(p,t) + graceMin is capped, and full from that sync', () => {
    const c = CALENDAR;
    for (const at of [CLAIMED_AT, shiftIso(c.graceAt, -1)]) {
      const result = coverageLevel(c.claim, GRANT, c.coverageAt(at), c.policy);
      expect(result).toMatchObject({
        level: 'partial',
        capReasons: [{ code: 'coverage.changes_unfollowed', source: 'gcal.event' }],
      });
    }
    expect(coverageAt(c, c.graceAt)).toBe('full');
  });
});
