import 'fake-indexeddb/auto';
/**
 * The grading batch (sprint_3 3.13; src/background/grading.ts; docs/grading.md §3 Background obligations) over a real
 * ledger, with the §2 demo stored as the service worker stores it, each write at its own instant (the clock only moves
 * forward, so the clock guard repairs nothing):
 *  - a batch before grace stores both claim receipts PENDING, with their inputs and the policy document;
 *  - a batch after grace finalises them (VERIFIED, NOT_FOUND), and releases the replaced inputs;
 *  - the export is the replay input, and replay reproduces every receipt (Hard Rule 4);
 *  - a batch stamped at or before the last one runs nothing; batches queue, never overlap;
 *  - the default grants: written for every agent that has none, never over the user's.
 * The vendor row is an orphan with no UNASKED receipt here: its only signals were Muse's session ping and the user's
 * idle time, which the paste path does not record yet (Decisions [3.13]).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultGrant, ensureDefaultGrants } from '../../../src/background/default-grants';
import { runGradingBatch } from '../../../src/background/grading';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { replay } from '../../../src/core/replay';
import { IsoTs, Receipt } from '../../../src/core/schema';
import { putSessions } from '../../../src/ledger/activity';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import { replayRecords } from '../../../src/ledger/replay-records';
import { getReceipt, listGrants, putGrant, putReceipt } from '../../../src/ledger/repo';
import { transition } from '../../../src/core/state';
import { readSnapshot } from '../../tools/attest-snapshot';
import { AT } from '../core/demo-ledger';
import {
  makeReceipt,
  observationId,
  omit,
  pinClock,
  releaseClock,
  ulid,
  uniqueDbName,
} from '../ledger/fixtures';
import { storeDemo } from './demo-store';

const DEPS = { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() };
const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock('2026-10-06T08:00:00-04:00');
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

async function open(prefix: string): Promise<LedgerDb> {
  const db = await openLedger(uniqueDbName(prefix));
  opened.push(db);
  return db;
}

async function batchAt(db: LedgerDb, at: string) {
  pinClock(at);
  return runGradingBatch(db, DEPS);
}

const receiptsOf = async (db: LedgerDb): Promise<Receipt[]> =>
  readRows('receipts', Receipt, await db.receipts.toArray());

describe('the grading batch over the §2 demo', () => {
  it('stores both claim receipts PENDING before grace, with their inputs and the policy', async () => {
    const db = await open('grading-pending');
    const demo = await storeDemo(db, AT.beforeGrace);
    const summary = await batchAt(db, AT.beforeGrace);
    expect(summary).toMatchObject({ claims: 2, written: 2, deleted: 0, superseded: 0 });
    const receipts = await receiptsOf(db);
    expect(receipts.map((r) => [r.claimId, r.state]).sort()).toEqual(
      [
        [demo.emailClaim.id, 'PENDING'],
        [demo.calendarClaim.id, 'PENDING'],
      ].sort(),
    );
    const records = await replayRecords(db);
    expect(Object.keys(records.receiptInputs).sort()).toEqual(receipts.map((r) => r.inputsHash).sort());
    expect(Object.keys(records.policies)).toEqual([DEFAULT_POLICY.policyHash]);
  });

  it('finalises them after grace, releases the replaced inputs, and replay reproduces every receipt', async () => {
    const db = await open('grading-final');
    await storeDemo(db, AT.beforeGrace);
    await batchAt(db, AT.beforeGrace);
    const early = await receiptsOf(db);
    const demo = await storeDemo(db, AT.evaluated, AT.beforeGrace);
    await batchAt(db, AT.evaluated);
    const receipts = await receiptsOf(db);
    const byClaim = new Map(receipts.map((r) => [r.claimId, r]));
    expect([byClaim.get(demo.emailClaim.id)?.grade, byClaim.get(demo.emailClaim.id)?.state]).toEqual([
      'VERIFIED',
      'FINAL',
    ]);
    expect([byClaim.get(demo.calendarClaim.id)?.grade, byClaim.get(demo.calendarClaim.id)?.state]).toEqual([
      'NOT_FOUND',
      'FINAL',
    ]);
    const records = await replayRecords(db);
    expect(Object.keys(records.receiptInputs).sort()).toEqual(receipts.map((r) => r.inputsHash).sort());
    for (const { inputsHash } of early) expect(records.receiptInputs[inputsHash]).toBeUndefined();
    const exported = await exportLedger(db, { exportedAt: '2026-10-06T16:00:00-04:00' });
    const report = await replay(readSnapshot(JSON.parse(JSON.stringify(exported))));
    expect(report).toMatchObject({ receipts: 2, reproduced: 2, mismatched: 0 });
  });

  it('a later batch with nothing new keeps every FINAL receipt as stored', async () => {
    const db = await open('grading-final-kept');
    await storeDemo(db, AT.evaluated);
    await batchAt(db, AT.evaluated);
    const before = await receiptsOf(db);
    expect(await batchAt(db, AT.nextDay)).toMatchObject({ claims: 0, written: 0, deleted: 0 });
    expect(await receiptsOf(db)).toEqual(before);
  });
});

describe('a batch with nothing to grade (tech review TECH-2)', () => {
  it('skips while nothing is PENDING and nothing was stored since the last graded batch; a stored fact ends it', async () => {
    const db = await open('grading-skip');
    await storeDemo(db, AT.evaluated);
    expect(await batchAt(db, AT.evaluated)).toMatchObject({ skipped: false, claims: 2, written: 2 });
    const before = await receiptsOf(db);
    expect(await batchAt(db, AT.nextDay)).toMatchObject({ skipped: true, claims: 0, written: 0 });
    expect(await receiptsOf(db)).toEqual(before);
    const later = new Date(Date.parse(AT.nextDay) + 5 * 60_000).toISOString();
    pinClock(later);
    await putSessions(db, 'muse', [IsoTs.parse(later)]);
    const after = new Date(Date.parse(later) + 60_000).toISOString();
    expect(await batchAt(db, after)).toMatchObject({ skipped: false });
  });
});

describe('a batch with only held receipts PENDING (tech review TECH-7)', () => {
  it('grades once and holds them, then skips: a held receipt never keeps every batch reading the ledger', async () => {
    const db = await open('grading-held');
    await storeDemo(db, AT.evaluated);
    await batchAt(db, AT.evaluated);
    // An unclaimed action's receipt, marked then unmarked, whose action is no longer in the ledger: no batch produces it.
    const unasked = Receipt.parse({
      ...omit(
        makeReceipt({
          id: ulid(900),
          grade: 'UNASKED',
          computedAt: AT.evaluated,
          observationIds: [observationId(77)],
        }),
        'claimId',
      ),
      attribution: 'likely',
      reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
    });
    const marked = transition(unasked, {
      event: 'override',
      grade: 'NOT_FOUND',
      reason: 'mine',
      at: AT.evaluated,
    });
    await putReceipt(db, transition(marked, { event: 'revert', at: AT.evaluated }));
    expect(await batchAt(db, AT.nextDay)).toMatchObject({ skipped: false });
    expect((await getReceipt(db, ulid(900)))?.state).toBe('PENDING');
    const later = new Date(Date.parse(AT.nextDay) + 5 * 60_000).toISOString();
    expect(await batchAt(db, later)).toMatchObject({ skipped: true });
  });
});

describe('batch order', () => {
  it('runs nothing for a batch stamped at or before the last one, and logs it', async () => {
    const db = await open('grading-order');
    await storeDemo(db, AT.beforeGrace);
    expect(await batchAt(db, AT.beforeGrace)).not.toBeNull();
    const before = await receiptsOf(db);
    expect(await batchAt(db, AT.beforeGrace)).toBeNull();
    expect(await receiptsOf(db)).toEqual(before);
  });

  it('queues batches: the second starts after the first has written, so it grades nothing again', async () => {
    const db = await open('grading-queue');
    await storeDemo(db, AT.evaluated);
    const instants = [AT.evaluated, AT.nextDay].map((at) => Date.parse(at));
    const deps = { ...DEPS, nowMs: () => instants.shift() ?? Number.NaN };
    const [first, second] = await Promise.all([runGradingBatch(db, deps), runGradingBatch(db, deps)]);
    expect([first?.claims, first?.written]).toEqual([2, 2]);
    expect([second?.claims, second?.written]).toEqual([0, 0]);
    expect((await receiptsOf(db)).every((r) => r.state === 'FINAL')).toBe(true);
  });
});

describe('default grants', () => {
  it('writes one for every agent without one, and never replaces the user’s', async () => {
    const db = await open('grading-grants');
    const mine = {
      ...defaultGrant('muse', IsoTs.parse('2026-10-01T09:00:00-04:00')),
      counterpartyAllowlist: ['a.example'],
    };
    await putGrant(db, mine);
    expect(await ensureDefaultGrants(db, IsoTs.parse('2026-10-06T08:00:00-04:00'))).toBe(3);
    expect(await ensureDefaultGrants(db, IsoTs.parse('2026-10-06T09:00:00-04:00'))).toBe(0);
    const grants = new Map((await listGrants(db)).map((grant) => [grant.agent, grant]));
    expect(grants.get('muse')).toEqual(mine);
    expect(grants.get('claude')).toEqual(defaultGrant('claude', IsoTs.parse('2026-10-06T08:00:00-04:00')));
  });
});
