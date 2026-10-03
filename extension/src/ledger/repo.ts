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
 *    A repeat is a no-op that returns the stored id; it never overwrites a readable row and never leaks a
 *    ConstraintError. A stored row no read can return (it fails its schema) is replaced, not kept as a ghost.
 *  - Adapter health and coverage keep the latest report: an older timestamp never replaces a newer one.
 *  - Reads strip derived index fields and Zod-parse; an invalid row is skipped and logged by id only.
 */
import type { Table } from 'dexie';
import { z } from 'zod';

import { assertLoadedPolicy, type Policy } from '../core/policy';
import { observationIntegrityProblems } from '../core/redact';
import { log } from '../log';
import { loggableId, logTableId, readRow, readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import {
  accountKeyOf,
  epochMs,
  normalizeToken,
  toClaimRow,
  toCoverageRow,
  toObservationRow,
  toReceiptRow,
  toRequestRow,
  type ClaimRow,
  type LedgerTableName,
  type ObservationRow,
} from './index-fields';
import { openLedger } from './migrations';
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

export interface UpsertResult {
  /** The stored row's id: the new one when inserted, the existing one when the hash was already known. */
  readonly id: string;
  readonly inserted: boolean;
}

export interface WriteResult {
  /** False when the incoming report was older than the stored one and was ignored. */
  readonly written: boolean;
}

/** `YYYY-MM-DD`, the `date` part of the `[agent+date]` indexes. */
const LocalDate = z.iso.date();

function parseInput<S extends z.ZodType>(table: LedgerTableName, schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)');
  throw new LedgerError('invalid_input', `Invalid ${table} input`, { table, paths: paths.join('|') });
}

function agentDateKey(table: LedgerTableName, agent: AgentId, date: string): [AgentId, string] {
  return [parseInput(table, AgentId, agent), parseInput(table, LocalDate, date)];
}

/** A table whose rows are idempotent on a unique hash. */
interface HashedTable<Row> {
  readonly table: 'observations' | 'claims';
  readonly store: Table<Row, string>;
  readonly schema: z.ZodType;
  readonly hashIndex: 'contentHash' | 'rawHash';
}

/** Deletes a stored row that no read can return, so a valid write can take its place. */
async function dropUnreadable<Row>(target: HashedTable<Row>, id: string): Promise<void> {
  await target.store.delete(id);
  log.warn('ledger.row_replaced', { table: logTableId(target.table), id: loggableId(target.table, id) });
}

/**
 * Inserts `row` unless a readable row with the same unique hash exists. One rw transaction, so concurrent
 * upserts of the same hash serialise: exactly one inserts, the rest return its id.
 *
 * A stored row that fails its schema is invisible to every read. If it held this hash (or this id), a
 * no-op would hide the new, valid fact forever: evidence Attest saw would never reach grading (Hard
 * Rule 5). So an unreadable row is replaced, never treated as "already stored".
 */
async function insertUnlessHashExists<Row extends { readonly id: string }>(
  db: LedgerDb,
  target: HashedTable<Row>,
  hash: string,
  row: Row,
): Promise<UpsertResult> {
  const { table, store, schema, hashIndex } = target;
  const readable = (stored: unknown): boolean => readRow(table, schema, stored) !== undefined;
  return db.transaction('rw', store, async (): Promise<UpsertResult> => {
    const [existingId] = await store.where(hashIndex).equals(hash).primaryKeys();
    if (existingId !== undefined) {
      if (readable(await store.get(existingId))) return { id: existingId, inserted: false };
      await dropUnreadable(target, existingId);
    }
    const sameId = await store.get(row.id);
    if (sameId !== undefined) {
      if (readable(sameId)) {
        throw new LedgerError('id_conflict', 'A row with this id already exists with a different hash', {
          table,
          id: row.id,
        });
      }
      await dropUnreadable(target, row.id);
    }
    await store.add(row);
    return { id: row.id, inserted: true };
  });
}

