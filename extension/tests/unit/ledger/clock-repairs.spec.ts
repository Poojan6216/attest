/**
 * The clock repairs the ledger keeps for grading (src/ledger/clock-repairs.ts; docs/grading.md §3 v1.16; S2-SIM2-1;
 * Decisions [3.17]; Hard Rules 4, 5): each repair keeps its span, from the clock's now to the high water it found,
 * in its own transaction; a guard that repairs nothing keeps nothing; the spans are read in order (a corrupt one
 * logged and skipped), bounded for a batch without losing an instant, and purged once they ended before the cutoff.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_LIMITS } from '../../../src/core/schema';
import { guardClock, noteStoredInstant } from '../../../src/ledger/clock-guard';
import {
  batchRepairs,
  CLOCK_REPAIR_PREFIX,
  clockRepairs,
  keepRepairSpan,
  purgeClockRepairs,
  type RepairSpan,
} from '../../../src/ledger/clock-repairs';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { purgeExpired } from '../../../src/ledger/retention';
import { IsoTs } from '../../../src/ledger/types';
import { captureLogs, pinClock, releaseClock, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('clock-repairs'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** 10:00 New York time on Sat 3 Oct 2026 plus `minutes`. */
const at = (minutes: number): IsoTs =>
  IsoTs.parse(
    `${new Date(Date.parse('2026-10-03T14:00:00Z') + minutes * 60_000 - 4 * 3_600_000).toISOString().slice(0, 23)}-04:00`,
  );
const ms = (iso: string): number => Date.parse(iso);
const instants = (spans: readonly RepairSpan[]) => spans.map(({ from, to }) => [ms(from), ms(to)]);

describe('a repair keeps its span', () => {
  it('from the clock’s now to the high water it found; a guard that repairs nothing keeps nothing', async () => {
    await db.transaction('rw', db.meta, () => noteStoredInstant(db, at(300)));
    await guardClock(db, ms(at(400)));
    expect(await clockRepairs(db)).toEqual([]);
    await guardClock(db, ms(at(120)));
    expect(instants(await clockRepairs(db))).toEqual([[ms(at(120)), ms(at(300))]]);
    await guardClock(db, ms(at(130)));
    expect(await clockRepairs(db)).toHaveLength(1);
  });

  it('two repairs keep two spans, in `from` order; one kept again from the same instant keeps the later end', async () => {
    await db.transaction('rw', db.meta, async () => {
      await keepRepairSpan(db, at(200), at(260));
      await keepRepairSpan(db, at(100), at(150));
      await keepRepairSpan(db, at(100), at(140));
    });
    expect(await clockRepairs(db)).toEqual([
      { from: at(100), to: at(150) },
      { from: at(200), to: at(260) },
    ]);
  });

  it('a stored value that is not a span is logged and skipped', async () => {
    await keepRepairSpan(db, at(100), at(150));
    await db.meta.put({ key: `${CLOCK_REPAIR_PREFIX}1`, value: `${at(160)}/${at(155)}` });
    const logs = captureLogs();
    try {
      expect(await clockRepairs(db)).toEqual([{ from: at(100), to: at(150) }]);
    } finally {
      logs.restore();
    }
    expect(logs.records.map((record) => record.event)).toEqual(['ledger.row_invalid']);
  });
});

describe('the spans a batch grades with', () => {
  const spans = (count: number): RepairSpan[] =>
    Array.from({ length: count }, (_, i) => ({ from: at(i * 10), to: at(i * 10 + (i === 1 ? 40 : 5)) }));

  it('are every span when they fit a coverage', () => {
    expect(batchRepairs(spans(SCHEMA_LIMITS.LIST))).toEqual(spans(SCHEMA_LIMITS.LIST));
  });

  it('join the oldest when they do not, holding every instant any of them held', () => {
    const all = spans(SCHEMA_LIMITS.LIST + 3);
    const bounded = batchRepairs([...all].reverse());
    expect(bounded).toHaveLength(SCHEMA_LIMITS.LIST);
    expect(bounded[0]).toEqual({ from: at(0), to: at(50) });
    expect(bounded.slice(1)).toEqual(all.slice(4));
  });
});

describe('the retention purge', () => {
  it('deletes the spans that ended before the cutoff, and reports how many', async () => {
    await keepRepairSpan(db, at(100), at(150));
    await keepRepairSpan(db, at(200), at(260));
    expect(await purgeClockRepairs(db, ms(at(200)))).toBe(1);
    expect(await clockRepairs(db)).toEqual([{ from: at(200), to: at(260) }]);
    const days = 90 * 24 * 60;
    expect((await purgeExpired(db, { now: at(261 + days) })).clockRepairs).toBe(1);
    expect(await clockRepairs(db)).toEqual([]);
  });
});
