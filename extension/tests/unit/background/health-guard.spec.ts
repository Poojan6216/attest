/**
 * SEC-4 (Hard Rule 6: fail loud, never cry wolf): an observer's own health report is held to the same clock and
 * identity rules as its rows and pings, and a report stored while the clock ran ahead never freezes the observer's
 * health once the clock comes back.
 *  - A report of an observer the extension does not have is refused, and nothing of it is kept.
 *  - A report checked after the service worker's clock is refused `clock_behind`, as rows and pings are.
 *  - The clock guard repairs `adapterHealth`: the observer's own report stored "in the future" goes (the honest
 *    report being stored takes its place); a DEGRADED the service worker set is re-stamped at now and still stands.
 *  - A refusal is never stamped after the clock, so a later clean pass can always clear it.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onCalendarSnapshot } from '../../../src/background/calendar-pass';
import { onCoveragePing, onHealth, onObservations } from '../../../src/background/observer-messages';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth } from '../../../src/ledger/repo';
import {
  captureLogs,
  makeObservation,
  makePing,
  pinClock,
  releaseClock,
  uniqueDbName,
} from '../ledger/fixtures';
import { ACCOUNT, at, event, week } from './calendar-fixtures';
import { contextOf, HANDLER_NOW, healthOf, pingOf, rowsOf, snapshotOf, tab } from './observer-harness';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('health-guard'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** A year ahead of the handlers' clock: the instants a clock that jumped forward stamps. */
const AHEAD = '2027-10-03T13:59:00-04:00';
const AHEAD_NOW = '2027-10-03T14:00:00-04:00';

describe('an own health report is held to the clock and to the observers the extension has', () => {
  it('a report of an observer the extension does not have is refused, and nothing of it is kept', async () => {
    const ctx = contextOf(db);
    const { records, restore } = captureLogs();
    expect(await onHealth(ctx, healthOf('muse', at(100)))).toEqual({ ok: false, code: 'invalid_input' });
    restore();
    expect(await db.adapterHealth.count()).toBe(0);
    expect(ctx.state.ownHealth.size + ctx.state.refused.size + ctx.state.queues.size).toBe(0);
    expect(records.map((record) => [record.event, record.fields])).toEqual([
      ['observer.refused', { observer: 'muse', type: 'adapter.health', code: 'invalid_input', count: 1 }],
    ]);
  });

  it('a report checked after the service worker clock is refused clock_behind and never stored', async () => {
    const ctx = contextOf(db);
    const ahead = at(121);
    expect(await onHealth(ctx, healthOf('gmail.sent', ahead))).toEqual({ ok: false, code: 'clock_behind' });
    expect(await getAdapterHealth(db, 'gmail.sent')).toBeUndefined();
    expect(await onHealth(ctx, healthOf('gmail.sent', HANDLER_NOW))).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ checkedAt: HANDLER_NOW });
  });
});

describe('the clock guard repairs health stored while the clock ran ahead', () => {
  it('an OK stored a year ahead no longer hides the DEGRADED an honest pass reports once the clock is back', async () => {
    const ahead = contextOf(db, { now: () => AHEAD_NOW });
    expect(await onHealth(ahead, healthOf('gmail.sent', AHEAD))).toEqual({ ok: true });
    const back = contextOf(db);
    const report = healthOf('gmail.sent', at(119.5), ['selector.missing.grid']);
    expect(await onHealth(back, report)).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.grid'],
      checkedAt: at(119.5),
    });
    expect(back.notified).toContainEqual(['adapterHealth']);
  });

  it('a DEGRADED the service worker set a year ahead is re-stamped at now, and a later clean pass clears it', async () => {
    const ahead = contextOf(db, { now: () => AHEAD_NOW });
    // A ping whose window cannot be what it says: refused, DEGRADED, stamped at its (future) pass.
    const bad = makePing({
      observerId: 'gmail.sent',
      lastSyncAt: AHEAD,
      windowStart: AHEAD,
      windowEnd: AHEAD_NOW,
    });
    expect(await onCoveragePing(ahead, pingOf(bad), tab())).toMatchObject({ ok: false });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'DEGRADED', checkedAt: AHEAD });

    const back = contextOf(db);
    expect(await onHealth(back, healthOf('gmail.sent', at(119)))).toEqual({ ok: true });
    // Re-stamped at the clock: it still stands (an OK report never clears it on its own)...
    const restamped = await getAdapterHealth(db, 'gmail.sent');
    expect(restamped).toMatchObject({ status: 'DEGRADED', reasons: ['ledger.invalid_input'] });
    expect(Date.parse(restamped?.checkedAt ?? '')).toBe(Date.parse(HANDLER_NOW));
    // ...and a later pass, once accepted, clears it: no longer frozen until 2027.
    const later = contextOf(db, { now: () => at(125) });
    const sighted = at(121);
    expect(await onHealth(later, healthOf('gmail.sent', sighted))).toEqual({ ok: true });
    const row = makeObservation({ observedAt: sighted });
    expect(await onObservations(later, rowsOf('gmail.sent', [row]))).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: sighted });
  });
});

describe('a refusal is never stamped after the clock', () => {
  it('a ping synced after the clock is clock_behind before anything else, never DEGRADED', async () => {
    const ctx = contextOf(db);
    const bad = makePing({
      observerId: 'gmail.sent',
      lastSyncAt: at(130),
      windowStart: at(100),
      windowEnd: at(125),
    });
    expect(await onCoveragePing(ctx, pingOf(bad), tab())).toEqual({ ok: false, code: 'clock_behind' });
    expect(await getAdapterHealth(db, 'gmail.sent')).toBeUndefined();
  });

  it('a refused snapshot read after the clock turns DEGRADED at now, so the next accepted pass clears it', async () => {
    const ctx = contextOf(db);
    // Not the Calendar observer's: refused invalid_input, stamped at its read, which is after the clock.
    const forged = snapshotOf(week([event('a')], { readAt: at(150) }), ACCOUNT, 'gmail.sent');
    expect(await onCalendarSnapshot(ctx, forged, tab())).toEqual({ ok: false, code: 'invalid_input' });
    const stamped = await getAdapterHealth(db, 'gmail.sent');
    expect(Date.parse(stamped?.checkedAt ?? '')).toBe(Date.parse(HANDLER_NOW));
    const later = contextOf(db, { now: () => at(125) });
    const sighted = at(121);
    expect(await onHealth(later, healthOf('gmail.sent', sighted))).toEqual({ ok: true });
    expect(
      await onObservations(later, rowsOf('gmail.sent', [makeObservation({ observedAt: sighted })])),
    ).toEqual({
      ok: true,
    });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: sighted });
  });
});
