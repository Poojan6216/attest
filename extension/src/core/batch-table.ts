/**
 * A batch's candidate rows of one action type (docs/grading.md §3, §4.1, §5; the task 1.5 grading perf gate).
 * Internal to gradeBatch.
 *
 * Batch retrieval reads each type once and hands every claim of that type a run of the same rows (an index hands
 * one observation to every claim whose window holds it). The table keeps, per row, what grading reads of it, each
 * computed at most once per batch: its facts for scoring (features-observed.ts), its §3 `refHash` (receipt-hash.ts),
 * its rank in id order (the order `candidatesHash` names candidates in), and, once assignment is known, which claim
 * owns it and whether it is taken. A table lives only as long as its batch call; nothing here is shared between
 * batches, and every value is what the per-claim functions compute from the same row.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { idDigitsLength, idDigitsValue } from './base32';
import { freshFacts, type ObservedFacts, type TextFacts } from './features';
import { InvariantError } from './invariant-error';
import { compareText as compareTextShared } from './order';
import { candidatesHashOfRows, refHashInto } from './receipt';
import type { Observation, Ulid } from './schema';
import { DIGEST_WORDS } from './sha256';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const refHashIntoLocal = refHashInto;
const candidatesHashOfRowsLocal = candidatesHashOfRows;
const freshFactsLocal = freshFacts;
const idDigitsValueLocal = idDigitsValue;
const compareText = compareTextShared;

/**
 * `idRanks` for any ids: the built-in sort with no comparator orders strings by UTF-16 code units, in native code;
 * a map from id to row then places each rank.
 */
function idRanksByText(rows: readonly Observation[]): Int32Array | null {
  const rowOf = new Map<string, number>();
  const ids: string[] = [];
  for (let row = 0; row < rows.length; row += 1) {
    const id = rows[row]?.id ?? '';
    if (rowOf.has(id)) return null;
    rowOf.set(id, row);
    ids.push(id);
  }
  ids.sort();
  const ranks = new Int32Array(ids.length);
  for (let rank = 0; rank < ids.length; rank += 1) ranks[rowOf.get(ids[rank] ?? '') ?? 0] = rank;
  return ranks;
}

/**
 * Orders by whole id each run of `order` whose keys tie (`key - row`, the value times the row count, is exact); false
 * when two rows share an id (they tie on every character, so they meet in one run).
 */
function orderTies(rows: readonly Observation[], keys: Float64Array, order: Int32Array): boolean {
  const idOf = (row: number): string => rows[row]?.id ?? '';
  let start = 0;
  while (start < order.length) {
    const prefix = (keys[start] ?? 0) - (order[start] ?? 0);
    let end = start + 1;
    while (end < order.length && (keys[end] ?? 0) - (order[end] ?? 0) === prefix) end += 1;
    if (end - start > 1) {
      const run = Array.from(order.subarray(start, end)).sort((a, b) => compareText(idOf(a), idOf(b)));
      for (let i = 1; i < run.length; i += 1) if (idOf(run[i - 1] ?? 0) === idOf(run[i] ?? 0)) return false;
      order.set(run, start);
    }
    start = end;
  }
  return true;
}

/** How many leading characters every id of `rows` shares. */
function sharedHead(rows: readonly Observation[]): number {
  const first = rows[0]?.id ?? '';
  let shared = first.length;
  for (let row = 1; row < rows.length && shared > 0; row += 1) {
    const id = rows[row]?.id ?? '';
    let i = 0;
    while (i < shared && id.charCodeAt(i) === first.charCodeAt(i)) i += 1;
    shared = i;
  }
  return shared;
}

/**
 * Each row's position among `rows` in id order (UTF-16 code unit order, as `<` compares strings), or null when two
 * rows share an id. Past the head every id shares (which orders nothing), each row is keyed by the number its id's
 * next Crockford characters read as (base32.ts `idDigitsValue`: the numbers compare as those characters do) times
 * the row count, plus the row, and the keys are sorted as numbers in native code; rows whose characters there tie
 * are then ordered by whole id (`orderTies`). A table with an id that has no such characters there (another alphabet,
 * or an id that ends sooner) is ordered by text (`idRanksByText`).
 */
function idRanks(rows: readonly Observation[]): Int32Array | null {
  const count = rows.length;
  const from = sharedHead(rows);
  const width = Math.min(idDigitsLength(count), (rows[0]?.id.length ?? 0) - from);
  if (width < 1) return idRanksByText(rows);
  const keys = new Float64Array(count);
  for (let row = 0; row < count; row += 1) {
    const value = idDigitsValueLocal(rows[row]?.id ?? '', from, width);
    if (value < 0) return idRanksByText(rows);
    keys[row] = value * count + row;
  }
  keys.sort();
  const order = new Int32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = (keys[i] ?? 0) % count;
  if (!orderTies(rows, keys, order)) return null;
  const ranks = new Int32Array(count);
  for (let rank = 0; rank < count; rank += 1) ranks[order[rank] ?? 0] = rank;
  return ranks;
}