function observationsByHash(db: LedgerDb): HashedTable<ObservationRow> {
  return { table: 'observations', store: db.observations, schema: Observation, hashIndex: 'contentHash' };
}

function claimsByHash(db: LedgerDb): HashedTable<ClaimRow> {
  return { table: 'claims', store: db.claims, schema: Claim, hashIndex: 'rawHash' };
}

function isOlder(incomingTs: string, storedTs: string): boolean {
  return epochMs(incomingTs) < epochMs(storedTs);
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
 * Inserts an observation, or returns the existing id when its contentHash is already stored. `policy` is the
 * loaded policy whose allowlist the observation was projected under; a row it could not have produced is
 * refused before anything is written. A policy `loadPolicy` did not return (a copy, possibly with a widened
 * allowlist) throws `PolicyError('policy_not_loaded')`, as grading does, and writes nothing.
 */
export async function upsertObservation(
  db: LedgerDb,
  input: ObservationInput,
  policy: Policy,
): Promise<UpsertResult> {
  assertLoadedPolicy(policy);
  const observation = parseInput('observations', Observation, input);
  assertProjected(observation, policy);
  const row = toObservationRow(observation);
  return insertUnlessHashExists(db, observationsByHash(db), observation.contentHash, row);
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

/** Observations indexed under a counterparty token (matched after the same normalisation as on write). */
export async function observationsByCounterpartyToken(db: LedgerDb, token: string): Promise<Observation[]> {
  const normalized = normalizeToken(token);
  if (normalized === '') {
    throw new LedgerError('invalid_input', 'Counterparty token is empty', { table: 'observations' });
  }
  const rows = await db.observations.where('counterpartyTokens').equals(normalized).toArray();
  return readRows('observations', Observation, rows);
}

// ── Claims ──────────────────────────────────────────────────────────────────────────────────────

/** Inserts a claim, or returns the existing id when its rawHash is already stored. */
export async function upsertClaim(db: LedgerDb, input: ClaimInput): Promise<UpsertResult> {
  const claim = parseInput('claims', Claim, input);
  return insertUnlessHashExists(db, claimsByHash(db), claim.rawHash, toClaimRow(claim));
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

/** Keeps the latest health report per adapter; a report older than the stored one is ignored. */
export async function putAdapterHealth(db: LedgerDb, input: AdapterHealthInput): Promise<WriteResult> {
  const health = parseInput('adapterHealth', AdapterHealth, input);
  return db.transaction('rw', db.adapterHealth, async (): Promise<WriteResult> => {
    const stored = readRow('adapterHealth', AdapterHealth, await db.adapterHealth.get(health.adapterId));
    if (stored !== undefined && isOlder(health.checkedAt, stored.checkedAt)) return { written: false };
    await db.adapterHealth.put(health);
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

export async function setMeta(db: LedgerDb, key: string, value: MetaEntry['value']): Promise<void> {
  await db.meta.put(parseInput('meta', MetaEntry, { key, value }));
}

// ── Shared runtime instance ─────────────────────────────────────────────────────────────────────

let shared: Promise<LedgerDb> | undefined;

/**
 * The extension's ledger (`DB_NAME`, latest migrations), opened once per context on first use.
 * A failed open is not cached: the next call retries.
 */
export function getLedger(): Promise<LedgerDb> {
  if (shared !== undefined) return shared;
  const opening = openLedger();
  shared = opening;
  opening.catch((error: unknown) => {
    if (shared === opening) shared = undefined;
    log.warn('ledger.shared_open_reset', { error });
  });
  return opening;
}

/** Closes the shared instance (if any) and forgets it; the next `getLedger()` reopens. */
export async function closeLedger(): Promise<void> {
  const current = shared;
  shared = undefined;
  if (current === undefined) return;
  try {
    (await current).close();
  } catch (error) {
    log.warn('ledger.close_skipped', { error });
  }
}
