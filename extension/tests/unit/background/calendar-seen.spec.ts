/**
 * A change another range saw first is stored as a first sighting (src/background/calendar-seen.ts; docs/grading.md §3
 * orphans, §7; Decisions [2.7] wave D; Hard Rule 7). Snapshots are kept per range and rows carry no range, so an
 * event edited on a day both a week view and a two-week view show reaches each chain on its own. When the week's view
 * already held the new state (read after the two-week base, before its pass), the two-week chain's row is not when the
 * change was first seen: it gets a first-look marker and never accuses an agent. A view read at or before the base,
 * a deletion, and a state the other view never held leave the change as it is.
 *
 * Since v1.12 the service worker stores every Calendar change as a first sighting anyway (Decisions [2.close]): the
 * rule is tested on `seenFirstElsewhere` itself, with the rows a step reports for changes the account made
 * (`firstSighting: false`, as when the live smoke re-enables them) over records stored as the service worker stores
 * them; and through the handlers, where whatever the views saw, no Calendar row is an orphan.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seenFirstElsewhere } from '../../../src/background/calendar-seen';
import type { CalendarRow } from '../../../src/background/calendar-step';
import { coveredObservations, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { IsoTs } from '../../../src/core/schema';
import { CalendarRecord, putCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import { coverageFor } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { Observation } from '../../../src/ledger/types';
import { CalendarSnapshot, type CalendarSnapshotInput } from '../../../src/observers/gcal/snapshot';
import { pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, type EventInput, FAMILY, MAIN, VERSION } from './calendar-fixtures';
import { eventOn, markerOf, markers, runPass, WIDE_WINDOWS_POLICY } from './calendar-pass-harness';
import { contextOf, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-seen'));
  // The worker's clock reads after every pass instant below. Hour-long attribution windows: the cross-range rule is
  // tested alone (a change noticed late is a first sighting too: ./calendar-step.spec.ts).
  ctx = contextOf(db, { now: () => '2026-10-04T00:00:00-04:00', policy: WIDE_WINDOWS_POLICY });
});

afterEach(() => {
  db.close();
  releaseClock();
});

type Events = CalendarSnapshotInput['events'];

function days(first: string, count: number): string[] {
  const start = Date.parse(`${first}T12:00:00Z`);
  return Array.from({ length: count + 1 }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** The `count` days from Sun 4 Oct (7: the week, 14: two weeks) read at `readAt`, every calendar shown. */
function snapshot(count: number, readAt: IsoTs, events: Events): CalendarSnapshot {
  const shown = days('2026-10-04', count);
  return CalendarSnapshot.parse({
    format: 1,
    observer: 'gcal.event',
    version: VERSION,
    range: `${shown[0]}/${shown[count - 1]}`,
    readAt,
    baselineAt: readAt,
    days: shown.slice(0, count).map((date) => ({ date, complete: true })),
    calendars: [
      { key: MAIN, shown: true },
      { key: FAMILY, shown: true },
    ],
    events,
  });
}

/** The record the service worker keeps for that view of `account`. */
function recordOf(count: number, readAt: IsoTs, events: Events, account: string = ACCOUNT): CalendarRecord {
  const view = snapshot(count, readAt, events);
  return CalendarRecord.parse({
    observerId: 'gcal.event',
    accountHash: account,
    range: view.range,
    snapshot: view,
    pending: [],
  });
}

/** Stores that view's record, as another range's (or account's) pass would. */
async function stored(
  count: number,
  readAt: IsoTs,
  events: Events,
  account: string = ACCOUNT,
): Promise<void> {
  await putCalendarRecord(db, recordOf(count, readAt, events, account));
}

const before = eventOn('e', '2026-10-06', 10, { subjectHint: 'Standup' });
const moved = eventOn('e', '2026-10-07', 10, { subjectHint: 'Standup moved' });
/** A creation no other view held: a change the two-week chain saw happen. */
const fresh = eventOn('n', '2026-10-09', 14, { subjectHint: 'Created later' });

/** The row a step reports for an own change of `event`, first seen at the pass: not a first sighting. */
function change(event: EventInput, type: CalendarRow['row']['type'] = 'calendar.updated'): CalendarRow {
  const fields = { occurredAt: event.occurredAt, subjectHint: event.subjectHint };
  return { row: { type, rowKey: event.key, fields }, sightedAt: at(20), firstSighting: false };
}

const TWO_WEEKS = { observerId: 'gcal.event', accountHash: ACCOUNT, range: '2026-10-04/2026-10-17' };

/** `rows` of the two-week pass at(20) showing `now`, compared with its base read at `baseAt` showing `was`. */
async function flags(rows: readonly CalendarRow[], now: Events, was: Events = [before], baseAt = at(5)) {
  const base = recordOf(14, baseAt, was);
  const marked = await seenFirstElsewhere(db, TWO_WEEKS, base, snapshot(14, at(20), now), rows);
  return marked.map((each) => each.firstSighting);
}

