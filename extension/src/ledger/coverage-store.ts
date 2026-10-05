/**
 * The writing half of the coverage store (./coverage.ts has the whole contract; docs/grading.md §3, §6.1; Hard
 * Rules 5, 6): a stored interval read back as a placed entry (`readInterval`, `storedEntries`), and `recordCoverage`,
 * which merges a pass's entry into its group's stored intervals (./coverage-merge.ts) and raises the clock's high
 * water (./clock-guard.ts).
 *
 * Bounded reads (TECH-1, schema v4): a stored interval is a `point` (one instant: a first-look marker, a receipt's
 * instant) or a `span`, read from separate index ranges, and the longest span of a source is one indexed read
 * (`longestSpanMs`). An interval [s, e] overlaps or touches [from, to] exactly when e ≥ from and s ≤ to, so with
 * spans no longer than L its end lies in [from, to + L]: the reads below walk exactly the rows that can overlap,
 * never every interval that ends later (every marker of a future event, every window ahead).
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
import { ObserverCoverage, type ObserverCoverageInput, type ObservationSource } from './types';

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
  const kind = startMs === endMs ? 'point' : 'span';
  return {
    ...entry,
    accountKey: accountKeyOfEntry(entry),
    startMs,
    endMs,
    syncMs,
    kind,
    lenMs: endMs - startMs,
  };
}

/** The length of the source's longest stored span (0 when it has none): one indexed read. */
export async function longestSpanMs(db: LedgerDb, source: ObservationSource): Promise<number> {
  const longest = await db.coverageIntervals
    .where('[source+kind+lenMs]')
    .between([source, 'span', Dexie.minKey], [source, 'span', Dexie.maxKey], true, true)
    .last();
  return typeof longest?.lenMs === 'number' && longest.lenMs > 0 ? longest.lenMs : 0;
}

/** The source's stored points whose instant lies in [fromMs, toMs]. */
export function pointsIn(
  db: LedgerDb,
  source: ObservationSource,
  fromMs: number,
  toMs: number,
): Collection<CoverageIntervalRow, number> {
  return db.coverageIntervals
    .where('[source+kind+endMs]')
    .between([source, 'point', fromMs], [source, 'point', toMs], true, true);
}

/** The source's stored spans that end in [fromMs, toMs]. */
export function spansEndingIn(
  db: LedgerDb,
  source: ObservationSource,
  fromMs: number,
  toMs: number,
): Collection<CoverageIntervalRow, number> {
  return db.coverageIntervals
    .where('[source+kind+endMs]')
    .between([source, 'span', fromMs], [source, 'span', toMs], true, true);
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
 * The stored intervals `incoming` may touch, read by bounded index ranges (see the header):
 *  - a first-look marker merges only with an identical marker (./coverage-merge.ts: its own group, one point per
 *    sighting): only the points at its instant;
 *  - a `gcal.event` window: only spans. Every `gcal.event` point is a marker (a pass's window is a run of whole
 *    days), and a marker never merges with a window;
 *  - any other entry: the points inside it and the spans that may reach it.
 * Spans are read up to the incoming end plus the source's longest span: a span ending later starts after it. A
 * Gmail window never ends after its sync (src/background/observer-messages.ts refuses one that does), so its read
 * never reaches a future the clock has not seen.
 */
async function mayTouch(db: LedgerDb, incoming: PlacedEntry): Promise<StoredEntry[]> {
  const { source } = incoming.entry;
  const { startMs, endMs } = incoming;
  if (isFirstLookMarker(incoming.entry)) return storedEntries(pointsIn(db, source, endMs, endMs));
  const spans = await storedEntries(
    spansEndingIn(db, source, startMs, endMs + (await longestSpanMs(db, source))),
  );
  if (source === 'gcal.event') return spans;
  return [...(await storedEntries(pointsIn(db, source, startMs, endMs))), ...spans];
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
    // In [source+endMs] index order (end, then key), the order the merge always read them in.
    const touching = (await mayTouch(db, incoming))
      .filter(({ placed }) => groupKey(placed.entry) === group && touches(placed, incoming))
      .sort((a, b) => a.placed.endMs - b.placed.endMs || a.key - b.key);
    const { union, absorbed } = absorb(incoming, touching);
    const [only] = absorbed;
    if (absorbed.length === 1 && only !== undefined && sameEntry(only.placed, union)) return;
    await table.bulkDelete(absorbed.map(({ key }) => key));
    await table.add(toIntervalRow(union));
  });
}
