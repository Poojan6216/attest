/**
 * A ledger graded the way the background grades it (docs/grading.md §3, §4.3, §7, §8, §9), for the replay tests
 * and the `attest replay` CLI tests.
 *
 * `LedgerSim` plays the background over a World (attest-world.ts). Batch instants are strictly increasing (§3: the
 * background stamps each batch after the last; `grade` refuses one that is not). At each batch instant it passes
 * every claim core's `gradedAt` says the batch grades (its stored receipt PENDING, or none yet, and no reverted
 * override of it still in force) to `gradeBatch`, with core's `preAssignments` of the rows it holds right then
 * (gradeBatch keeps those in force at the batch's instant), and stores what comes back as the ledger does:
 *  - a new subject's receipt is inserted; a PENDING row is replaced through state.ts `regrade`;
 *  - a FINAL, overridden or superseded row is kept and the regrade discarded (UNASKED and scope receipts, §3);
 *  - a PENDING claim-less row the batch no longer produces is deleted (§7), unless it holds reverted overrides:
 *    the batches that ran while one was in force had its orphan taken, which replay must still see (§8, §9);
 *  - each stored receipt's inputs ({coverage, grant, context, policyHash}) are kept under its `inputsHash` (§9).
 * Between batches the user may override receipts (`override`) and revert overrides (`revert`), and a FINAL claim
 * supersedes the UNASKED receipt of the observation it holds (`supersede`). `snapshot()` is what an export holds.
 *
 * The pre-assignments here are read from the live rows (what is FINAL or overridden now), while replay reads them
 * from the stored rows afterwards; both go through batch-fixed.ts, and the property tests hold the two together,
 * including overrides and reverts stamped at a batch's very instant or just after it but read by it (`simulate`).
 */
import { gradeBatch, gradedAt, preAssignments } from '../../src/core/batch';
import { createMemoryIndex, type ObservationIndex } from '../../src/core/candidates';
import type { Policy } from '../../src/core/policy';
import { receiptId } from '../../src/core/receipt';
import type { LedgerSnapshot, ReceiptInputs } from '../../src/core/replay';
import { Claim, Coverage, type OverrideGrade, type Receipt, type Ulid } from '../../src/core/schema';
import { transition } from '../../src/core/state';

import { isoAt, pick, seededRandom, syntheticWorld, type World, type WorldOptions } from './attest-world';

/** The memory index's bucket width in minutes: an index tuning parameter, not policy. */
const BUCKET_MINUTES = 15;
const OVERRIDE_GRADES: readonly OverrideGrade[] = ['VERIFIED', 'NOT_FOUND'];

export class LedgerSim {
  /** The stored receipts by id: one row per subject. */
  readonly receipts = new Map<Ulid, Receipt>();
  readonly #inputs = new Map<string, ReceiptInputs>();
  readonly #policies = new Map<string, Policy>();
  readonly #index: ObservationIndex;
  /** The last batch's instant: each batch is stamped strictly after it (§3). */
  #lastBatchMs = Number.NEGATIVE_INFINITY;

  constructor(readonly world: World) {
    this.#index = createMemoryIndex(world.observations, BUCKET_MINUTES);
  }

  /** The coverage a batch at `at` reads: every pass synced by then (§3: several intervals per source). */
  coverageAt(at: string): Coverage {
    const atMs = Date.parse(at);
    const observers = this.world.passes.filter((pass) => Date.parse(pass.lastSyncAt) <= atMs);
    return Coverage.parse({ evaluatedAt: at, observers });
  }

