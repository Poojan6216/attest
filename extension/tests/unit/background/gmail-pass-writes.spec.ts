/**
 * What one Gmail pass costs the service worker (TECH-2; docs/grading.md §3 "Observer obligations"; Hard Rules 5, 6).
 *
 * A Gmail Sent pass re-posts every row of the head of the list; before, each row was stored in its own readwrite
 * transaction and every health report was rewritten and announced, so an 11-row pass opened 18 readwrite
 * transactions. Now a message's rows are stored in one transaction with the clock guard, while each row's refusal is
 * still collected (a refusal inside one row's write never aborts the rows around it), a ping is recorded in one
 * transaction with the guard, and a repeat of the stored health report is neither rewritten nor announced.
 * Counted on the real IndexedDB transactions fake-indexeddb opens.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onCoveragePing, onHealth, onObservations } from '../../../src/background/observer-messages';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getObservation } from '../../../src/ledger/repo';
import { makeObservation, makePing, pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { contextOf, healthOf, pingOf, rowsOf, tab, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

/** Readwrite transactions IndexedDB opened while `counting` (Dexie binds `transaction` when it opens: spy first). */
const counter = { counting: false, readwrite: 0 };

beforeEach(async () => {
  pinClock();
  const open: (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) => IDBTransaction =
    Reflect.get(IDBDatabase.prototype, 'transaction');
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase['transaction']>
  ) {
    if (counter.counting && args[1] === 'readwrite') counter.readwrite += 1;
    return open.apply(this, args);
  });
  db = await openLedger(uniqueDbName('gmail-pass-writes'));
  ctx = contextOf(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  releaseClock();
});

const SIGHTED = '2026-10-01T10:20:00-04:00';
const NEXT = '2026-10-01T10:20:30-04:00';
const LATER = '2026-10-01T10:25:00-04:00';

/** Counts the readwrite transactions IndexedDB opens while `act` runs. */
async function readwriteDuring(act: () => Promise<unknown>): Promise<number> {
  counter.readwrite = 0;
  counter.counting = true;
  try {
    await act();
  } finally {
    counter.counting = false;
  }
  return counter.readwrite;
}

const rowsAt = (observedAt: string) =>
  Array.from({ length: 11 }, (_, index) => makeObservation({ rowKeyHash: sha(index + 1), observedAt }));

/** One Sent head pass: its health, its rows, its ping (src/observers/base.ts order). */
async function sentPass(at: string): Promise<void> {
  expect(await onHealth(ctx, healthOf('gmail.sent', at))).toEqual({ ok: true });
  expect(await onObservations(ctx, rowsOf('gmail.sent', rowsAt(at)))).toEqual({ ok: true });
  const ping = makePing({
    observerId: 'gmail.sent',
    lastSyncAt: at,
    windowStart: '2026-10-01T09:00:00-04:00',
    windowEnd: at,
  });
  expect(await onCoveragePing(ctx, pingOf(ping), tab())).toEqual({ ok: true });
}

describe('an 11-row Gmail Sent pass', () => {
  it('opens one readwrite transaction for its rows, one for its ping, and one for a new health report', async () => {
    expect(await readwriteDuring(() => sentPass(SIGHTED))).toBe(3);
    expect(await db.observations.count()).toBe(11);
  });

  it('the next pass, re-posting the same rows with the same health, opens two and announces no health', async () => {
    await sentPass(SIGHTED);
    ctx.notified.length = 0;
    expect(await readwriteDuring(() => sentPass(NEXT))).toBe(2);
    expect(ctx.notified).not.toContainEqual(['adapterHealth']);
  });
});

describe('one transaction per message still collects each row’s refusal', () => {
  it('a row refused inside its own write (late_sighting) neither aborts nor hides the rows around it', async () => {
    const late = makeObservation({ rowKeyHash: sha(500), observedAt: LATER });
    expect(await onObservations(ctx, rowsOf('gmail.sent', [late]))).toEqual({ ok: true });
    const before = makeObservation({ rowKeyHash: sha(501), observedAt: SIGHTED });
    const after = makeObservation({ rowKeyHash: sha(502), observedAt: SIGHTED });
    const earlier = makeObservation({ rowKeyHash: sha(500), observedAt: SIGHTED });
    const answer = await onObservations(ctx, rowsOf('gmail.sent', [before, earlier, after]));
    expect(answer).toEqual({ ok: false, code: 'late_sighting' });
    expect(await getObservation(db, before.id)).toEqual(before);
    expect(await getObservation(db, after.id)).toEqual(after);
    expect(await getObservation(db, late.id)).toEqual(late);
  });
});
