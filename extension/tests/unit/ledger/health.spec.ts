/**
 * Observer health as the service worker keeps it (src/ledger/health.ts; sprint_2 2.7; Hard Rule 6): a DEGRADED the
 * service worker set (`ledger.<code>`) stays until a later clean pass of the observer is fully accepted, and an IDLE
 * report (a page the observer does not read) never replaces the status a page it reads gave (sprint_2 2.11).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import {
  clearLedgerDegraded,
  markLedgerDegraded,
  recordOwnHealth,
  setByLedger,
  UNKNOWN_VERSION,
} from '../../../src/ledger/health';
import { openLedger } from '../../../src/ledger/migrations';
import { readInstant } from '../../../src/ledger/clock-high-water';
import { CLOCK_HIGH_WATER } from '../../../src/ledger/clock-guard';
import { getAdapterHealth, putAdapterHealth } from '../../../src/ledger/repo';
import { IsoTs } from '../../../src/ledger/types';
import { expectLedgerError, makeHealth, pinClock, releaseClock, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('health'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const T1 = IsoTs.parse('2026-10-01T10:00:00Z');
const T2 = IsoTs.parse('2026-10-01T10:05:00Z');
const T3 = IsoTs.parse('2026-10-01T10:10:00Z');
const own = (checkedAt: string, reasons: string[] = []) =>
  makeHealth({
    adapterId: 'gmail.sent',
    status: reasons.length === 0 ? 'OK' : 'DEGRADED',
    reasons,
    checkedAt,
  });

describe('recordOwnHealth', () => {
  it('keeps the latest of the observer reports while the service worker set nothing', async () => {
    expect(await recordOwnHealth(db, own(T2))).toEqual({ written: true, changed: true, agrees: true });
    expect(await recordOwnHealth(db, own(T1, ['selector.missing.row']))).toEqual({
      written: false,
      changed: false,
      agrees: false,
    });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: T2 });
  });

  it('never lets an OK report replace a DEGRADED the service worker set', async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T1 });
    expect(await recordOwnHealth(db, own(T2))).toEqual({ written: false, changed: false, agrees: false });
    expect(setByLedger(await getAdapterHealth(db, 'gmail.sent'))).toBe(true);
  });

  it('keeps the service worker reasons beside a DEGRADED report of the observer', async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.invalid_input'], at: T1 });
    await recordOwnHealth(db, own(T2, ['selector.missing.row']));
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.row', 'ledger.invalid_input'],
      checkedAt: T2,
    });
  });
});

const idle = (checkedAt: string, reasons: string[] = ['not_sent_folder']) =>
  makeHealth({ adapterId: 'gmail.sent', status: 'IDLE', reasons, checkedAt });

describe('an IDLE report: a page the observer does not read, beside one it reads (sprint_2 2.11)', () => {
  it('is stored where nothing is, and over an IDLE: the latest one', async () => {
    expect(await recordOwnHealth(db, idle(T1))).toEqual({ written: true, changed: true, agrees: true });
    expect(await recordOwnHealth(db, idle(T2, ['not_sent_list']))).toEqual({
      written: true,
      changed: true,
      agrees: true,
    });
    expect(await recordOwnHealth(db, idle(T1))).toEqual({ written: false, changed: false, agrees: false });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'IDLE',
      reasons: ['not_sent_list'],
      checkedAt: T2,
    });
  });

  it.each([
    ['an OK', [] as string[]],
    ["the observer's own DEGRADED", ['selector.missing.time']],
  ])('never replaces %s, however much later', async (_name, reasons) => {
    await recordOwnHealth(db, own(T1, reasons));
    expect(await recordOwnHealth(db, idle(T3))).toEqual({ written: false, changed: false, agrees: false });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ reasons, checkedAt: T1 });
  });

  it('never replaces a DEGRADED the service worker set', async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T1 });
    expect(await recordOwnHealth(db, idle(T2))).toEqual({ written: false, changed: false, agrees: false });
    expect(setByLedger(await getAdapterHealth(db, 'gmail.sent'))).toBe(true);
  });

  it('replaces the report of its own tab, which moved off the page it reported (QA-L8, SEC-L5)', async () => {
    await recordOwnHealth(db, own(T1, ['view.mismatch']));
    expect(await recordOwnHealth(db, idle(T2), { sameSource: true })).toEqual({
      written: true,
      changed: true,
      agrees: true,
    });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'IDLE', checkedAt: T2 });
    await recordOwnHealth(db, own(T3));
    expect(await recordOwnHealth(db, idle(T2), { sameSource: true })).toMatchObject({ written: false });
  });

  it("never replaces a DEGRADED the service worker set, even its own tab's", async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T1 });
    expect(await recordOwnHealth(db, idle(T2), { sameSource: true })).toMatchObject({ written: false });
    expect(setByLedger(await getAdapterHealth(db, 'gmail.sent'))).toBe(true);
  });

  it('never holds back a report from a page the observer reads, even one read before it', async () => {
    await recordOwnHealth(db, idle(T2));
    expect(await recordOwnHealth(db, own(T1, ['selector.missing.time']))).toEqual({
      written: true,
      changed: true,
      agrees: true,
    });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'DEGRADED', checkedAt: T1 });
  });
});

describe('markLedgerDegraded', () => {
  it('is never ignored: stamped at its pass, or at a later stored report', async () => {
    await recordOwnHealth(db, own(T3));
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T1 });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['ledger.late_sighting'],
      checkedAt: T3,
      version: '1.0.0',
    });
  });

  it('keeps the reasons a DEGRADED report already holds, its own and earlier refusals', async () => {
    await recordOwnHealth(db, own(T1, ['selector.missing.row']));
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.invalid_input'], at: T2 });
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T3 });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.row', 'ledger.invalid_input', 'ledger.late_sighting'],
      checkedAt: T3,
    });
  });

  it('names an unknown version when the observer never reported one, and needs ledger reasons', async () => {
    await markLedgerDegraded(db, { adapterId: 'gcal.event', reasons: ['ledger.invalid_input'], at: T1 });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ version: UNKNOWN_VERSION });
    await expectLedgerError(
      markLedgerDegraded(db, { adapterId: 'gcal.event', reasons: ['selector.missing.row'], at: T1 }),
      'invalid_input',
    );
  });
});

describe('clearLedgerDegraded', () => {
  it('replaces the DEGRADED with the own report of a later accepted pass, and only a later one', async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T2 });
    expect(await clearLedgerDegraded(db, own(T1))).toEqual({ cleared: false });
    expect(await clearLedgerDegraded(db, own(T2))).toEqual({ cleared: false });
    expect(await clearLedgerDegraded(db, own(T3))).toEqual({ cleared: true });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'OK',
      reasons: [],
      checkedAt: T3,
    });
  });

  it('changes nothing when the service worker set nothing', async () => {
    await recordOwnHealth(db, own(T1, ['selector.missing.row']));
    expect(await clearLedgerDegraded(db, own(T2))).toEqual({ cleared: false });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ reasons: ['selector.missing.row'] });
  });
});

describe('a repeat of the stored report (TECH-2: no write, no broadcast, checkedAt kept fresh)', () => {
  const at = (minutes: number, seconds = 0): IsoTs =>
    IsoTs.parse(new Date(Date.parse(T1) + minutes * 60_000 + seconds * 1_000).toISOString());

  it('is not rewritten while the stored one is younger than OBSERVER_HEALTH_REFRESH_MS', async () => {
    expect(await recordOwnHealth(db, own(at(0)))).toEqual({ written: true, changed: true, agrees: true });
    expect(await recordOwnHealth(db, own(at(0, 30)))).toEqual({
      written: false,
      changed: false,
      agrees: true,
    });
    expect(await recordOwnHealth(db, own(at(0, 59)))).toEqual({
      written: false,
      changed: false,
      agrees: true,
    });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ checkedAt: at(0) });
  });

  it('is written once the stored one is that old, so checkedAt stays fresh, but says nothing new', async () => {
    await recordOwnHealth(db, own(at(0)));
    expect(await recordOwnHealth(db, own(at(1)))).toEqual({ written: true, changed: false, agrees: true });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: at(1) });
  });

  it('a change of status, reasons or version is written at once and announced', async () => {
    await recordOwnHealth(db, own(at(0)));
    expect(await recordOwnHealth(db, own(at(0, 5), ['selector.missing.grid']))).toEqual({
      written: true,
      changed: true,
      agrees: true,
    });
    expect(await recordOwnHealth(db, own(at(0, 10), ['selector.missing.row']))).toEqual({
      written: true,
      changed: true,
      agrees: true,
    });
    // A page that recovers clears its DEGRADED at its next pass (Hard Rule 6).
    expect(await recordOwnHealth(db, own(at(0, 15)))).toEqual({ written: true, changed: true, agrees: true });
    const bumped = makeHealth({ adapterId: 'gmail.sent', version: '1.0.1', checkedAt: at(0, 20) });
    expect(await recordOwnHealth(db, bumped)).toEqual({ written: true, changed: true, agrees: true });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      version: '1.0.1',
      checkedAt: at(0, 20),
    });
  });

  it('every health instant written raises the clock high water (SEC-4: the guard repairs it)', async () => {
    await recordOwnHealth(db, own(T2));
    expect(await readInstant(db, CLOCK_HIGH_WATER)).toBe(T2);
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T3 });
    expect(await readInstant(db, CLOCK_HIGH_WATER)).toBe(T3);
    const later = IsoTs.parse(new Date(Date.parse(T3) + 60_000).toISOString());
    await putAdapterHealth(db, makeHealth({ adapterId: 'muse', checkedAt: later }));
    expect(await readInstant(db, CLOCK_HIGH_WATER)).toBe(later);
  });
});

describe('the service worker over a stored IDLE (QA third review, sprint_2 2.11)', () => {
  it("a DEGRADED it sets over an IDLE names none of the IDLE's reasons, and a later IDLE never clears it", async () => {
    await recordOwnHealth(db, idle(T1));
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T2 });
    // `not_sent_folder` described a page that was not read; beside a refused row it would read as the cause.
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['ledger.late_sighting'],
      checkedAt: T2,
    });
    expect(await recordOwnHealth(db, idle(T3))).toEqual({ written: false, changed: false, agrees: false });
    expect(setByLedger(await getAdapterHealth(db, 'gmail.sent'))).toBe(true);
  });
});
