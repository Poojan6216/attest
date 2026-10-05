/**
 * The writing half of the coverage store (./coverage.ts has the whole contract; docs/grading.md §3, §6.1; Hard
 * Rules 5, 6): a stored interval read back as a placed entry (`readInterval`, `storedEntries`), and `recordCoverage`,
 * which merges a pass's entry into its group's stored intervals (./coverage-merge.ts) and raises the clock's high
 * water (./clock-guard.ts).
 */
import { Dexie, type Collection } from 'dexie';
import type { z } from 'zod';

import { canonicalJson } from '../core/hash';
import { instantMs } from '../core/normalize';
import { noteStoredInstant } from './clock-high-water';
import {
  absorb,
  accountKeyOfEntry,
  groupKey,
  isFirstLookMarker,
  type PlacedEntry,
  type StoredEntry,
  touches,
} from './coverage-merge';
import { readRow, type CoverageIntervalRow, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { ObserverCoverage, type ObserverCoverageInput } from './types';

export function placeEntry(entry: ObserverCoverage): PlacedEntry {
  return {
    entry,
    startMs: instantMs(entry.windowStart),
    endMs: instantMs(entry.windowEnd),
    syncMs: instantMs(entry.lastSyncAt),
  };
}

export function toIntervalRow(placed: PlacedEntry): CoverageIntervalRow {
  const { entry, startMs, endMs, syncMs } = placed;
  return { ...entry, accountKey: accountKeyOfEntry(entry), startMs, endMs, syncMs };
}

/**
 * Stored row → strict entry (its derived fields, INDEX_FIELDS.coverageIntervals, stripped), or undefined when it
 * fails its schema (logged by table and observer id only, never echoed: Hard Rule 10).
 */
export function readInterval(row: unknown): PlacedEntry | undefined {
  if (row === undefined) return undefined;
  const entry = readRow('coverageIntervals', ObserverCoverage, row);
  return entry === undefined ? undefined : placeEntry(entry);
}

/** Every valid row of `collection` with its key, in index order. */
export async function storedEntries(
  collection: Collection<CoverageIntervalRow, number>,
): Promise<StoredEntry[]> {
  const out: StoredEntry[] = [];
  await collection.each((row, cursor) => {
    const placed = readInterval(row);
    if (placed !== undefined && typeof cursor.primaryKey === 'number') {
      out.push({ key: cursor.primaryKey, placed });
    }
  });
  return out;
}

/** `input` parsed with `schema`, or `LedgerError('invalid_input')` naming the failing fields only. */
export function parseCoverageInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  field: string,
): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || field);
  throw new LedgerError('invalid_input', 'Invalid coverage input', {
    table: 'coverage',
    paths: paths.join('|'),
  });
}

const sameEntry = (a: PlacedEntry, b: PlacedEntry): boolean =>
  canonicalJson(a.entry) === canonicalJson(b.entry);

/**
 * The stored intervals `incoming` may touch: those ending at or after its start. A first-look marker merges only with
 * an identical marker (./coverage-merge.ts: its own group, one point per sighting), so for one only the intervals
 * ending at its instant are read, never every interval after it.
 */
function mayTouch(db: LedgerDb, incoming: PlacedEntry): Collection<CoverageIntervalRow, number> {
  const { source } = incoming.entry;
  const index = db.coverageIntervals.where('[source+endMs]');
  if (isFirstLookMarker(incoming.entry)) return index.equals([source, incoming.endMs]);
  return index.between([source, incoming.startMs], [source, Dexie.maxKey], true, true);
}

/**
 * Stores one pass's coverage entry (the core `ObserverCoverage`; §3), merged with every stored interval of its group
 * that it overlaps or touches and may merge with (./coverage-merge.ts `absorb`), in one readwrite transaction over
 * `coverageIntervals` and `meta` (its `lastSyncAt` raises the clock's high water, ./clock-guard.ts). Recording the
 * same entry twice changes nothing. An entry that fails its schema throws `LedgerError('invalid_input')` (field names
 * only) and writes nothing.
 */
export async function recordCoverage(db: LedgerDb, input: ObserverCoverageInput): Promise<void> {
  const incoming = placeEntry(parseCoverageInput(ObserverCoverage, input, 'entry'));
  const group = groupKey(incoming.entry);
  const table = db.coverageIntervals;
  await db.transaction('rw', [table, db.meta], async (): Promise<void> => {
    await noteStoredInstant(db, incoming.entry.lastSyncAt);
    const touching = (await storedEntries(mayTouch(db, incoming))).filter(
      ({ placed }) => groupKey(placed.entry) === group && touches(placed, incoming),
    );
    const { union, absorbed } = absorb(incoming, touching);
    const [only] = absorbed;
    if (absorbed.length === 1 && only !== undefined && sameEntry(only.placed, union)) return;
    await table.bulkDelete(absorbed.map(({ key }) => key));
    await table.add(toIntervalRow(union));
  });
}