/** Who may see a row in `grade` (§4.3): its owner's claim id under the assignment, and whether it is taken. */
interface Exclusion {
  readonly owners: readonly (Ulid | undefined)[];
  readonly taken: Uint8Array;
}

/** Each row's owner under `assignment` and whether it is taken (read once per table: the assignment is final). */
function exclusionOf(
  rows: readonly Observation[],
  assignment: ReadonlyMap<Ulid, Ulid>,
  taken: ReadonlySet<Ulid>,
): Exclusion {
  const owners: (Ulid | undefined)[] = [];
  const flags = new Uint8Array(rows.length);
  for (let row = 0; row < rows.length; row += 1) {
    const id = rows[row]?.id;
    owners.push(id === undefined ? undefined : assignment.get(id));
    flags[row] = id !== undefined && taken.has(id) ? 1 : 0;
  }
  return { owners, taken: flags };
}

export class CandidateTable {
  readonly #facts: (ObservedFacts | undefined)[] = [];
  #ranks: Int32Array | null | undefined;
  #refs: Int32Array | undefined;
  #hashed: Uint8Array | undefined;
  #exclusion: Exclusion | undefined;

  /**
   * `rows` are distinct observation objects; `occurredMs[i]` is `rows[i]`'s `occurredAt` instant (candidates-time.ts);
   * `texts` holds the texts the batch already read, under its policy's stop words.
   */
  constructor(
    readonly rows: readonly Observation[],
    readonly occurredMs: readonly number[],
    readonly texts: TextFacts,
  ) {}

  /** The row's facts for scoring, read on first use. */
  facts(row: number): ObservedFacts {
    const held = this.#facts[row];
    if (held !== undefined) return held;
    const observation = this.#row(row);
    const made = freshFactsLocal(observation, this.occurredMs[row], this.texts.stopWords, this.texts);
    this.#facts[row] = made;
    return made;
  }

  id(row: number): Ulid {
    return this.#row(row).id;
  }

  /**
   * Each row's position among the rows in id order, or null when two rows share an id: only a corrupt ledger holds
   * such rows (ids derive from content hashes, §10), and `grade` itself then decides which row of an id it names.
   */
  ranks(): Int32Array | null {
    if (this.#ranks === undefined) this.#ranks = idRanks(this.rows);
    return this.#ranks;
  }

  /**
   * §3 v1.5 `candidatesHash` of the rows `claimRows[kept[i]]` for i < `count` (rows of distinct ids: `ranks()` is not
   * null): their `refHash` digests, each computed once per row, concatenated in id order and hashed. `order` is
   * scratch space of at least `count` entries.
   */
  candidatesHash(claimRows: readonly number[], kept: Int32Array, count: number, order: Int32Array): string {
    const ranks = this.ranks() ?? new Int32Array(this.rows.length);
    const refs = (this.#refs ??= new Int32Array(this.rows.length * DIGEST_WORDS));
    const hashed = (this.#hashed ??= new Uint8Array(this.rows.length));
    for (let i = 0; i < count; i += 1) {
      const row = claimRows[kept[i] ?? 0] ?? 0;
      const rank = ranks[row] ?? 0;
      if (hashed[rank] !== 1) {
        refHashIntoLocal(this.#row(row), refs, rank * DIGEST_WORDS);
        hashed[rank] = 1;
      }
      order[i] = rank;
    }
    order.subarray(0, count).sort();
    return candidatesHashOfRowsLocal(refs, order, count);
  }

  /**
   * Whether `grade` sees the row for claim `claimId` (§4.3 `exclusiveCandidates`): it is not taken, and the
   * assignment gives it to no claim or to this one. Read per row once per batch (the assignment is final).
   */
  visibleTo(
    row: number,
    claimId: Ulid,
    assignment: ReadonlyMap<Ulid, Ulid>,
    taken: ReadonlySet<Ulid>,
  ): boolean {
    const exclusion = (this.#exclusion ??= exclusionOf(this.rows, assignment, taken));
    if (exclusion.taken[row] === 1) return false;
    const owner = exclusion.owners[row];
    return owner === undefined || owner === claimId;
  }

  #row(row: number): Observation {
    const observation = this.rows[row];
    if (observation === undefined) throw new InvariantError('no_such_row');
    return observation;
  }
}
