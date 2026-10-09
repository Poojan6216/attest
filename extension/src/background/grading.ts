/**
 * The grading batch (sprint_3 3.13; docs/grading.md §3 Background obligations, §7, §8, §9; Hard Rules 4, 5, 7): the
 * one path from the ledger's claims and observations to stored receipts. The service worker runs one after an import,
 * after an observer pass, and on the grace alarm (./alarms.ts). Batches never run at once (`runGradingBatch` queues
 * them), and each is stamped strictly after the last (`recordBatchInstant`).
 *
 * One batch:
 *  1. `guardClock` repairs the ledger if the clock went back (src/ledger/clock-guard.ts); `evaluatedAt` is stamped
 *     from the same reading of the clock.
 *  2. One readwrite transaction, begun after that stamp, over every table the batch reads or writes:
 *     `recordBatchInstant` first (an instant at or before the last recorded one throws `batch_out_of_order`; the
 *     batch runs nothing, logs it, and the next alarm tries again), then every read.
 *  3. The claims it grades: those with no stored receipt, or a PENDING one `gradedAt` admits (a claim whose reverted
 *     override is still in force is left out like an overridden one); `fixed` is `preAssignments` of every receipt.
 *  4. Its coverage (src/ledger/coverage-batch.ts): every graded claim's window, and for every type the span in which
 *     an orphan's PENDING UNASKED receipt can still change (`orphanHorizonMs`), as one `Coverage`, with every clock
 *     repair the ledger keeps (`repairs`, src/ledger/clock-repairs.ts; docs/grading.md §3 v1.16, S2-SIM2-1).
 *  5. Its activity (§7): every claim (spend and adjacency), the activity-log entries the claims of an activity view
 *     are, each agent's last import as its adapter sync, and the session pings and idle intervals the ledger holds
 *     from the earliest instant the batch's coverage reaches, less the widest attribution window (src/ledger/
 *     activity.ts, sprint_3 3.14): an orphan is looked for in every window that coverage holds, which can reach
 *     further back than the orphan horizon (a Gmail interval spans days), so its signals are read wherever it is.
 *  6. `gradeBatch`, then core's `storeBatch` and `supersede` (src/core/batch-store.ts, the rule the replay simulator
 *     plays): receipts written, rows deleted, each written receipt's inputs stored and the replaced ones' released,
 *     and the policy document stored once.
 * `BatchError` and `IllegalTransitionError` are bugs (§3): they fail loud and are never caught here. Logs name ids,
 * counts and instants only (Hard Rule 10).
 */
import { gradeBatch, gradedAt, preAssignments } from '../core/batch';
import { storeBatch, supersede } from '../core/batch-store';
import { latestClaimReceipts } from '../core/batch-fixed';
import { instantMs } from '../core/normalize';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT, type Policy } from '../core/policy';
import {
  ActionType,
  type Activity,
  type AgentId,
  Claim,
  type Coverage,
  Grant,
  IsoTs,
  Receipt,
  SCHEMA_LIMITS,
  type Ulid,
} from '../core/schema';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../core/units';
import { claimWindow } from '../core/window';
import { isoWithLocalOffset } from '../clock';
import { activityIn } from '../ledger/activity';
import { guardClock } from '../ledger/clock-guard';
import { batchRepairs, clockRepairs } from '../ledger/clock-repairs';
import { coverageForBatch } from '../ledger/coverage-batch';
import { readRows, type LedgerDb } from '../ledger/db';
import { LedgerError } from '../ledger/errors';
import { createLedgerIndex } from '../ledger/index';
import { deleteReceiptInputs, putPolicyDocument, putReceiptInputs } from '../ledger/replay-records';
import { getMeta, putReceipt, recordBatchInstant } from '../ledger/repo';
import { log } from '../log';

export interface GradingDeps {
  readonly policy: Policy;
  /** The policy's document as written, stored beside its receipts for replay (src/ledger/replay-records.ts). */
  readonly policyDocument: unknown;
  /** The clock at the edge (src/clock.ts): epoch ms. */
  readonly nowMs: () => number;
}

