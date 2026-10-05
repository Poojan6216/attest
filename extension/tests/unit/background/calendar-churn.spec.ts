/**
 * At most CHURN_LIMIT stored `calendar.updated` rows per Calendar event per CHURN_WINDOW_MS (src/background/
 * calendar-churn.ts; SEC-11; Hard Rules 5, 6). Anyone who organises an event on the user's calendar can edit it by
 * script while the user's Calendar tab is open, and every state is its own row: without a cap each edit a pass sees
 * is one more row kept for 90 days. Past the cap an event's updates are held back (its base still moves), the pass
 * records its windows without `changesSince` and breaks the run of followed changes, and the observer is DEGRADED
 * `ledger.event_churn` until a pass holds nothing back. Creations, deletions and first sightings are never held back.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CHURN_LIMIT, CHURN_WINDOW_MS, capUpdates } from '../../../src/background/calendar-churn';
import { EVENT_CHURN_REASON } from '../../../src/background/calendar-pass';
import { accountMadeChange } from '../../../src/background/calendar-own';
import { calendarStep, staleChangeMs } from '../../../src/background/calendar-step';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { IsoTs } from '../../../src/core/schema';
import type { CalendarRecord } from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth } from '../../../src/ledger/repo';
import type { RawRow } from '../../../src/observers/types';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, event, keyOf, week } from './calendar-fixtures';
import { eventOn, runPass, windows } from './calendar-pass-harness';
import { contextOf, healthOf, type TestContext } from './observer-harness';
import { onHealth } from '../../../src/background/observer-messages';

const update = (id: string): RawRow => ({ type: 'calendar.updated', rowKey: keyOf(id), fields: {} });
const created = (id: string): RawRow => ({ type: 'calendar.created', rowKey: keyOf(id), fields: {} });
const present = (...ids: string[]) => new Set(ids.map(keyOf));

describe('capUpdates', () => {
  it('keeps CHURN_LIMIT updates of one event per window, holds back the rest, and never a creation', () => {
    expect([CHURN_LIMIT, CHURN_WINDOW_MS]).toEqual([20, 24 * 60 * 60_000]);
    let windowsNow = capUpdates([], [], at(0), present('a')).updates;
    let kept = 0;
    for (let i = 1; i <= CHURN_LIMIT; i += 1) {
      const capped = capUpdates([update('a')], windowsNow, at(i), present('a'));
      kept += capped.rows.length;
      windowsNow = capped.updates;
    }
    expect(kept).toBe(CHURN_LIMIT);
    expect(windowsNow).toEqual([{ key: keyOf('a'), since: at(1), count: CHURN_LIMIT }]);
    const past = capUpdates(
      [update('a'), created('b'), update('c')],
      windowsNow,
      at(30),
      present('a', 'b', 'c'),
    );
    expect(past.rows).toEqual([created('b'), update('c')]);
    expect(past.heldBack).toBe(1);
    expect(past.updates).toEqual(
      [
        ...[{ key: keyOf('a'), since: at(1), count: CHURN_LIMIT }],
        { key: keyOf('c'), since: at(30), count: 1 },
      ].sort((x, y) => (x.key < y.key ? -1 : 1)),
    );
  });

  it('a window ends CHURN_WINDOW_MS after its first row, or when the clock went back past it', () => {
    const full = [{ key: keyOf('a'), since: at(1), count: CHURN_LIMIT }];
    const day = CHURN_WINDOW_MS / 60_000;
    expect(capUpdates([update('a')], full, at(day), present('a'))).toMatchObject({ heldBack: 1 });
    const next = capUpdates([update('a')], full, at(1 + day), present('a'));
    expect(next).toMatchObject({ heldBack: 0, updates: [{ key: keyOf('a'), since: at(1 + day), count: 1 }] });
    expect(capUpdates([update('a')], full, at(0), present('a'))).toMatchObject({ heldBack: 0 });
  });

  it('keeps no window of an event the next base does not hold', () => {
    const open = [{ key: keyOf('gone'), since: at(1), count: 3 }];
    expect(capUpdates([], open, at(2), present('a')).updates).toEqual([]);
  });
});

/** The week with event 'e' titled `title`, read at `readAt`. */
const retitled = (title: string, readAt: IsoTs) =>
  week([event('e', { subjectHint: title }), event('f')], { readAt });
