/**
 * First-look markers and the Calendar pass transaction (src/ledger/first-look.ts; docs/grading.md §3 `gcal.event`
 * bullet and orphans; Hard Rules 5, 7): a first sighting is stored with its marker in one transaction, a marker blocks
 * the orphan rule for its row and nothing else, never makes coverage full, and never merges with a pass's window;
 * anything thrown inside a pass's transaction leaves nothing of it.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isOrphanCandidate, seenWindows } from '../../../src/core/batch-orphans';
import { coverageLevel } from '../../../src/core/conditions';
import { idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { project } from '../../../src/core/redact';
import { Claim, Grant, type IsoTs, type ObserverCoverageInput } from '../../../src/core/schema';
import { coverageFor, readInterval, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import {
  firstLookMarker,
  inCalendarPass,
  isFirstLookMarker,
  upsertFirstSighting,
} from '../../../src/ledger/first-look';
import { openLedger } from '../../../src/ledger/migrations';
import { recordBatchInstant, upsertObservation } from '../../../src/ledger/repo';
import { Observation, ObserverCoverage } from '../../../src/ledger/types';
import {
  expectLedgerError,
  makeGrant,
  makeObservation,
  omit,
  pinClock,
  releaseClock,
  sha,
  uniqueDbName,
} from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('first-look'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const A = sha(900);
const T0 = '2026-10-03T12:00:00-04:00' as IsoTs;
const T1 = '2026-10-03T12:10:00-04:00' as IsoTs;
const T2 = '2026-10-03T12:20:00-04:00' as IsoTs;
const START = '2026-10-06T10:00:00-04:00';

/** A `gcal.event` row of event `id` starting at `occurredAt`, sighted at `observedAt`, as `project()` builds it. */
function calendarRow(
  id: string,
  observedAt: IsoTs,
  occurredAt = START,
  type: 'calendar.created' | 'calendar.updated' = 'calendar.created',
) {
  return project(
    'gcal.event',
    { occurredAt, subjectHint: `Event ${id}` },
    { type, observedAt, rowKey: sha(id.charCodeAt(0)) },
    DEFAULT_POLICY,
  );
}

/** Account A's week Oct 4–11, synced at `sync`, following changes since `since` (none: compared nothing). */
function week(sync: IsoTs, since?: IsoTs): ObserverCoverageInput {
  return {
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt: sync,
    windowStart: '2026-10-04T00:00:00-04:00',
    windowEnd: '2026-10-11T00:00:00-04:00',
    accountHash: A,
    allCalendars: true,
    ...(since === undefined ? {} : { changesSince: since }),
  };
}

async function intervals(): Promise<ObserverCoverage[]> {
  return (await db.coverageIntervals.toArray()).flatMap((row) => {
    const placed = readInterval(row);
    return placed === undefined ? [] : [placed.entry];
  });
}

const owner = { observerId: 'gcal.event', accountHash: A, allCalendars: true };

describe('a first-look marker', () => {
  it('is a point at the event start, synced and comparing since the first sighting, of the pass that found it', () => {
    const marker = firstLookMarker(Observation.parse(calendarRow('a', T1)), owner);
    expect(marker).toEqual({
      observerId: 'gcal.event',
      source: 'gcal.event',
      lastSyncAt: T1,
      windowStart: START,
      windowEnd: START,
      changesSince: T1,
      accountHash: A,
      allCalendars: true,
    });
    expect(isFirstLookMarker(marker)).toBe(true);
    // A pass's window, a first look's included (changesSince = its sync), is never one; nor a point without it.
    expect(isFirstLookMarker(ObserverCoverage.parse(week(T1, T1)))).toBe(false);
    expect(isFirstLookMarker(ObserverCoverage.parse({ ...marker, changesSince: T0 }))).toBe(false);
    expect(isFirstLookMarker(ObserverCoverage.parse(omit(marker, 'changesSince')))).toBe(false);
  });

  it('is written with the row it marks, once: a re-sighting of a stored row writes none', async () => {
    expect(await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner)).toMatchObject({
      inserted: true,
    });
    expect(await upsertFirstSighting(db, calendarRow('a', T2), DEFAULT_POLICY, owner)).toMatchObject({
      inserted: false,
    });
    expect(await db.observations.count()).toBe(1);
    expect(await intervals()).toEqual([firstLookMarker(Observation.parse(calendarRow('a', T1)), owner)]);
  });

  it('is dated at the sighting, not at the write, when the row is stored after a batch (§3: sightedAt)', async () => {
    await recordBatchInstant(db, T2);
    await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
    const [row] = await db.observations.toArray();
    expect(row?.sightedAt).toBe(T1);
    expect(Date.parse(row?.observedAt ?? '')).toBeGreaterThan(Date.parse(T2));
    expect(await intervals()).toEqual([firstLookMarker(Observation.parse(calendarRow('a', T1)), owner)]);
  });

  it('is never written for a refused row, nor for a row of another source', async () => {
    await upsertObservation(db, calendarRow('a', T2), DEFAULT_POLICY);
    await expectLedgerError(
      upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner),
      'late_sighting',
    );
    await expectLedgerError(
      upsertFirstSighting(db, makeObservation(), DEFAULT_POLICY, owner),
      'invalid_input',
    );
    expect(await db.observations.count()).toBe(1);
    expect(await intervals()).toEqual([]);
  });
});

