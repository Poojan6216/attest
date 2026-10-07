/**
 * A calendar view looked at before a claim's grace sync (docs/grading.md v1.10 §6.1; Sprint 2 wave D decision 2): a
 * `gcal.event` entry counts towards full coverage of a `calendar.created` claim only if its `lastSyncAt` is at or
 * after `end(p,t) + graceMin`; any other overlapping entry is capped with `coverage.changes_unfollowed`. A view looked
 * at before the claimed event could have been created cannot say it never was (Hard Rule 5). A `calendar.updated` or
 * `calendar.deleted` claim is never fully covered at all (v1.11: every entry capped `coverage.change_unprovable`).
 *
 *  - `calendarBound` (conditions.ts): the bound per claim type, null for a claim of another type.
 *  - The cap is exact to the millisecond, per entry (a stale view and a fresh one are never pieced together), and a
 *    `gcal.event` fact (another source a custom policy lists is never capped by it).
 *  - Through `grade`: a stale view never yields NOT_FOUND (the C1 verifier's probe: an October view synced at 14:00,
 *    a November view synced at 14:40, a created claim at 14:02 for October 15); a fresh one still does; and a row the
 *    stale view saw still verifies, FINAL once some view synced at the grace sync.
 *
 * Times are 2026-10-06 in −04:00 unless a day is given. The claim is at 14:02 (minute precision) for an event on
 * 10-15 at 10:00: window [10-12 10:00, 10-18 10:00], grace sync 14:33.
 */
import { describe, expect, it } from 'vitest';

import { calendarBound, coverageLevel, graceElapsed } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import type { Claim, Observation, Receipt } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage, ScenarioObservation } from '../../golden/scenario-schema';
import defaultPolicyJson from '../../../../policy/default.json';

const EVAL = '2026-10-06T15:00:00-04:00';
const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const ms = (iso: string): number => Date.parse(iso);
const VIEW = PolicyView.parse(defaultPolicyJson);
const STALE_CAP = { code: 'coverage.changes_unfollowed', source: 'gcal.event' };

function claimOf(type: string, over: Record<string, unknown> = {}): Claim {
  return buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type,
      subjectHint: 'Q4 planning',
      claimedAt: at('14:02'),
      targetAt: at('10:00', '15'),
      ...over,
    }),
  );
}

/** The October view of every calendar, bound to acct-a, followed since 09:00 and synced at `sync`. */
const october = (sync: string, over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gcal.event',
  lastSyncAt: sync,
  windowStart: at('00:00', '01'),
  windowEnd: '2026-11-01T00:00:00-04:00',
  accountHash: 'acct-a',
  allCalendars: true,
  changesSince: at('09:00'),
  ...over,
});
/** The November view, first looked at 14:35 and synced at 14:40: after every grace sync below, overlapping none. */
const NOVEMBER: ScenarioCoverage = {
  source: 'gcal.event',
  lastSyncAt: at('14:40'),
  windowStart: '2026-11-01T00:00:00-04:00',
  windowEnd: '2026-12-01T00:00:00-05:00',
  accountHash: 'acct-a',
  allCalendars: true,
  changesSince: at('14:35'),
};

const grant = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);
const level = (claim: Claim, entries: readonly ScenarioCoverage[]) =>
  coverageLevel(claim, grant, buildCoverage(entries, EVAL), DEFAULT_POLICY);
const outcome = (receipt: Receipt) => [receipt.grade, receipt.ruleId, receipt.state];
const gradeWith = (claim: Claim, entries: readonly ScenarioCoverage[], candidates: Observation[] = []) =>
  grade(claim, candidates, grant, DEFAULT_POLICY, buildCoverage(entries, EVAL), { priorSpendCents: 0 });

describe('calendarBound (§6.1 v1.10, v1.11)', () => {
  it('asks every calendar claim for a sync at end(p,t) + graceMin, and marks a change claim', () => {
    expect(calendarBound(claimOf('calendar.created'), DEFAULT_POLICY)).toEqual({
      syncMs: ms(at('14:33')),
      change: false,
    });
    for (const type of ['calendar.updated', 'calendar.deleted']) {
      expect(calendarBound(claimOf(type), DEFAULT_POLICY)).toEqual({ syncMs: ms(at('14:33')), change: true });
    }
    const hour = claimOf('calendar.created', { claimedAt: at('14:00'), claimedAtPrecision: 'hour' });
    expect(calendarBound(hour, DEFAULT_POLICY)).toEqual({ syncMs: ms(at('15:30')), change: false });
    expect(calendarBound(claimOf('email.sent', { counterparty: 'p@x.example' }), DEFAULT_POLICY)).toBeNull();
  });
});

