/**
 * The ledger's `ObservationIndex` (docs/grading.md §4.2; src/core/candidates-index.ts): the Sprint 1 interface over
 * Dexie, the index the background grades with (Sprint 3.6) and the one `candidates()` and `gradeBatch()` read in the
 * live path.
 *
 * Every read is an indexed range over the `[type+timeBucket]` compound index (schema v1), bounded in time: the
 * buckets that overlap `[fromMs, toMs]`, one more bucket on each side (the stored bucket is read with `Date.parse`,
 * the bounds with core `instantMs`; the margin keeps a row whose two readings differ by under a bucket in the
 * read), then trimmed exactly to `[fromMs, toMs]` by `occurredAt` instant and ordered by (instant, id), as the
 * memory index orders. So this index never over-returns; `candidates()` still filters exactly (§4.2).
 *
 * Each row is read back through the ledger's row reader (`readRows`: index fields stripped, strict `Observation`
 * parse), so an observation comes back exactly as the ledger stored it, `sightedAt` included, and is never rebuilt
 * from index fields (Sprint 1 carry-forward SIM-2; §4.1, §7, §10). A row that fails its schema is skipped and
 * logged by id only (db.ts), as on every ledger read: a corrupt row never reaches grading.
 *
 * `byCounterpartyToken` reads the same bounded `[type+timeBucket]` ranges for every action type and keeps the rows
 * whose core `counterpartyTokens` (§4.2: the address read through `email()`, its domain, its local-part tokens, the
 * merchant's name tokens) include the token, matched exactly as given, as the memory index matches. (The v1
 * `counterpartyTokens` multiEntry index, a Sprint 0 placeholder that differed from §4.2 and was unbounded in time,
 * was dropped in schema v4: db.ts STORES_V4.)
 *
 * Reads run in the caller's transaction when there is one (a batch's readwrite transaction must include
 * `observations`, §3 Background obligations), else each in its own.
 */
import { LEDGER_TIME_BUCKET_MINUTES } from '../config';
import { CandidatesError, counterpartyTokens, type ObservationIndex } from '../core/candidates';
import { instantMs } from '../core/normalize';
import { compareNumbers, compareText } from '../core/order';
import { MS_PER_MINUTE } from '../core/units';
import { readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { ActionType, Observation } from './types';

/** The stored bucket width (index-fields.ts `timeBucketOf` computes the same `floor(epochMs / width)`). */
const BUCKET_MS = LEDGER_TIME_BUCKET_MINUTES * MS_PER_MINUTE;

/** Buckets read beyond each end of a range (see the header). */
const BUCKET_MARGIN = 1;

interface Entry {
  readonly ms: number;
  readonly observation: Observation;
}

/** The bucket that holds instant `ms` (index-fields.ts `timeBucketOf`, from epoch ms). */
export function bucketOfMs(ms: number): number {
  return Math.floor(ms / BUCKET_MS);
}

/** As the memory index: bounds that are not safe integers of ms reject the read (fail loud, Hard Rule 6). */
function checkRange(fromMs: number, toMs: number): void {
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs)) {
    throw new CandidatesError('invalid_range');
  }
}

function checkType(type: ActionType): ActionType {
  const parsed = ActionType.safeParse(type);
  if (parsed.success) return parsed.data;
  throw new LedgerError('invalid_input', 'Unknown action type', { table: 'observations', paths: 'type' });
}

/** The `[type+timeBucket]` key range of `type` that covers `[fromMs, toMs]`, with the margin. */
function bucketRange(type: ActionType, fromMs: number, toMs: number): [[string, number], [string, number]] {
  return [
    [type, bucketOfMs(fromMs) - BUCKET_MARGIN],
    [type, bucketOfMs(toMs) + BUCKET_MARGIN],
  ];
}

/** The valid rows among `rows` whose `occurredAt` lies in `[fromMs, toMs]` and that `keep` accepts, in order. */
function trimmed(
  rows: readonly unknown[],
  fromMs: number,
  toMs: number,
  keep: (observation: Observation) => boolean,
): Observation[] {
  const entries: Entry[] = [];
  for (const observation of readRows('observations', Observation, rows)) {
    const ms = instantMs(observation.occurredAt);
    if (ms >= fromMs && ms <= toMs && keep(observation)) entries.push({ ms, observation });
  }
  entries.sort((a, b) => compareNumbers(a.ms, b.ms) || compareText(a.observation.id, b.observation.id));
  return entries.map((entry) => entry.observation);
}

const everyRow = (): boolean => true;

/**
 * An `ObservationIndex` over the ledger's observations table. Reads reject with `CandidatesError('invalid_range')`
 * for a bound that is not a safe integer and with `LedgerError('invalid_input')` for an unknown type; an empty
 * range (`fromMs > toMs`) reads nothing.
 */
export function createLedgerIndex(db: LedgerDb): ObservationIndex {
  return {
    async byTypeAndBucket(type, fromMs, toMs) {
      checkRange(fromMs, toMs);
      const actionType = checkType(type);
      if (fromMs > toMs) return [];
      const [lower, upper] = bucketRange(actionType, fromMs, toMs);
      const rows = await db.observations
        .where('[type+timeBucket]')
        .between(lower, upper, true, true)
        .toArray();
      return trimmed(rows, fromMs, toMs, everyRow);
    },
    async byCounterpartyToken(token, fromMs, toMs) {
      checkRange(fromMs, toMs);
      if (fromMs > toMs) return [];
      const ranges = ActionType.options.map((type) => bucketRange(type, fromMs, toMs));
      const rows = await db.observations
        .where('[type+timeBucket]')
        .inAnyRange(ranges, { includeLowers: true, includeUppers: true })
        .toArray();
      return trimmed(rows, fromMs, toMs, (observation) => counterpartyTokens(observation).includes(token));
    },
  };
}
