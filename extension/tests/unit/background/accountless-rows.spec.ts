/**
 * Calendar rows of a page with no account (src/background/calendar-rows.ts `storeAccountlessRows`, through
 * `observer.observations`; docs/grading.md §3; Decisions [2.7] wave D; Hard Rules 5, 7): every one is a first sighting
 * of its pass, stored with an account-less first-look marker, all in one transaction or none of them, and the pass's
 * coverage follows only rows that were stored.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onCoveragePing, onObservations } from '../../../src/background/observer-messages';
import { idFromHash } from '../../../src/core/hash';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth } from '../../../src/ledger/repo';
import { makeObservation, omit, pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { at, event } from './calendar-fixtures';
import { eventOn, markerOf, markers, rowOf, weekPing, windows } from './calendar-pass-harness';
import { contextOf, pingOf, rowsOf, tab, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('accountless-rows'));
  ctx = contextOf(db);
});

afterEach(() => {
  db.close();
  releaseClock();
});

const a = event('a');
const b = eventOn('b', '2026-10-07');
/** The pass's coverage: the week, with no account. */
const accountless = omit(weekPing(at(0)), 'accountHash');

describe('rows of a Calendar page with no account', () => {
  it('are each stored with an account-less marker, and announce both tables', async () => {
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(a, at(0)), rowOf(b, at(0))]))).toEqual({
      ok: true,
    });
    expect(await db.observations.count()).toBe(2);
    expect(await markers(db)).toEqual([markerOf(a, at(0), {}), markerOf(b, at(0), {})]);
    expect(ctx.notified).toContainEqual(['observations', 'coverageIntervals']);
    // The pass's coverage follows them.
    expect(await onCoveragePing(ctx, pingOf(accountless), tab())).toEqual({ ok: true });
    expect(await windows(db)).toHaveLength(1);
  });

  it('a re-sighting by a later pass stores nothing new and no second marker', async () => {
    await onObservations(ctx, rowsOf('gcal.event', [rowOf(a, at(0))]));
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(a, at(10))]))).toEqual({ ok: true });
    expect(await markers(db)).toEqual([markerOf(a, at(0), {})]);
  });

  it('one refused row leaves none of the message: no row, no marker, no coverage, DEGRADED', async () => {
    const forgedHash = sha(4242);
    const forged = {
      ...rowOf(b, at(0)),
      merchant: 'Acme Store',
      contentHash: forgedHash,
      id: idFromHash(forgedHash),
    };
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(a, at(0)), forged]))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await onCoveragePing(ctx, pingOf(accountless), tab())).toEqual({ ok: false, code: 'refused' });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ reasons: ['ledger.invalid_input'] });
  });

  it('a row of another source refuses the whole message before the ledger', async () => {
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(a, at(0)), makeObservation()]))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
  });

  it('a late sighting refuses the whole message', async () => {
    await onObservations(ctx, rowsOf('gcal.event', [rowOf(b, at(10))]));
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(a, at(0)), rowOf(b, at(0))]))).toEqual({
      ok: false,
      code: 'late_sighting',
    });
    expect((await db.observations.toArray()).map((row) => row.subjectHint)).toEqual(['Event b']);
    expect(await markers(db)).toEqual([markerOf(b, at(10), {})]);
  });
});
