/**
 * Calendar changes the account did not make never accuse an agent (docs/grading.md §3, §7 v1.12; SEC-1; Hard Rule 7:
 * Attest accuses an agent of an action only when it saw the action happen). Other people change the account's
 * calendar: Google adds an invitation from anyone (its default), an organiser moves or cancels an event the user was
 * invited to, a colleague edits an event on a shared calendar the grid shows. A snapshot cannot tell those from the
 * account's own changes yet (src/background/calendar-own.ts), so since v1.12 the service worker stores every Calendar
 * change as a first sighting with its first-look marker: no Calendar row is ever an orphan, whatever the views saw.
 * The rows stay as evidence a claim can be graded against (§4.1).
 *
 * Each scenario follows the week a minute at a time (a base inside the attribution window, as a visible tab is read),
 * so every change below is one a followed view saw happen: the very rows v1.11 would have made orphans.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coveredObservations, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { IsoTs } from '../../../src/core/schema';
import { coverageFor } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { Observation } from '../../../src/ledger/types';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, type EventInput, FAMILY, week } from './calendar-fixtures';
import { eventOn, markerOf, markers, runPass, weekPing } from './calendar-pass-harness';
import { contextOf, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-third-party'));
  ctx = contextOf(db, { now: () => at(600) });
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** One pass of account A's week at minute `minute`, every calendar shown, with `events`. */
async function pass(minute: number, events: readonly EventInput[]): Promise<void> {
  const snapshot = week(events, { readAt: at(minute), familyShown: true });
  const ping = weekPing(at(minute), { allCalendars: true });
  expect(await runPass(ctx, snapshot, { pings: [ping] })).toEqual({ ok: true });
}

/** The orphan candidates of a batch at `evaluatedAt` over the week, as `type:subject`. */
async function orphans(evaluatedAt: IsoTs): Promise<string[]> {
  const window = {
    fromMs: Date.parse('2026-10-04T00:00:00-04:00'),
    toMs: Date.parse('2026-10-11T00:00:00-04:00'),
  };
  const coverage = await coverageFor(db, { type: 'calendar.created', window, evaluatedAt }, DEFAULT_POLICY);
  const rows = readRows('observations', Observation, await db.observations.toArray());
  const found = await coveredObservations(
    visibleAt(createMemoryIndex(rows, 15), instantMs(evaluatedAt)),
    coverage,
    DEFAULT_POLICY,
  );
  return found.map(({ observation }) => `${observation.type}:${observation.subjectHint ?? ''}`).sort();
}

/** The stored rows as `type:subject`, and when each was first seen. */
async function stored(): Promise<string[]> {
  return (await db.observations.toArray())
    .map((row) => `${row.type}:${row.subjectHint ?? ''}@${row.sightedAt ?? row.observedAt}`)
    .sort();
}

const ALL = { accountHash: ACCOUNT, allCalendars: true };
const standup = eventOn('s', '2026-10-06', 10, { subjectHint: 'Standup' });
const review = eventOn('r', '2026-10-07', 15, {
  subjectHint: 'Design review',
  guests: ['priya.raman@example.org'],
  guestCount: 1,
});

describe('an invitation or a reschedule, seen by a followed view, is a first sighting with its marker', () => {
  it('an invitation Google adds from a stranger (calendar.created)', async () => {
    await pass(0, [standup]);
    await pass(1, [standup]);
    const invite = eventOn('i', '2026-10-08', 9, {
      subjectHint: 'Invitation from a stranger',
      guests: ['stranger@example.net'],
      guestCount: 1,
    });
    await pass(2, [standup, invite]);
    expect(await markers(db)).toContainEqual(markerOf(invite, at(2), ALL));
    expect(await stored()).toContain(`calendar.created:Invitation from a stranger@${at(2)}`);
    expect(await orphans(at(30))).toEqual([]);
  });

  it('an organiser moves the meeting (calendar.updated), then renames it', async () => {
    await pass(0, [standup, review]);
    await pass(1, [standup, review]);
    const moved = {
      ...review,
      occurredAt: '2026-10-08T15:00:00-04:00',
      endAt: '2026-10-08T16:00:00-04:00',
      days: ['2026-10-08'],
    };
    await pass(2, [standup, moved]);
    const renamed = { ...moved, subjectHint: 'Design review (moved)' };
    await pass(3, [standup, renamed]);
    expect(await markers(db)).toEqual(
      expect.arrayContaining([markerOf(moved, at(2), ALL), markerOf(renamed, at(3), ALL)]),
    );
    expect(await stored()).toEqual(
      expect.arrayContaining([
        `calendar.updated:Design review@${at(2)}`,
        `calendar.updated:Design review (moved)@${at(3)}`,
      ]),
    );
    expect(await orphans(at(30))).toEqual([]);
  });
});

describe('a cancellation or a shared calendar’s edit, seen by a followed view, is a first sighting too', () => {
  it('an organiser cancels the meeting (calendar.deleted, confirmed by a second absence)', async () => {
    await pass(0, [standup, review]);
    await pass(1, [standup, review]);
    await pass(2, [standup]);
    await pass(3, [standup]);
    expect(await stored()).toContain(`calendar.deleted:Design review@${at(2)}`);
    expect(await markers(db)).toContainEqual(markerOf(review, at(2), ALL));
    expect(await orphans(at(30))).toEqual([]);
  });

  it('a colleague edits an event on a shared calendar the grid shows', async () => {
    const shared = eventOn('c', '2026-10-09', 11, { subjectHint: 'Dentist (colleague)', calendar: FAMILY });
    await pass(0, [standup, shared]);
    await pass(1, [standup, shared]);
    const edited = {
      ...shared,
      subjectHint: 'Dentist (moved by colleague)',
      occurredAt: '2026-10-09T13:00:00-04:00',
      endAt: '2026-10-09T14:00:00-04:00',
    };
    await pass(2, [standup, edited]);
    expect(await markers(db)).toContainEqual(markerOf(edited, at(2), ALL));
    expect(await orphans(at(30))).toEqual([]);
  });
});

describe('the rows stay evidence', () => {
  it('every change is stored with its type and allowlisted fields, first seen at the pass that saw it', async () => {
    await pass(0, [standup, review]);
    await pass(1, [standup]);
    await pass(2, [standup]);
    const rows = (await db.observations.toArray()).filter((row) => row.type === 'calendar.deleted');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'gcal.event',
      subjectHint: 'Design review',
      counterparty: 'priya.raman@example.org',
      occurredAt: '2026-10-07T15:00:00-04:00',
      observedAt: at(1),
    });
  });
});
