/**
 * SIM-1 (Hard Rule 4): an override's `at` and a revert's instant get the floor a new row gets. Replay applies a user
 * event in exactly the batches evaluated strictly after its instant, so an event written after a batch must be
 * stamped after that batch's instant even when the clock went back (src/ledger/batch-instant.ts `writeUserEvent`;
 * docs/grading.md §3 Background obligations). Each test drives the background's writes, batches and user events over
 * a real ledger (./live-ledger.ts) and replays the export: the verifier's probe repro-clockback (the clock 5 min 1 s
 * back, 5 min after T2), expecting 0 mismatches and a next batch that runs.
 *
 * R4-EVENT-ORDER: an event is also stamped at least 1 ms after the receipt's own last event (`lastEventAt`, passed
 * as `notBefore`), so a revert or an override whose clock went back below that event is saved instead of refused by
 * `transition` (`invalid_event`): the verifier's probe repro-r4 part A.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { replay } from '../../../src/core/replay';
import { IllegalTransitionError, transition } from '../../../src/core/state';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getReceipt, lastEventAt, putReceipt, writeUserEvent } from '../../../src/ledger/repo';
import type { IsoTs, Receipt } from '../../../src/ledger/types';
import { receiptIdOf, scenarioWorld, T1, T2, T2_MS, OVERRIDE_AT } from '../../tools/attest-scenario';
import { isoAt, MS_PER_DAY, MS_PER_MINUTE } from '../../tools/attest-world';
import { captureLogs, makeReceipt, pinClock, releaseClock, uniqueDbName } from './fixtures';
import { LiveLedger, play, sightingWrites, type Step } from './live-ledger';

let db: LedgerDb;
let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('user-event'));
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  db.close();
  releaseClock();
});

/** The clock the user event reads: 5 min after T2, stepped back 5 min 1 s (the verifier's BACK_MS=301000). */
const CLOCK_BACK = isoAt(T2_MS + 5 * MS_PER_MINUTE - 301_000, 0);
const T3 = isoAt(T2_MS + MS_PER_DAY, 0);
const C7 = receiptIdOf('c7');
const C8 = receiptIdOf('c8');

async function mismatches(live: LiveLedger) {
  return (await replay(await live.snapshot())).mismatches;
}

/** The scenario's rows and its two batches, with `between` the user's events between T1 and T2. */
async function scenario(between: readonly Step[] = []): Promise<LiveLedger> {
  const world = scenarioWorld();
  const live = new LiveLedger(db, world);
  const batches: Step[] = [
    { at: T1, kind: 'batch' },
    { at: T2, kind: 'batch' },
  ];
  await play(live, [...sightingWrites(world), ...batches, ...between]);
  return live;
}

describe('a user event is stamped after the last batch, even when the clock went back (SIM-1)', () => {
  it('override: c7, FINAL at T1 holding o7, overridden after T2 by a clock 1 s before T2', async () => {
    const live = await scenario();
    expect(live.receipts.get(C7)).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    expect(live.receipts.get(C8)).toMatchObject({ grade: 'NOT_FOUND', state: 'FINAL' });
    expect(await mismatches(live)).toEqual([]);
    const at = await live.override(C7, 'NOT_FOUND', CLOCK_BACK);
    expect(Date.parse(at)).toBe(T2_MS + 1);
    expect(live.receipts.get(C7)?.override?.at).toBe(at);
    expect(await mismatches(live)).toEqual([]);
    await live.batch(T3);
    expect(live.receipts.get(C8)).toMatchObject({ grade: 'NOT_FOUND', state: 'FINAL' });
    expect(await mismatches(live)).toEqual([]);
  });

  it('revert: c7 overridden to NOT_FOUND before T2 (c8 took o7 at T2), reverted by a clock 1 s before T2', async () => {
    const live = await scenario([{ at: OVERRIDE_AT, kind: 'override', id: C7, grade: 'NOT_FOUND' }]);
    expect(live.receipts.get(C8)).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    expect(await mismatches(live)).toEqual([]);
    const at = await live.revert(C7, CLOCK_BACK);
    expect(Date.parse(at)).toBe(T2_MS + 1);
    expect(live.receipts.get(C7)?.reverted?.at(-1)?.revertedAt).toBe(at);
    expect(await mismatches(live)).toEqual([]);
    await live.batch(T3); // the unfloored revert made every later batch throw fixed_conflict
    expect(live.receipts.get(C8)).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    expect(await mismatches(live)).toEqual([]);
  });

  it('a clock that reads after the last batch stamps the event as read', async () => {
    const live = await scenario();
    const clock = isoAt(T2_MS + 5 * MS_PER_MINUTE, 0);
    expect(Date.parse(await live.override(C7, 'NOT_FOUND', clock))).toBe(Date.parse(clock));
    expect(await mismatches(live)).toEqual([]);
  });
});

