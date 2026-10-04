/**
 * The coverage half of the retention purge (./retention.ts; Decisions [2.6]; Hard Rule 5).
 *
 * Coverage honesty after a purge: the ledger never keeps a coverage interval over an instant whose evidence it has
 * forgotten. Otherwise a claim graded after the purge could read `full` coverage over a window whose matching
 * observation was purged (a false NOT_FOUND), and an old observation kept as another receipt's evidence could be
 * read as an orphan again (a false UNASKED). Every observation the purge removes lies before the cutoff
 * (./retention.ts rule 3 keeps current evidence with its receipt), so cutting coverage at the cutoff is enough:
 * an interval that ends before it is deleted, one that starts before it starts there now. Removing coverage lowers
 * a claim's coverage over the forgotten span (towards UNVERIFIABLE). It forgets the accounts seen only before the
 * cutoff too, so §6.1's account count is taken over the retention window, and replay reads the coverage each
 * receipt stored, never this table (§9).
 *
 * The latest-ping rows of the v1 `coverage` table (one per observer and account) are deleted once their last sync is
 * before the cutoff.
 */
import { Dexie } from 'dexie';

import { instantMs } from '../core/normalize';
import { type PlacedEntry, placeEntry, storedEntries, toIntervalRow } from './coverage';
import { readRows, type LedgerDb } from './db';
import { accountKeyOf } from './index-fields';
import { CoveragePing, IsoTs, ObservationSource, ObserverCoverage } from './types';

export interface CoverageForgotten {
  /** Intervals deleted: nothing of them is kept. */
  readonly deleted: number;
  /** Intervals cut: moved to start at the cutoff. */
  readonly cut: number;
}

const isoOf = (ms: number): IsoTs => IsoTs.parse(new Date(ms).toISOString());

/** `placed` with a new start and/or end, still in its group (every other field kept). */
function reshaped(placed: PlacedEntry, startMs: number, endMs: number): PlacedEntry {
  const windowStart = startMs === placed.startMs ? placed.entry.windowStart : isoOf(startMs);
  const windowEnd = endMs === placed.endMs ? placed.entry.windowEnd : isoOf(endMs);
  return placeEntry(ObserverCoverage.parse({ ...placed.entry, windowStart, windowEnd }));
}

/** Deletes or cuts one source's intervals so none starts before `cutoffMs`. */
async function cutAtCutoff(
  db: LedgerDb,
  source: ObservationSource,
  cutoffMs: number,
): Promise<CoverageForgotten> {
  const table = db.coverageIntervals;
  let deleted = await table
    .where('[source+endMs]')
    .between([source, Dexie.minKey], [source, cutoffMs], true, false)
    .delete();
  let cut = 0;
  const reaching = table
    .where('[source+endMs]')
    .between([source, cutoffMs], [source, Dexie.maxKey], true, true);
  for (const { key, placed } of await storedEntries(reaching)) {
    if (placed.startMs >= cutoffMs) continue;
    if (placed.endMs < cutoffMs) {
      // A row whose index field disagrees with its own windowEnd: nothing of it is kept.
      await table.delete(key);
      deleted += 1;
    } else {
      await table.put(toIntervalRow(reshaped(placed, cutoffMs, placed.endMs)), key);
      cut += 1;
    }
  }
  return { deleted, cut };
}

/** Applies the rule in the header for a purge at `cutoffMs`. Runs inside the purge's readwrite transaction. */
export async function forgetCoverage(db: LedgerDb, cutoffMs: number): Promise<CoverageForgotten> {
  const total = { deleted: 0, cut: 0 };
  for (const source of ObservationSource.options) {
    const done = await cutAtCutoff(db, source, cutoffMs);
    total.deleted += done.deleted;
    total.cut += done.cut;
  }
  return total;
}

/**
 * Deletes the v1 latest-ping rows whose `lastSyncAt` is before `cutoffMs`. The table holds one row per observer and
 * account (repo.ts `putCoveragePing`), so reading it whole is bounded.
 */
export async function purgeCoveragePings(db: LedgerDb, cutoffMs: number): Promise<number> {
  const stale = readRows('coverage', CoveragePing, await db.coverage.toArray()).filter(
    (ping) => instantMs(ping.lastSyncAt) < cutoffMs,
  );
  await db.coverage.bulkDelete(stale.map((ping) => [ping.observerId, accountKeyOf(ping.accountHash)]));
  return stale.length;
}