describe('seenFirstElsewhere: a change another range held first is a first sighting', () => {
  it('the week view read between the base and the pass held the moved event: the update, not the creation', async () => {
    await stored(7, at(10), [moved]);
    expect(await flags([change(moved), change(fresh, 'calendar.created')], [moved, fresh])).toEqual([
      true,
      false,
    ]);
  });

  it('a creation another view already held is a first sighting too (an event moved into this range)', async () => {
    await stored(7, at(10), [before, fresh]);
    expect(await flags([change(fresh, 'calendar.created')], [before, fresh])).toEqual([true]);
  });

  it('another account’s view of the same event in the same state counts too', async () => {
    await stored(7, at(10), [moved], sha(66));
    expect(await flags([change(moved)], [moved])).toEqual([true]);
  });

  it('another account’s view of the same range counts too; this range’s own record never does', async () => {
    await stored(14, at(10), [moved]);
    expect(await flags([change(moved)], [moved])).toEqual([false]);
    await stored(14, at(10), [moved], sha(66));
    expect(await flags([change(moved)], [moved])).toEqual([true]);
  });

  it('"the same state" is the diff’s own sameEventState: a guest’s ASCII case is no change, another guest is', async () => {
    const withGuest = (guest: string) => ({ ...moved, guests: [guest], guestCount: 1 });
    await stored(7, at(10), [withGuest('A@example.com')]);
    expect(await flags([change(withGuest('a@example.com'))], [withGuest('a@example.com')])).toEqual([true]);
    expect(await flags([change(withGuest('c@example.com'))], [withGuest('c@example.com')])).toEqual([false]);
  });
});

describe('seenFirstElsewhere: what stays a change', () => {
  it('a view read at or before the base says nothing of the change since', async () => {
    await stored(7, at(0), [moved]);
    await stored(7, at(5), [moved], sha(66));
    expect(await flags([change(moved)], [moved])).toEqual([false]);
  });

  it('a view read at the very instant of the pass cannot be ordered with it', async () => {
    await stored(7, at(20), [moved], sha(66));
    expect(await flags([change(moved)], [moved])).toEqual([false]);
  });

  it('a state the other view never held', async () => {
    await stored(7, at(10), [before]);
    expect(await flags([change(moved)], [moved])).toEqual([false]);
  });

  it('a confirmed deletion is never turned into a first sighting', async () => {
    await stored(7, at(10), []);
    expect(await flags([change(before, 'calendar.deleted')], [])).toEqual([false]);
  });

  it('rows that are first sightings already are returned as they are, and a first look reads nothing', async () => {
    await stored(7, at(10), [moved]);
    const sighting = { ...change(moved), firstSighting: true };
    expect(await flags([sighting], [moved])).toEqual([true]);
    const firstLook = await seenFirstElsewhere(db, TWO_WEEKS, null, snapshot(14, at(20), [moved]), [
      change(moved),
    ]);
    expect(firstLook.map((each) => each.firstSighting)).toEqual([false]);
  });
});

/** The orphan candidates of a batch at `evaluatedAt`, as `type:subject`. */
async function orphans(evaluatedAt: IsoTs): Promise<string[]> {
  const window = {
    fromMs: Date.parse('2026-10-01T00:00:00-04:00'),
    toMs: Date.parse('2026-10-20T00:00:00-04:00'),
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

/** A whole pass of that view from tab `sender`, through the handlers. */
function view(count: number, readAt: IsoTs, events: Events, account: string = ACCOUNT, sender = 9) {
  const shown = days('2026-10-04', count);
  const ping = {
    observerId: 'gcal.event',
    source: 'gcal.event' as const,
    accountHash: account,
    lastSyncAt: readAt,
    windowStart: `${shown[0]}T00:00:00-04:00`,
    windowEnd: `${shown[count]}T00:00:00-04:00`,
    allCalendars: true,
    userActive: false,
  };
  return runPass(ctx, snapshot(count, readAt, events), { account, sender, pings: [ping] });
}

describe('through the handlers (v1.12, Decisions [2.close])', () => {
  it('whatever another range held, no change is an orphan: each is stored with its marker', async () => {
    expect(await view(14, at(0), [before])).toEqual({ ok: true });
    expect(await view(14, at(5), [before])).toEqual({ ok: true });
    expect(await view(7, at(10), [moved], ACCOUNT, 7)).toEqual({ ok: true });
    expect(await view(14, at(20), [moved, fresh])).toEqual({ ok: true });
    const allCalendars = { accountHash: ACCOUNT, allCalendars: true };
    expect(await markers(db)).toEqual(
      expect.arrayContaining([markerOf(moved, at(20), allCalendars), markerOf(fresh, at(20), allCalendars)]),
    );
    expect(await orphans(at(30))).toEqual([]);
  });
});
