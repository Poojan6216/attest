/**
 * Pins for the v1.9 coverage rules that calendar-changes.spec.ts leaves loose (docs/grading.md v1.9 §3, §6.1, §15;
 * Sprint 2 wave C interface 2):
 *
 *  - `coverageHash` (§3): an entry without `changesSince` hashes exactly as the v1.8 code hashed it (a vector computed
 *    with the core of commit 193d7da), so every stored receipt still replays; and the v1.9 order of entries that
 *    differ only in `changesSince` is pinned by a vector, so a change to the sort is a reviewed hash change.
 *  - The cap order (§15 table order): `coverage.changes_unfollowed` (a created claim's stale view, v1.10) and
 *    `coverage.change_unprovable` (every entry of a change claim, v1.11) come right after `coverage.calendars_hidden`.
 *  - The stale-view cap reads the entry's `lastSyncAt` as it is now, even when the entry object is edited in place.
 *  - The change cap is a `gcal.event` fact: under a policy that also lists another source for a change type, that
 *    source's entries are never capped by it.
 *
 * Times are 2026-10-06 in −04:00 unless a day is given. The deletion claim is at 14:02 (minute precision) for an
 * event on 10-08 at 14:00: window [10-05 14:00, 10-11 14:00], change span [14:00, 14:33].
 */
import { describe, expect, it } from 'vitest';

import { coverageLevel } from '../../../src/core/conditions';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { coverageHash } from '../../../src/core/receipt-hash';
import { type Claim, Coverage } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage } from '../../golden/scenario-schema';
import defaultPolicyJson from '../../../../policy/default.json';

const EVAL = '2026-10-06T16:00:00-04:00';
const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const hex = (digit: string): string => digit.repeat(64);

const claimOf = (type: string): Claim =>
  buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type,
      subjectHint: 'Board dinner',
      claimedAt: at('14:02'),
      targetAt: at('14:00', '08'),
    }),
  );
const deletion = claimOf('calendar.deleted');
const creation = claimOf('calendar.created');

/** A whole-week view of every calendar, followed since 09:00 and synced at 15:00. */
const week = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gcal.event',
  lastSyncAt: at('15:00'),
  windowStart: at('00:00', '04'),
  windowEnd: at('00:00', '12'),
  accountHash: 'acct-a',
  allCalendars: true,
  changesSince: at('09:00'),
  ...over,
});
const without = (entry: ScenarioCoverage, key: keyof ScenarioCoverage): ScenarioCoverage =>
  Object.fromEntries(Object.entries(entry).filter(([k]) => k !== key)) as ScenarioCoverage;

describe('coverageHash with changesSince (§3)', () => {
  const calendar = {
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt: at('15:00'),
    windowStart: at('00:00', '04'),
    windowEnd: at('00:00', '12'),
    accountHash: hex('a'),
    allCalendars: true,
  } as const;

  it('hashes entries without changesSince exactly as the v1.8 code did (replay of stored receipts)', () => {
    const observers = [
      calendar,
      { ...calendar, lastSyncAt: at('14:00'), accountHash: hex('b'), allCalendars: undefined },
      { ...calendar, lastSyncAt: at('14:00'), accountHash: undefined, allCalendars: undefined },
      {
        observerId: 'gmail.sent',
        source: 'gmail.sent',
        lastSyncAt: at('15:30'),
        windowStart: at('09:00'),
        windowEnd: at('15:30'),
        accountHash: hex('a'),
      },
      {
        observerId: 'gmail.receipt',
        source: 'gmail.receipt',
        lastSyncAt: at('14:10'),
        windowStart: at('14:03'),
        windowEnd: at('14:03'),
        accountHash: hex('a'),
      },
      calendar,
    ];
    const coverage = Coverage.parse({ evaluatedAt: EVAL, observers });
    // Computed with src/core at commit 193d7da (v1.8, before changesSince existed).
    expect(coverageHash(coverage)).toBe('b9fc239ddea05d10607c3d5c6dff86c743395c98487026f366d179008c5ee6de');
  });

  it('binds changesSince and orders entries that differ only in it (a pinned v1.9 vector)', () => {
    const observers = [
      { ...calendar, changesSince: at('10:00') },
      calendar,
      { ...calendar, changesSince: at('09:00') },
      { ...calendar, changesSince: at('09:00') },
    ];
    const hashOf = (entries: readonly object[]) =>
      coverageHash(Coverage.parse({ evaluatedAt: EVAL, observers: entries }));
    const pinned = 'a8691fe4dc6d46a222e1f739d52a8d06815762f117ed61f3fa804cdd91197e7d';
    expect(hashOf(observers)).toBe(pinned);
    expect(hashOf([...observers].reverse())).toBe(pinned);
    expect(hashOf(observers.slice(0, 3))).toBe(pinned);
  });
});