describe('control: what replay reports for an event stamped as the clock read it (no floor)', () => {
  it('the override, stamped 1 s before T2, puts it in force for a batch that never read it', async () => {
    const live = await scenario();
    const held = live.receipts.get(C7);
    if (held === undefined) throw new Error('no c7 receipt');
    live.receipts.set(
      C7,
      transition(held, {
        event: 'override',
        grade: 'NOT_FOUND',
        reason: 'synthetic override',
        at: CLOCK_BACK,
      }),
    );
    const found = (await mismatches(live)).map((mismatch) => [mismatch.receiptId, mismatch.field]);
    expect(found).toContainEqual([C8, 'grade']);
  });
});

describe("a user event is stamped after the receipt's own last event, even when the clock went back below it", () => {
  const after = (minutes: number) => isoAt(T2_MS + minutes * MS_PER_MINUTE, 0);

  it('repro-r4 A: c7 overridden at T2 + 10 min, reverted by a clock at T2 + 5 min: saved 1 ms after', async () => {
    const live = await scenario();
    const overrideAt = await live.override(C7, 'NOT_FOUND', after(10));
    expect(Date.parse(overrideAt)).toBe(Date.parse(after(10)));
    const revertedAt = await live.revert(C7, after(5));
    expect(Date.parse(revertedAt)).toBe(Date.parse(after(10)) + 1);
    const c7 = live.receipts.get(C7);
    expect(c7).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    expect(c7?.override).toBeUndefined();
    expect(c7?.reverted?.at(-1)).toMatchObject({ at: overrideAt, revertedAt });
    expect(await mismatches(live)).toEqual([]);
    await live.batch(T3);
    expect(live.receipts.get(C8)).toMatchObject({ grade: 'NOT_FOUND', state: 'FINAL' });
    expect(await mismatches(live)).toEqual([]);
  });

  it('an override after a revert, by a clock below the revert: saved 1 ms after the revert', async () => {
    const live = await scenario();
    await live.override(C7, 'NOT_FOUND', after(10));
    const revertedAt = await live.revert(C7, after(20));
    const again = await live.override(C7, 'NOT_FOUND', after(15));
    expect(Date.parse(again)).toBe(Date.parse(revertedAt) + 1);
    expect(live.receipts.get(C7)).toMatchObject({ state: 'USER_OVERRIDDEN', override: { at: again } });
    expect(await mismatches(live)).toEqual([]);
    await live.batch(T3);
    expect(await mismatches(live)).toEqual([]);
  });

  it("a clock after the receipt's last event stamps the event as read", async () => {
    const live = await scenario();
    await live.override(C7, 'NOT_FOUND', after(10));
    expect(Date.parse(await live.revert(C7, after(30)))).toBe(Date.parse(after(30)));
    expect(await mismatches(live)).toEqual([]);
  });

  it('control: the same revert without the bound is refused (invalid_event) and changes nothing', async () => {
    const live = await scenario();
    await live.override(C7, 'NOT_FOUND', after(10));
    const held = live.receipts.get(C7);
    if (held === undefined) throw new Error('no c7 receipt');
    pinClock(after(5));
    const unbounded = writeUserEvent(db, (at) => Promise.resolve(transition(held, { event: 'revert', at })));
    await expect(unbounded).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(unbounded).rejects.toMatchObject({ code: 'invalid_event' });
    expect(live.receipts.get(C7)).toBe(held);
  });
});

describe('the Sprint 4.3 write over a stored receipt: read it, then writeUserEvent bounded by it, in one transaction', () => {
  /** One user event on the stored receipt `id` with the clock reading `clock`, as sprints/sprint_4.md 4.3 says. */
  async function onStored(id: string, clock: string, apply: (held: Receipt, at: IsoTs) => Receipt) {
    pinClock(clock);
    await db.transaction('rw', [db.receipts, db.meta], async () => {
      const held = await getReceipt(db, id);
      if (held === undefined) throw new Error('no stored receipt');
      const write = (at: IsoTs) => putReceipt(db, apply(held, at));
      await writeUserEvent(db, write, { notBefore: lastEventAt(held) });
    });
    return getReceipt(db, id);
  }

  it('an override, then a revert by a clock 5 min below it: stored 1 ms after the override', async () => {
    const stored = makeReceipt({ state: 'FINAL', finalAt: '2026-10-01T10:31:00-04:00' });
    await putReceipt(db, stored);
    const override = (held: Receipt, at: IsoTs) =>
      transition(held, { event: 'override', grade: 'NOT_FOUND', reason: 'synthetic override', at });
    const overridden = await onStored(stored.id, '2026-10-01T15:00:00Z', override);
    expect(overridden?.override?.at).toBeDefined();
    const reverted = await onStored(stored.id, '2026-10-01T14:55:00Z', (held, at) =>
      transition(held, { event: 'revert', at }),
    );
    expect(reverted).toMatchObject({ state: 'FINAL' });
    expect(Date.parse(reverted?.reverted?.at(-1)?.revertedAt ?? '')).toBe(
      Date.parse('2026-10-01T15:00:00Z') + 1,
    );
  });
});
