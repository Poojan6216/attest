/**
 * The clock's high water (./clock-guard.ts has the rule; Decisions [2.7] wave E): the latest instant the ledger stored
 * a sighting, a sync or a read at since the clock last went back. Every writer of such an instant raises it in the
 * transaction that stores the fact (`noteStoredInstant`): ./upsert.ts (a new row's or claim's sighting),
 * ./coverage-store.ts (an interval's `lastSyncAt`), ./calendar-snapshots.ts (a record's `readAt`) and ./health.ts (an
 * observer health report's `checkedAt`, SEC-4). Kept apart from the guard so those writers do not depend on what the
 * guard repairs. The retention purge trusts the wall clock only up to it (./retention-clock.ts, SEC-5).
 */
import { z } from 'zod';

import { readRow, type LedgerDb } from './db';
import { epochMs } from './index-fields';
import { IsoTs } from './types';

/** The meta key of the latest instant stored since the last repair. Written only by `noteStoredInstant`. */
export const CLOCK_HIGH_WATER = 'clockHighWater';

const InstantEntry = z.strictObject({ key: z.string(), value: IsoTs });

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
  const held = await readInstant(db, CLOCK_HIGH_WATER);
  if (held !== undefined && epochMs(held) >= epochMs(at)) return;
  await db.meta.put({ key: CLOCK_HIGH_WATER, value: at });
}
