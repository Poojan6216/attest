/**
 * Typed ledger repositories. Every function takes the database as its first argument (no hidden
 * singleton); runtime callers get the shared instance from `getLedger()`.
 *
 * Contract:
 *  - Writes take the schemas' input types and Zod-parse them first (src/core/schema.ts). Invalid input throws
 *    `LedgerError('invalid_input')` and writes nothing. Strict schemas reject keys no schema names; they do not
 *    know which fields a source may store. So an observation must also be one `redact.project()` could have
 *    returned under the caller's loaded policy (`observationIntegrityProblems`): only the content fields its
 *    source's allowlist names, and a contentHash that is the §10 hash of its content, so a row can neither
 *    carry a field its source never stores nor choose its own id (Hard Rule 2). Reads return the parsed
 *    domain types.
 *  - Observations and claims are idempotent: keyed on contentHash / rawHash inside one rw transaction.
 *    A repeat returns the stored id and never leaks a ConstraintError. A stored row is never rewritten, because
 *    a batch may have graded with it (docs/grading.md §3, Hard Rule 4). A repeat must be the same fact: one that
 *    differs in anything but `observedAt` (and a claim's `extractor`) throws `LedgerError('id_conflict')`, and an
 *    observation sighted earlier than the stored row's first sighting throws `LedgerError('late_sighting')`; both
 *    change nothing (Hard Rule 6). A claim's sighting grades nothing, so a claim seen again is a no-op however
 *    early it was sighted. A new row is stored with the `observedAt` `stampObservedAt` gives (./batch-instant.ts):
 *    never at or before the instant of a batch that did not read it. A new observation stored later than it was
 *    sighted keeps the sighting as `sightedAt`, which only the ledger sets (an incoming one is `invalid_input`).
 *    A stored row no read can return (it fails its schema) is replaced, not kept as a ghost.
 *  - A grading batch records its instant with `recordBatchInstant` before it reads, and a user event (override,
 *    revert) is written through `writeUserEvent`, which stamps it after the last batch and after the receipt's own
 *    last event (`lastEventAt`, passed as `notBefore`; ./batch-instant.ts).
 *  - Adapter health and coverage keep the latest report: an older timestamp never replaces a newer one.
 *  - Reads strip derived index fields and Zod-parse; an invalid row is skipped and logged by id only.
 */
import { z } from 'zod';

import { assertLoadedPolicy, type Policy } from '../core/policy';
import { observationIntegrityProblems } from '../core/redact';
import { LAST_EVALUATED_AT } from './batch-instant';
import { noteStoredInstant } from './clock-high-water';
import { readRow, readRows, type LedgerDb } from './db';
import { LedgerError, parseWrite } from './errors';
import {
  accountKeyOf,
  toCoverageRow,
  toReceiptRow,
  toRequestRow,
  type LedgerTableName,
} from './index-fields';
import {
  ActionType,
  AdapterHealth,
  AgentId,
  Claim,
  CoveragePing,
  Grant,
  MetaEntry,
  Observation,
  Receipt,
  Request,
  type AdapterHealthInput,
  type ClaimInput,
  type CoveragePingInput,
  type GrantInput,
  type ObservationInput,
  type ReceiptInput,
  type RequestInput,
} from './types';
import {
  claimsByHash,
  insertUnlessHashExists,
  isOlder,
  observationsByHash,
  type UpsertResult,
} from './upsert';

export type { UpsertResult } from './upsert';
export { lastEventAt, recordBatchInstant, type UserEventBound, writeUserEvent } from './batch-instant';

export interface WriteResult {
  /** False when the incoming report was older than the stored one and was ignored. */
  readonly written: boolean;
}

/** `YYYY-MM-DD`, the `date` part of the `[agent+date]` indexes. */
const LocalDate = z.iso.date();

function parseInput<S extends z.ZodType>(table: LedgerTableName, schema: S, input: unknown): z.output<S> {
  return parseWrite(schema, input, `Invalid ${table} input`, { table });
}

function agentDateKey(table: LedgerTableName, agent: AgentId, date: string): [AgentId, string] {
  return [parseInput(table, AgentId, agent), parseInput(table, LocalDate, date)];
}

// ── Observations ────────────────────────────────────────────────────────────────────────────────

/** Throws `invalid_input` (field names only) unless `project()` could have returned `observation` (SEC-V1). */
function assertProjected(observation: Observation, policy: Policy): void {
  const problems = observationIntegrityProblems(observation, policy);
  if (problems.length === 0) return;
  const paths = problems.map(([field]) => (typeof field === 'string' ? field : field.join('.')));
  throw new LedgerError('invalid_input', 'Invalid observations input', {
    table: 'observations',
    paths: paths.join('|'),
  });
}

