/**
 * Clock repairs in grading (docs/grading.md §3 and §6.1, v1.16; S2-SIM2-1; Decisions [3.17]; Hard Rules 4, 5): what
 * core does with `Coverage.repairs`.
 *  - `calendarBound` marks a `calendar.created` claim whose first-seen bound, start(p,t) − beforeClaimMin, lies in a
 *    span (both ends included); a claim of any other type, and one whose bound lies outside every span, is not.
 *  - Through `grade`: such a claim is never NOT_FOUND (`coverage.clock_repaired` on every gcal.event entry), a row
 *    first seen at or after its bound still verifies it, and a claim whose bound lies outside every span is NOT_FOUND
 *    as before.
 *  - The visible coverage keeps the repairs found by `evaluatedAt` (`from` at or before it), leaves `repairs` out
 *    when none is, and is never stale when the input's repairs are edited in place.
 *  - `coverageHash` reads the repairs as a set, and an empty list as none: every v1.15 hash is unchanged.
 *
 * Times are 2026-10-06 in −04:00. The claim is at 11:05 (minute precision; first-seen bound 11:03) for an event on
 * 10-07 at 14:00; the October view of every calendar is synced at 11:50, after its grace sync, 11:36.
 */
import { describe, expect, it } from 'vitest';

import { calendarBound } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { visibleCoverage } from '../../../src/core/grade-best';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { coverageHash } from '../../../src/core/receipt';
import { type Claim, type Coverage, IsoTs, type Observation, type Receipt } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage, ScenarioObservation } from '../../golden/scenario-schema';
import defaultPolicyJson from '../../../../policy/default.json';
import type { Mutable } from './receipt-fixtures';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('12:00');
const span = (from: string, to: string) => ({ from: IsoTs.parse(at(from)), to: IsoTs.parse(at(to)) });
const JUMP = span('09:10', '12:05');

function claimOf(type = 'calendar.created', over: Record<string, unknown> = {}): Claim {
  const claim = { ref: 'c1', agent: 'muse', type, subjectHint: 'Design review', claimedAt: at('11:05') };
  return buildClaim(ScenarioClaim.parse({ ...claim, targetAt: at('14:00', '07'), ...over }));
}

const OCTOBER: ScenarioCoverage = {
  source: 'gcal.event',
  lastSyncAt: at('11:50'),
  windowStart: at('00:00', '01'),
  windowEnd: '2026-11-01T00:00:00-04:00',
  accountHash: 'acct-a',
  allCalendars: true,
  changesSince: at('08:00'),
};

const GRANT = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);

function row(observedAt: string): Observation {
  const fields = { ref: 'o1', source: 'gcal.event', type: 'calendar.created', subjectHint: 'Design review' };
  const parsed = ScenarioObservation.parse({ ...fields, occurredAt: at('14:00', '07'), observedAt });
  return buildObservation(parsed, [OCTOBER], EVAL, PolicyView.parse(defaultPolicyJson));
}

function gradeWith(
  repairs: readonly { from: string; to: string }[],
  candidates: Observation[] = [],
): Receipt {
  const coverage = buildCoverage([OCTOBER], EVAL, repairs);
  return grade(claimOf(), candidates, GRANT, DEFAULT_POLICY, coverage, { priorSpendCents: 0 });
}

const codes = (receipt: Receipt): string[] => receipt.reasons.map((reason) => reason.code);

