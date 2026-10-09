/**
 * The clock's high water (./clock-guard.ts has the rule; Decisions [2.7] wave E): the latest instant the ledger stored
 * a sighting, a sync or a read at since the clock last went back, and how many facts it has stored (`STORED_WRITES`).
 * Every writer of such an instant raises both in the transaction that stores the fact (`noteStoredInstant`):
 * ./upsert.ts (a new row's or claim's sighting), ./coverage-store.ts (an interval's `lastSyncAt`),
 * ./calendar-snapshots.ts (a record's `readAt`), ./health.ts (an observer health report's `checkedAt`, SEC-4) and
 * ./grant-save.ts (the instant a person saved a grant, sprint_4 4.4). Kept apart from the guard so those writers do
 * not depend on what the guard repairs. The retention purge trusts the wall clock only up to it (./retention-clock.ts,
 * SEC-5).
 */
import { z } from 'zod';

import { readRow, type LedgerDb } from './db';
import { epochMs } from './index-fields';
import { IsoTs } from './types';

/** The meta key of the latest instant stored since the last repair. Written only by `noteStoredInstant`. */
export const CLOCK_HIGH_WATER = 'clockHighWater';

/**
 * The meta key of how many facts the ledger has stored (tech review TECH-2): every call of `noteStoredInstant`, so
 * every row, claim, coverage interval, Calendar record, health report, activity row and saved grant, counts one, in the
 * transaction that stores it. A grading batch that finds it where the last graded batch left it, and no receipt
 * PENDING, has nothing to grade (src/background/grading.ts). Never lowered, never reset by a clock repair.
 */
export const STORED_WRITES = 'storedWrites';

const InstantEntry = z.strictObject({ key: z.string(), value: IsoTs });
const CountEntry = z.strictObject({ key: z.string(), value: z.number().int().nonnegative() });

/** The count stored under a meta `key`, or 0 (none yet, or one that is not a count). */
export async function readCount(db: LedgerDb, key: string): Promise<number> {
  const entry = readRow('meta', CountEntry, await db.meta.get(key));
  return entry?.key === key ? entry.value : 0;
}

/** The instant stored under a meta `key`, or undefined (none, or one that is not an instant). */
export async function readInstant(db: LedgerDb, key: string): Promise<IsoTs | undefined> {
  const entry = readRow('meta', InstantEntry, await db.meta.get(key));
  return entry?.key === key ? entry.value : undefined;
}

/**
 * Raises the high water to `at` (an instant the caller is storing: a sighting, a sync, a read). Call it inside the
 * transaction that stores the fact; its scope must include `meta`.
 */
export async function noteStoredInstant(db: LedgerDb, at: IsoTs): Promise<void> {
  await db.meta.put({ key: STORED_WRITES, value: (await readCount(db, STORED_WRITES)) + 1 });
  const held = await readInstant(db, CLOCK_HIGH_WATER);
  if (held !== undefined && epochMs(held) >= epochMs(at)) return;
  await db.meta.put({ key: CLOCK_HIGH_WATER, value: at });
}