/**
 * Inserts an observation (its `observedAt` stamped, ./batch-instant.ts, and its sighting kept as `sightedAt` when
 * the stamp is later), or returns the existing id when its contentHash is already stored and the stored row is the
 * same fact first seen no later (`id_conflict` for another fact, `late_sighting` for an earlier sighting; the stored
 * row never changes). An observation carrying `sightedAt` is `invalid_input`: only the ledger sets it.
 * `policy` is the loaded policy whose allowlist the observation was projected under; a row it could not have
 * produced is refused before anything is written. A policy `loadPolicy` did not return (a copy, possibly with a
 * widened allowlist) throws `PolicyError('policy_not_loaded')`, as grading does, and writes nothing.
 * `options.clockMs` is the writer's clock (the service worker's): a stored first sighting after it is from before
 * the clock went back, and an earlier sighting of it is then a no-op, not `late_sighting` (./upsert.ts).
 */
export async function upsertObservation(
  db: LedgerDb,
  input: ObservationInput,
  policy: Policy,
  options: WriterClock = {},
): Promise<UpsertResult> {
  assertLoadedPolicy(policy);
  const observation = parseInput('observations', Observation, input);
  assertProjected(observation, policy);
  const sighting = { hash: observation.contentHash, fact: observation };
  return insertUnlessHashExists(db, observationsByHash(db), sighting, options.clockMs);
}

/** The writer's own clock, in epoch ms (src/background passes the service worker's). */
export interface WriterClock {
  readonly clockMs?: number;
}

export async function getObservation(db: LedgerDb, id: string): Promise<Observation | undefined> {
  return readRow('observations', Observation, await db.observations.get(id));
}

/** Observations of one action type whose `occurredAt` falls in buckets `fromBucket..toBucket` (inclusive). */
export async function observationsByTypeAndBuckets(
  db: LedgerDb,
  type: ActionType,
  fromBucket: number,
  toBucket: number,
): Promise<Observation[]> {
  const actionType = parseInput('observations', ActionType, type);
  if (!Number.isSafeInteger(fromBucket) || !Number.isSafeInteger(toBucket) || fromBucket > toBucket) {
    throw new LedgerError('invalid_input', 'Bucket range must be integers with from <= to', {
      table: 'observations',
      fromBucket,
      toBucket,
    });
  }
  const rows = await db.observations
    .where('[type+timeBucket]')
    .between([actionType, fromBucket], [actionType, toBucket], true, true)
    .toArray();
  return readRows('observations', Observation, rows);
}

// ── Claims ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a claim (its `observedAt` stamped, ./batch-instant.ts), or returns the existing id when its rawHash
 * is already stored and the stored claim is the same one, whenever this read sighted it: a claim's sighting grades
 * nothing (docs/grading.md §3, §10), so an earlier re-read is no news and never `late_sighting`. The raw text is
 * never stored, so the rawHash cannot be checked against it: a claim that differs from the stored one in anything
 * but `observedAt` and `extractor` throws `LedgerError('id_conflict')` instead. A newer extractor that reads the
 * claim the same way changes nothing (the stored extractor is kept).
 */
export async function upsertClaim(db: LedgerDb, input: ClaimInput): Promise<UpsertResult> {
  const claim = parseInput('claims', Claim, input);
  return insertUnlessHashExists(db, claimsByHash(db), { hash: claim.rawHash, fact: claim });
}

export async function getClaim(db: LedgerDb, id: string): Promise<Claim | undefined> {
  return readRow('claims', Claim, await db.claims.get(id));
}

/** Claims by agent on a local date (`YYYY-MM-DD` of `claimedAt`). */
export async function claimsByAgentAndDate(db: LedgerDb, agent: AgentId, date: string): Promise<Claim[]> {
  const key = agentDateKey('claims', agent, date);
  return readRows('claims', Claim, await db.claims.where('[agent+date]').equals(key).toArray());
}

// ── Requests ────────────────────────────────────────────────────────────────────────────────────

/** Stores a request by id (a later put with the same id replaces it). */
export async function putRequest(db: LedgerDb, input: RequestInput): Promise<void> {
  const request = parseInput('requests', Request, input);
  await db.requests.put(toRequestRow(request));
}

export async function getRequest(db: LedgerDb, id: string): Promise<Request | undefined> {
  return readRow('requests', Request, await db.requests.get(id));
}

/** Requests by agent on a local date (`YYYY-MM-DD` of `ts`). */
export async function requestsByAgentAndDate(db: LedgerDb, agent: AgentId, date: string): Promise<Request[]> {
  const key = agentDateKey('requests', agent, date);
  return readRows('requests', Request, await db.requests.where('[agent+date]').equals(key).toArray());
}

// ── Receipts ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stores a receipt by id; a later put replaces it (PENDING → FINAL is the same receipt id). The receipt's own
 * `agent` field feeds the [agent+date] index.
 */
export async function putReceipt(db: LedgerDb, input: ReceiptInput): Promise<void> {
  await db.receipts.put(toReceiptRow(parseInput('receipts', Receipt, input)));
}

export async function getReceipt(db: LedgerDb, id: string): Promise<Receipt | undefined> {
  return readRow('receipts', Receipt, await db.receipts.get(id));
}

