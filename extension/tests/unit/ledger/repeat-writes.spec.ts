import 'fake-indexeddb/auto';
/**
 * The second write of the same fact, for the Dexie repo methods Sprint 3 added (qa_tester rule 3: a happy test and a
 * duplicate or conflict test per method; Sprint 3 QA review): replay records (src/ledger/replay-records.ts), activity
 * (src/ledger/activity.ts) and clock repairs (src/ledger/clock-repairs.ts). Their happy paths are in replay-records,
 * activity and clock-repairs.spec.ts; here each is done twice, or against what it cannot change, and must leave the
 * ledger as one write would. Every instant is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { coverageHash } from '../../../src/core/receipt';
import { IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';
import {
  activityIn,
  closeIdle,
  forgetIdle,
  OPEN_IDLE,
  openIdle,
  purgeActivity,
  putSessions,
} from '../../../src/ledger/activity';
import {
  batchRepairs,
  clockRepairs,
  keepRepairSpan,
  purgeClockRepairs,
  type RepairSpan,
} from '../../../src/ledger/clock-repairs';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  deleteReceiptInputs,
  purgeReplayRecords,
  putReceiptInputs,
  replayRecords,
} from '../../../src/ledger/replay-records';
import { getMeta } from '../../../src/ledger/repo';
import { Coverage, Grant } from '../../../src/ledger/types';
import { expectLedgerError, makeGrant, pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-06T08:00:00-04:00');
  db = await openLedger(uniqueDbName('repeat-writes'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const at = (iso: string): IsoTs => IsoTs.parse(iso);
const DAY = [Date.parse('2026-10-06T00:00:00-04:00'), Date.parse('2026-10-07T00:00:00-04:00')] as const;

const inputs = () => ({
  coverage: Coverage.parse({ evaluatedAt: '2026-10-06T15:00:00-04:00', observers: [] }),
  grant: Grant.parse(makeGrant()),
  context: { priorSpendCents: 0 },
  policyHash: DEFAULT_POLICY.policyHash,
});

describe('replay records, written twice', () => {
  it('the same inputs under the same inputsHash twice are one row', async () => {
    await putReceiptInputs(db, new Map([[sha(1), inputs()]]));
    await putReceiptInputs(db, new Map([[sha(1), inputs()]]));
    expect([await db.receiptInputs.count(), await db.batchCoverages.count()]).toEqual([1, 1]);
    const { coverage, ...rest } = inputs();
    const records = await replayRecords(db);
    expect(records.receiptInputs).toEqual({ [sha(1)]: { coverageHash: coverageHash(coverage), ...rest } });
    expect(records.batchCoverages).toEqual({ [coverageHash(coverage)]: coverage });
  });

  it('deleting inputs no row holds, or none at all, changes nothing', async () => {
    await putReceiptInputs(db, new Map([[sha(1), inputs()]]));
    await deleteReceiptInputs(db, [sha(2), sha(3)]);
    await deleteReceiptInputs(db, []);
    expect(Object.keys((await replayRecords(db)).receiptInputs)).toEqual([sha(1)]);
  });

  it('the purge of the same receipts twice deletes their inputs once, and the second time reports none', async () => {
    await putReceiptInputs(db, new Map([[sha(1), inputs()]]));
    await putReceiptInputs(db, new Map([[sha(2), inputs()]]));
    const purge = () =>
      db.transaction('rw', [db.receiptInputs, db.policies, db.batchCoverages], () =>
        purgeReplayRecords(db, [sha(1), sha(1)]),
      );
    expect(await purge()).toEqual({ receiptInputs: 1, policies: 0, batchCoverages: 0 });
    expect(await purge()).toEqual({ receiptInputs: 0, policies: 0, batchCoverages: 0 });
    expect(Object.keys((await replayRecords(db)).receiptInputs)).toEqual([sha(2)]);
  });
});

describe('session pings and idle intervals, written twice', () => {
  it('one instant named twice in one import is one ping', async () => {
    const minute = at('2026-10-06T14:02:00-04:00');
    expect(await putSessions(db, 'muse', [minute, minute, at('2026-10-06T18:02:00Z')])).toBe(1);
    expect((await activityIn(db, ...DAY)).sessions).toHaveLength(1);
  });

  it('a back at or before the stored end neither shortens nor stretches the interval, and closes it', async () => {
    await openIdle(db, at('2026-10-06T14:00:00-04:00'), at('2026-10-06T14:01:00-04:00'));
    await closeIdle(db, at('2026-10-06T14:00:30-04:00'));
    expect(await getMeta(db, OPEN_IDLE)).toBeUndefined();
    await closeIdle(db, at('2026-10-06T14:09:00-04:00'));
    expect((await activityIn(db, ...DAY)).idle).toEqual([
      { from: '2026-10-06T14:00:00-04:00', to: '2026-10-06T14:01:00-04:00' },
    ]);
  });

  it('an interval that ends before it starts is refused (invalid_input), and nothing is stored or left open', async () => {
    await expectLedgerError(
      openIdle(db, at('2026-10-06T14:05:00-04:00'), at('2026-10-06T14:01:00-04:00')),
      'invalid_input',
    );
    expect([await db.activity.count(), await getMeta(db, OPEN_IDLE)]).toEqual([0, undefined]);
  });

  it('forgetting idle time twice, and purging the same cutoff twice, delete once', async () => {
    await putSessions(db, 'muse', [at('2026-10-06T09:00:00-04:00'), at('2026-10-06T14:02:00-04:00')]);
    await openIdle(db, at('2026-10-06T14:00:00-04:00'), at('2026-10-06T14:01:00-04:00'));
    expect([await forgetIdle(db), await forgetIdle(db)]).toEqual([1, 0]);
    const cutoff = Date.parse('2026-10-06T12:00:00-04:00');
    expect([await purgeActivity(db, cutoff), await purgeActivity(db, cutoff)]).toEqual([1, 0]);
    expect((await activityIn(db, ...DAY)).sessions.map((s) => s.at)).toEqual(['2026-10-06T14:02:00-04:00']);
  });
});

describe('clock repairs, written twice', () => {
  const span = (from: number, to: number): RepairSpan => ({
    from: at(new Date(Date.parse('2026-10-06T12:00:00Z') + from * 60_000).toISOString()),
    to: at(new Date(Date.parse('2026-10-06T12:00:00Z') + to * 60_000).toISOString()),
  });

  it('the same span kept twice is one span; the purge of one cutoff twice deletes once', async () => {
    const [early, late] = [span(0, 30), span(60, 90)];
    await db.transaction('rw', db.meta, async () => {
      for (const kept of [early, early, late]) await keepRepairSpan(db, kept.from, kept.to);
    });
    expect(await clockRepairs(db)).toEqual([early, late]);
    const cutoff = Date.parse(late.from);
    expect([await purgeClockRepairs(db, cutoff), await purgeClockRepairs(db, cutoff)]).toEqual([1, 0]);
    expect(await clockRepairs(db)).toEqual([late]);
  });

  it('one span more than a coverage holds joins only the two oldest', () => {
    const spans = Array.from({ length: SCHEMA_LIMITS.LIST + 1 }, (_, i) => span(i * 10, i * 10 + 5));
    const bounded = batchRepairs(spans);
    expect(bounded).toHaveLength(SCHEMA_LIMITS.LIST);
    expect(bounded[0]).toEqual(span(0, 15));
    expect(bounded.slice(1)).toEqual(spans.slice(2));
  });
});
