/**
 * A ledger graded the way the background grades it (docs/grading.md §3, §4.3, §7, §8, §9), for the replay tests
 * and the `attest replay` CLI tests.
 *
 * `LedgerSim` plays the background over a World (attest-world.ts). At each batch instant it passes every claim
 * whose stored receipt is not FINAL or overridden to `gradeBatch`, with the FINAL and USER_OVERRIDDEN
 * pre-assignments derived from the rows it holds right then, and stores what comes back as the ledger does:
 *  - a new subject's receipt is inserted; a PENDING row is replaced through state.ts `regrade`;
 *  - a FINAL or overridden row is kept and the regrade discarded (UNASKED and scope receipts, §3);
 *  - a PENDING claim-less row the batch no longer produces is deleted (§7);
 *  - each stored receipt's inputs ({coverage, grant, context, policyHash}) are kept under its `inputsHash` (§9).
 * Between batches the user may override receipts (`override`), and a FINAL claim supersedes the UNASKED receipt of
 * the observation it holds (`supersede`). `snapshot()` is what an export holds.
 *
 * The pre-assignments here are read from the live rows (what is FINAL or overridden now), while replay reads them
 * from the stored rows' timestamps afterwards: the property test holds the two together.
 */
import { gradeBatch, type BatchFixed } from '../../src/core/batch';
import { createMemoryIndex, type ObservationIndex } from '../../src/core/candidates';
import type { Policy } from '../../src/core/policy';
import { receiptId } from '../../src/core/receipt';
import type { LedgerSnapshot, ReceiptInputs } from '../../src/core/replay';
import { Coverage, type OverrideGrade, type Receipt, type Ulid } from '../../src/core/schema';
import { transition } from '../../src/core/state';

import { isoAt, pick, seededRandom, syntheticWorld, type World, type WorldOptions } from './attest-world';

/** The memory index's bucket width in minutes: an index tuning parameter, not policy. */
const BUCKET_MINUTES = 15;
const OVERRIDE_GRADES: readonly OverrideGrade[] = ['VERIFIED', 'NOT_FOUND'];

/** The pre-assignments the background passes to a batch (§4.3), from the rows it holds now. */
export function preAssignments(receipts: Iterable<Receipt>): BatchFixed[] {
  const fixed: BatchFixed[] = [];
  for (const receipt of receipts) {
    const { claimId, override, observationIds } = receipt;
    if (claimId === undefined) {
      const [orphan] = observationIds;
      if (override !== undefined && orphan !== undefined)
        fixed.push({ observationId: orphan, claimId: null });
      continue;
    }
    if (receipt.state === 'PENDING' || override?.grade === 'NOT_FOUND') continue;
    for (const observationId of observationIds) fixed.push({ observationId, claimId });
  }
  return fixed;
}

export class LedgerSim {
  /** The stored receipts by id: one row per subject. */
  readonly receipts = new Map<Ulid, Receipt>();
  readonly #inputs = new Map<string, ReceiptInputs>();
  readonly #policies = new Map<string, Policy>();
  readonly #index: ObservationIndex;

  constructor(readonly world: World) {
    this.#index = createMemoryIndex(world.observations, BUCKET_MINUTES);
  }

  /** The coverage a batch at `at` reads: every pass synced by then (§3: several intervals per source). */
  coverageAt(at: string): Coverage {
    const atMs = Date.parse(at);
    const observers = this.world.passes.filter((pass) => Date.parse(pass.lastSyncAt) <= atMs);
    return Coverage.parse({ evaluatedAt: at, observers });
  }

