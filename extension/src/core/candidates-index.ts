/**
 * Observation indexes (docs/grading.md §4.2). `ObservationIndex` is the only way core reads observations, and
 * every read is bounded in time. Reads may over-return (whole time buckets, other tokens' neighbours);
 * `candidates()` filters exactly. The in-memory index here serves tests and replay; the Dexie index
 * (Sprint 2.6) passes the same tests.
 *
 * Memory index: one array per action type and one per counterparty token, each sorted by `occurredAt`
 * instant (then id), searched by binary search. A query's bounds are widened outward to whole buckets of
 * `bucketMinutes`, the granularity a bucketed store returns, so callers are exercised against over-return.
 *
 * PURE: no I/O, no clock (Hard Rule 4). Async only because the Dexie index is.
 */
import { CandidatesError } from './candidates-error';
import { asciiLower, email, instantMs, nameTokens } from './normalize';
import { compareNumbers, compareText } from './order';
import type { ActionType, Observation } from './schema';
import { MS_PER_MINUTE } from './units';

export interface ObservationIndex {
  /** Observations of `type` with `occurredAt` in `[fromMs, toMs]`, possibly with more around them. */
  byTypeAndBucket(type: ActionType, fromMs: number, toMs: number): Promise<readonly Observation[]>;
  /**
   * Observations carrying `token` (see `counterpartyTokens`, matched exactly as given) with `occurredAt` in
   * `[fromMs, toMs]`, possibly with more around them.
   */
  byCounterpartyToken(token: string, fromMs: number, toMs: number): Promise<readonly Observation[]>;
}

interface Entry {
  readonly ms: number;
  readonly observation: Observation;
}

/** §5.1: an observation address's local part splits on `[._-]` after its `+tag` is removed. */
const LOCAL_PART_SEPARATOR = /[._-]+/;

/**
 * The tokens an observation is indexed under: its counterparty address (read through `email()`, so a display
 * name is never indexed: it is attacker-controlled), that address's domain and local-part tokens, all
 * ASCII-lowercased (§5.1, §11), and its merchant's name tokens. Distinct and sorted.
 */
export function counterpartyTokens(observation: Pick<Observation, 'counterparty' | 'merchant'>): string[] {
  const tokens = new Set<string>();
  const address = observation.counterparty === undefined ? null : email(observation.counterparty);
  if (address !== null) {
    tokens.add(asciiLower(address.address));
    tokens.add(asciiLower(address.domain));
    for (const part of asciiLower(address.baseLocal).split(LOCAL_PART_SEPARATOR)) {
      if (part !== '') tokens.add(part);
    }
  }
  if (observation.merchant !== undefined) {
    for (const token of nameTokens(observation.merchant)) tokens.add(token);
  }
  return [...tokens].sort();
}

/** Storage order: `occurredAt` instant, then id (order.ts comparators; `candidates()` filters and orders exactly). */
function compareEntries(a: Entry, b: Entry): number {
  return compareNumbers(a.ms, b.ms) || compareText(a.observation.id, b.observation.id);
}

/** The first index whose entry is at `ms` or later (`entries` sorted by `ms`). */
function firstAtOrAfter(entries: readonly Entry[], ms: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const entry = entries[middle];
    if (entry !== undefined && entry.ms < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

function floorMod(value: number, unit: number): number {
  return ((value % unit) + unit) % unit;
}

/** Entries in `[fromMs, toMs]` widened to whole buckets: the over-return of a bucketed store. */
function readRange(entries: readonly Entry[] | undefined, fromMs: number, toMs: number, bucketMs: number) {
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs)) {
    throw new CandidatesError('invalid_range');
  }
  if (entries === undefined || fromMs > toMs) return [];
  const bucketStart = fromMs - floorMod(fromMs, bucketMs);
  const nextBucketStart = toMs - floorMod(toMs, bucketMs) + bucketMs;
  const first = firstAtOrAfter(entries, bucketStart);
  const end = firstAtOrAfter(entries, nextBucketStart);
  return entries.slice(first, end).map((entry) => entry.observation);
}

function push<Key>(map: Map<Key, Entry[]>, key: Key, entry: Entry): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [entry]);
  else list.push(entry);
}

function sortAll<Key>(map: Map<Key, Entry[]>): Map<Key, Entry[]> {
  for (const list of map.values()) list.sort(compareEntries);
  return map;
}

/**
 * An in-memory `ObservationIndex` over `observations` (kept as given; duplicates are `candidates()`'s job).
 * `bucketMinutes` is the bucket width reads are widened to: a positive whole number of minutes, else
 * `CandidatesError('invalid_bucket')`. Throws `NormalizeError` for an `occurredAt` that is not ISO with an
 * offset. Build O(n log n); each read O(log n + returned).
 */
export function createMemoryIndex(
  observations: readonly Observation[],
  bucketMinutes: number,
): ObservationIndex {
  if (!Number.isSafeInteger(bucketMinutes) || bucketMinutes < 1) throw new CandidatesError('invalid_bucket');
  const bucketMs = bucketMinutes * MS_PER_MINUTE;
  if (!Number.isSafeInteger(bucketMs)) throw new CandidatesError('invalid_bucket');
  const byType = new Map<ActionType, Entry[]>();
  const byToken = new Map<string, Entry[]>();
  for (const observation of observations) {
    // Read from the text: the entry keeps the instant, and a memo entry (candidates-time.ts) would outlive the index.
    const entry = { ms: instantMs(observation.occurredAt), observation };
    push(byType, observation.type, entry);
    for (const token of counterpartyTokens(observation)) push(byToken, token, entry);
  }
  sortAll(byType);
  sortAll(byToken);
  // A bad range rejects the returned promise (the executor's throw), as an async store's read would.
  const read = (entries: readonly Entry[] | undefined, fromMs: number, toMs: number) =>
    new Promise<readonly Observation[]>((resolve) => {
      resolve(readRange(entries, fromMs, toMs, bucketMs));
    });
  return {
    byTypeAndBucket: (type, fromMs, toMs) => read(byType.get(type), fromMs, toMs),
    byCounterpartyToken: (token, fromMs, toMs) => read(byToken.get(token), fromMs, toMs),
  };
}
