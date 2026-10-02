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
import { freshFacts, type ObservedFacts, type TextFacts } from './features';
import { candidatesHashOfRows, refHashInto } from './receipt';
import type { Observation, Ulid } from './schema';
import { DIGEST_WORDS } from './sha256';

/** UTF-16 code unit order, as `<` compares strings. */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
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
    const made = freshFacts(observation, this.occurredMs[row], this.texts.stopWords, this.texts);
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
    if (this.#ranks !== undefined) return this.#ranks;
    const ids = this.rows.map((observation) => observation.id);
    const order = Array.from(ids, (_, row) => row).sort((a, b) => compareIds(ids[a] ?? '', ids[b] ?? ''));
    const ranks = new Int32Array(ids.length);
    let repeats = false;
    for (let rank = 0; rank < order.length; rank += 1) {
      const row = order[rank] ?? 0;
      ranks[row] = rank;
      if (rank > 0 && ids[order[rank - 1] ?? 0] === ids[row]) repeats = true;
    }
    this.#ranks = repeats ? null : ranks;
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
        refHashInto(this.#row(row), refs, rank * DIGEST_WORDS);
        hashed[rank] = 1;
      }
      order[i] = rank;
    }
    order.subarray(0, count).sort();
    return candidatesHashOfRows(refs, order, count);
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
    if (observation === undefined) throw new RangeError('candidate table: no such row');
    return observation;
  }
}
