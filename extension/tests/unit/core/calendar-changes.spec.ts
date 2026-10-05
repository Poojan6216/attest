/**
 * The calendar's followed changes (docs/grading.md v1.9 §3, §6.1, §7; Sprint 2 wave C interfaces 2 and 7; v1.11).
 *
 *  - `ObserverCoverage.changesSince`: gcal.event only, never after `lastSyncAt`, part of `coverageHash` only when set.
 *  - Coverage (§6.1 v1.11): a `calendar.updated` or `calendar.deleted` claim counts no gcal.event entry towards full
 *    coverage, followed or not (`coverage.change_unprovable`): a snapshot reader cannot show a change was never made
 *    between two looks. A change row still verifies. `changesSince` is read for orphans only. A `calendar.created`
 *    claim reads any entry synced at or after its grace sync.
 *  - Orphans (§3, §7): a gcal.event row is an orphan candidate only if a covering entry followed changes from strictly
 *    before its first sighting through it, and no covering entry may have found it already there (one that began
 *    comparing at that first sighting, or one that compared nothing and synced at or after it).
 *
 * Times are 2026-10-06 in −04:00 unless a day is given. The deletion claim used throughout is at 14:02 (minute
 * precision) for an event on 10-08 at 14:00: window [10-05 14:00, 10-11 14:00], change span [14:00, 14:33].
 */
import { describe, expect, it } from 'vitest';

import { isOrphanCandidate, seenWindows } from '../../../src/core/batch-orphans';
import { coverageLevel } from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { coverageHash } from '../../../src/core/receipt-hash';
import { type Claim, Coverage, type Observation, ObserverCoverage } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage, ScenarioObservation } from '../../golden/scenario-schema';
import defaultPolicyJson from '../../../../policy/default.json';

const EVAL = '2026-10-06T16:00:00-04:00';
const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const VIEW = PolicyView.parse(defaultPolicyJson);

/** A whole-week view of every calendar, bound to acct-a, followed since 09:00 and synced at 15:00. */
const view = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
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

function claimOf(type: string, over: Record<string, unknown> = {}): Claim {
  return buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type,
      subjectHint: 'Board dinner',
      claimedAt: at('14:02'),
      targetAt: at('14:00', '08'),
      ...over,
    }),
  );
}

const grant = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);
const level = (claim: Claim, entries: readonly ScenarioCoverage[]) =>
  coverageLevel(claim, grant, buildCoverage(entries, EVAL), DEFAULT_POLICY);

describe('ObserverCoverage.changesSince (§3)', () => {
  const entry = {
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt: at('15:00'),
    windowStart: at('00:00', '04'),
    windowEnd: at('00:00', '12'),
  };

  it('is a gcal.event fact at or before lastSyncAt', () => {
    expect(ObserverCoverage.safeParse({ ...entry, changesSince: at('09:00') }).success).toBe(true);
    expect(ObserverCoverage.safeParse({ ...entry, changesSince: at('15:00') }).success).toBe(true);
    const after = ObserverCoverage.safeParse({ ...entry, changesSince: '2026-10-06T15:00:00.001-04:00' });
    expect(after.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['changesSince'], 'must not be after lastSyncAt'],
    ]);
    const gmail = ObserverCoverage.safeParse({ ...entry, source: 'gmail.sent', changesSince: at('09:00') });
    expect(gmail.error?.issues.map((issue) => issue.path)).toEqual([['changesSince']]);
    expect(ObserverCoverage.safeParse({ ...entry, changesSince: 'yesterday' }).success).toBe(false);
  });

  it('is bound by coverageHash when set, and an entry without it hashes as before v1.9', () => {
    const plain = Coverage.parse({ evaluatedAt: EVAL, observers: [entry] });
    const followed = Coverage.parse({
      evaluatedAt: EVAL,
      observers: [{ ...entry, changesSince: at('09:00') }],
    });
    const later = Coverage.parse({ evaluatedAt: EVAL, observers: [{ ...entry, changesSince: at('10:00') }] });
    expect(new Set([coverageHash(plain), coverageHash(followed), coverageHash(later)]).size).toBe(3);
    // Canonical JSON drops an absent field: the v1.8 hash of the same entry.
    expect(coverageHash(plain)).toBe(coverageHash(Coverage.parse({ evaluatedAt: EVAL, observers: [entry] })));
  });
});

describe('a change claim is never fully covered (§6.1 v1.11)', () => {
  const deleted = claimOf('calendar.deleted');
  const capped = {
    level: 'partial',
    capReasons: [{ code: 'coverage.change_unprovable', source: 'gcal.event' }],
  };

  it('caps a whole, fresh view that followed changes over the old change span [14:00, 14:33]', () => {
    expect(level(deleted, [view()])).toMatchObject(capped);
    expect(level(claimOf('calendar.updated'), [view()])).toMatchObject(capped);
    expect(level(deleted, [view({ changesSince: at('14:00'), lastSyncAt: at('14:33') })])).toMatchObject(
      capped,
    );
  });

  it('caps every other entry with the same one code: no changesSince, a later chain, a stale sync', () => {
    expect(level(deleted, [without(view(), 'changesSince')])).toMatchObject(capped);
    expect(level(deleted, [view({ changesSince: '2026-10-06T14:00:00.001-04:00' })])).toMatchObject(capped);
    expect(level(deleted, [view({ lastSyncAt: '2026-10-06T14:32:59.999-04:00' })])).toMatchObject(capped);
    const before = view({ changesSince: at('09:00'), lastSyncAt: at('13:00') });
    const after = view({ changesSince: at('14:10'), lastSyncAt: at('15:00') });
    expect(level(deleted, [before, after])).toMatchObject(capped);
  });

  it('keeps the entry caps beside it, and is none when no entry overlaps the window', () => {
    const hidden = without(view(), 'allCalendars');
    expect(level(deleted, [hidden]).capReasons.map((cap) => cap.code)).toEqual([
      'coverage.calendars_hidden',
      'coverage.change_unprovable',
    ]);
    expect(
      level(deleted, [view({ windowStart: at('00:00', '20'), windowEnd: at('00:00', '27') })]),
    ).toMatchObject({
      level: 'none',
      capReasons: [],
    });
  });

  it('a created claim reads every entry, followed or not (§4.1 decides with first sightings)', () => {
    const created = claimOf('calendar.created');
    expect(level(created, [without(view(), 'changesSince')]).level).toBe('full');
    expect(level(created, [view({ changesSince: at('14:30') })]).level).toBe('full');
  });
});

