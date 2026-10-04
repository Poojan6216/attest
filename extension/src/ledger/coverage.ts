/**
 * The coverage store (docs/grading.md §3, §6.1; Hard Rules 5, 6): every interval an observer pass reported it saw,
 * per observer, source and account hash, kept within retention, and `coverageFor`, which reads them back in the
 * exact `Coverage` shape `grade()` and `gradeBatch()` take.
 *
 * Storage (`coverageIntervals`, schema v2, db.ts): one row per maximal interval of one group, a group being one
 * (observerId, source, accountHash, allCalendars). `recordCoverage` merges a pass into every stored interval of its
 * group that it overlaps or touches (closed intervals: a 1 ms gap is never bridged, as conditions-coverage.ts
 * `covers` reads them): the union keeps the earliest start, the latest end and the latest `lastSyncAt`. That is sound
 * for every batch evaluated at or after the latest sync it merged. "By `lastSyncAt` the observer had seen
 * `windowStart..windowEnd`" stays true of the union; the time seen is unchanged; eligibility, caps and the account
 * count read the group's fields, which the union keeps; and grace (§6.1 `graceElapsed`) reads the latest sync, which
 * it keeps. A batch evaluated before that sync (stamped before the pass synced, its transaction begun after the pass
 * was stored, §3) does not see the merged interval at all, where it would have seen the earlier pass: less coverage,
 * never more, so it can only grade towards UNVERIFIABLE or miss an orphan the next batch finds (Hard Rule 5). A batch
 * stores the coverage it graded with in its receipt inputs, so replay never reads this table (§9). Without merging, a
 * Gmail tab open all day would add an overlapping interval per pass, and `coverageFor` would read thousands.
 *
 * `coverageFor(type, window, evaluatedAt)` returns, for each source the policy lists for `type` (§6.1 relevant
 * sources), every interval synced by `evaluatedAt` that overlaps the window, plus, for each account the source was
 * seen with (the account-less key included), its latest interval synced by `evaluatedAt`. §6.1 counts a source's
 * distinct account hashes over all of its entries in `coverage.observers` ("coverageFor must return all of them"),
 * and `graceElapsed` reads the latest eligible sync whatever window it saw, so the result decides every condition
 * exactly as every stored interval would, at a bounded size. A window that no interval overlaps gets level `none`
 * (Hard Rule 5): a claim windowed before an observer's first pass is UNVERIFIABLE (`no_coverage`).
 *
 * Rows are read through `readInterval`: derived fields stripped, strict `ObserverCoverage` parse, a corrupt row
 * skipped and logged by count only (it then counts as no coverage, the safe direction). The observer obligations
 * (a pass whose health was OK and whose rows were all stored) are the writer's, Sprint 2.7.
 */
import { Dexie, type Collection } from 'dexie';
import type { z } from 'zod';

import { canonicalJson } from '../core/hash';
import { instantMs } from '../core/normalize';
import { compareNumbers, compareText } from '../core/order';
import type { Policy } from '../core/policy';
import { claimWindow, type WindowClaim } from '../core/window';
import { log } from '../log';
import type { CoverageIntervalRow, LedgerDb } from './db';
import { LedgerError } from './errors';
import {
  ActionType,
  Coverage,
  IsoTs,
  ObserverCoverage,
  type ObservationSource,
  type ObserverCoverageInput,
} from './types';

/** A coverage entry with its instants read once (core `instantMs`, as grading reads them). */
export interface PlacedEntry {
  readonly entry: ObserverCoverage;
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
}

/** A stored row: its outbound key and its parsed entry. */
export interface StoredEntry {
  readonly key: number;
  readonly placed: PlacedEntry;
}

/** The claim window §6.1 reads coverage over, or null for a claim with none (a calendar claim without targetAt). */
export interface CoverageWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

export interface CoverageQuery {
  readonly type: ActionType;
  readonly window: CoverageWindow | null;
  /** The batch instant (ISO 8601 with an offset): intervals synced later are not returned (§3). */
  readonly evaluatedAt: string;
}

/** The policy fields coverage reads. A loaded `Policy` satisfies it. */
export type CoverageStorePolicy = Pick<Policy, 'sourcesByType' | 'windows'>;

