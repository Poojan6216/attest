/**
 * Replay (docs/grading.md §9; module contract §13 `replay.ts`; Hard Rule 4: replaying the ledger must reproduce
 * every receipt exactly).
 *
 *   replay(snapshot) → Promise<ReplayReport>
 *
 * Receipts are grouped by `computedAt` instant (one group per batch that last graded them) and the groups are
 * replayed oldest first. For each group, the batch is rebuilt as it was at that instant (replay-batch.ts): its
 * claims are the claims first seen by then whose stored receipt was graded at or after it, its observations those
 * first seen by then (`observedAt ≤ computedAt`), and the pre-assignments of the stored FINAL and overridden
 * receipts in force at that instant are fixed (batch-fixed.ts through replay-timeline.ts: the one rule `gradeBatch`
 * applies to its own). Coverage, grant and context cannot be rebuilt from current state, so they come from
 * `receiptInputs` (keyed by the receipt's `inputsHash`), and the policy from `policies` (keyed by `policyHash`).
 * Then `grade` runs on the receipt's subject:
 *  - a claim receipt: its claim, with the candidates the batch left it (§4.3);
 *  - an UNASKED receipt: its orphan (`observationIds[0]`), which must still be an orphan in the rebuilt batch (§3:
 *    from a source the policy lists for its type, in a window its own source's observer saw, assigned to no claim,
 *    not taken);
 *  - a scope-diff receipt (`context.scope` set): no claim, no candidates;
 * every observation it grades with must hash to its own `contentHash` (§10; `inputsHash` names candidates by it),
 * and the result is compared with the stored receipt on `inputsHash`, `grade`, `ruleId` and `state` (an overridden
 * receipt on its `previousState`: the override sits beside the computed part, §8) and on every other field grading
 * computed (replay-compare.ts): a receipt is reproduced only if grading it again gives it back exactly.
 *
 * Every mismatch is reported, never thrown: `{receiptId, field, stored, replayed}`, where field is one of the
 * compared fields, or names why the receipt could not be graded again (REPLAY_FIELDS). Values are ids, hashes,
 * grades, rule ids, states, numbers, timestamps and error codes only, never content (Hard Rules 2, 10).
 *
 * Replay is exact only for a ledger whose overrides were never reverted: a revert erases the span in which the
 * receipt was fixed (raised as a contract issue).
 *
 * PURE: no I/O but reading the snapshot, no clock, no logging (Hard Rule 4). Async only because the index is.
 */
import { isOrphanCandidate, seenWindows, visibleAt } from './batch-orphans';
import { createMemoryIndex, type ObservationIndex } from './candidates';
import { grade } from './grade';
import { instantMs } from './normalize';
import { compareText } from './order';
import { assertLoadedPolicy, type Policy } from './policy';
import { rebuildBatch, type ReplayBatch } from './replay-batch';
import { COMPARED_FIELDS, compareReceipts, contentHashOf } from './replay-compare';
import { Timeline } from './replay-timeline';
import type { Claim, Coverage, GradeContext, Grant, Observation, Receipt, Sha256, Ulid } from './schema';

/** What a receipt was graded with besides its subject and candidates (§9 `receiptInputs`). */
export interface ReceiptInputs {
  readonly coverage: Coverage;
  readonly grant: Grant;
  readonly context: GradeContext;
  readonly policyHash: Sha256;
}

/** The ledger as replay reads it (§9). */
export interface LedgerSnapshot {
  readonly claims: readonly Claim[];
  readonly observations: readonly Observation[];
  readonly receipts: readonly Receipt[];
  /** Keyed by the receipt's `inputsHash`. */
  readonly receiptInputs: ReadonlyMap<string, ReceiptInputs>;
  /** Loaded policies, keyed by `policyHash`. */
  readonly policies: ReadonlyMap<string, Policy>;
}