describe('coverage.ts merge invariants with markers', () => {
  it('a marker never merges into a window with changesSince, its own changesSince included, nor one into it', async () => {
    await recordCoverage(db, week(T1, T1));
    await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
    await recordCoverage(db, week(T2, T1));
    const held = await intervals();
    expect(held).toHaveLength(2);
    expect(held.filter(isFirstLookMarker)).toHaveLength(1);
    expect(held.find((entry) => !isFirstLookMarker(entry))).toEqual(ObserverCoverage.parse(week(T2, T1)));
  });

  it('a marker never merges with a window without changesSince, nor such a window with a marker', async () => {
    await recordCoverage(db, week(T0));
    await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
    await recordCoverage(db, week(T2));
    const held = await intervals();
    expect(held.filter(isFirstLookMarker)).toEqual([
      firstLookMarker(Observation.parse(calendarRow('a', T1)), owner),
    ]);
    expect(held.filter((entry) => !isFirstLookMarker(entry))).toEqual([ObserverCoverage.parse(week(T2))]);
  });

  it('a window without changesSince never merges with one that has it (the v1.9 rule, kept)', async () => {
    await recordCoverage(db, week(T0));
    await recordCoverage(db, week(T1, T1));
    await recordCoverage(db, week(T2));
    expect((await intervals()).map((entry) => entry.changesSince ?? null)).toEqual([T1, null]);
  });

  it('two markers of one instant and pass are one row; of two instants, two rows (points never touch)', async () => {
    const other = calendarRow('b', T1, '2026-10-06T10:00:00.001-04:00');
    await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
    await recordCoverage(db, firstLookMarker(Observation.parse(calendarRow('a', T1)), owner));
    await upsertFirstSighting(db, other, DEFAULT_POLICY, owner);
    expect(await intervals()).toHaveLength(2);
  });
});

describe('what a marker does to grading', () => {
  async function coverageAt(evaluatedAt: string) {
    const atMs = Date.parse(START);
    const window = { fromMs: atMs - 3_600_000, toMs: atMs + 3_600_000 };
    return coverageFor(db, { type: 'calendar.created', window, evaluatedAt }, DEFAULT_POLICY);
  }

  it('keeps the row it marks from being an orphan, and leaves a change the followed view saw one', async () => {
    // Account A's week follows changes since T0, synced at T2. Event a was first seen at T1 by a pass with no account.
    await recordCoverage(db, week(T2, T0));
    await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, { observerId: 'gcal.event' });
    const change = calendarRow(
      'c',
      '2026-10-03T12:15:00-04:00' as IsoTs,
      '2026-10-07T09:00:00-04:00',
      'calendar.updated',
    );
    await upsertObservation(db, change, DEFAULT_POLICY);
    const coverage = await coverageAt('2026-10-03T13:00:00-04:00');
    const windows = seenWindows(coverage);
    expect(isOrphanCandidate(Observation.parse(calendarRow('a', T1)), windows, DEFAULT_POLICY)).toBe(false);
    expect(isOrphanCandidate(Observation.parse(change), windows, DEFAULT_POLICY)).toBe(true);
    // Control: without its marker, the row first seen inside A's followed span would read as a change A saw.
    const unmarked = {
      ...coverage,
      observers: coverage.observers.filter((entry) => !isFirstLookMarker(entry)),
    };
    expect(
      isOrphanCandidate(Observation.parse(calendarRow('a', T1)), seenWindows(unmarked), DEFAULT_POLICY),
    ).toBe(true);
  });

  it('never makes coverage full: a point never contains a claim window', async () => {
    await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
    const claim = Claim.parse({
      id: idFromHash(sha(5)),
      agent: 'muse',
      type: 'calendar.created',
      subjectHint: 'Event a',
      claimedAt: T0,
      claimedAtPrecision: 'minute',
      targetAt: START,
      observedAt: T0,
      sourceKind: 'activity_view',
      extractor: { id: 'test', version: '1', confidence: 1 },
      rawHash: sha(5),
    });
    const grant = Grant.parse(makeGrant({ allowedTypes: ['calendar.created'] }));
    const coverage = await coverageAt('2026-10-03T13:00:00-04:00');
    expect(coverageLevel(claim, grant, coverage, DEFAULT_POLICY).level).toBe('partial');
  });
});

describe('inCalendarPass: one transaction, all or none', () => {
  it('a throw after rows and markers were written leaves none of them', async () => {
    const boom = new Error('worker stopped');
    const run = inCalendarPass(db, async () => {
      await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
      await recordCoverage(db, week(T1, T1));
      throw boom;
    });
    await expect(run).rejects.toBe(boom);
    expect(await db.observations.count()).toBe(0);
    expect(await intervals()).toEqual([]);
  });

  it('a nested refusal aborts the rows written before it, and rejects with what the scope threw', async () => {
    await upsertObservation(db, calendarRow('z', T2), DEFAULT_POLICY);
    class Refused extends Error {}
    const run = inCalendarPass(db, async () => {
      await upsertFirstSighting(db, calendarRow('a', T1), DEFAULT_POLICY, owner);
      try {
        await upsertFirstSighting(db, calendarRow('z', T1), DEFAULT_POLICY, owner);
      } catch {
        throw new Refused('late');
      }
    });
    await expect(run).rejects.toBeInstanceOf(Refused);
    expect(await db.observations.count()).toBe(1);
    expect(await intervals()).toEqual([]);
  });
});
