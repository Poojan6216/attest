/**
 * The Calendar first-look marker at the grader (docs/grading.md v1.10 §3, §6.1, §7; Sprint 2 wave D decision 1).
 * Every row a Calendar pass stores as a first sighting gets a marker, written by the ledger with the row: a
 * `gcal.event` entry of the same observer and account whose window is the row's `occurredAt` (a point) and whose
 * `lastSyncAt` and `changesSince` are the row's first sighting. The core needs no special case for it:
 *
 *  - Orphans (§3): the marker found its row already there (rule (b): `changesSince` = the first sighting), so the
 *    row is never an orphan, wherever its start lies (before the visible range, on a day hidden behind "N more", in a
 *    pass that recorded no window), with or without an account. It blocks exactly the rows that share its instant and
 *    its first sighting, and it never makes a row an orphan: `changesSince = lastSyncAt` can never satisfy rule (a).
 *  - Coverage (§6.1): a point never contains a claim window and never bridges a gap, so a marker never makes coverage
 *    full; over the window it at most turns `none` into `partial`. Its account counts for the account rule like any
 *    entry's (a second account caps a grant without accounts; under a grant binding two accounts, a marker never
 *    stands for its account's view, v1.11), and it counts for grace: the pass did sync then.
 *
 * Times are 2026-10-06 in −04:00 unless a day is given. acct-a follows the week [10-04 00:00, 10-11 00:00] since
 * 09:00, synced 14:20; acct-b's pass at 14:10 stored first sightings.
 */
import { describe, expect, it } from 'vitest';

import {
  coveredObservations,
  isOrphanCandidate,
  seenWindows,
  visibleAt,
} from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { coverageLevel, graceElapsed } from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import {
  type Claim,
  type Observation,
  Observation as ObservationSchema,
  ObserverCoverage,
} from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage, ScenarioObservation } from '../../golden/scenario-schema';
import defaultPolicyJson from '../../../../policy/default.json';

const EVAL = '2026-10-06T15:30:00-04:00';
const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const VIEW = PolicyView.parse(defaultPolicyJson);

/** acct-a's week, followed since 09:00 and synced at 14:20. */
const FOLLOWED: ScenarioCoverage = {
  source: 'gcal.event',
  lastSyncAt: at('14:20'),
  windowStart: at('00:00', '04'),
  windowEnd: at('00:00', '11'),
  accountHash: 'acct-a',
  allCalendars: true,
  changesSince: at('09:00'),
};

/** The first-look marker of a row starting at `start`, first seen at `seen`, of `account` (none: no account). */
function marker(start: string, seen: string, account: string | null = 'acct-b'): ScenarioCoverage {
  return {
    source: 'gcal.event',
    lastSyncAt: seen,
    windowStart: start,
    windowEnd: start,
    ...(account === null ? {} : { accountHash: account }),
    allCalendars: true,
    changesSince: seen,
  };
}

/** A gcal.event first sighting of an event starting at `start`, first seen at `seen`. */
function row(start: string, seen: string, subject = 'Busy day'): Observation {
  return buildObservation(
    ScenarioObservation.parse({
      ref: 'o1',
      source: 'gcal.event',
      type: 'calendar.created',
      subjectHint: subject,
      occurredAt: start,
      observedAt: seen,
    }),
    [],
    EVAL,
    VIEW,
  );
}

const orphan = (observation: Observation, entries: readonly ScenarioCoverage[]): boolean =>
  isOrphanCandidate(observation, seenWindows(buildCoverage(entries, EVAL)), DEFAULT_POLICY);

describe('a first-look marker is an ordinary coverage entry (§3, §13)', () => {
  it('parses as ObserverCoverage: a point window, changesSince equal to lastSyncAt, with or without an account', () => {
    for (const account of ['0'.repeat(64), null]) {
      const entry = {
        observerId: 'gcal.event',
        source: 'gcal.event',
        lastSyncAt: at('14:10'),
        windowStart: at('10:00', '08'),
        windowEnd: at('10:00', '08'),
        ...(account === null ? {} : { accountHash: account }),
        allCalendars: true,
        changesSince: at('14:10'),
      };
      expect(ObserverCoverage.safeParse(entry).success).toBe(true);
    }
  });
});