/**
 * What a mismatch is about, in report order:
 *  - `receiptInputs`: no inputs row for the receipt's `inputsHash` (stored: the hash; replayed: null);
 *  - `policy`: the inputs name a policy the snapshot lacks (stored: the policyHash; replayed: null);
 *  - `subject`: the receipt's claim (or UNASKED orphan) is missing or was first seen after `computedAt` (stored:
 *    its id, null when an UNASKED receipt names no observation; replayed: null);
 *  - `orphan`: the UNASKED receipt's observation was no orphan in the rebuilt batch (stored: the observation id;
 *    replayed: the claim the batch gave it to, `taken` when an override had taken it, or `uncovered` when it is no
 *    orphan candidate under the receipt's coverage: the policy does not list its source for its type, or no window
 *    of its own source saw it, §3);
 *  - `contentHash`: an observation the receipt is graded with does not hash to its `contentHash`: its content was
 *    changed after it was projected (stored: its `contentHash`; replayed: the hash of its content); one per such
 *    observation, in candidate order;
 *  - `error`: grading again threw (stored: null; replayed: the error's name and code, never its message);
 *  - the compared fields (COMPARED_FIELDS: `id`, `inputsHash`, `grade`, `ruleId`, `state`, then every other field
 *    grading computed): the stored and replayed values differ (replay-compare.ts shows how each is written).
 */
export const REPLAY_FIELDS = [
  'receiptInputs',
  'policy',
  'subject',
  'orphan',
  'contentHash',
  'error',
  ...COMPARED_FIELDS,
] as const;
export type ReplayField = (typeof REPLAY_FIELDS)[number];

export interface ReplayMismatch {
  readonly receiptId: Ulid;
  readonly field: ReplayField;
  readonly stored: string | null;
  readonly replayed: string | null;
}

export interface ReplayReport {
  /** Stored receipts replayed. */
  readonly receipts: number;
  /** Distinct `computedAt` instants: the batches replayed. */
  readonly batches: number;
  /** Receipts reproduced exactly (no mismatch). */
  readonly reproduced: number;
  /** Receipts with at least one mismatch. */
  readonly mismatched: number;
  /** Mismatches per field. */
  readonly byField: Readonly<Record<ReplayField, number>>;
  /** Every mismatch: by `computedAt` instant, then receipt id, then field (REPLAY_FIELDS order). */
  readonly mismatches: readonly ReplayMismatch[];
}

/** The snapshot read once: claims and observations by id, the index, the timeline. */
interface Ledger {
  readonly snapshot: LedgerSnapshot;
  readonly claims: ReadonlyMap<Ulid, { readonly claim: Claim; readonly observedMs: number }>;
  readonly observations: ReadonlyMap<
    Ulid,
    { readonly observation: Observation; readonly observedMs: number }
  >;
  readonly index: ObservationIndex;
  readonly timeline: Timeline;
  /** Each observation's recomputed content hash, computed once (`contentHashOf`). */
  readonly contentHashes: WeakMap<Observation, string>;
}

/** One `computedAt` instant and the receipts last graded then. */
interface Group {
  readonly atMs: number;
  readonly receipts: Receipt[];
}

/** The memory index's bucket width in minutes: an index tuning parameter (Decisions [1.3]), not policy. */
const BUCKET_MINUTES = 1;

/** By id, the first of each id kept (the ledger keys rows by id: two rows with one id are a corrupt snapshot). */
function byId<T extends { readonly id: Ulid; readonly observedAt: string }>(rows: readonly T[]) {
  const found = new Map<Ulid, { readonly row: T; readonly observedMs: number }>();
  for (const row of rows) {
    if (!found.has(row.id)) found.set(row.id, { row, observedMs: instantMs(row.observedAt) });
  }
  return found;
}

function readLedger(snapshot: LedgerSnapshot): Ledger {
  const claims = new Map(
    [...byId(snapshot.claims)].map(([id, { row, observedMs }]) => [id, { claim: row, observedMs }]),
  );
  const observations = new Map(
    [...byId(snapshot.observations)].map(([id, { row, observedMs }]) => [
      id,
      { observation: row, observedMs },
    ]),
  );
  const index = createMemoryIndex(
    [...observations.values()].map((held) => held.observation),
    BUCKET_MINUTES,
  );
  const timeline = new Timeline(snapshot.receipts);
  return { snapshot, claims, observations, index, timeline, contentHashes: new WeakMap() };
}

/** The receipts grouped by `computedAt` instant, oldest first; each group by id, then by `inputsHash`. */
function groupsOf(receipts: readonly Receipt[]): Group[] {
  const groups = new Map<number, Receipt[]>();
  for (const receipt of receipts) {
    const atMs = instantMs(receipt.computedAt);
    const held = groups.get(atMs);
    if (held === undefined) groups.set(atMs, [receipt]);
    else held.push(receipt);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([atMs, held]) => ({
      atMs,
      receipts: held.sort((a, b) => compareText(a.id, b.id) || compareText(a.inputsHash, b.inputsHash)),
    }));
}

