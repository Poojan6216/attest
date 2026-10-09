/**
 * The retention purge (Sprint 2.6; docs/grading.md §9 "the 90-day purge removes receipts together with their
 * evidence and inputs"; Decisions [2.6]; Hard Rules 2, 4, 5, 7). The service worker's purge alarm runs it once a day
 * (src/background/alarms.ts).
 *
 * The rule. Cutoff C = now − `retentionDays` × 24 h (an instant; every comparison is by instant, never by text).
 *  1. A claim is old when `claimedAt < C`; a receipt is old when `computedAt < C` (its last grading).
 *  2. A receipt goes with its claim, and a claim goes with its receipt: a claim kept without its receipt would be
 *     graded again from scratch, without its evidence and its coverage. An UNASKED receipt superseded by a purged
 *     claim goes too (`supersededBy` is that claim's id, §8; it names the claim's evidence). Repeated until nothing
 *     more joins.
 *  3. Evidence at or after C is current: a receipt that names an observation with `occurredAt ≥ C` (an old calendar
 *     claim's event next month) stays, with its claim and the claim that superseded it, and so do their receipts,
 *     repeated until nothing more is kept; rule 2 then runs again from the old rows rule 3 did not keep, so a row
 *     that only joined through a kept one stays. So no observation at or after C is ever forgotten while its
 *     explanation is, and nothing kept names a purged row. Forgetting it instead would let the next Calendar pass
 *     see the event again: the coverage over its instant comes back with that pass (recordCoverage merges it), and
 *     the event is either missing under full coverage (a false NOT_FOUND) or re-sighted as new, with a first
 *     sighting of now, where it can verify a later "created" claim or be read as an orphan (a false UNASKED, Hard
 *     Rule 7).
 *  4. An observation goes when no kept receipt names it and it is old (`occurredAt < C`) or a purged receipt named
 *     it: evidence goes with its receipt, never before it (no kept receipt ever names a purged observation), and a
 *     purged claim's evidence never stays behind as a free orphan that would accuse an agent of an action the
 *     purged claim explained (Hard Rule 7). By rule 3, a purged receipt names only observations before C. An old
 *     observation a kept receipt still names stays until that receipt goes.
 *  5. A request goes when `ts < C` and no kept claim names it.
 *  6. Coverage: no kept interval spans an instant before C (./retention-coverage.ts, Hard Rule 5); latest-ping rows
 *     go once their last sync is before C, and Calendar snapshots once they were read before C
 *     (./calendar-snapshots.ts): a range not looked at since is compared with nothing next time, so its events are
 *     first sightings again, never changes (Hard Rule 5). An interval's `changesSince` is an instant of looking,
 *     not of the window, and is kept as it is.
 *  7. Session pings and idle intervals (./activity.ts) go once their window ended before C.
 *  8. The replay records go with their receipts (sprint_3 3.13, ./replay-records.ts): the `receiptInputs` rows keyed
 *     by the purged receipts' `inputsHash`, then every policy document no stored input names any more, in this
 *     same transaction.
 *  9. A clock repair's span (`meta` `clockRepair.*`, ./clock-repairs.ts) goes once it ended before C: no claim it
 *     bears on is still graded by then.
 * 10. A receipt's alert (./alerts.ts, sprint_4 4.6) goes with the receipt.
 * Grants, adapter health and the rest of meta are not dated history and are kept.
 *
 * Everything runs in one readwrite transaction over the dated tables, so the purge never interleaves with a grading
 * batch (§3: a batch's own readwrite transaction covers claims, observations and receipts) and a crash leaves either
 * nothing or everything purged. Every read is an indexed range (`[agent+date]` with a two-day margin for the
 * writer's offset, `[type+timeBucket]`, `claimId`, `supersededBy`, `*observationIds`, `requestId`) or a read by
 * primary key, filtered exactly by instant. Rows that fail their schema are invisible to every read (db.ts) and are
 * left alone.
 *
 * Known limit (replay, §9): a kept receipt whose claim window reached before C could have had a non-evidence
 * candidate there (receipts name only their evidence). Replaying it after the purge rebuilds its batch without that
 * row, so its `inputsHash` no longer matches; its grade is unchanged unless the dropped row decided the assignment.
 * Purging every receipt whose window overlaps a purged row would cascade without bound. Replay is exact for the
 * receipts whose claim windows lie after the cutoff.
 */
import { Dexie } from 'dexie';