describe('calendarBound: a claim whose first-seen bound lies in a repair’s span (§6.1 v1.16)', () => {
  it('marks a calendar.created claim whose bound is in a span, both ends included', () => {
    const repaired = (repairs: Coverage['repairs']) =>
      calendarBound(claimOf(), DEFAULT_POLICY, repairs)?.repaired;
    expect(repaired([JUMP])).toBe(true);
    expect(repaired([span('11:03', '11:20')])).toBe(true);
    expect(repaired([span('08:00', '11:03')])).toBe(true);
    expect(repaired([span('11:04', '12:05'), span('08:00', '11:02')])).toBe(false);
    expect(repaired([])).toBe(false);
    expect(repaired(undefined)).toBe(false);
  });

  it('never marks a change claim (no first-seen rule) or a day-precision claim whose day began before the span', () => {
    for (const type of ['calendar.updated', 'calendar.deleted']) {
      expect(calendarBound(claimOf(type), DEFAULT_POLICY, [JUMP])).toMatchObject({
        change: true,
        repaired: false,
      });
    }
    const day = claimOf('calendar.created', { claimedAtPrecision: 'day', claimedAt: at('00:00') });
    expect(calendarBound(day, DEFAULT_POLICY, [JUMP])?.repaired).toBe(false);
  });
});

describe('grade with a repair (S2-SIM2-1)', () => {
  it('a claim whose bound is in a span is partial_coverage with coverage.clock_repaired, never NOT_FOUND', () => {
    const receipt = gradeWith([JUMP]);
    expect([receipt.grade, receipt.ruleId, receipt.state]).toEqual([
      'UNVERIFIABLE',
      'partial_coverage',
      'PENDING',
    ]);
    expect(codes(receipt)).toEqual(['coverage.partial', 'coverage.clock_repaired', 'match.none']);
    expect(receipt.reasons[1]).toEqual({ code: 'coverage.clock_repaired', params: { source: 'gcal.event' } });
  });

  it('a row first seen at or after the bound still verifies; a span after the bound caps nothing', () => {
    const verified = gradeWith([JUMP], [row(at('11:20'))]);
    expect([verified.grade, verified.state]).toEqual(['VERIFIED', 'FINAL']);
    for (const repairs of [[], [span('11:10', '12:05')]]) {
      const receipt = gradeWith(repairs);
      expect([receipt.grade, receipt.ruleId, codes(receipt)]).toEqual([
        'NOT_FOUND',
        'not_found',
        ['match.none'],
      ]);
    }
  });
});

describe('the visible coverage keeps the repairs found by evaluatedAt (§3)', () => {
  it('drops a repair found after it, and leaves repairs out when none is found by then', () => {
    const later = span('12:30', '13:00');
    expect(visibleCoverage(buildCoverage([OCTOBER], EVAL, [JUMP, later])).repairs).toEqual([JUMP]);
    expect('repairs' in visibleCoverage(buildCoverage([OCTOBER], EVAL, [later]))).toBe(false);
    expect('repairs' in visibleCoverage(buildCoverage([OCTOBER], EVAL))).toBe(false);
  });

  it('is never stale: repairs pushed, edited or replaced in place are filtered again', () => {
    const coverage: Mutable<Coverage> = { ...buildCoverage([OCTOBER], EVAL), repairs: [] };
    expect(visibleCoverage(coverage).repairs).toBeUndefined();
    const repairs = [{ ...JUMP }];
    coverage.repairs = repairs;
    expect(visibleCoverage(coverage).repairs).toEqual([JUMP]);
    repairs.push(span('10:00', '10:30'));
    expect(visibleCoverage(coverage).repairs).toEqual([JUMP, span('10:00', '10:30')]);
    repairs[0] = span('12:01', '12:05');
    expect(visibleCoverage(coverage).repairs).toEqual([span('10:00', '10:30')]);
  });
});

describe('coverageHash reads the repairs as a set (§3)', () => {
  it('an empty list hashes as none; order and repetition never count; another span does', () => {
    const bare = buildCoverage([OCTOBER], EVAL);
    const other = span('10:00', '10:30');
    expect(coverageHash({ ...bare, repairs: [] })).toBe(coverageHash(bare));
    expect(coverageHash({ ...bare, repairs: [JUMP, other] })).toBe(
      coverageHash({ ...bare, repairs: [other, JUMP, other] }),
    );
    expect(coverageHash({ ...bare, repairs: [JUMP] })).not.toBe(coverageHash(bare));
    expect(coverageHash({ ...bare, repairs: [JUMP] })).not.toBe(coverageHash({ ...bare, repairs: [other] }));
  });
});
