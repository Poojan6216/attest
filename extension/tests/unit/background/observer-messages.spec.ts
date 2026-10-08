/**
 * The service worker's observer handlers (src/background/observer-messages.ts; sprint_2 2.7 and its carry-forwards;
 * docs/grading.md §3 "Observer obligations"; Hard Rules 2, 4, 5, 6) over a real ledger: rows stored one by one
 * through `upsertObservation`, refusals answered and turned DEGRADED, coverage recorded only for a pass whose rows
 * were all accepted, and a DEGRADED the service worker set kept until a later clean pass is accepted.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  onCoveragePing,
  onHealth,
  onObservations,
  pingProblem,
} from '../../../src/background/observer-messages';
import { idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY, PolicyError } from '../../../src/core/policy';
import { CoveragePing } from '../../../src/ledger/types';
import { coverageFor } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth, getCoveragePing, getObservation } from '../../../src/ledger/repo';
import {
  captureLogs,
  makeObservation,
  makePing,
  pinClock,
  releaseClock,
  sha,
  uniqueDbName,
} from '../ledger/fixtures';
import { ACCOUNT } from './calendar-fixtures';
import { contextOf, healthOf, idleOf, pingOf, rowsOf, tab, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('observer-messages'));
  ctx = contextOf(db);
});

afterEach(() => {
  db.close();
  releaseClock();
});

const SIGHTED = '2026-10-01T10:20:00-04:00';
const LATER = '2026-10-01T10:25:00-04:00';

/** A gcal.event row with merchant fields and a self-chosen contentHash: what `project()` never returns (SEC-V1). */
function forgedRow() {
  const contentHash = sha(4242);
  return {
    id: idFromHash(contentHash),
    source: 'gcal.event' as const,
    type: 'calendar.created' as const,
    merchant: 'Acme Store',
    amountCents: 4200,
    currency: 'USD',
    occurredAt: '2026-10-08T19:00:00-04:00',
    observedAt: SIGHTED,
    contentHash,
  };
}

const sentPing = (overrides: Parameters<typeof makePing>[0] = {}) =>
  makePing({
    observerId: 'gmail.sent',
    lastSyncAt: SIGHTED,
    windowStart: '2026-10-01T09:00:00-04:00',
    windowEnd: SIGHTED,
    ...overrides,
  });

async function intervals(): Promise<number> {
  return db.coverageIntervals.count();
}

describe('observer.observations', () => {
  it('stores every row through upsertObservation, answers ok, and announces the observations table', async () => {
    const row = makeObservation();
    await expect(onObservations(ctx, rowsOf('gmail.sent', [row]))).resolves.toEqual({ ok: true });
    expect(await getObservation(db, row.id)).toEqual(row);
    expect(ctx.notified).toContainEqual(['observations']);
  });

  it('a forged row writes nothing, turns the observer DEGRADED, and logs only the code and the observer', async () => {
    const { records: logs, restore } = captureLogs();
    const answer = await onObservations(ctx, rowsOf('gcal.event', [forgedRow()]));
    restore();
    expect(answer).toEqual({ ok: false, code: 'invalid_input' });
    expect(await db.observations.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['ledger.invalid_input'],
      checkedAt: SIGHTED,
    });
    expect(logs.map((record) => [record.event, record.fields])).toContainEqual([
      'observer.refused',
      { observer: 'gcal.event', type: 'observer.observations', code: 'invalid_input', count: 1 },
    ]);
    expect(JSON.stringify(logs)).not.toContain('Acme');
  });

  it('one refused row never stops the rest of its message', async () => {
    const good = makeObservation({ counterparty: 'bob@example.com' });
    const answer = await onObservations(ctx, rowsOf('gmail.sent', [forgedRow(), good]));
    expect(answer).toEqual({ ok: false, code: 'invalid_input' });
    expect(await getObservation(db, good.id)).toEqual(good);
  });

  it('a row of another source than the observer reads, or of an unknown observer, never reaches the ledger', async () => {
    const receiptRow = makeObservation();
    expect(await onObservations(ctx, rowsOf('gcal.event', [receiptRow]))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(await onObservations(ctx, rowsOf('evil.observer', [receiptRow]))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(await db.observations.count()).toBe(0);
    expect(await getAdapterHealth(db, 'evil.observer')).toBeUndefined();
  });
});

describe('observer.observations: refusals', () => {
  it('two passes of one row out of order: the first is stored, the second refused late_sighting, DEGRADED', async () => {
    const later = makeObservation({ observedAt: LATER });
    const earlier = makeObservation({ observedAt: SIGHTED });
    expect(await onObservations(ctx, rowsOf('gmail.sent', [later]))).toEqual({ ok: true });
    expect(await onObservations(ctx, rowsOf('gmail.sent', [earlier]))).toEqual({
      ok: false,
      code: 'late_sighting',
    });
    expect(await getObservation(db, later.id)).toEqual(later);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['ledger.late_sighting'],
    });
  });

  it('a message refused for several reasons answers the worst and keeps every reason', async () => {
    await onObservations(ctx, rowsOf('gmail.sent', [makeObservation({ observedAt: LATER })]));
    const late = makeObservation({ observedAt: SIGHTED });
    const forged = { ...forgedRow(), source: 'gmail.sent' as const };
    expect(await onObservations(ctx, rowsOf('gmail.sent', [late, forged]))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    const health = await getAdapterHealth(db, 'gmail.sent');
    expect([...(health?.reasons ?? [])].sort()).toEqual(['ledger.invalid_input', 'ledger.late_sighting']);
  });

  it('a policy loadPolicy did not return is a bug: it fails loud, never as DEGRADED', async () => {
    const copied = contextOf(db, { policy: { ...DEFAULT_POLICY } });
    await expect(onObservations(copied, rowsOf('gmail.sent', [makeObservation()]))).rejects.toBeInstanceOf(
      PolicyError,
    );
    expect(await getAdapterHealth(db, 'gmail.sent')).toBeUndefined();
  });
});