/** A gcal.event row of the 'Board dinner' event (10-08 19:00), first seen at `seen`. */
function eventRow(seen: string, over: Record<string, unknown> = {}): Observation {
  return buildObservation(
    ScenarioObservation.parse({
      ref: 'o1',
      source: 'gcal.event',
      type: 'calendar.created',
      subjectHint: 'Board dinner',
      occurredAt: at('19:00', '08'),
      observedAt: seen,
      ...over,
    }),
    [],
    EVAL,
    VIEW,
  );
}
const orphan = (row: Observation, entries: readonly ScenarioCoverage[]): boolean =>
  isOrphanCandidate(row, seenWindows(buildCoverage(entries, EVAL)), DEFAULT_POLICY);

describe('a calendar orphan is a change Attest saw happen (§3, §7)', () => {
  it('is an orphan when a covering entry followed changes from before its first sighting through it', () => {
    expect(orphan(eventRow(at('14:05')), [view()])).toBe(true);
    expect(orphan(eventRow(at('15:00')), [view()])).toBe(true);
    expect(orphan(eventRow(at('14:05'), { type: 'calendar.deleted' }), [view()])).toBe(true);
  });

  it('never makes an orphan of what a first look found already there', () => {
    // The first look at 09:00: no changesSince, synced when it saw the event.
    const firstLook = without(view({ lastSyncAt: at('09:00') }), 'changesSince');
    expect(orphan(eventRow(at('09:00')), [firstLook])).toBe(false);
    expect(orphan(eventRow(at('09:00')), [firstLook, view()])).toBe(false);
    // A first look that the ledger stamps with its own instant reads the same way.
    expect(
      orphan(eventRow(at('09:00')), [view({ changesSince: at('09:00'), lastSyncAt: at('15:00') })]),
    ).toBe(false);
  });

  it('needs the following entry to have synced at or after the first sighting', () => {
    expect(orphan(eventRow(at('15:30')), [view()])).toBe(false);
    expect(orphan(eventRow(at('15:30')), [view(), view({ lastSyncAt: at('15:30') })])).toBe(true);
  });

  it('needs the following entry to hold the event start', () => {
    expect(orphan(eventRow(at('14:05')), [view({ windowEnd: at('00:00', '08') })])).toBe(false);
  });
});

describe('a calendar orphan: who began comparing when, and which rows the rule reads (§3, §10)', () => {
  it("is never an orphan when another view began comparing at its first sighting (a second account's first look)", () => {
    const secondAccount = without(view({ accountHash: 'acct-b', lastSyncAt: at('14:05') }), 'changesSince');
    expect(orphan(eventRow(at('14:05')), [view(), secondAccount])).toBe(false);
    // A row of acct-a first seen at another instant is still a change acct-a's view followed.
    expect(orphan(eventRow(at('14:06')), [view(), secondAccount])).toBe(true);
    // A restarted chain (changesSince = the restart) stops the rows of that pass the same way.
    expect(orphan(eventRow(at('14:05')), [view(), view({ changesSince: at('14:05') })])).toBe(false);
  });

  it('is never an orphan while a view that compared nothing was synced at or after its first sighting', () => {
    // Passes that compared nothing may be merged into one entry (§3): its lastSyncAt is the latest of them, and one
    // of them may be the first look that found the row.
    const merged = without(view({ accountHash: 'acct-b', lastSyncAt: at('14:30') }), 'changesSince');
    expect(orphan(eventRow(at('14:05')), [view(), merged])).toBe(false);
    expect(orphan(eventRow(at('14:31')), [view(), merged])).toBe(true);
  });

  it('reads the first sighting, not the later store (sightedAt, §10)', () => {
    const row = eventRow(at('14:20'));
    const firstLook = without(view({ lastSyncAt: at('09:00') }), 'changesSince');
    expect(orphan(row, [firstLook, view()])).toBe(true);
    expect(orphan({ ...row, sightedAt: at('09:00') } as Observation, [firstLook, view()])).toBe(false);
  });

  it('applies to gcal.event rows only: a Gmail row needs no followed changes', () => {
    const send = buildObservation(
      ScenarioObservation.parse({
        ref: 'o2',
        source: 'gmail.sent',
        type: 'email.sent',
        counterparty: 'p@x.example',
        occurredAt: at('14:05'),
        observedAt: at('14:05'),
      }),
      [],
      EVAL,
      VIEW,
    );
    const sent = { source: 'gmail.sent' as const, lastSyncAt: at('15:00'), windowStart: at('12:00') };
    expect(orphan(send, [{ ...sent, windowEnd: at('15:00'), accountHash: 'acct-a' }])).toBe(true);
  });
});
