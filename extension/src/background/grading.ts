/**
 * The grading batch (sprint_3 3.13; docs/grading.md §3 Background obligations, §7, §8, §9; Hard Rules 4, 5, 7): the
 * one path from the ledger's claims and observations to stored receipts. The service worker runs one after an import
 * and on the grace alarm (./alarms.ts), never after an observer pass: the alarm regrades within its period (Decisions
 * [3.13]). Batches never run at once (`runGradingBatch` queues them), and each is stamped strictly after the last
 * (`recordBatchInstant`).
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
  Claim,
  type Coverage,
  Grant,
  IsoTs,
  Receipt,
  SCHEMA_LIMITS,
  type Ulid,
} from '../core/schema';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../core/units';
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
import { gradedWrites, noteGradedWrites } from '../ledger/batch-instant';
import { readCount, STORED_WRITES } from '../ledger/clock-high-water';
import { lastImportKey } from '../ledger/meta-keys';
import { getMeta, putReceipt, recordBatchInstant } from '../ledger/repo';
import { queueAlerts } from '../ledger/alerts';
import { log } from '../log';
import { type AlertDeps, BROWSER_ALERTS, deliverAlerts } from './alerts';

export interface GradingDeps {
  readonly policy: Policy;
  /** The policy's document as written, stored beside its receipts for replay (src/ledger/replay-records.ts). */
  readonly policyDocument: unknown;
  /** The clock at the edge (src/clock.ts): epoch ms. */
  readonly nowMs: () => number;
  /** Where the alerts a batch queued are shown, after it (sprint_4 4.6, ./alerts.ts); none are shown when absent. */
  readonly alerts?: AlertDeps;
}

/** The service worker's batches: the shipped policy, the wall clock (the one src/clock.ts reads) and Chrome's alerts. */
export const SHIPPED_GRADING: GradingDeps = Object.freeze({
  policy: DEFAULT_POLICY,
  policyDocument: DEFAULT_POLICY_DOCUMENT,
  nowMs: () => Date.now(),
  alerts: BROWSER_ALERTS,
});

/** What one batch did: counts only. */
export interface BatchSummary {
  readonly evaluatedAt: IsoTs;
  readonly claims: number;
  readonly written: number;
  readonly deleted: number;
  readonly superseded: number;
  /** It had nothing to grade and read nothing (`nothingToGrade`; tech review TECH-2). */
  readonly skipped: boolean;
}

/** Whether a batch wrote, deleted or superseded a receipt: what open pages are told (tech review TECH-8). */
export function changedReceipts(summary: BatchSummary | null): boolean {
  return summary !== null && summary.written + summary.deleted + summary.superseded > 0;
}

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
function latest<T>(list: ActivityList, items: readonly T[], at: (item: T) => string): T[] {
  if (items.length > SCHEMA_LIMITS.GRADING_INPUT) {
    // Never cut silently (tech review TECH-9): the batch grades with the newest, and says how many it left out.
    log.warn('grading.input_capped', {
      list,
      itemCount: items.length,
      keptCount: SCHEMA_LIMITS.GRADING_INPUT,
    });
  }
  return [...items].sort((a, b) => instantMs(at(b)) - instantMs(at(a))).slice(0, SCHEMA_LIMITS.GRADING_INPUT);
}

/** The Activity lists a batch can cut to GRADING_INPUT, as its log names them. */
type ActivityList = 'claims' | 'sessions' | 'idle_intervals' | 'activity_entries';

/** The batch's activity (header, step 5). */
async function batchActivity(
  db: LedgerDb,
  claims: readonly Claim[],
  pending: readonly Claim[],
  coverage: Coverage,
  policy: Policy,
): Promise<Activity> {
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
  // Only a claim made within the spend window before a claim this batch grades, or near an orphan it can find, can
  // change a grade (§6.3 cumulative spend, §7 adjacency); a day more holds a claim whose precision unit is a day.
  const spendMs = policy.windows.spendWindowDays * MS_PER_DAY;
  const graded = pending.map((claim) => instantMs(claim.claimedAt) - spendMs);
  const fromMs = Math.min(reached - reachMs, ...graded) - MS_PER_DAY;
  const inRange = claims.filter((claim) => instantMs(claim.claimedAt) >= fromMs);
  const logged = inRange.filter((c) => c.sourceKind === 'activity_view' && c.claimedAtPrecision !== 'day');
  const held = await activityIn(db, reached - reachMs, evaluatedMs + reachMs);
  return {
    sessions: latest('sessions', held.sessions, (session) => session.at),
    idle: latest('idle_intervals', held.idle, (interval) => interval.to),
    entries: latest('activity_entries', logged, (claim) => claim.claimedAt).map(
      ({ agent, claimedAt, type }) => ({
        agent,
        at: claimedAt,
        type,
      }),
    ),
    adapterSyncs,
    claims: latest('claims', inRange, (claim) => claim.claimedAt),
  };
}