describe('coverage.ping', () => {
  it('records a clean Gmail pass as an interval and as the latest ping of its account', async () => {
    await expect(onCoveragePing(ctx, pingOf(sentPing()), tab())).resolves.toEqual({ ok: true });
    expect(await intervals()).toBe(1);
    expect(await getCoveragePing(db, 'gmail.sent', sha(900))).toEqual(CoveragePing.parse(sentPing()));
    expect(ctx.notified).toContainEqual(['coverageIntervals', 'coverage']);
  });

  it('refuses the coverage of a pass whose rows were refused: no window is reported past a refused row', async () => {
    await onObservations(ctx, rowsOf('gmail.sent', [{ ...forgedRow(), source: 'gmail.sent' }]));
    await expect(onCoveragePing(ctx, pingOf(sentPing()), tab())).resolves.toEqual({
      ok: false,
      code: 'refused',
    });
    expect(await intervals()).toBe(0);
  });

  it('refuses a window the observer cannot have seen, and turns it DEGRADED', async () => {
    const future = sentPing({ windowEnd: LATER });
    expect(pingProblem(CoveragePing.parse(future))).toBe('window');
    expect(await onCoveragePing(ctx, pingOf(future), tab())).toEqual({ ok: false, code: 'invalid_input' });
    const wide = makePing({ observerId: 'gmail.receipt', source: 'gmail.receipt', lastSyncAt: SIGHTED });
    expect(await onCoveragePing(ctx, pingOf(wide), tab())).toEqual({ ok: false, code: 'invalid_input' });
    // A later pass that read one receipt asserts that one instant.
    const instant = {
      ...wide,
      lastSyncAt: LATER,
      windowStart: '2026-10-01T09:30:00Z',
      windowEnd: '2026-10-01T09:30:00Z',
    };
    expect(await onCoveragePing(ctx, pingOf(instant), tab())).toEqual({ ok: true });
    const crossed = sentPing({ observerId: 'gmail.receipt' });
    expect(pingProblem(CoveragePing.parse(crossed))).toBe('source');
    expect(await intervals()).toBe(1);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'DEGRADED' });
  });

  it('a ping that says allCalendars for anything but Calendar fails its schema at the boundary (interface 1)', () => {
    expect(CoveragePing.safeParse({ ...sentPing(), allCalendars: true }).success).toBe(false);
    expect(CoveragePing.safeParse({ ...sentPing(), changesSince: SIGHTED }).success).toBe(false);
  });

  it('refuses a Sent window that ends before its sync: only the head of the list writes coverage (interface 4)', async () => {
    // An older Sent page's span (its newest row at 10:10) cannot vouch for itself: a send can be listed elsewhere.
    const older = sentPing({ windowEnd: '2026-10-01T10:10:00-04:00' });
    expect(pingProblem(CoveragePing.parse(older))).toBe('window');
    expect(await onCoveragePing(ctx, pingOf(older), tab())).toEqual({ ok: false, code: 'invalid_input' });
    expect(await intervals()).toBe(0);
    // The head's window, written in another offset, ends at the same instant as its sync.
    const head = sentPing({ windowEnd: '2026-10-01T14:20:00Z' });
    expect(pingProblem(CoveragePing.parse(head))).toBeNull();
  });
});