/** An error's name and typed code (core errors carry a `code`); never its message, which may carry values. */
function errorLabel(error: Error): string {
  const code: unknown = 'code' in error ? error.code : undefined;
  return typeof code === 'string' ? `${error.name}:${code}` : error.name;
}

/** The batch rebuilt at one instant under one policy, or what stopped it. */
type Rebuilt = ReplayBatch | Error;

/** The batches of one group, rebuilt lazily per policy (one batch has one policy; a corrupt one may name more). */
class GroupBatches {
  readonly #held = new Map<string, Promise<Rebuilt>>();

  constructor(
    readonly ledger: Ledger,
    readonly atMs: number,
  ) {}

  at(policy: Policy): Promise<Rebuilt> {
    let held = this.#held.get(policy.policyHash);
    if (held === undefined) {
      held = this.#rebuild(policy);
      this.#held.set(policy.policyHash, held);
    }
    return held;
  }

  async #rebuild(policy: Policy): Promise<Rebuilt> {
    const { ledger, atMs } = this;
    const claims = ledger.timeline.batchClaims(atMs, (id) => ledger.claims.get(id));
    try {
      return await rebuildBatch(claims, visibleAt(ledger.index, atMs), policy, ledger.timeline.fixedAt(atMs));
    } catch (error) {
      if (error instanceof Error) return error;
      throw error;
    }
  }
}

/** The subject and candidates `grade` is called with for one receipt. */
interface GradeCall {
  readonly claim: Claim | null;
  readonly candidates: readonly Observation[];
}

/** A `grade` call for one receipt, or the mismatch that prevents it. */
type Call = GradeCall | { readonly mismatch: ReplayMismatch };

function mismatch(receipt: Receipt, field: ReplayField, stored: string | null, replayed: string | null) {
  return { mismatch: { receiptId: receipt.id, field, stored, replayed } };
}

/** A claim receipt's call: its claim, first seen by `computedAt`, with the candidates the batch left it. */
async function claimCall(
  receipt: Receipt,
  claimId: Ulid,
  policy: Policy,
  batches: GroupBatches,
): Promise<Call> {
  const held = batches.ledger.claims.get(claimId);
  if (held === undefined || held.observedMs > batches.atMs) {
    return mismatch(receipt, 'subject', claimId, null);
  }
  const batch = await batches.at(policy);
  if (batch instanceof Error) return mismatch(receipt, 'error', null, errorLabel(batch));
  return { claim: held.claim, candidates: batch.candidatesFor(claimId) };
}

/**
 * An UNASKED receipt's call: its orphan, first seen by `computedAt`, an orphan candidate under the receipt's own
 * coverage (§3, batch-orphans.ts `isOrphanCandidate`: the predicate gradeBatch decides with), assigned to no claim
 * and not taken.
 */
async function orphanCall(
  receipt: Receipt,
  inputs: ReceiptInputs,
  policy: Policy,
  batches: GroupBatches,
): Promise<Call> {
  const [orphanId] = receipt.observationIds;
  const held = orphanId === undefined ? undefined : batches.ledger.observations.get(orphanId);
  if (orphanId === undefined || held === undefined || held.observedMs > batches.atMs) {
    return mismatch(receipt, 'subject', orphanId ?? null, null);
  }
  const batch = await batches.at(policy);
  if (batch instanceof Error) return mismatch(receipt, 'error', null, errorLabel(batch));
  const owner = batch.assignment.get(orphanId);
  if (owner !== undefined) return mismatch(receipt, 'orphan', orphanId, owner);
  if (batch.taken.has(orphanId)) return mismatch(receipt, 'orphan', orphanId, 'taken');
  if (!isOrphanCandidate(held.observation, seenWindows(inputs.coverage), policy)) {
    return mismatch(receipt, 'orphan', orphanId, 'uncovered');
  }
  return { claim: null, candidates: [held.observation] };
}

function callFor(
  receipt: Receipt,
  inputs: ReceiptInputs,
  policy: Policy,
  batches: GroupBatches,
): Promise<Call> {
  if (receipt.claimId !== undefined) return claimCall(receipt, receipt.claimId, policy, batches);
  if (inputs.context.scope !== undefined) return Promise.resolve({ claim: null, candidates: [] });
  return orphanCall(receipt, inputs, policy, batches);
}