const OPTIONS = { staleAfterMs: staleChangeMs(DEFAULT_POLICY), ownChange: accountMadeChange };

describe('calendarStep under 1,000 scripted edits of one event', () => {
  it('stores at most CHURN_LIMIT updates a day, holds back the rest, and its base follows the page', () => {
    let stored: CalendarRecord | null = null;
    let rows = 0;
    let heldBack = 0;
    let plainWhileHeld = 0;
    for (let i = 0; i <= 1_000; i += 1) {
      const next = retitled(`Edit ${String(i)}`, at(i));
      const step = calendarStep(stored, next, OPTIONS);
      rows += step.rows.filter(({ row }) => row.type === 'calendar.updated').length;
      heldBack += step.heldBack;
      if (step.heldBack > 0 && step.coverage.kind === 'plain') plainWhileHeld += 1;
      expect(step.snapshot.events.find((each) => each.key === keyOf('e'))?.subjectHint).toBe(
        `Edit ${String(i)}`,
      );
      // Every row stored is a first sighting (v1.12): the cap bounds the markers too.
      expect(step.rows.every((each) => each.firstSighting)).toBe(true);
      stored = {
        observerId: 'gcal.event',
        accountHash: ACCOUNT,
        range: step.snapshot.range,
        snapshot: step.snapshot,
        pending: [...step.pending],
        updates: [...step.updates],
      };
    }
    expect(rows).toBe(CHURN_LIMIT);
    expect(heldBack).toBe(1_000 - CHURN_LIMIT);
    expect(plainWhileHeld).toBe(heldBack);
  });

  it('a pass that held an update back breaks the run of followed changes; the next clean one restarts it there', () => {
    let stored: CalendarRecord | null = null;
    const steps = [];
    for (let i = 0; i <= CHURN_LIMIT + 2; i += 1) {
      const step = calendarStep(
        stored,
        retitled(i <= CHURN_LIMIT + 1 ? `Edit ${String(i)}` : `Edit ${String(i - 1)}`, at(i)),
        OPTIONS,
      );
      steps.push(step);
      stored = {
        observerId: 'gcal.event',
        accountHash: ACCOUNT,
        range: step.snapshot.range,
        snapshot: step.snapshot,
        pending: [...step.pending],
        updates: [...step.updates],
      };
    }
    const held = steps[CHURN_LIMIT + 1];
    const after = steps[CHURN_LIMIT + 2];
    expect(held?.heldBack).toBe(1);
    expect(held?.coverage).toEqual({ kind: 'plain' });
    expect(held?.snapshot.baselineAt).toBe(at(CHURN_LIMIT + 1));
    expect(after?.heldBack).toBe(0);
    expect(after?.coverage).toEqual({ kind: 'followed', changesSince: at(CHURN_LIMIT + 1) });
  });
});

describe('through the handlers', () => {
  let db: LedgerDb;
  let ctx: TestContext;

  beforeEach(async () => {
    pinClock();
    db = await openLedger(uniqueDbName('calendar-churn'));
    ctx = contextOf(db, { now: () => at(10_000) });
  });

  afterEach(() => {
    db.close();
    releaseClock();
  });

  const standup = (title: string) => eventOn('e', '2026-10-06', 10, { subjectHint: title });

  /** One pass as the content script posts it: its own health (OK), its pings, its snapshot. */
  async function passAt(minute: number, title: string) {
    await onHealth(ctx, healthOf('gcal.event', at(minute)));
    return runPass(ctx, week([standup(title)], { readAt: at(minute) }));
  }

  it('60 edits a minute apart store the first look and CHURN_LIMIT updates; DEGRADED event_churn until a clean pass', async () => {
    for (let i = 0; i < 60; i += 1) expect(await passAt(i, `Edit ${String(i)}`)).toEqual({ ok: true });
    const types = (await db.observations.toArray()).map((row) => row.type);
    expect(types.filter((type) => type === 'calendar.created')).toHaveLength(1);
    expect(types.filter((type) => type === 'calendar.updated')).toHaveLength(CHURN_LIMIT);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({
      status: 'DEGRADED',
      reasons: [EVENT_CHURN_REASON],
    });
    // The last held-back pass recorded its window without changesSince.
    expect((await windows(db)).at(-1)).not.toHaveProperty('changesSince');
    expect(await passAt(60, 'Edit 59')).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ status: 'OK', checkedAt: at(60) });
  });
});