  /** The claims a batch at `atMs` grades: first seen by then, with no stored receipt or one `gradedAt` admits. */
  #batchClaims(seen: readonly Claim[], atMs: number): Claim[] {
    const stored = new Map<Ulid, Receipt>();
    for (const receipt of this.receipts.values()) {
      if (receipt.claimId !== undefined) stored.set(receipt.claimId, receipt);
    }
    return seen.filter((claim) => {
      const receipt = stored.get(claim.id);
      return receipt === undefined || gradedAt(receipt, atMs);
    });
  }

  /** One batch at `at` under `policy`, strictly after the last; stores the result (see the file comment). */
  async grade(at: string, policy: Policy): Promise<void> {
    const atMs = Date.parse(at);
    if (!(atMs > this.#lastBatchMs)) throw new Error(`batch at ${at} is not after the last batch`);
    this.#lastBatchMs = atMs;
    const seen = this.world.claims.filter((claim) => Date.parse(claim.observedAt) <= atMs);
    const pending = this.#batchClaims(seen, atMs);
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
      if (held !== undefined && (held.state !== 'PENDING' || held.supersededBy !== undefined)) continue;
      const next = held === undefined ? receipt : transition(held, { event: 'regrade', next: receipt });
      this.receipts.set(receipt.id, next);
      this.#inputs.set(receipt.inputsHash, { coverage, ...inputs });
    }
    for (const [id, receipt] of this.receipts) {
      if (receipt.claimId !== undefined || receipt.state !== 'PENDING' || produced.has(id)) continue;
      if (receipt.reverted === undefined) this.receipts.delete(id);
    }
  }

  /** The user overrides one stored receipt (§8). */
  override(id: Ulid, grade: OverrideGrade, at: string): void {
    const held = this.receipts.get(id);
    if (held === undefined) throw new Error(`no receipt ${id}`);
    this.receipts.set(id, transition(held, { event: 'override', grade, reason: 'synthetic override', at }));
  }

  /** The user reverts the override of one stored receipt, at `at` (§8). */
  revert(id: Ulid, at: string): void {
    const held = this.receipts.get(id);
    if (held === undefined) throw new Error(`no receipt ${id}`);
    this.receipts.set(id, transition(held, { event: 'revert', at }));
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
  /** Overrides the user makes after each batch but the last (see `overrideInstant`). */
  readonly overridesPerGap: number;
  /** Overrides the user reverts after each batch but the last, whichever batch read them (`revertSome`). */
  readonly revertsPerGap?: number;
}

export interface Simulation {
  readonly world: World;
  readonly sim: LedgerSim;
  readonly snapshot: LedgerSnapshot;
}

/** The share of claims first read exactly at a batch instant (§3: `observedAt ≤ evaluatedAt`, so that batch has them). */
const READ_AT_BATCH = 0.1;
/** The longest an override stamped after a batch's instant can precede that batch's read of its pre-assignments. */
const RACE_MS = 5_000;

/**
 * The world with a `READ_AT_BATCH` share of its claims first read at a batch instant: the first one at or after the
 * claim's own `observedAt`. Drawn from its own seeded stream, so the rest of the world is as `syntheticWorld` built it.
 */
export function readAtBatches(world: World, seed: number): World {
  const random = seededRandom(seed ^ 0x0b5e);
  const instants = world.batchTimes.map((at) => Date.parse(at));
  const claims = world.claims.map((claim) => {
    const seenMs = Date.parse(claim.observedAt);
    const atMs = instants.find((ms) => ms >= seenMs);
    if (random() >= READ_AT_BATCH || atMs === undefined) return claim;
    return Claim.parse({ ...claim, observedAt: isoAt(atMs, 0) });
  });
  return { ...world, claims };
}

/**
 * When an override made between the batches at `fromMs` and `toMs` is stamped: mostly strictly between them; one in
 * ten at `fromMs` (the batch just run), one in ten at `toMs` (the next batch's very instant, stamped before it reads
 * its pre-assignments), and one in ten up to `RACE_MS` after `toMs` (stamped after the next batch's `evaluatedAt` but
 * before that batch reads its pre-assignments). Each is applied before the next batch runs.
 */
function overrideInstant(random: () => number, fromMs: number, toMs: number): number {
  const roll = random();
  if (roll < 0.1) return fromMs;
  if (roll < 0.2) return toMs;
  if (roll < 0.3) return toMs + 1 + Math.floor(random() * RACE_MS);
  return fromMs + 1 + Math.floor(random() * (toMs - fromMs - 1));
}

/** The instant of `receipt`'s last revert (state.ts: a new override is stamped no earlier), or -Infinity. */
function lastRevertMs(receipt: Receipt): number {
  const last = receipt.reverted?.at(-1);
  return last === undefined ? Number.NEGATIVE_INFINITY : Date.parse(last.revertedAt);
}

/** Overrides `count` random claim or UNASKED receipts not yet overridden (`overrideInstant`). */
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
    const atMs = overrideInstant(random, fromMs, toMs);
    const receipt = pick(random, open);
    sim.override(receipt.id, pick(random, OVERRIDE_GRADES), isoAt(Math.max(atMs, lastRevertMs(receipt)), 0));
  }
}

/**
 * Reverts `count` random overridden receipts, stamped like an override (`overrideInstant`), never before the override's
 * own `at` (§8). The first of each gap is one a batch has graded under (stamped before the batch just run at
 * `fromMs`) when there is one, so every ledger with two gaps or more reverts what a batch saw; the rest are any.
 */
function revertSome(sim: LedgerSim, random: () => number, count: number, fromMs: number, toMs: number): void {
  for (let n = 0; n < count; n += 1) {
    const overridden = [...sim.receipts.values()].filter((r) => r.override !== undefined);
    const read = overridden.filter((r) => Date.parse(r.override?.at ?? '') < fromMs);
    const pool = n === 0 && read.length > 0 ? read : overridden;
    if (pool.length === 0 || toMs - fromMs < 2) return;
    const atMs = overrideInstant(random, fromMs, toMs);
    const receipt = pick(random, pool);
    sim.revert(receipt.id, isoAt(Math.max(atMs, Date.parse(receipt.override?.at ?? '')), 0));
  }
}

/** Builds the world for `options` (`readAtBatches`) and grades it batch by batch, with overrides between batches. */
export async function simulate(options: SimulationOptions): Promise<Simulation> {
  const world = readAtBatches(syntheticWorld(options), options.seed);
  const sim = new LedgerSim(world);
  const random = seededRandom(options.seed ^ 0x5eed);
  const { batchTimes } = world;
  for (let i = 0; i < batchTimes.length; i += 1) {
    const at = batchTimes[i] ?? '';
    await sim.grade(at, world.policyAt(i).policy);
    sim.supersede();
    const next = batchTimes[i + 1];
    if (next === undefined) continue;
    overrideSome(sim, random, options.overridesPerGap, Date.parse(at), Date.parse(next));
    revertSome(sim, random, options.revertsPerGap ?? 0, Date.parse(at), Date.parse(next));
  }
  return { world, sim, snapshot: sim.snapshot() };
}