import { instantMs } from '../core/normalize';
import { MS_PER_DAY } from '../core/units';
import { readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { bucketOfMs } from './index';
import { purgeActivity } from './activity';
import { purgeClockRepairs } from './clock-repairs';
import { purgeCalendarRecords } from './calendar-snapshots';
import { purgeReplayRecords } from './replay-records';
import { forgetCoverage, purgeCoveragePings } from './retention-coverage';
import { ActionType, AgentId, Claim, IsoTs, Observation, Receipt, Request } from './types';
import { RETENTION_DAYS } from '../config';

export interface PurgeOptions {
  /** The purge instant, ISO 8601 with an offset: the caller reads the clock (src/clock.ts), never the ledger. */
  readonly now: string;
  /** Whole days, at least 1. Default `RETENTION_DAYS`. */
  readonly retentionDays?: number;
}

export interface PurgeReport {
  readonly cutoff: IsoTs;
  readonly claims: number;
  readonly receipts: number;
  readonly observations: number;
  readonly requests: number;
  /** Coverage intervals deleted, and those cut to start at the cutoff (./retention-coverage.ts). */
  readonly coverageDeleted: number;
  readonly coverageCut: number;
  /** Latest-ping rows deleted. */
  readonly coveragePings: number;
  /** Calendar snapshot records deleted. */
  readonly calendarSnapshots: number;
  /** Activity rows deleted: session pings and idle intervals that ended before the cutoff (./activity.ts). */
  readonly activity: number;
  /** Replay records deleted: the purged receipts' inputs, and the batch coverages and policy documents no input names. */
  readonly receiptInputs: number;
  readonly policies: number;
  readonly batchCoverages: number;
  /** Clock repair spans deleted: those that ended before the cutoff (./clock-repairs.ts). */
  readonly clockRepairs: number;
  /** Alerts deleted: those of the purged receipts (./alerts.ts, sprint_4 4.6). */
  readonly alerts: number;
}

/** What goes, decided before anything is deleted. */
interface Doomed {
  readonly receipts: Map<string, Receipt>;
  readonly claimIds: Set<string>;
}

function cutoffOf(options: PurgeOptions): number {
  const now = IsoTs.safeParse(options.now);
  const days = options.retentionDays ?? RETENTION_DAYS;
  if (!now.success || !Number.isSafeInteger(days) || days < 1) {
    throw new LedgerError(
      'invalid_input',
      'now must be ISO 8601 with an offset, retentionDays a whole day count',
      {
        paths: now.success ? 'retentionDays' : 'now',
      },
    );
  }
  return instantMs(now.data) - days * MS_PER_DAY;
}

/**
 * The exclusive upper bound of the `[agent+date]` range that holds every row dated before `cutoffMs`. `date` is the
 * writer's local date (index-fields.ts `dateKey`), within a day of the UTC date, so two days of margin hold them all.
 */
function dateBound(cutoffMs: number): string {
  return new Date(cutoffMs + 2 * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The rows `read` returns for each agent, parsed, whose instant `at` is before `cutoffMs`. */
async function datedBefore<T>(
  cutoffMs: number,
  read: (agent: AgentId, bound: string) => Promise<readonly unknown[]>,
  parse: (rows: readonly unknown[]) => T[],
  at: (value: T) => string,
): Promise<T[]> {
  const bound = dateBound(cutoffMs);
  const out: T[] = [];
  for (const agent of AgentId.options) {
    for (const value of parse(await read(agent, bound))) if (instantMs(at(value)) < cutoffMs) out.push(value);
  }
  return out;
}

/** Rule 1: the old claims' ids and the old receipts. */
async function oldClaimsAndReceipts(db: LedgerDb, cutoffMs: number): Promise<Doomed> {
  const claims = await datedBefore(
    cutoffMs,
    (agent, bound) =>
      db.claims.where('[agent+date]').between([agent, Dexie.minKey], [agent, bound], true, false).toArray(),
    (rows) => readRows('claims', Claim, rows),
    (claim) => claim.claimedAt,
  );
  const receipts = await datedBefore(
    cutoffMs,
    (agent, bound) =>
      db.receipts.where('[agent+date]').between([agent, Dexie.minKey], [agent, bound], true, false).toArray(),
    (rows) => readRows('receipts', Receipt, rows),
    (receipt) => receipt.computedAt,
  );
  return {
    receipts: new Map(receipts.map((receipt) => [receipt.id, receipt])),
    claimIds: new Set(claims.map((claim) => claim.id)),
  };
}

/** Rule 2: receipts and claims join each other (and superseded receipts their superseding claim) to a fixpoint. */
async function closeOver(db: LedgerDb, doomed: Doomed): Promise<void> {
  let claims = [...doomed.claimIds];
  let receipts = [...doomed.receipts.values()];
  while (claims.length > 0 || receipts.length > 0) {
    for (const { claimId } of receipts) {
      if (claimId !== undefined && !doomed.claimIds.has(claimId)) {
        doomed.claimIds.add(claimId);
        claims.push(claimId);
      }
    }
    // A claim's own receipt, and the UNASKED receipts it superseded (`supersededBy` holds the claim id, §8).
    const joined = [
      ...(await db.receipts.where('claimId').anyOf(claims).toArray()),
      ...(await db.receipts.where('supersededBy').anyOf(claims).toArray()),
    ];
    receipts = readRows('receipts', Receipt, joined).filter(({ id }) => !doomed.receipts.has(id));
    for (const receipt of receipts) doomed.receipts.set(receipt.id, receipt);
    claims = [];
  }
}

/** The rows rule 3 keeps: receipt ids and claim ids. */
interface Kept {
  readonly receiptIds: Set<string>;
  readonly claimIds: Set<string>;
}

/**
 * Rule 3 over the rows rules 1 and 2 reached: a receipt that names an observation at or after the cutoff is kept, with
 * its claim and the claim that superseded it; a kept claim keeps its receipts. Repeated until nothing more is kept.
 * Every edge it follows stays inside `reached` (rule 2 reached every receipt of a reached claim) or leads to a row
 * that rules 1 and 2 never reached, which is kept anyway.
 */
async function keptByCurrentEvidence(db: LedgerDb, cutoffMs: number, reached: Doomed): Promise<Kept> {
  const named = [...new Set([...reached.receipts.values()].flatMap(({ observationIds }) => observationIds))];
  const current = new Set(
    readRows('observations', Observation, await db.observations.bulkGet(named))
      .filter((observation) => instantMs(observation.occurredAt) >= cutoffMs)
      .map(({ id }) => id),
  );
  const kept: Kept = { receiptIds: new Set(), claimIds: new Set() };
  let receipts = [...reached.receipts.values()].filter(({ observationIds }) =>
    observationIds.some((id) => current.has(id)),
  );
  while (receipts.length > 0) {
    const claims = new Set<string>();
    for (const receipt of receipts) {
      kept.receiptIds.add(receipt.id);
      for (const id of [receipt.claimId, receipt.supersededBy]) {
        if (id !== undefined && reached.claimIds.has(id) && !kept.claimIds.has(id)) claims.add(id);
      }
    }
    for (const id of claims) kept.claimIds.add(id);
    receipts = [...reached.receipts.values()].filter(
      ({ id, claimId }) => !kept.receiptIds.has(id) && claimId !== undefined && claims.has(claimId),
    );
  }
  return kept;
}

/**
 * Rules 1 to 3: the claims and receipts that go. Rules 1 and 2 reach the old rows and what joins them; rule 3 keeps
 * what current evidence needs; then rule 2 runs again from the old rows rule 3 did not keep, so a row that only joined
 * through a kept one stays (an UNASKED receipt computed after the cutoff, superseded by a kept old claim). That second
 * closure never reaches a kept row: `keptByCurrentEvidence` keeps every row joined to a kept one.
 */
async function doomedHistory(db: LedgerDb, cutoffMs: number): Promise<Doomed> {
  const old = await oldClaimsAndReceipts(db, cutoffMs);
  const reached: Doomed = { receipts: new Map(old.receipts), claimIds: new Set(old.claimIds) };
  await closeOver(db, reached);
  const kept = await keptByCurrentEvidence(db, cutoffMs, reached);
  const doomed: Doomed = {
    receipts: new Map([...old.receipts].filter(([id]) => !kept.receiptIds.has(id))),
    claimIds: new Set([...old.claimIds].filter((id) => !kept.claimIds.has(id))),
  };
  await closeOver(db, doomed);
  return doomed;
}

/** Rule 4: the observations that go. */
async function doomedObservations(db: LedgerDb, cutoffMs: number, doomed: Doomed): Promise<Observation[]> {
  const found = new Map<string, Observation>();
  const lastBucket = bucketOfMs(cutoffMs) + 1;
  for (const type of ActionType.options) {
    const rows = await db.observations
      .where('[type+timeBucket]')
      .between([type, Dexie.minKey], [type, lastBucket], true, true)
      .toArray();
    for (const observation of readRows('observations', Observation, rows)) {
      if (instantMs(observation.occurredAt) < cutoffMs) found.set(observation.id, observation);
    }
  }
  const named = [...doomed.receipts.values()].flatMap(({ observationIds }) => observationIds);
  for (const observation of readRows('observations', Observation, await db.observations.bulkGet(named))) {
    found.set(observation.id, observation);
  }
  const naming = await db.receipts
    .where('observationIds')
    .anyOf([...found.keys()])
    .toArray();
  for (const receipt of readRows('receipts', Receipt, naming)) {
    if (!doomed.receipts.has(receipt.id)) for (const id of receipt.observationIds) found.delete(id);
  }
  return [...found.values()];
}

/** Rule 5: the requests that go. */
async function doomedRequests(db: LedgerDb, cutoffMs: number, doomed: Doomed): Promise<string[]> {
  const old = await datedBefore(
    cutoffMs,
    (agent, bound) =>
      db.requests.where('[agent+date]').between([agent, Dexie.minKey], [agent, bound], true, false).toArray(),
    (rows) => readRows('requests', Request, rows),
    (request) => request.ts,
  );
  const ids = new Set(old.map(({ id }) => id));
  const naming = readRows(
    'claims',
    Claim,
    await db.claims
      .where('requestId')
      .anyOf([...ids])
      .toArray(),
  );
  for (const claim of naming) {
    if (!doomed.claimIds.has(claim.id) && claim.requestId !== undefined) ids.delete(claim.requestId);
  }
  return [...ids];
}

/**
 * Purges the dated history older than the retention cutoff by the rule in the header, in one readwrite transaction,
 * and reports what went (counts only: Hard Rule 10). Throws `LedgerError('invalid_input')` for a malformed `now` or
 * `retentionDays`, before anything is read.
 */
export async function purgeExpired(db: LedgerDb, options: PurgeOptions): Promise<PurgeReport> {
  const cutoffMs = cutoffOf(options);
  const tables = [
    db.claims,
    db.receipts,
    db.observations,
    db.requests,
    db.coverage,
    db.coverageIntervals,
    db.calendarSnapshots,
    db.activity,
    db.receiptInputs,
    db.policies,
    db.batchCoverages,
    db.meta,
    db.alerts,
  ];
  return db.transaction('rw', tables, async (): Promise<PurgeReport> => {
    const doomed = await doomedHistory(db, cutoffMs);
    const observations = await doomedObservations(db, cutoffMs, doomed);
    const requests = await doomedRequests(db, cutoffMs, doomed);
    const claimIds = [...doomed.claimIds];
    // A receipt may name a claim the ledger does not hold: count the rows that go, not the ids.
    const claims = (await db.claims.bulkGet(claimIds)).filter((row) => row !== undefined).length;
    await db.receipts.bulkDelete([...doomed.receipts.keys()]);
    const alertKeys = [...doomed.receipts.keys()];
    const alerts = (await db.alerts.bulkGet(alertKeys)).filter((row) => row !== undefined).length;
    await db.alerts.bulkDelete(alertKeys);
    await db.claims.bulkDelete(claimIds);
    await db.observations.bulkDelete(observations.map(({ id }) => id));
    await db.requests.bulkDelete(requests);
    const coverage = await forgetCoverage(db, cutoffMs);
    const replay = await purgeReplayRecords(
      db,
      [...doomed.receipts.values()].map(({ inputsHash }) => inputsHash),
    );
    return {
      cutoff: IsoTs.parse(new Date(cutoffMs).toISOString()),
      claims,
      receipts: doomed.receipts.size,
      observations: observations.length,
      requests: requests.length,
      coverageDeleted: coverage.deleted,
      coverageCut: coverage.cut,
      coveragePings: await purgeCoveragePings(db, cutoffMs),
      calendarSnapshots: await purgeCalendarRecords(db, cutoffMs),
      activity: await purgeActivity(db, cutoffMs),
      receiptInputs: replay.receiptInputs,
      policies: replay.policies,
      batchCoverages: replay.batchCoverages,
      clockRepairs: await purgeClockRepairs(db, cutoffMs),
      alerts,
    };
  });
}