/** One batch inside its transaction, after its instant is recorded (header, steps 3 to 6). */
async function gradeInside(db: LedgerDb, evaluatedAt: IsoTs, deps: GradingDeps): Promise<BatchSummary> {
  const receipts = readRows('receipts', Receipt, await db.receipts.toArray());
  const claims = readRows('claims', Claim, await db.claims.toArray());
  const pending = claimsToGrade(claims, receipts, instantMs(evaluatedAt));
  const coverage = await batchCoverage(db, pending, evaluatedAt, deps.policy);
  const grants = readRows('grants', Grant, await db.grants.toArray());
  const activity = await batchActivity(db, claims, pending, coverage, deps.policy);
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
  await putReceiptInputs(db, result.inputs);
  await deleteReceiptInputs(db, result.released);
  if (result.put.length > 0) await putPolicyDocument(db, deps.policy, deps.policyDocument);
  const superseded = supersede(stored);
  for (const receipt of superseded) await putReceipt(db, receipt);
  // What this batch made FINAL with an alerting grade, as it now stands (sprint_4 4.6; src/ledger/alerts.ts).
  const latest = new Map<Ulid, Receipt>(superseded.map((receipt) => [receipt.id, receipt]));
  await queueAlerts(
    db,
    result.put.map((receipt) => latest.get(receipt.id) ?? receipt),
  );
  return {
    evaluatedAt,
    claims: pending.length,
    written: result.put.length,
    deleted: result.deleted.length,
    superseded: superseded.length,
    skipped: false,
  };
}

/**
 * Whether a batch has nothing to grade (tech review TECH-2): no receipt is PENDING (its finality reads the clock, so
 * it is always regraded) and no fact was stored since the last batch that graded (`writes`, the ledger's stored-fact
 * count, is where that batch left it; a ledger that never recorded one always grades). Such a batch would read and
 * parse every claim and receipt, every five minutes, and write nothing.
 */
async function nothingToGrade(db: LedgerDb, writes: number): Promise<boolean> {
  if ((await gradedWrites(db)) !== writes) return false;
  return (await db.receipts.where('state').equals('PENDING').count()) === 0;
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
    db.batchCoverages,
    db.alerts,
  ];
  try {
    const summary = await db.transaction('rw', tables, async (): Promise<BatchSummary> => {
      await recordBatchInstant(db, evaluatedAt);
      const writes = await readCount(db, STORED_WRITES);
      if (await nothingToGrade(db, writes)) {
        return { evaluatedAt, claims: 0, written: 0, deleted: 0, superseded: 0, skipped: true };
      }
      const graded = await gradeInside(db, evaluatedAt, deps);
      await noteGradedWrites(db, writes);
      return graded;
    });
    if (summary.skipped) {
      log.debug('grading.batch_skipped', { evaluatedAt });
      return summary;
    }
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

/** One batch, then the alerts it queued shown (./alerts.ts); a failure to show is logged, never the batch's. */
async function gradeAndAlert(db: LedgerDb, deps: GradingDeps): Promise<BatchSummary | null> {
  const summary = await gradeOnce(db, deps);
  if (deps.alerts !== undefined && summary !== null && !summary.skipped) {
    await deliverAlerts(db, deps.alerts).catch((error: unknown) => {
      log.error('alerts.deliver_failed', { error });
    });
  }
  return summary;
}

/** Runs one batch once every batch before it has finished: batches never run at once (§3). */
export function runGradingBatch(db: LedgerDb, deps: GradingDeps): Promise<BatchSummary | null> {
  const run = queue.then(() => gradeAndAlert(db, deps));
  queue = run.catch(() => undefined);
  return run;
}