describe('coverage.ping: Calendar', () => {
  it('records a Calendar pass with no account at once, and holds one with an account for its snapshot', async () => {
    const calendar = {
      observerId: 'gcal.event',
      source: 'gcal.event' as const,
      lastSyncAt: SIGHTED,
      windowStart: '2026-10-04T00:00:00-04:00',
      windowEnd: '2026-10-11T00:00:00-04:00',
      allCalendars: false,
      userActive: false,
    };
    expect(await onCoveragePing(ctx, pingOf(calendar), tab())).toEqual({ ok: true });
    expect(await intervals()).toBe(1);
    expect(await onCoveragePing(ctx, pingOf({ ...calendar, accountHash: ACCOUNT }), tab())).toEqual({
      ok: true,
    });
    expect(await intervals()).toBe(1);
    expect(ctx.state.held.size).toBe(1);
    const coverage = await coverageFor(
      db,
      { type: 'calendar.created', window: null, evaluatedAt: LATER },
      DEFAULT_POLICY,
    );
    expect(coverage.observers.map((entry) => entry.accountHash)).toEqual([undefined]);
  });
});

describe('a DEGRADED the service worker set stays until a later clean pass is fully accepted', () => {
  it('an OK report does not clear it; the later pass, once its rows are stored, does', async () => {
    await onHealth(ctx, healthOf('gmail.sent', SIGHTED));
    await onObservations(ctx, rowsOf('gmail.sent', [{ ...forgedRow(), source: 'gmail.sent' }]));
    await onHealth(ctx, healthOf('gmail.sent', LATER));
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      checkedAt: SIGHTED,
    });

    await onObservations(ctx, rowsOf('gmail.sent', [makeObservation({ observedAt: LATER })]));
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'OK',
      reasons: [],
      checkedAt: LATER,
    });
  });

  it('a later pass that reports DEGRADED itself keeps the service worker reason beside its own', async () => {
    await onObservations(ctx, rowsOf('gmail.sent', [{ ...forgedRow(), source: 'gmail.sent' }]));
    await onHealth(ctx, healthOf('gmail.sent', LATER, ['selector.missing.time']));
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.time', 'ledger.invalid_input'],
    });
  });

  it('a pass with nothing but its health clears nothing: there was nothing to accept', async () => {
    await onObservations(ctx, rowsOf('gmail.receipt', [{ ...forgedRow(), source: 'gmail.receipt' }]));
    await onHealth(ctx, healthOf('gmail.receipt', LATER));
    expect(await getAdapterHealth(db, 'gmail.receipt')).toMatchObject({ status: 'DEGRADED' });
  });

  it('accepted coverage of the later pass clears it too', async () => {
    await onObservations(ctx, rowsOf('gmail.sent', [{ ...forgedRow(), source: 'gmail.sent' }]));
    await onHealth(ctx, healthOf('gmail.sent', LATER));
    await onCoveragePing(ctx, pingOf(sentPing({ lastSyncAt: LATER, windowEnd: LATER })), tab());
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: LATER });
  });
});

describe('several Gmail tabs: a page the observer does not read never flips its health (sprint_2 2.11)', () => {
  const BETWEEN = '2026-10-01T10:22:00-04:00';
  const LATEST = '2026-10-01T10:30:00-04:00';
  const SENT_TAB = tab(7);
  const INBOX_TAB = tab(8);

  it("an Inbox tab's reports between the Sent tab's keep the Sent tab's status, OK or DEGRADED", async () => {
    await onHealth(ctx, healthOf('gmail.sent', SIGHTED), SENT_TAB);
    await onHealth(ctx, idleOf('gmail.sent', BETWEEN), INBOX_TAB);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: SIGHTED });
    await onHealth(ctx, healthOf('gmail.sent', LATER, ['selector.missing.time']), SENT_TAB);
    await onHealth(ctx, idleOf('gmail.sent', LATEST), INBOX_TAB);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'DEGRADED',
      reasons: ['selector.missing.time'],
      checkedAt: LATER,
    });
  });

  it('the tab that reported a status replaces it with its IDLE when it moves on: a one-pass mismatch clears (QA-L8)', async () => {
    await onHealth(ctx, healthOf('gmail.sent', SIGHTED, ['view.mismatch']), SENT_TAB);
    await onHealth(ctx, idleOf('gmail.sent', LATER, ['not_sent_list']), SENT_TAB);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({
      status: 'IDLE',
      reasons: ['not_sent_list'],
    });
  });

  it('a restarted service worker knows no tab, so an IDLE then replaces nothing but an IDLE', async () => {
    await onHealth(ctx, healthOf('gmail.sent', SIGHTED, ['view.mismatch']), SENT_TAB);
    const restarted = contextOf(db);
    await onHealth(restarted, idleOf('gmail.sent', LATER), SENT_TAB);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'DEGRADED' });
  });

  it("an Inbox tab's report between a Sent pass's health and its rows still lets that pass clear a ledger DEGRADED", async () => {
    await onObservations(ctx, rowsOf('gmail.sent', [{ ...forgedRow(), source: 'gmail.sent' }]));
    await onHealth(ctx, healthOf('gmail.sent', LATER), SENT_TAB);
    await onHealth(ctx, idleOf('gmail.sent', LATEST), INBOX_TAB);
    await onObservations(ctx, rowsOf('gmail.sent', [makeObservation({ observedAt: LATER })]));
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: LATER });
  });
});