describe('a marker keeps its row from being an orphan (§3 rule (b), Hard Rule 7)', () => {
  it('(i) an event that began before the visible range: no window of its pass holds its start', () => {
    const previous = { ...FOLLOWED, windowStart: '2026-09-27T00:00:00-04:00', windowEnd: at('00:00', '04') };
    const firstLook = {
      ...FOLLOWED,
      accountHash: 'acct-b',
      lastSyncAt: at('14:10'),
      changesSince: at('14:10'),
    };
    const conference = row(at('09:00', '02'), at('14:10'), 'Conference');
    expect(orphan(conference, [previous, firstLook])).toBe(true);
    expect(orphan(conference, [previous, firstLook, marker(at('09:00', '02'), at('14:10'))])).toBe(false);
  });

  it('(ii) an event on a day hidden behind "N more": its pass reported the runs around that day', () => {
    // Not seen whole: the runs carry no changesSince (§3).
    const run = (from: string, to: string): ScenarioCoverage => ({
      source: 'gcal.event',
      lastSyncAt: at('14:10'),
      windowStart: from,
      windowEnd: to,
      accountHash: 'acct-b',
      allCalendars: true,
    });
    const runs = [run(at('00:00', '04'), at('00:00', '08')), run(at('00:00', '09'), at('00:00', '11'))];
    const busy = row(at('10:00', '08'), at('14:10'));
    expect(orphan(busy, [FOLLOWED, ...runs])).toBe(true);
    expect(orphan(busy, [FOLLOWED, ...runs, marker(at('10:00', '08'), at('14:10'))])).toBe(false);
  });

  it('(iv) a pass that recorded no window at all; and a marker without an account blocks the same way', () => {
    const family = row(at('18:00', '09'), at('14:10'), 'Family dinner');
    expect(orphan(family, [FOLLOWED])).toBe(true);
    expect(orphan(family, [FOLLOWED, marker(at('18:00', '09'), at('14:10'))])).toBe(false);
    expect(orphan(family, [FOLLOWED, marker(at('18:00', '09'), at('14:10'), null)])).toBe(false);
  });

  it('reads the first sighting a row stored later keeps (sightedAt, §10)', () => {
    const stored = ObservationSchema.parse({
      ...row(at('10:00', '08'), at('14:10')),
      observedAt: at('14:15'),
      sightedAt: at('14:10'),
    });
    expect(orphan(stored, [FOLLOWED])).toBe(true);
    expect(orphan(stored, [FOLLOWED, marker(at('10:00', '08'), at('14:10'))])).toBe(false);
    expect(orphan(stored, [FOLLOWED, marker(at('10:00', '08'), at('14:15'))])).toBe(true);
  });
});

describe('a marker blocks exactly its row and accuses nobody (§3)', () => {
  const mark = marker(at('10:00', '08'), at('14:10'));

  it('blocks no row that starts 1 ms away or was first seen 1 ms apart', () => {
    expect(orphan(row('2026-10-08T10:00:00.001-04:00', at('14:10')), [FOLLOWED, mark])).toBe(true);
    expect(orphan(row(at('10:00', '08'), '2026-10-06T14:10:00.001-04:00'), [FOLLOWED, mark])).toBe(true);
    expect(orphan(row(at('10:00', '08'), '2026-10-06T14:09:59.999-04:00'), [FOLLOWED, mark])).toBe(true);
  });

  it('blocks every row sharing its instant and first sighting (a missed UNASKED at most, never a false one)', () => {
    expect(orphan(row(at('10:00', '08'), at('14:10'), 'Another event'), [FOLLOWED, mark])).toBe(false);
  });

  it('never makes a row an orphan: changesSince = lastSyncAt never follows a change (rule (a))', () => {
    for (const seen of [at('14:00'), at('14:10'), at('14:15')]) {
      expect(orphan(row(at('10:00', '08'), seen), [mark])).toBe(false);
      expect(orphan(row(at('10:00', '08'), seen), [mark, marker(at('10:00', '08'), at('14:15'))])).toBe(
        false,
      );
    }
  });

  it('coveredObservations leaves the marked row out and keeps the change acct-a saw', async () => {
    const busy = row(at('10:00', '08'), at('14:10'));
    const lunch = row(at('12:30', '07'), at('14:20'), 'Team lunch');
    const index = visibleAt(createMemoryIndex([busy, lunch], 15), Date.parse(EVAL));
    const coverage = buildCoverage([FOLLOWED, mark], EVAL);
    const found = await coveredObservations(index, coverage, DEFAULT_POLICY);
    expect(found.map((keyed) => keyed.observation.id)).toEqual([lunch.id]);
  });
});

