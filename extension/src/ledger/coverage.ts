/**
 * The coverage store (docs/grading.md §3, §6.1; Hard Rules 5, 6): every interval an observer pass reported it saw,
 * per observer, source and account hash, kept within retention, and `coverageFor`, which reads them back in the
 * exact `Coverage` shape `grade()` and `gradeBatch()` take.
 *
 * Storage (`coverageIntervals`, schema v2, db.ts): one row per maximal interval of one group (./coverage-merge.ts:
 * the same observer, source, account, `allCalendars`, `changesSince`, and first-look marker or not). `recordCoverage`
 * (./coverage-store.ts) merges a pass into every stored interval of its group that it overlaps or touches and may
 * merge with (closed intervals: a 1 ms gap is never bridged, as conditions-coverage.ts `covers` reads them): the
 * union keeps the earliest start, the latest end and the latest `lastSyncAt`. Two `gcal.event` intervals merge only
 * when they synced at one instant or the earlier-synced window lies inside the later-synced one, so a union never
 * moves a `lastSyncAt` over Calendar days the later pass did not see (./coverage-merge.ts `mergeable`; §6.1 caps a
 * calendar claim's entries synced before its grace). A union is sound for every batch evaluated at or after the
 * latest sync it merged: "by `lastSyncAt` the observer had seen `windowStart..windowEnd`" stays true of it;
 * eligibility, caps and the account count read the group's fields, which the union keeps; and grace (§6.1
 * `graceElapsed`) reads the latest sync, which it keeps. A batch evaluated before that sync (stamped before the
 * pass synced, its transaction begun after the pass was stored, §3) does not see the merged interval at all, where
 * it would have seen the earlier pass: less coverage, never more, so it can only grade towards UNVERIFIABLE or miss
 * an orphan the next batch finds (Hard Rule 5). A batch stores the coverage it graded with in its receipt inputs,
 * so replay never reads this table (§9). Without merging, a Gmail tab open all day would add an overlapping interval
 * per pass, and `coverageFor` would read thousands.
 *
 * `coverageFor(type, window, evaluatedAt)` returns, for each source the policy lists for `type` (§6.1 relevant
 * sources), every interval synced by `evaluatedAt` that overlaps the window, plus, for each account the source was
 * seen with (the account-less key included), its latest interval synced by `evaluatedAt`. §6.1 counts a source's
 * distinct account hashes over all of its entries in `coverage.observers` ("coverageFor must return all of them"),
 * and `graceElapsed` reads the latest eligible sync whatever window it saw, so the result decides every condition
 * exactly as every stored interval would, at a bounded size. The `gcal.event` entries it returns are closed under
 * overlap (v1.9): with any it holds, every other one synced by `evaluatedAt` whose window overlaps it, whatever its
 * account (`closeOverlaps`). `coverageForMany` answers every claim of a batch in one read transaction, reading the
 * Calendar source once for all of them. A window that no interval overlaps gets level `none` (Hard Rule 5): a claim
 * windowed before an observer's first pass is UNVERIFIABLE (`no_coverage`).
 *
 * Rows are read through `readInterval`: derived fields stripped, strict `ObserverCoverage` parse, a corrupt row
 * skipped and logged by count only (it then counts as no coverage, the safe direction). The observer obligations
 * (a pass whose health was OK and whose rows were all stored) are the writer's: src/background/observer-messages.ts.
 */
import { Dexie } from 'dexie';

import { canonicalJson } from '../core/hash';
import { instantMs } from '../core/normalize';
import { compareNumbers, compareText } from '../core/order';
import type { Policy } from '../core/policy';
import { claimWindow, type WindowClaim } from '../core/window';
import { accountKeyOfEntry, isFirstLookMarker, type PlacedEntry, type StoredEntry } from './coverage-merge';
import {
  parseCoverageInput,
  placeEntry,
  readInterval,
  recordCoverage,
  storedEntries,
  toIntervalRow,
} from './coverage-store';
import type { LedgerDb } from './db';
import { LedgerError } from './errors';
import { ActionType, Coverage, IsoTs, type ObservationSource } from './types';

export { accountKeyOfEntry, isFirstLookMarker, type PlacedEntry, type StoredEntry };
export { placeEntry, readInterval, recordCoverage, storedEntries, toIntervalRow };

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

/** The source whose entries a batch holds closed under overlap (docs/grading.md §3, Background obligations, v1.9). */
const CLOSED_SOURCE: ObservationSource = 'gcal.event';

/** One run of `overlapRuns`: its intervals, its earliest start and the latest end it reaches. */
interface Run {
  readonly entries: PlacedEntry[];
  readonly startMs: number;
  reachMs: number;
}

/**
 * What one read transaction has already read, per source and instant: the closed source's runs and each source's
 * latest interval per account. Shared by every query of a batch (`coverageForMany`), so the source is read once per
 * batch, not once per claim.
 */
type ReadCache = Map<string, Promise<unknown>>;

function cached<T>(cache: ReadCache, key: string, read: () => Promise<T>): Promise<T> {
  const held = cache.get(key) as Promise<T> | undefined;
  if (held !== undefined) return held;
  const reading = read();
  cache.set(key, reading);
  return reading;
}

/**
 * The source's intervals synced by `evaluatedMs`, cut into RUNS: maximal groups, ascending by start, in which each
 * interval overlaps or touches (closed intervals) one before it. Two intervals are connected by a chain of
 * overlapping ones exactly when they share a run, so a run is a connected component of the overlap graph.
 */