const DERIVED_FIELDS: ReadonlySet<string> = new Set(['accountKey', 'startMs', 'endMs', 'syncMs']);

/** IndexedDB keys cannot be undefined: the account-less entries share the key ''. */
export function accountKeyOfEntry(entry: Pick<ObserverCoverage, 'accountHash'>): string {
  return entry.accountHash ?? '';
}

/** Entries merge only within one group: everything eligibility and caps read is the same (§6.1). */
function groupKey(entry: ObserverCoverage): string {
  return canonicalJson([
    entry.observerId,
    entry.source,
    accountKeyOfEntry(entry),
    entry.allCalendars ?? null,
  ]);
}

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

/** Stored row → strict entry, or undefined (logged, never echoed: Hard Rule 10) when it fails its schema. */
export function readInterval(row: unknown): PlacedEntry | undefined {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined;
  const domain = Object.fromEntries(Object.entries(row).filter(([key]) => !DERIVED_FIELDS.has(key)));
  const parsed = ObserverCoverage.safeParse(domain);
  if (parsed.success) return placeEntry(parsed.data);
  log.warn('ledger.row_invalid', { table: 'coverage', id: null, issues: parsed.error.issues.length });
  return undefined;
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

function parseInput<S extends z.ZodType>(schema: S, input: unknown, field: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || field);
  throw new LedgerError('invalid_input', 'Invalid coverage input', {
    table: 'coverage',
    paths: paths.join('|'),
  });
}

/** The union of two intervals of one group that overlap or touch: earliest start, latest end, latest sync. */
function unite(a: PlacedEntry, b: PlacedEntry): PlacedEntry {
  const start = b.startMs < a.startMs ? b : a;
  const end = b.endMs > a.endMs ? b : a;
  const sync = b.syncMs > a.syncMs ? b : a;
  const entry = ObserverCoverage.parse({
    ...a.entry,
    windowStart: start.entry.windowStart,
    windowEnd: end.entry.windowEnd,
    lastSyncAt: sync.entry.lastSyncAt,
  });
  return { entry, startMs: start.startMs, endMs: end.endMs, syncMs: sync.syncMs };
}

const sameEntry = (a: PlacedEntry, b: PlacedEntry): boolean =>
  canonicalJson(a.entry) === canonicalJson(b.entry);

/**
 * Stores one pass's coverage entry (the core `ObserverCoverage`; §3), merged with every stored interval of its group
 * that it overlaps or touches, in one readwrite transaction. Recording the same entry twice changes nothing. An
 * entry that fails its schema throws `LedgerError('invalid_input')` (field names only) and writes nothing.
 */
export async function recordCoverage(db: LedgerDb, input: ObserverCoverageInput): Promise<void> {
  const incoming = placeEntry(parseInput(ObserverCoverage, input, 'entry'));
  const group = groupKey(incoming.entry);
  const table = db.coverageIntervals;
  await db.transaction('rw', table, async (): Promise<void> => {
    const later = table
      .where('[source+endMs]')
      .between([incoming.entry.source, incoming.startMs], [incoming.entry.source, Dexie.maxKey], true, true);
    const touching = (await storedEntries(later)).filter(
      ({ placed }) =>
        groupKey(placed.entry) === group &&
        placed.startMs <= incoming.endMs &&
        placed.endMs >= incoming.startMs,
    );
    const union = touching.reduce((held, { placed }) => unite(held, placed), incoming);
    const [only] = touching;
    if (touching.length === 1 && only !== undefined && sameEntry(only.placed, union)) return;
    await table.bulkDelete(touching.map(({ key }) => key));
    await table.add(toIntervalRow(union));
  });
}

function checkWindow(window: CoverageWindow | null): void {
  if (window === null) return;
  const { fromMs, toMs } = window;
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs > toMs) {
    throw new LedgerError('invalid_input', 'Coverage window must be safe integers with from <= to', {
      table: 'coverage',
      paths: 'window',
    });
  }
}

/** The source's intervals synced by `evaluatedMs` that overlap `window`. */
async function overlapping(
  db: LedgerDb,
  source: ObservationSource,
  window: CoverageWindow,
  evaluatedMs: number,
): Promise<PlacedEntry[]> {
  const ending = db.coverageIntervals
    .where('[source+endMs]')
    .between([source, window.fromMs], [source, Dexie.maxKey], true, true);
  return (await storedEntries(ending))
    .map(({ placed }) => placed)
    .filter(
      (placed) =>
        placed.entry.source === source &&
        placed.syncMs <= evaluatedMs &&
        placed.startMs <= window.toMs &&
        placed.endMs >= window.fromMs,
    );
}