/** The service worker's batches: the shipped policy and the wall clock (the one src/clock.ts reads). */
export const SHIPPED_GRADING: GradingDeps = Object.freeze({
  policy: DEFAULT_POLICY,
  policyDocument: DEFAULT_POLICY_DOCUMENT,
  nowMs: () => Date.now(),
});

/** What one batch did: counts only. */
export interface BatchSummary {
  readonly evaluatedAt: IsoTs;
  readonly claims: number;
  readonly written: number;
  readonly deleted: number;
  readonly superseded: number;
}

/** The meta key of an agent's last import instant (src/background/claims-import.ts writes it). */
export const lastImportKey = (agent: AgentId): string => `lastImportAt.${agent}`;

/**
 * How far back a batch looks for orphans: as long as an orphan's PENDING UNASKED receipt can still change, the
 * `finalizeUnverifiableHours` after its anchor (§7), plus the grace and the minutes a claim may precede it.
 */
export function orphanHorizonMs(policy: Policy): number {
  const { finalizeUnverifiableHours, graceMin, beforeClaimMin } = policy.windows;
  return finalizeUnverifiableHours * MS_PER_HOUR + (graceMin + beforeClaimMin) * MS_PER_MINUTE;
}

/** The claims a batch at `evaluatedMs` grades (§3): no stored receipt yet, or a PENDING one `gradedAt` admits. */
export function claimsToGrade(
  claims: readonly Claim[],
  receipts: readonly Receipt[],
  evaluatedMs: number,
): Claim[] {
  const latest = latestClaimReceipts(receipts);
  return claims.filter((claim) => {
    const receipt = latest.get(claim.id);
    return receipt === undefined || gradedAt(receipt, evaluatedMs);
  });
}

/** The batch's coverage: each graded claim's window, the orphan horizon for every type, the repairs (header, step 4). */
async function batchCoverage(
  db: LedgerDb,
  pending: readonly Claim[],
  evaluatedAt: IsoTs,
  policy: Policy,
): Promise<Coverage> {
  const evaluatedMs = instantMs(evaluatedAt);
  const horizon = { fromMs: evaluatedMs - orphanHorizonMs(policy), toMs: evaluatedMs };
  const queries = [
    ...pending.map((claim) => ({ type: claim.type, window: claimWindow(claim, policy), evaluatedAt })),
    ...ActionType.options.map((type) => ({ type, window: horizon, evaluatedAt })),
  ];
  const coverage = await coverageForBatch(db, evaluatedAt, queries, policy);
  const repairs = batchRepairs(await clockRepairs(db));
  return repairs.length === 0 ? coverage : { ...coverage, repairs };
}

/** The latest `SCHEMA_LIMITS.GRADING_INPUT` of `items`, by `at`. */
function latest<T>(items: readonly T[], at: (item: T) => string): T[] {
  return [...items].sort((a, b) => instantMs(at(b)) - instantMs(at(a))).slice(0, SCHEMA_LIMITS.GRADING_INPUT);
}

/** The batch's activity (header, step 5). */
async function batchActivity(
  db: LedgerDb,
  claims: readonly Claim[],
  coverage: Coverage,
  policy: Policy,
): Promise<Activity> {
  const logged = claims.filter((c) => c.sourceKind === 'activity_view' && c.claimedAtPrecision !== 'day');
  const adapterSyncs: Activity['adapterSyncs'] = [];
  for (const agent of new Set(claims.map((claim) => claim.agent))) {
    const at = IsoTs.safeParse(await getMeta(db, lastImportKey(agent)));
    if (at.success) adapterSyncs.push({ agent, lastSyncAt: at.data });
  }
  const { sessionMin, idleMin, adjacentMin } = policy.unasked.windows;
  const reachMs = Math.max(sessionMin, idleMin, adjacentMin) * MS_PER_MINUTE;
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const reached = Math.min(
    evaluatedMs - orphanHorizonMs(policy),
    ...coverage.observers.map((entry) => instantMs(entry.windowStart)),
  );
  const held = await activityIn(db, reached - reachMs, evaluatedMs + reachMs);
  return {
    sessions: latest(held.sessions, (session) => session.at),
    idle: latest(held.idle, (interval) => interval.to),
    entries: latest(logged, (claim) => claim.claimedAt).map(({ agent, claimedAt, type }) => ({
      agent,
      at: claimedAt,
      type,
    })),
    adapterSyncs,
    claims: latest(claims, (claim) => claim.claimedAt),
  };
}