describe('a calendar view synced before the grace sync is capped (§6.1 v1.10)', () => {
  const created = claimOf('calendar.created');

  it('caps a created claim view synced 1 ms before end(p,t) + graceMin; at it exactly the view is full', () => {
    expect(level(created, [october('2026-10-06T14:32:59.999-04:00')])).toMatchObject({
      level: 'partial',
      capReasons: [STALE_CAP],
    });
    expect(level(created, [october(at('14:33'))])).toMatchObject({ level: 'full', capReasons: [] });
  });

  it('caps a view without changesSince the same way: a created claim reads first looks too', () => {
    const plain = Object.fromEntries(
      Object.entries(october(at('14:00'))).filter(([key]) => key !== 'changesSince'),
    ) as ScenarioCoverage;
    expect(level(created, [plain])).toMatchObject({ level: 'partial', capReasons: [STALE_CAP] });
    expect(level(created, [{ ...plain, lastSyncAt: at('14:40') }]).level).toBe('full');
  });

  it('never pieces full coverage from a stale view of one part of the window and a fresh view of the rest', () => {
    const early = october(at('14:00'), { windowEnd: at('00:00', '15') });
    const late = october(at('14:40'), { windowStart: at('00:00', '15') });
    expect(level(created, [early, late])).toMatchObject({ level: 'partial', capReasons: [STALE_CAP] });
    expect(level(created, [early, late, october(at('14:40'))]).level).toBe('full');
  });
});

describe('which views the stale-view cap bounds, and grace (§6.1 v1.10, v1.14)', () => {
  const created = claimOf('calendar.created');

  it('is a gcal.event fact: another source a custom policy lists for the type is never capped by it', () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      sourcesByType: { ...defaultPolicyJson.sourcesByType, 'calendar.created': ['gcal.event', 'gmail.sent'] },
    });
    const both = buildGrant(
      { agent: 'muse', accounts: { 'gcal.event': ['acct-a'], 'gmail.sent': ['acct-a'] } },
      EVAL,
    );
    // Synced after the claim's own grace sync (14:48 for a non-calendar source), so only the calendar bound could
    // cap it; v1.14's cap on an earlier Sent view is checked below.
    const sent = (lastSyncAt: string): ScenarioCoverage => ({
      source: 'gmail.sent',
      lastSyncAt,
      windowStart: at('00:00', '01'),
      windowEnd: '2026-11-01T00:00:00-04:00',
      accountHash: 'acct-a',
    });
    const result = coverageLevel(
      created,
      both,
      buildCoverage([october(at('14:40')), sent(at('14:50'))], EVAL),
      policy,
    );
    expect(result).toMatchObject({ level: 'full', capReasons: [] });
    const early = coverageLevel(
      created,
      both,
      buildCoverage([october(at('14:40')), sent(at('14:00'))], EVAL),
      policy,
    );
    expect(early.capReasons).toEqual([{ code: 'coverage.list_unsettled', source: 'gmail.sent' }]);
  });

  it('still counts a capped view for grace: the observer synced', () => {
    const coverage = buildCoverage([october(at('14:00')), NOVEMBER], EVAL);
    expect(graceElapsed(created, grant, coverage, DEFAULT_POLICY)).toBe(true);
    expect(level(created, [october(at('14:00')), NOVEMBER]).level).toBe('partial');
  });
});

describe('a stale view never yields NOT_FOUND for a calendar claim; a fresh one still can (§6.1, Hard Rule 5)', () => {
  it.each([
    ['calendar.created', 'coverage.changes_unfollowed'],
    ['calendar.updated', 'coverage.change_unprovable'],
    ['calendar.deleted', 'coverage.change_unprovable'],
  ])(
    '%s: the October view synced at 14:00, November at 14:40 → partial_coverage, PENDING, %s',
    (type, cap) => {
      const receipt = gradeWith(claimOf(type), [october(at('14:00')), NOVEMBER]);
      expect(outcome(receipt)).toEqual(['UNVERIFIABLE', 'partial_coverage', 'PENDING']);
      expect(receipt.reasons.map((reason) => reason.code)).toEqual(['coverage.partial', cap, 'match.none']);
    },
  );

  it('calendar.created: the October view synced again at 14:40 → NOT_FOUND, FINAL', () => {
    const receipt = gradeWith(claimOf('calendar.created'), [october(at('14:40')), NOVEMBER]);
    expect(outcome(receipt)).toEqual(['NOT_FOUND', 'not_found', 'FINAL']);
  });

  it.each(['calendar.updated', 'calendar.deleted'])(
    '%s: the October view synced again at 14:40 is still partial_coverage, PENDING (v1.11: never NOT_FOUND)',
    (type) => {
      const receipt = gradeWith(claimOf(type), [october(at('14:40')), NOVEMBER]);
      expect(outcome(receipt)).toEqual(['UNVERIFIABLE', 'partial_coverage', 'PENDING']);
      expect(receipt.reasons.map((reason) => reason.code)).toEqual([
        'coverage.partial',
        'coverage.change_unprovable',
        'match.none',
      ]);
    },
  );

  it('lets a row the stale view saw verify a created claim, FINAL once some view synced at the grace sync', () => {
    const row = buildObservation(
      ScenarioObservation.parse({
        ref: 'o1',
        source: 'gcal.event',
        type: 'calendar.created',
        subjectHint: 'Q4 planning',
        occurredAt: at('10:00', '15'),
        observedAt: at('14:05'),
      }),
      [],
      EVAL,
      VIEW,
    );
    const view = october(at('14:05'));
    const created = claimOf('calendar.created');
    expect(outcome(gradeWith(created, [view], [row]))).toEqual(['VERIFIED', 'verified', 'PENDING']);
    expect(outcome(gradeWith(created, [view, NOVEMBER], [row]))).toEqual(['VERIFIED', 'verified', 'FINAL']);
  });
});
