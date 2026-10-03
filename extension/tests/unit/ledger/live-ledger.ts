/**
 * The background's write path and its batches over a real ledger (fake-indexeddb), for the late-sighting tests
 * (docs/grading.md §3 Background obligations, §9; R3-LEDGER-1, RP3-3).
 *
 * Every write goes through the repo at its own instant (the clock pinned there). Every batch records its instant
 * (`recordBatchInstant`) and reads the claims and observations the ledger holds, in one readwrite transaction, then
 * grades exactly those rows with a `LedgerSim` (tests/tools) holding the receipts stored so far. `snapshot()` is
 * what an export holds: the ledger's rows as they are at the end, the receipts and their inputs. Replay rebuilds
 * each batch from those final rows, so it reproduces every receipt only if no stored row moved after a batch could
 * read it and no row was stored at or before the instant of a batch that did not read it.
 */
import type { Policy } from '../../../src/core/policy';
import type { LedgerSnapshot, ReceiptInputs } from '../../../src/core/replay';
import type { OverrideGrade, Receipt, Ulid } from '../../../src/core/schema';
import { transition } from '../../../src/core/state';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import {
  recordBatchInstant,
  upsertClaim,
  upsertObservation,
  type UpsertResult,
} from '../../../src/ledger/repo';
import { Claim, Observation, type ClaimInput, type ObservationInput } from '../../../src/ledger/types';
import { LedgerSim } from '../../tools/attest-ledger';
import { isoAt, type World } from '../../tools/attest-world';
import { pinClock } from './fixtures';

export interface LedgerRows {
  readonly claims: Claim[];
  readonly observations: Observation[];
}

export class LiveLedger {
  readonly receipts = new Map<Ulid, Receipt>();
  readonly #inputs = new Map<string, ReceiptInputs>();
  readonly #policies = new Map<string, Policy>();

  constructor(
    readonly db: LedgerDb,
    readonly world: World,
  ) {}

  /** The background stores one sighting, with the clock reading `at`. */
  async write(row: ClaimInput | ObservationInput, at: string): Promise<UpsertResult> {
    pinClock(at);
    if ('contentHash' in row) return upsertObservation(this.db, row, this.world.policyAt(0).policy);
    return upsertClaim(this.db, row);
  }

  /** Every claim and observation the ledger holds. */
  async rows(): Promise<LedgerRows> {
    return {
      claims: readRows('claims', Claim, await this.db.claims.toArray()),
      observations: readRows('observations', Observation, await this.db.observations.toArray()),
    };
  }

  /** A batch at `at` under policy `index`: record the instant and read in one transaction, then grade (§3). */
  async batch(at: string, index = 0): Promise<void> {
    pinClock(at);
    const { db } = this;
    const rows = await db.transaction('rw', [db.claims, db.observations, db.meta], async () => {
      await recordBatchInstant(db, at);
      return this.rows();
    });
    const sim = new LedgerSim({ ...this.world, ...rows });
    for (const [id, receipt] of this.receipts) sim.receipts.set(id, receipt);
    await sim.grade(at, this.world.policyAt(index).policy);
    this.receipts.clear();
    for (const [id, receipt] of sim.receipts) this.receipts.set(id, receipt);
    const graded = sim.snapshot();
    for (const [hash, inputs] of graded.receiptInputs) this.#inputs.set(hash, inputs);
    for (const [hash, policy] of graded.policies) this.#policies.set(hash, policy);
  }

  /** The user overrides one stored receipt (§8). */
  override(id: Ulid, grade: OverrideGrade, at: string): void {
    const held = this.receipts.get(id);
    if (held === undefined) throw new Error(`no receipt ${id}`);
    this.receipts.set(id, transition(held, { event: 'override', grade, reason: 'synthetic override', at }));
  }

  /** What an export holds: the ledger's rows now, the receipts and the inputs they reference. */
  async snapshot(): Promise<LedgerSnapshot> {
    const receipts = [...this.receipts.values()];
    const receiptInputs = new Map<string, ReceiptInputs>();
    for (const { inputsHash } of receipts) {
      const inputs = this.#inputs.get(inputsHash);
      if (inputs !== undefined) receiptInputs.set(inputsHash, inputs);
    }
    return { ...(await this.rows()), receipts, receiptInputs, policies: new Map(this.#policies) };
  }
}

/** One step of a timeline: a write, a batch, or a user override, at an instant. */
export type Step =
  | { readonly at: string; readonly kind: 'write'; readonly row: Claim | Observation }
  | { readonly at: string; readonly kind: 'batch'; readonly policy?: number }
  | { readonly at: string; readonly kind: 'override'; readonly id: Ulid; readonly grade: OverrideGrade };

/** Runs the steps in time order (a stable sort: steps at one instant keep their listed order). */
export async function play(live: LiveLedger, steps: readonly Step[]): Promise<void> {
  const ordered = [...steps].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const step of ordered) {
    if (step.kind === 'write') await live.write(step.row, step.at);
    else if (step.kind === 'batch') await live.batch(step.at, step.policy);
    else live.override(step.id, step.grade, step.at);
  }
}

/** Each row of the world written `latencyMs` after it was sighted. */
export function sightingWrites(world: World, latencyMs = 0): Step[] {
  return [...world.observations, ...world.claims].map((row): Step => ({
    at: isoAt(Date.parse(row.observedAt) + latencyMs, 0),
    kind: 'write',
    row,
  }));
}