describe('a marker never makes coverage full (§6.1)', () => {
  const claim: Claim = buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type: 'calendar.created',
      subjectHint: 'Busy day',
      claimedAt: at('14:02'),
      targetAt: at('10:00', '08'),
    }),
  );
  const grant = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a', 'acct-b'] } }, EVAL);
  const fresh = { ...FOLLOWED, lastSyncAt: at('15:00'), windowEnd: at('00:00', '12') };
  const level = (entries: readonly ScenarioCoverage[]) =>
    coverageLevel(claim, grant, buildCoverage(entries, EVAL), DEFAULT_POLICY);

  it('alone over the window it is partial, never full', () => {
    expect(level([marker(at('10:00', '08'), at('15:00'))])).toMatchObject({
      level: 'partial',
      capReasons: [],
    });
    expect(level([marker(at('10:00', '01'), at('15:00'))]).level).toBe('none');
  });

  it('never bridges a gap between two views, even a gap of one instant', () => {
    const before = { ...fresh, windowEnd: '2026-10-08T09:59:59.999-04:00' };
    const after = { ...fresh, windowStart: '2026-10-08T10:00:00.001-04:00' };
    expect(level([before, after]).level).toBe('partial');
    expect(level([before, marker(at('10:00', '08'), at('15:00')), after]).level).toBe('partial');
    // acct-a's whole view is full beside its own marker under a grant binding acct-a alone ...
    const boundToA = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);
    const marked = buildCoverage([fresh, marker(at('10:00', '08'), at('15:00'), 'acct-a')], EVAL);
    expect(coverageLevel(claim, boundToA, marked, DEFAULT_POLICY)).toMatchObject({
      level: 'full',
      capReasons: [],
    });
    // ... but with acct-b bound too, acct-b's marker never stands for a view of acct-b's calendars (v1.11).
    expect(level([fresh, marker(at('10:00', '08'), at('15:00'))])).toMatchObject({
      level: 'partial',
      capReasons: [{ code: 'coverage.account_partial', source: 'gcal.event' }],
    });
  });

  it('counts for grace like any entry: the pass that stored the row synced then', () => {
    const coverage = (entries: readonly ScenarioCoverage[]) => buildCoverage(entries, EVAL);
    const early = { ...FOLLOWED, lastSyncAt: at('14:00') };
    expect(graceElapsed(claim, grant, coverage([early]), DEFAULT_POLICY)).toBe(false);
    const markerAfterGrace = marker(at('10:00', '08'), at('14:40'));
    expect(graceElapsed(claim, grant, coverage([early, markerAfterGrace]), DEFAULT_POLICY)).toBe(true);
    expect(level([early, markerAfterGrace]).level).toBe('partial');
  });
});

describe("a marker's account counts like any entry's (§6.1 account rule)", () => {
  const claim: Claim = buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type: 'calendar.created',
      subjectHint: 'Busy day',
      claimedAt: at('14:02'),
      targetAt: at('10:00', '08'),
    }),
  );
  const fresh = { ...FOLLOWED, lastSyncAt: at('15:00'), windowEnd: at('00:00', '12') };

  it('caps a grant without accounts when it is of a second account; of the bound account or none, nothing', () => {
    // The one way a marker lowers a level, wherever its point lies: it shows Attest a second account, as that
    // account's own windows would (a pass that recorded no window, case iv), so NOT_FOUND cannot say which account the
    // agent used. Conservative (Hard Rule 5); a marker of the bound account, or of no account, changes nothing.
    const unbound = buildGrant({ agent: 'muse' }, EVAL);
    const elsewhere = (account: string | null) => marker(at('10:00', '20'), at('15:10'), account);
    const levelOf = (entries: readonly ScenarioCoverage[]) =>
      coverageLevel(claim, unbound, buildCoverage(entries, EVAL), DEFAULT_POLICY);
    expect(levelOf([fresh])).toMatchObject({ level: 'full', capReasons: [] });
    expect(levelOf([fresh, elsewhere('acct-a')])).toMatchObject({ level: 'full', capReasons: [] });
    expect(levelOf([fresh, elsewhere(null)])).toMatchObject({ level: 'full', capReasons: [] });
    expect(levelOf([fresh, elsewhere('acct-b')])).toMatchObject({
      level: 'partial',
      capReasons: [{ code: 'coverage.multiple_accounts', source: 'gcal.event' }],
    });
    const boundToA = buildGrant({ agent: 'muse', accounts: { 'gcal.event': ['acct-a'] } }, EVAL);
    const bound = coverageLevel(
      claim,
      boundToA,
      buildCoverage([fresh, elsewhere('acct-b')], EVAL),
      DEFAULT_POLICY,
    );
    expect(bound).toMatchObject({ level: 'full', capReasons: [] });
  });
});