/** Each account key the source was seen with (the account-less key '' included). */
async function accountKeys(db: LedgerDb, source: ObservationSource): Promise<string[]> {
  const keys = await db.coverageIntervals
    .where('[source+accountKey]')
    .between([source, Dexie.minKey], [source, Dexie.maxKey], true, true)
    .uniqueKeys();
  return keys.flatMap((key) => (Array.isArray(key) && typeof key[1] === 'string' ? [key[1]] : []));
}

/** For each account of the source, its latest valid interval synced by `evaluatedMs`. */
async function latestPerAccount(
  db: LedgerDb,
  source: ObservationSource,
  evaluatedMs: number,
): Promise<PlacedEntry[]> {
  const latest: PlacedEntry[] = [];
  for (const account of await accountKeys(db, source)) {
    const found: PlacedEntry[] = [];
    await db.coverageIntervals
      .where('[source+accountKey+syncMs]')
      .between([source, account, Dexie.minKey], [source, account, evaluatedMs], true, true)
      .reverse()
      .until(() => found.length > 0)
      .each((row) => {
        const placed = readInterval(row);
        const usable =
          placed?.entry.source === source &&
          accountKeyOfEntry(placed.entry) === account &&
          placed.syncMs <= evaluatedMs;
        if (usable) found.push(placed);
      });
    latest.push(...found);
  }
  return latest;
}

/** A deterministic order: source, start, end, sync, observer, account, allCalendars. */
function compareEntries(a: PlacedEntry, b: PlacedEntry): number {
  return (
    compareText(a.entry.source, b.entry.source) ||
    compareNumbers(a.startMs, b.startMs) ||
    compareNumbers(a.endMs, b.endMs) ||
    compareNumbers(a.syncMs, b.syncMs) ||
    compareText(a.entry.observerId, b.entry.observerId) ||
    compareText(accountKeyOfEntry(a.entry), accountKeyOfEntry(b.entry)) ||
    compareText(canonicalJson(a.entry), canonicalJson(b.entry))
  );
}

/**
 * §3, §6.1: the coverage a claim of `type` windowed at `window` is graded with at `evaluatedAt` (see the header),
 * as a parsed `Coverage`, entries de-duplicated and in a fixed order. Throws `LedgerError('invalid_input')` for a
 * malformed `evaluatedAt`, an unknown type or a window that is not safe integers with `fromMs <= toMs`. Reads in
 * the caller's transaction when there is one (it must include the coverage store), else in its own.
 */
export async function coverageFor(
  db: LedgerDb,
  query: CoverageQuery,
  policy: Pick<Policy, 'sourcesByType'>,
): Promise<Coverage> {
  const evaluatedAt = parseInput(IsoTs, query.evaluatedAt, 'evaluatedAt');
  const type = parseInput(ActionType, query.type, 'type');
  checkWindow(query.window);
  const evaluatedMs = instantMs(evaluatedAt);
  return db.transaction('r', db.coverageIntervals, async (): Promise<Coverage> => {
    const found = new Map<string, PlacedEntry>();
    for (const source of policy.sourcesByType[type]) {
      const window = query.window;
      const seen = window === null ? [] : await overlapping(db, source, window, evaluatedMs);
      for (const placed of [...seen, ...(await latestPerAccount(db, source, evaluatedMs))]) {
        found.set(canonicalJson(placed.entry), placed);
      }
    }
    const observers = [...found.values()].sort(compareEntries).map(({ entry }) => entry);
    return Coverage.parse({ evaluatedAt, observers });
  });
}

/** `coverageFor` over a claim's own §4.1 window (null for a calendar claim without `targetAt`). */
export async function coverageForClaim(
  db: LedgerDb,
  claim: WindowClaim,
  evaluatedAt: string,
  policy: CoverageStorePolicy,
): Promise<Coverage> {
  return coverageFor(db, { type: claim.type, window: claimWindow(claim, policy), evaluatedAt }, policy);
}