/**
 * A `contentHash` mismatch for each observation of `candidates` whose content does not hash to it (§10). Throws a
 * HashError for content canonical JSON cannot write (a non-finite number; the Observation schema admits none).
 */
function alteredEvidence(receipt: Receipt, candidates: readonly Observation[], ledger: Ledger) {
  const found: ReplayMismatch[] = [];
  for (const observation of candidates) {
    let hash = ledger.contentHashes.get(observation);
    if (hash === undefined) {
      hash = contentHashOf(observation);
      ledger.contentHashes.set(observation, hash);
    }
    if (hash !== observation.contentHash) {
      found.push(mismatch(receipt, 'contentHash', observation.contentHash, hash).mismatch);
    }
  }
  return found;
}

/**
 * Grades the call again and compares the result with the stored receipt (replay-compare.ts). Throws whatever
 * `grade` throws, and a HashError for a stored value canonical JSON cannot write (a non-finite number).
 */
function gradeAndCompare(receipt: Receipt, call: GradeCall, inputs: ReceiptInputs, policy: Policy) {
  const replayed = grade(call.claim, call.candidates, inputs.grant, policy, inputs.coverage, inputs.context);
  return compareReceipts(receipt, replayed).map((one) => ({ receiptId: receipt.id, ...one }));
}

/** Grades one stored receipt again and lists its mismatches (none: reproduced). */
async function replayOne(receipt: Receipt, batches: GroupBatches): Promise<ReplayMismatch[]> {
  const { snapshot } = batches.ledger;
  const inputs = snapshot.receiptInputs.get(receipt.inputsHash);
  if (inputs === undefined) return [mismatch(receipt, 'receiptInputs', receipt.inputsHash, null).mismatch];
  const policy = snapshot.policies.get(inputs.policyHash);
  if (policy === undefined) return [mismatch(receipt, 'policy', inputs.policyHash, null).mismatch];
  const call = await callFor(receipt, inputs, policy, batches);
  if ('mismatch' in call) return [call.mismatch];
  let altered: ReplayMismatch[] = [];
  try {
    altered = alteredEvidence(receipt, call.candidates, batches.ledger);
    return [...altered, ...gradeAndCompare(receipt, call, inputs, policy)];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return [...altered, mismatch(receipt, 'error', null, errorLabel(error)).mismatch];
  }
}

function emptyCounts(): Record<ReplayField, number> {
  return {
    receiptInputs: 0,
    policy: 0,
    subject: 0,
    orphan: 0,
    contentHash: 0,
    error: 0,
    id: 0,
    inputsHash: 0,
    grade: 0,
    ruleId: 0,
    state: 0,
    agent: 0,
    claimId: 0,
    observationIds: 0,
    requestId: 0,
    confidence: 0,
    reasons: 0,
    signals: 0,
    policyHash: 0,
    attribution: 0,
    computedAt: 0,
    finalAt: 0,
  };
}

/**
 * Replays every stored receipt of `snapshot` (§9) and reports each mismatch. Deterministic. Throws
 * `PolicyError('policy_not_loaded')`, once and before replaying anything, when `snapshot.policies` holds an object
 * `loadPolicy` did not return: a caller's bug, not a ledger mismatch (Hard Rule 6).
 */
export async function replay(snapshot: LedgerSnapshot): Promise<ReplayReport> {
  for (const policy of snapshot.policies.values()) assertLoadedPolicy(policy);
  const ledger = readLedger(snapshot);
  const groups = groupsOf(snapshot.receipts);
  const mismatches: ReplayMismatch[] = [];
  const byField = emptyCounts();
  let mismatched = 0;
  for (const group of groups) {
    const batches = new GroupBatches(ledger, group.atMs);
    for (const receipt of group.receipts) {
      const found = await replayOne(receipt, batches);
      if (found.length > 0) mismatched += 1;
      for (const one of found) {
        mismatches.push(one);
        byField[one.field] += 1;
      }
    }
  }
  const receipts = snapshot.receipts.length;
  return {
    receipts,
    batches: groups.length,
    reproduced: receipts - mismatched,
    mismatched,
    byField,
    mismatches,
  };
}
