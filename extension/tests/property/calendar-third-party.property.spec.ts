/**
 * No Calendar row is ever an orphan (docs/grading.md §3, §7 v1.12; SEC-1; Hard Rule 7), over random histories run
 * through the real service-worker handlers and ledger, the way the wave D/E simulator ran them: account A follows a
 * week a minute at a time (sometimes three) while events appear, move, are renamed and disappear on its own and on a
 * shared calendar (an invitation Google adds, an organiser's reschedule or cancellation, a colleague's edit), the
 * shared calendar is switched on and off, a day hides events behind "N more", account B looks at the same week, and a
 * page that names no account posts its first sightings. Whatever happened, every stored `gcal.event` row carries its
 * first-look marker, and a batch's own orphan discovery finds none.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { coveredObservations, visibleAt } from '../../src/core/batch-orphans';
import { createMemoryIndex } from '../../src/core/candidates';
import { instantMs } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import type { IsoTs } from '../../src/core/schema';
import { coverageFor } from '../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../src/ledger/db';
import { openLedger } from '../../src/ledger/migrations';
import { Observation } from '../../src/ledger/types';
import { sha, uniqueDbName } from '../unit/ledger/fixtures';
import { at, DAYS, type EventInput, FAMILY, MAIN, week } from '../unit/background/calendar-fixtures';
import {
  eventOn,
  markers,
  postedElsewhere,
  runPass,
  weekPing,
} from '../unit/background/calendar-pass-harness';
import { contextOf, type TestContext } from '../unit/background/observer-harness';

const B = sha(66);
const TITLES = ['Standup', 'Design review', 'Invitation from a stranger', 'Dentist (colleague)'];

/** One event of the world: its id, day, hour, title and calendar. */
interface Spec {
  readonly id: number;
  readonly day: number;
  readonly hour: number;
  readonly title: number;
  readonly shared: boolean;
}

const specArb = (id: number): fc.Arbitrary<Spec> =>
  fc.record({
    id: fc.constant(id),
    day: fc.integer({ min: 0, max: 6 }),
    hour: fc.integer({ min: 8, max: 18 }),
    title: fc.integer({ min: 0, max: TITLES.length - 1 }),
    shared: fc.boolean(),
  });

const eventOf = (spec: Spec): EventInput =>
  eventOn(`e${String(spec.id)}`, DAYS[spec.day] ?? '2026-10-04', spec.hour, {
    subjectHint: `${TITLES[spec.title] ?? ''} ${String(spec.id)}`,
    calendar: spec.shared ? FAMILY : MAIN,
  });

/** One look at the week: who looks, how long after the last look, what the calendars hold, what the page shows. */
interface Look {
  readonly who: 'A' | 'B' | 'none';
  readonly gapMin: number;
  readonly world: readonly Spec[];
  readonly familyShown: boolean;
  readonly hiddenDay: number | null;
}

/** Up to 5 events with ids 0..4, each present or not, each in a random state. */
const worldArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 4 }), { maxLength: 5 })
  .chain((ids) => fc.tuple(...ids.map((id) => specArb(id))));

const lookArb: fc.Arbitrary<Look> = fc.record({
  who: fc.constantFrom<Look['who']>('A', 'A', 'A', 'A', 'B', 'none'),
  gapMin: fc.constantFrom(1, 1, 1, 3),
  world: worldArb,
  familyShown: fc.boolean(),
  hiddenDay: fc.option(fc.integer({ min: 0, max: 6 }), { freq: 4 }),
});

/** Runs one look at minute `minute` through the handlers. */
async function look(ctx: TestContext, step: Look, minute: number): Promise<void> {
  const readAt = at(minute);
  const events = step.world.map(eventOf);
  if (step.who === 'none') {
    for (const event of events) await postedElsewhere(ctx, event, readAt).catch(() => undefined);
    return;
  }
  const hidden = step.hiddenDay === null ? [] : [DAYS[step.hiddenDay] ?? ''];
  const visible = events.filter(
    (event) =>
      (event.calendar === MAIN || step.familyShown) && !event.days.some((day) => hidden.includes(day)),
  );
  const snapshot = week(visible, { readAt, familyShown: step.familyShown, hidden });
  const account = step.who === 'A' ? undefined : B;
  const pings =
    hidden.length > 0
      ? []
      : [weekPing(readAt, { allCalendars: step.familyShown, ...(account ? { accountHash: account } : {}) })];
  await runPass(ctx, snapshot, { pings, ...(account === undefined ? {} : { account, sender: 8 }) });
}

/** The orphan candidates of a batch at `evaluatedAt` over the week. */
async function orphans(db: LedgerDb, evaluatedAt: IsoTs): Promise<string[]> {
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
  return found.map(({ observation }) => `${observation.type}:${observation.subjectHint ?? ''}`);
}

describe('no Calendar row is an orphan, whoever changed the calendar (v1.12)', () => {
  it('every stored row has its first-look marker, and a batch finds no orphan', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(lookArb, { minLength: 2, maxLength: 7 }), async (looks) => {
        const db = await openLedger(uniqueDbName('calendar-third-party-property'));
        try {
          const ctx = contextOf(db, { now: () => at(10_000) });
          let minute = 0;
          for (const step of looks) {
            minute += step.gapMin;
            await look(ctx, step, minute);
          }
          const rows = readRows('observations', Observation, await db.observations.toArray());
          const marks = await markers(db);
          for (const row of rows) {
            const seen = instantMs(row.sightedAt ?? row.observedAt);
            const marked = marks.some(
              (mark) =>
                instantMs(mark.windowStart) === instantMs(row.occurredAt) &&
                mark.changesSince !== undefined &&
                instantMs(mark.changesSince) === seen,
            );
            expect(marked, `${row.type} ${row.subjectHint ?? ''}`).toBe(true);
          }
          expect(await orphans(db, at(minute + 30))).toEqual([]);
        } finally {
          db.close();
        }
      }),
      { numRuns: 40 },
    );
  });
});