/** Receipts by their `agent` on a local date (`YYYY-MM-DD` of `computedAt`). */
export async function receiptsByAgentAndDate(db: LedgerDb, agent: AgentId, date: string): Promise<Receipt[]> {
  const key = agentDateKey('receipts', agent, date);
  return readRows('receipts', Receipt, await db.receipts.where('[agent+date]').equals(key).toArray());
}

// ── Grants ──────────────────────────────────────────────────────────────────────────────────────

/** Stores the grant for its agent (one grant per agent; a later put replaces it). */
export async function putGrant(db: LedgerDb, input: GrantInput): Promise<void> {
  await db.grants.put(parseInput('grants', Grant, input));
}

export async function getGrant(db: LedgerDb, agent: AgentId): Promise<Grant | undefined> {
  return readRow('grants', Grant, await db.grants.get(parseInput('grants', AgentId, agent)));
}

/** Every stored grant, ordered by agent. Bounded: at most one row per AgentId. */
export async function listGrants(db: LedgerDb): Promise<Grant[]> {
  return readRows('grants', Grant, await db.grants.toArray());
}

// ── Adapter health ──────────────────────────────────────────────────────────────────────────────

/**
 * Keeps the latest health report per adapter; a report older than the stored one is ignored. Its `checkedAt` raises
 * the clock's high water (./clock-high-water.ts), as every health instant does (SEC-4), so a report stored while the
 * clock ran ahead is repaired when it comes back (./clock-guard.ts).
 */
export async function putAdapterHealth(db: LedgerDb, input: AdapterHealthInput): Promise<WriteResult> {
  const health = parseInput('adapterHealth', AdapterHealth, input);
  return db.transaction('rw', [db.adapterHealth, db.meta], async (): Promise<WriteResult> => {
    const stored = readRow('adapterHealth', AdapterHealth, await db.adapterHealth.get(health.adapterId));
    if (stored !== undefined && isOlder(health.checkedAt, stored.checkedAt)) return { written: false };
    await db.adapterHealth.put(health);
    await noteStoredInstant(db, health.checkedAt);
    return { written: true };
  });
}

export async function getAdapterHealth(db: LedgerDb, adapterId: string): Promise<AdapterHealth | undefined> {
  return readRow('adapterHealth', AdapterHealth, await db.adapterHealth.get(adapterId));
}

/** The latest health report of every adapter/observer, ordered by id. Bounded by the adapter count. */
export async function listAdapterHealth(db: LedgerDb): Promise<AdapterHealth[]> {
  return readRows('adapterHealth', AdapterHealth, await db.adapterHealth.toArray());
}

// ── Coverage ────────────────────────────────────────────────────────────────────────────────────

/** Keeps the latest ping per observer + account; a ping older than the stored one is ignored. */
export async function putCoveragePing(db: LedgerDb, input: CoveragePingInput): Promise<WriteResult> {
  const ping = parseInput('coverage', CoveragePing, input);
  const row = toCoverageRow(ping);
  return db.transaction('rw', db.coverage, async (): Promise<WriteResult> => {
    const stored = readRow(
      'coverage',
      CoveragePing,
      await db.coverage.get([ping.observerId, row.accountKey]),
    );
    if (stored !== undefined && isOlder(ping.lastSyncAt, stored.lastSyncAt)) return { written: false };
    await db.coverage.put(row);
    return { written: true };
  });
}

/** The latest ping for one observer and account (`accountHash` omitted = the account-less row). */
export async function getCoveragePing(
  db: LedgerDb,
  observerId: string,
  accountHash?: string,
): Promise<CoveragePing | undefined> {
  return readRow('coverage', CoveragePing, await db.coverage.get([observerId, accountKeyOf(accountHash)]));
}

/** The latest ping of every account of one observer, ordered by account key. */
export async function coverageByObserver(db: LedgerDb, observerId: string): Promise<CoveragePing[]> {
  return readRows(
    'coverage',
    CoveragePing,
    await db.coverage.where('observerId').equals(observerId).toArray(),
  );
}

// ── Meta ────────────────────────────────────────────────────────────────────────────────────────

export async function getMeta(db: LedgerDb, key: string): Promise<MetaEntry['value'] | undefined> {
  return readRow('meta', MetaEntry, await db.meta.get(key))?.value;
}

/** Stores a meta value. The last batch instant is written only by `recordBatchInstant` (it never moves back). */
export async function setMeta(db: LedgerDb, key: string, value: MetaEntry['value']): Promise<void> {
  if (key === LAST_EVALUATED_AT) {
    throw new LedgerError('invalid_input', 'This meta key is written only by recordBatchInstant', {
      table: 'meta',
      paths: 'key',
    });
  }
  await db.meta.put(parseInput('meta', MetaEntry, { key, value }));
}

// ── Shared runtime instance ─────────────────────────────────────────────────────────────────────

/** The shared instance lives in ./shared.ts, which the pages import without the rest of this module (sprint_4 4.2). */
export { closeLedger, getLedger } from './shared';