/** One batch inside its transaction, after its instant is recorded (header, steps 3 to 6). */
async function gradeInside(db: LedgerDb, evaluatedAt: IsoTs, deps: GradingDeps): Promise<BatchSummary> {
  const receipts = readRows('receipts', Receipt, await db.receipts.toArray());
  const claims = readRows('claims', Claim, await db.claims.toArray());
  const pending = claimsToGrade(claims, receipts, instantMs(evaluatedAt));
  const coverage = await batchCoverage(db, pending, evaluatedAt, deps.policy);
  const grants = readRows('grants', Grant, await db.grants.toArray());
  const activity = await batchActivity(db, claims, coverage, deps.policy);
  const graded = await gradeBatch(
    pending,
    createLedgerIndex(db),
    grants,
    deps.policy,
    coverage,
    activity,
    preAssignments(receipts),
  );
  const stored = new Map<Ulid, Receipt>(receipts.map((receipt) => [receipt.id, receipt]));
  const result = storeBatch(stored, graded, coverage);
  await db.receipts.bulkDelete([...result.deleted]);
  for (const id of result.deleted) stored.delete(id);
  for (const receipt of result.put) {
    await putReceipt(db, receipt);
    stored.set(receipt.id, receipt);
  }
  for (const [inputsHash, inputs] of result.inputs) await putReceiptInputs(db, inputsHash, inputs);
  await deleteReceiptInputs(db, result.released);
  if (result.put.length > 0) await putPolicyDocument(db, deps.policy, deps.policyDocument);
  const superseded = supersede(stored);
  for (const receipt of superseded) await putReceipt(db, receipt);
  return {
    evaluatedAt,
    claims: pending.length,
    written: result.put.length,
    deleted: result.deleted.length,
    superseded: superseded.length,
  };
}

/** One batch now (header); null when it ran nothing because its instant was not after the last batch's. */
async function gradeOnce(db: LedgerDb, deps: GradingDeps): Promise<BatchSummary | null> {
  const nowMs = deps.nowMs();
  await guardClock(db, nowMs);
  const evaluatedAt = IsoTs.parse(isoWithLocalOffset(new Date(nowMs)));
  const tables = [
    db.claims,
    db.observations,
    db.receipts,
    db.meta,
    db.grants,
    db.coverageIntervals,
    db.activity,
    db.receiptInputs,
    db.policies,
  ];
  try {
    const summary = await db.transaction('rw', tables, async () => {
      await recordBatchInstant(db, evaluatedAt);
      return gradeInside(db, evaluatedAt, deps);
    });
    log.info('grading.batch', {
      evaluatedAt: summary.evaluatedAt,
      claimCount: summary.claims,
      writtenCount: summary.written,
      deletedCount: summary.deleted,
      supersededCount: summary.superseded,
    });
    return summary;
  } catch (error) {
    if (!(error instanceof LedgerError) || error.code !== 'batch_out_of_order') throw error;
    log.warn('grading.batch_out_of_order', { evaluatedAt });
    return null;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs one batch once every batch before it has finished: batches never run at once (§3). */
export function runGradingBatch(db: LedgerDb, deps: GradingDeps): Promise<BatchSummary | null> {
  const run = queue.then(() => gradeOnce(db, deps));
  queue = run.catch(() => undefined);
  return run;
}
