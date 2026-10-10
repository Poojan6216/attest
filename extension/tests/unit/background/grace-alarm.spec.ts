import 'fake-indexeddb/auto';
/**
 * The grace alarm (sprint_3 3.13; src/background/alarms.ts `runGraceBatch`; the 3.6 rule): every few minutes one
 * grading batch over the shared ledger. A service worker Chrome stops mid-grace keeps nothing in memory that matters
 * (extension_engineer rule 3): the claims, observations, coverage and PENDING receipts are all in the ledger, so the
 * first alarm after it starts again finalises what grace allows. A stop is modelled as Chrome makes one: the ledger
 * stays, the ledger connection and every module's memory go (a fresh import of the alarm module).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dexie } from 'dexie';

import { ALARM_NAMES, DB_NAME } from '../../../src/config';
import { Receipt } from '../../../src/core/schema';
import { readRows } from '../../../src/ledger/db';
import { closeLedger, getLedger } from '../../../src/ledger/repo';
import { AT } from '../core/demo-ledger';
import { pinClock, releaseClock } from '../ledger/fixtures';
import { storeDemo } from './demo-store';

beforeEach(() => {
  pinClock('2026-10-06T08:00:00-04:00');
});

afterEach(async () => {
  await closeLedger();
  releaseClock();
});

/** The alarm as a service worker started afresh would run it: a new module instance, the shared ledger reopened. */
async function fireGraceAlarm(at: string): Promise<void> {
  pinClock(at);
  vi.resetModules();
  const { handleAlarm } = await import('../../../src/background/alarms');
  await handleAlarm({ name: ALARM_NAMES.GRADE });
}

const states = async () =>
  readRows('receipts', Receipt, await (await getLedger()).receipts.toArray())
    .map((receipt) => [receipt.grade, receipt.state])
    .sort();

describe('the grace alarm', () => {
  it('grades before grace, and after a stop mid-grace the next alarm finalises', async () => {
    await storeDemo(await getLedger(), AT.beforeGrace);
    await fireGraceAlarm(AT.beforeGrace);
    expect((await states()).every(([, state]) => state === 'PENDING')).toBe(true);
    expect(await states()).toHaveLength(2);

    // Chrome stops the service worker: the connection and every module's memory go, the ledger stays.
    await closeLedger();
    await storeDemo(await getLedger(), AT.evaluated, AT.beforeGrace);
    await closeLedger();
    await fireGraceAlarm(AT.evaluated);
    expect(await states()).toEqual(
      [
        ['NOT_FOUND', 'FINAL'],
        ['VERIFIED', 'FINAL'],
      ].sort(),
    );
  });
  it('tells open pages when it changed a receipt, and nothing when it had nothing to grade (TECH-8)', async () => {
    // The shared ledger an earlier case graded is deleted: this one starts empty.
    await closeLedger();
    await Dexie.delete(DB_NAME);
    await storeDemo(await getLedger(), AT.evaluated);
    pinClock(AT.evaluated);
    const { runGraceBatch } = await import('../../../src/background/alarms');
    const notify = vi.fn<(tables: readonly string[]) => void>();
    await runGraceBatch(notify);
    expect(notify.mock.calls).toEqual([[['receipts']]]);
    pinClock(AT.nextDay);
    await runGraceBatch(notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('asks the advisory model after its batch, about what the batch graded (sprint_5 5.4)', async () => {
    await closeLedger();
    await Dexie.delete(DB_NAME);
    await storeDemo(await getLedger(), AT.beforeGrace);
    pinClock(AT.beforeGrace);
    const { runGraceBatch } = await import('../../../src/background/alarms');
    const seen: number[] = [];
    const askModel = vi.fn(async (db: Awaited<ReturnType<typeof getLedger>>) => {
      seen.push(await db.receipts.count());
      return 0;
    });
    await runGraceBatch(vi.fn(), () => Promise.resolve(), askModel);
    expect(askModel).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([2]);
  });
});

describe('the grace alarm and the model', () => {
  it('asks the model last, after the upkeep: nothing the alarm does waits for its calls (TECH-10)', async () => {
    await closeLedger();
    await Dexie.delete(DB_NAME);
    await storeDemo(await getLedger(), AT.beforeGrace);
    pinClock(AT.beforeGrace);
    const { runGraceBatch } = await import('../../../src/background/alarms');
    const order: string[] = [];
    const upkeep = () => {
      order.push('upkeep');
      return Promise.resolve();
    };
    const askModel = () => {
      order.push('model');
      return Promise.resolve(0);
    };
    await runGraceBatch(vi.fn(), upkeep, askModel);
    expect(order).toEqual(['upkeep', 'model']);
  });
});
