/**
 * Observer health as the service worker keeps it (src/ledger/health.ts; sprint_2 2.7; Hard Rule 6): a DEGRADED the
 * service worker set (`ledger.<code>`) stays until a later clean pass of the observer is fully accepted.
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
import { getAdapterHealth } from '../../../src/ledger/repo';
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
    expect(await recordOwnHealth(db, own(T2))).toEqual({ written: true });
    expect(await recordOwnHealth(db, own(T1, ['not_sent_folder']))).toEqual({ written: false });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: T2 });
  });

  it('never lets an OK report replace a DEGRADED the service worker set', async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T1 });
    expect(await recordOwnHealth(db, own(T2))).toEqual({ written: false });
    expect(setByLedger(await getAdapterHealth(db, 'gmail.sent'))).toBe(true);
  });

  it('keeps the service worker reasons beside a DEGRADED report of the observer', async () => {
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.invalid_input'], at: T1 });
    await recordOwnHealth(db, own(T2, ['not_sent_folder']));
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['not_sent_folder', 'ledger.invalid_input'],
      checkedAt: T2,
    });
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
    await recordOwnHealth(db, own(T1, ['not_sent_folder']));
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.invalid_input'], at: T2 });
    await markLedgerDegraded(db, { adapterId: 'gmail.sent', reasons: ['ledger.late_sighting'], at: T3 });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['not_sent_folder', 'ledger.invalid_input', 'ledger.late_sighting'],
      checkedAt: T3,
    });
  });

  it('names an unknown version when the observer never reported one, and needs ledger reasons', async () => {
    await markLedgerDegraded(db, { adapterId: 'gcal.event', reasons: ['ledger.invalid_input'], at: T1 });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ version: UNKNOWN_VERSION });
    await expectLedgerError(
      markLedgerDegraded(db, { adapterId: 'gcal.event', reasons: ['not_sent_folder'], at: T1 }),
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
    await recordOwnHealth(db, own(T1, ['not_sent_folder']));
    expect(await clearLedgerDegraded(db, own(T2))).toEqual({ cleared: false });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ reasons: ['not_sent_folder'] });
  });
});