describe('the calendar caps in §15 order (§6.1 v1.10, v1.11)', () => {
  const unbound = buildGrant({ agent: 'muse' }, EVAL);
  const caps = (claim: Claim, entries: readonly ScenarioCoverage[]) =>
    coverageLevel(claim, unbound, buildCoverage(entries, EVAL), DEFAULT_POLICY).capReasons.map(
      (reason) => reason.code,
    );
  const hidden = without(without(week(), 'allCalendars'), 'changesSince');
  const other = week({ accountHash: 'acct-b' });
  const nameless = without(week(), 'accountHash');

  it('lists change_unprovable right after calendars_hidden, before the account caps', () => {
    expect(caps(deletion, [nameless, other, hidden])).toEqual([
      'coverage.calendars_hidden',
      'coverage.change_unprovable',
      'coverage.multiple_accounts',
      'coverage.no_account',
    ]);
  });

  it('lists a created claim stale view (changes_unfollowed) in the same place', () => {
    const stale = (entry: ScenarioCoverage) => ({ ...entry, lastSyncAt: at('14:10') });
    expect(caps(creation, [stale(nameless), stale(other), stale(hidden)])).toEqual([
      'coverage.calendars_hidden',
      'coverage.changes_unfollowed',
      'coverage.multiple_accounts',
      'coverage.no_account',
    ]);
  });
});

describe('the stale-view cap reads the entry as it holds it now (§6.1 v1.10)', () => {
  it('reads lastSyncAt as the entry holds it now, when the same object is edited in place', () => {
    const grant = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);
    const coverage = buildCoverage([week()], EVAL);
    const [entry] = coverage.observers;
    if (entry === undefined) throw new Error('one entry expected');
    expect(coverageLevel(creation, grant, coverage, DEFAULT_POLICY).level).toBe('full');
    (entry as { lastSyncAt: string }).lastSyncAt = at('14:10');
    expect(coverageLevel(creation, grant, coverage, DEFAULT_POLICY)).toMatchObject({
      level: 'partial',
      capReasons: [{ code: 'coverage.changes_unfollowed', source: 'gcal.event' }],
    });
    (entry as { lastSyncAt: string }).lastSyncAt = at('15:00');
    expect(coverageLevel(creation, grant, coverage, DEFAULT_POLICY).level).toBe('full');
  });
});

describe('the change_unprovable cap is a gcal.event fact (§6.1 v1.11)', () => {
  it('caps gcal.event entries only, under a policy that lists another source for a change type', () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      sourcesByType: { ...defaultPolicyJson.sourcesByType, 'calendar.deleted': ['gcal.event', 'gmail.sent'] },
    });
    const grant = buildGrant(
      { agent: 'muse', accounts: { 'gcal.event': ['acct-a'], 'gmail.sent': ['acct-a'] } },
      EVAL,
    );
    const sent: ScenarioCoverage = {
      source: 'gmail.sent',
      lastSyncAt: at('15:00'),
      windowStart: at('00:00', '04'),
      windowEnd: at('00:00', '12'),
      accountHash: 'acct-a',
    };
    const result = coverageLevel(deletion, grant, buildCoverage([week(), sent], EVAL), policy);
    expect(result.level).toBe('partial');
    expect(result.sources).toEqual([
      { source: 'gcal.event', level: 'partial', caps: ['coverage.change_unprovable'] },
      { source: 'gmail.sent', level: 'full', caps: [] },
    ]);
    expect(result.capReasons).toEqual([{ code: 'coverage.change_unprovable', source: 'gcal.event' }]);
  });
});
