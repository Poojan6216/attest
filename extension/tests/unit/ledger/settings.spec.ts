import 'fake-indexeddb/auto';
/**
 * The retention window the ledger keeps (sprint_4 4.5; src/ledger/settings.ts): 90 days until the person chooses; one
 * of 30, 90 or 180 once saved, and never anything else; a stored value that is not one of them reads as the default,
 * never as a shorter window; and the daily purge keeps the window saved (src/ledger/retention-clock.ts). Every value
 * is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt, upsertClaim } from '../../../src/ledger/repo';
import { purgeAtTrustedClock } from '../../../src/ledger/retention-clock';
import { readRetentionDays, RETENTION_DAYS_KEY, saveRetentionDays } from '../../../src/ledger/settings';
import { type LogRecord, setLogSink } from '../../../src/log';
import { claimId, makeClaim, makeReceipt, pinClock, releaseClock, sha, ulid, uniqueDbName } from './fixtures';

let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;

beforeEach(async () => {
  pinClock('2026-10-01T10:30:00-04:00');
  db = await openLedger(uniqueDbName('settings'));
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(() => {
  restore();
  db.close();
  releaseClock();
});

describe('the retention window', () => {
  it('is 90 days until chosen, then the one saved; nothing but 30, 90 or 180 is saved', async () => {
    expect(await readRetentionDays(db)).toBe(90);
    await saveRetentionDays(db, 30);
    expect(await readRetentionDays(db)).toBe(30);
    await expect(saveRetentionDays(db, 45 as 30)).rejects.toThrow();
    expect(await readRetentionDays(db)).toBe(30);
  });

  it('reads a stored value that is not a choice as the default, never as a shorter window', async () => {
    await db.meta.put({ key: RETENTION_DAYS_KEY, value: 1 });
    expect(await readRetentionDays(db)).toBe(90);
    expect(records.some(({ event }) => event === 'ledger.row_invalid')).toBe(true);
  });

  it('is what the daily purge keeps: a claim 40 days old stays under 90 days and goes under 30', async () => {
    const old = '2026-08-22T10:00:00-04:00';
    const now = '2026-10-01T10:30:00-04:00';
    await upsertClaim(db, makeClaim({ rawHash: sha(101), claimedAt: old, observedAt: old }));
    await putReceipt(db, makeReceipt({ id: ulid(1), claimId: claimId(101), computedAt: old }));
    // A claim sighted now: the purge trusts the clock up to the latest instant stored (retention-clock.ts).
    await upsertClaim(db, makeClaim({ rawHash: sha(102), claimedAt: now, observedAt: now }));
    await purgeAtTrustedClock(db, { now });
    expect(await db.claims.count()).toBe(2);
    await saveRetentionDays(db, 30);
    await purgeAtTrustedClock(db, { now });
    expect((await db.claims.toArray()).map(({ id }) => id)).toEqual([claimId(102)]);
    expect(await db.receipts.count()).toBe(0);
  });
});