  /** One batch at `at` under `policy`; stores the result (see the file comment). */
  async grade(at: string, policy: Policy): Promise<void> {
    const atMs = Date.parse(at);
    const closed = new Set<Ulid>();
    for (const receipt of this.receipts.values()) {
      if (receipt.claimId !== undefined && receipt.state !== 'PENDING') closed.add(receipt.claimId);
    }
    const seen = this.world.claims.filter((claim) => Date.parse(claim.observedAt) <= atMs);
    const pending = seen.filter((claim) => !closed.has(claim.id));
    const coverage = this.coverageAt(at);
    const activity = { ...this.world.activity, claims: seen };
    const fixed = preAssignments(this.receipts.values());
    const graded = await gradeBatch(
      pending,
      this.#index,
      this.world.grants,
      policy,
      coverage,
      activity,
      fixed,
    );
    this.#policies.set(policy.policyHash, policy);
    const produced = new Set<Ulid>();
    for (const { receipt, inputs } of graded) {
      produced.add(receipt.id);
      const held = this.receipts.get(receipt.id);
      if (held !== undefined && held.state !== 'PENDING') continue;
      const next = held === undefined ? receipt : transition(held, { event: 'regrade', next: receipt });
      this.receipts.set(receipt.id, next);
      this.#inputs.set(receipt.inputsHash, { coverage, ...inputs });
    }
    for (const [id, receipt] of this.receipts) {
      if (receipt.claimId === undefined && receipt.state === 'PENDING' && !produced.has(id))
        this.receipts.delete(id);
    }
  }

  /** The user overrides one stored receipt (§8). */
  override(id: Ulid, grade: OverrideGrade, at: string): void {
    const held = this.receipts.get(id);
    if (held === undefined) throw new Error(`no receipt ${id}`);
    this.receipts.set(id, transition(held, { event: 'override', grade, reason: 'synthetic override', at }));
  }

  /** Every FINAL claim receipt supersedes the UNASKED receipt of the observation it holds (§7, §8). */
  supersede(): void {
    for (const receipt of [...this.receipts.values()]) {
      const [held] = receipt.observationIds;
      if (receipt.claimId === undefined || receipt.state !== 'FINAL' || held === undefined) continue;
      const unaskedId = receiptId({ k: 'unasked', observationId: held });
      const unasked = this.receipts.get(unaskedId);
      if (unasked === undefined || unasked.supersededBy === receipt.claimId) continue;
      this.receipts.set(unaskedId, transition(unasked, { event: 'supersede', claimId: receipt.claimId }));
    }
  }

  /** What an export holds: every claim and observation, the stored receipts and the inputs they reference. */
  snapshot(): LedgerSnapshot {
    const receipts = [...this.receipts.values()];
    const receiptInputs = new Map<string, ReceiptInputs>();
    for (const { inputsHash } of receipts) {
      const inputs = this.#inputs.get(inputsHash);
      if (inputs !== undefined) receiptInputs.set(inputsHash, inputs);
    }
    const { claims, observations } = this.world;
    return { claims, observations, receipts, receiptInputs, policies: new Map(this.#policies) };
  }
}

export interface SimulationOptions extends WorldOptions {
  /** Overrides the user makes between two batches, at random instants strictly between them. */
  readonly overridesPerGap: number;
}

export interface Simulation {
  readonly world: World;
  readonly sim: LedgerSim;
  readonly snapshot: LedgerSnapshot;
}

/** Overrides `count` random claim or UNASKED receipts not yet overridden, at instants in `(fromMs, toMs)`. */
function overrideSome(
  sim: LedgerSim,
  random: () => number,
  count: number,
  fromMs: number,
  toMs: number,
): void {
  for (let n = 0; n < count; n += 1) {
    const open = [...sim.receipts.values()].filter(
      (r) => r.state !== 'USER_OVERRIDDEN' && (r.claimId !== undefined || r.observationIds.length > 0),
    );
    if (open.length === 0 || toMs - fromMs < 2) return;
    const atMs = fromMs + 1 + Math.floor(random() * (toMs - fromMs - 1));
    sim.override(pick(random, open).id, pick(random, OVERRIDE_GRADES), isoAt(atMs, 0));
  }
}

/** Builds the world for `options` and grades it batch by batch, with overrides between batches. */
export async function simulate(options: SimulationOptions): Promise<Simulation> {
  const world = syntheticWorld(options);
  const sim = new LedgerSim(world);
  const random = seededRandom(options.seed ^ 0x5eed);
  const { batchTimes } = world;
  for (let i = 0; i < batchTimes.length; i += 1) {
    const at = batchTimes[i] ?? '';
    await sim.grade(at, world.policyAt(i).policy);
    sim.supersede();
    const next = batchTimes[i + 1];
    if (next !== undefined)
      overrideSome(sim, random, options.overridesPerGap, Date.parse(at), Date.parse(next));
  }
  return { world, sim, snapshot: sim.snapshot() };
}