async function overlapRuns(db: LedgerDb, source: ObservationSource, evaluatedMs: number): Promise<Run[]> {
  const all = db.coverageIntervals
    .where('[source+endMs]')
    .between([source, Dexie.minKey], [source, Dexie.maxKey], true, true);
  const synced = (await storedEntries(all))
    .map(({ placed }) => placed)
    .filter((placed) => placed.entry.source === source && placed.syncMs <= evaluatedMs)
    .sort((a, b) => compareNumbers(a.startMs, b.startMs));
  const runs: Run[] = [];
  for (const placed of synced) {
    const last = runs[runs.length - 1];
    if (last === undefined || placed.startMs > last.reachMs) {
      runs.push({ entries: [placed], startMs: placed.startMs, reachMs: placed.endMs });
    } else {
      last.entries.push(placed);
      last.reachMs = Math.max(last.reachMs, placed.endMs);
    }
  }
  return runs;
}

/**
 * Adds to `found` every interval of `source` synced by `evaluatedMs` whose window overlaps one `found` holds, until
 * none joins: the orphan rule reads every first look over a change's days, whatever its account, so a reader that
 * returned only some of them could let another account's first-look rows accuse an agent (§3, §7; Hard Rule 7).
 * That fixpoint is every run (`overlapRuns`) an interval of `found` overlaps. The source is read once per read
 * transaction and instant (`cache`) and the closure is taken in memory: one query per joined interval made a batch's
 * read quadratic in the source's intervals, and first-look markers (./first-look.ts) add one per event first seen.
 */
async function closeOverlaps(
  db: LedgerDb,
  source: ObservationSource,
  found: Map<string, PlacedEntry>,
  evaluatedMs: number,
  cache: ReadCache,
): Promise<void> {
  const seeds = [...found.values()].filter((placed) => placed.entry.source === source);
  if (seeds.length === 0) return;
  const runs = await cached(cache, `runs:${source}:${String(evaluatedMs)}`, () =>
    overlapRuns(db, source, evaluatedMs),
  );
  for (const run of runs) {
    const reached = seeds.some((seed) => seed.startMs <= run.reachMs && seed.endMs >= run.startMs);
    if (!reached) continue;
    for (const other of run.entries) {
      const key = canonicalJson(other.entry);
      if (!found.has(key)) found.set(key, other);
    }
  }
}

/** A query checked before any read (`LedgerError('invalid_input')` otherwise): its type, window and instant. */
interface CheckedQuery {
  readonly type: ActionType;
  readonly window: CoverageWindow | null;
  readonly evaluatedAt: IsoTs;
  readonly evaluatedMs: number;
}

function checkQuery(query: CoverageQuery): CheckedQuery {
  const evaluatedAt = parseCoverageInput(IsoTs, query.evaluatedAt, 'evaluatedAt');
  const type = parseCoverageInput(ActionType, query.type, 'type');
  checkWindow(query.window);
  return { type, window: query.window, evaluatedAt, evaluatedMs: instantMs(evaluatedAt) };
}

/** One query's coverage, inside the caller's read transaction, sharing what it already read (`cache`). */
async function coverageIn(
  db: LedgerDb,
  query: CheckedQuery,
  policy: Pick<Policy, 'sourcesByType'>,
  cache: ReadCache,
): Promise<Coverage> {
  const { type, window, evaluatedAt, evaluatedMs } = query;
  const found = new Map<string, PlacedEntry>();
  for (const source of policy.sourcesByType[type]) {
    const seen = window === null ? [] : await overlapping(db, source, window, evaluatedMs);
    const latest = await cached(cache, `latest:${source}:${String(evaluatedMs)}`, () =>
      latestPerAccount(db, source, evaluatedMs),
    );
    for (const placed of [...seen, ...latest]) found.set(canonicalJson(placed.entry), placed);
  }
  if (policy.sourcesByType[type].includes(CLOSED_SOURCE)) {
    await closeOverlaps(db, CLOSED_SOURCE, found, evaluatedMs, cache);
  }
  const observers = [...found.values()].sort(compareEntries).map(({ entry }) => entry);
  return Coverage.parse({ evaluatedAt, observers });
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
  const checked = checkQuery(query);
  // An `async` scope: Dexie keeps its transaction across native awaits only inside one.
  return db.transaction('r', db.coverageIntervals, async (): Promise<Coverage> =>
    coverageIn(db, checked, policy, new Map()),
  );
}

/**
 * `coverageFor` of every query, in order, in one read transaction (the caller's when there is one): what one query
 * read (the closed source's runs, each source's latest per account) is not read again for another at the same
 * instant. A batch passes all of its claims here, so it reads the Calendar source once, not once per claim. Each
 * result is exactly what `coverageFor` returns for its query. Every query is checked before anything is read.
 */
export async function coverageForMany(
  db: LedgerDb,
  queries: readonly CoverageQuery[],
  policy: Pick<Policy, 'sourcesByType'>,
): Promise<Coverage[]> {
  const checked = queries.map(checkQuery);
  return db.transaction('r', db.coverageIntervals, async (): Promise<Coverage[]> => {
    const cache: ReadCache = new Map();
    const out: Coverage[] = [];
    for (const query of checked) out.push(await coverageIn(db, query, policy, cache));
    return out;
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
