/**
 * What a `gcal.event` coverage window can be (src/background/calendar-window.ts; SEC-8; docs/grading.md §3; Hard
 * Rule 5). The Calendar observer sends one window per run of whole visible days, in a range of at most MAX_RANGE_DAYS
 * days: at least a day (23 hours on the day a DST change skips an hour) and at most MAX_RANGE_DAYS days (plus the hour
 * a DST change adds). A window outside that was never seen; one with no account would otherwise be recorded as it
 * came, counting for grace and keeping rows from being orphans over its whole span, so the service worker refuses
 * it (`invalid_input`, DEGRADED).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  calendarWindowFits,
  MAX_CALENDAR_WINDOW_MS,
  MIN_CALENDAR_WINDOW_MS,
} from '../../../src/background/calendar-window';
import { onCoveragePing } from '../../../src/background/observer-messages';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { MAX_RANGE_DAYS } from '../../../src/observers/gcal/snapshot';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { contextOf, pingOf, tab, type TestContext } from './observer-harness';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const span = (windowStart: string, windowEnd: string) => ({ windowStart, windowEnd });

describe('calendarWindowFits', () => {
  it('a day, a week and six weeks fit; so do the days a DST change makes 23 or 25 hours long', () => {
    expect(MIN_CALENDAR_WINDOW_MS).toBe(DAY - HOUR);
    expect(MAX_CALENDAR_WINDOW_MS).toBe(MAX_RANGE_DAYS * DAY + HOUR);
    for (const window of [
      span('2026-10-06T00:00:00-04:00', '2026-10-07T00:00:00-04:00'),
      span('2026-10-04T00:00:00-04:00', '2026-10-11T00:00:00-04:00'),
      span('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'),
      span('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'),
      span('2026-11-01T00:00:00-04:00', '2026-11-12T00:00:00-05:00'),
      span('2026-10-25T00:00:00-04:00', '2026-12-06T00:00:00-05:00'),
    ])
      expect(calendarWindowFits(window), JSON.stringify(window)).toBe(true);
  });

  it('a window shorter than a day, or longer than six weeks, was never seen by a pass', () => {
    for (const window of [
      span('2026-10-06T10:00:00-04:00', '2026-10-06T10:00:00-04:00'),
      span('2026-10-06T00:00:00-04:00', '2026-10-06T22:00:00-04:00'),
      span('2026-10-04T00:00:00-04:00', '2026-11-16T00:00:00-05:00'),
      span('1990-01-01T00:00:00-05:00', '2090-01-01T00:00:00-05:00'),
      span('2026-10-11T00:00:00-04:00', '2026-10-04T00:00:00-04:00'),
    ])
      expect(calendarWindowFits(window), JSON.stringify(window)).toBe(false);
  });
});

describe('the service worker refuses a gcal.event window no pass can send (SEC-8)', () => {
  let db: LedgerDb;
  let ctx: TestContext;

  beforeEach(async () => {
    pinClock();
    db = await openLedger(uniqueDbName('calendar-window'));
    ctx = contextOf(db, { now: () => '2026-10-03T14:00:00-04:00' });
  });

  afterEach(() => {
    db.close();
    releaseClock();
  });

  const accountless = (windowStart: string, windowEnd: string) =>
    pingOf({
      observerId: 'gcal.event',
      source: 'gcal.event',
      lastSyncAt: '2026-10-03T13:00:00-04:00',
      windowStart,
      windowEnd,
      allCalendars: true,
      userActive: false,
    });

  it('an account-less window of a century: invalid_input, nothing recorded', async () => {
    const ack = await onCoveragePing(
      ctx,
      accountless('1990-01-01T00:00:00-05:00', '2090-01-01T00:00:00-05:00'),
      tab(),
    );
    expect(ack).toEqual({ ok: false, code: 'invalid_input' });
    expect(await db.coverageIntervals.count()).toBe(0);
  });

  it('an account-less week is recorded as before', async () => {
    const ack = await onCoveragePing(
      ctx,
      accountless('2026-10-04T00:00:00-04:00', '2026-10-11T00:00:00-04:00'),
      tab(),
    );
    expect(ack).toEqual({ ok: true });
    expect(await db.coverageIntervals.count()).toBe(1);
  });
});
