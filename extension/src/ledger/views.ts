/**
 * The ledger reads the UI shows (sprint_4 4.0; src/ui/data.ts calls them for the pages). Each reads through an index or
 * by key, never a whole unbounded table (tests/unit/ledger/views.spec.ts fails on a full scan), and computes nothing
 * beyond joins and sorting: the UI is a view of the ledger (sprint_4 header).
 *
 *  - `receiptPage`: the receipts graded in a range of instants, newest first (`computedAt`, then id), of the agents and
 *    grades asked, `limit` at a time, each with its claim. One read per agent through `[agent+computedMs]` (per agent
 *    and grade through `[agent+grade+computedMs]` when grades are asked), newest first, stops at `limit + 1` receipts,
 *    so a page reads as many rows however many the range holds; the next page resumes after the last receipt shown.
 *    The popup's range starts at local midnight; the timeline's spans its days. A grade is the computed one: an
 *    overridden receipt is found under the grade Attest gave it, and shows the override beside it.
 *  - `receiptDetail`: a receipt, its claim and request, its evidence in the receipt's order, and what grading saw (its
 *    replay inputs, the batch's coverage joined), each read by key.
 *  - `coverageSummary`: the latest coverage ping of each observer and account, and each agent's last import.
 *  - `popupView`: the popup's reads in one transaction: today's page, the coverage summary, the health reports and the
 *    last batch instant.
 *  - The small tables, read whole: the latest coverage ping of each observer and account, the health reports and the
 *    grants (one row per observer and account, adapter, agent). The last imports are meta rows read by key.
 */
import { compareText } from '../core/order';
import { lastBatchMs } from './batch-instant';
import { readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { epochMs, type ReceiptRow } from './index-fields';
import { lastImportKey } from './meta-keys';
import { receiptInputsOf } from './replay-records';
import { getClaim, getMeta, getReceipt, getRequest, listAdapterHealth } from './repo';
import {
  type AdapterHealth,
  AgentId,
  Claim,
  CoveragePing,
  type Grade,
  IsoTs,
  Observation,
  Receipt,
  type ReceiptInputs,
  type Request,
} from './types';

/** Where a page ended: the last receipt shown, so the next page starts after it. */
export interface ReceiptCursor {
  /** Its `computedAt` in epoch ms. */
  readonly computedMs: number;
  readonly id: string;
}

export interface ReceiptQuery {
  /** The agents whose receipts to read; none reads none. */
  readonly agents: readonly AgentId[];
  /** The grading instants of the range, epoch ms, both included. */
  readonly fromMs: number;
  readonly toMs: number;
  /** The grades to keep; every grade when absent. */
  readonly grades?: readonly Grade[];
  /** How many receipts a page holds: a positive integer. */
  readonly limit: number;
  /** The cursor of the page before; the first page when absent. */
  readonly after?: ReceiptCursor;
}

/** A receipt as a list shows it, with its claim: none for UNASKED and scope receipts, or a claim the purge removed. */
export interface ReceiptItem {
  readonly receipt: Receipt;
  readonly claim: Claim | undefined;
}

export interface ReceiptPage {
  readonly items: readonly ReceiptItem[];
  /** Where the next page starts; null when the range holds no more. */
  readonly next: ReceiptCursor | null;
}

/** Newest first: the later `computedMs`, then the greater id. The index's own order, reversed. */
function newestFirst(a: ReceiptRow, b: ReceiptRow): number {
  return b.computedMs - a.computedMs || compareText(b.id, a.id);
}

/** The index prefix one read of a page goes under: an agent, or an agent and a grade. */
type Prefix = readonly [AgentId] | readonly [AgentId, Grade];

/**
 * The newest `limit` rows under `prefix` in the query's range and after its cursor, newest first, through
 * `[agent+computedMs]`, or `[agent+grade+computedMs]` when the query names grades. Rows come off disk unparsed: an index
 * lists a row only under a number `computedMs`, and the order reads only that and the id (the primary key); the strict
 * read of the rows shown comes after (`receiptPage`). Past a cursor, the rows at its instant up to it are read and
 * passed over: at most the receipts one batch graded.
 */
async function newestUnder(
  db: LedgerDb,
  prefix: Prefix,
  query: ReceiptQuery,
  limit: number,
): Promise<ReceiptRow[]> {
  const { after } = query;
  const toMs = after === undefined ? query.toMs : Math.min(query.toMs, after.computedMs);
  if (toMs < query.fromMs) return [];
  const index = prefix.length === 1 ? '[agent+computedMs]' : '[agent+grade+computedMs]';
  const rows = db.receipts
    .where(index)
    .between([...prefix, query.fromMs], [...prefix, toMs], true, true)
    .reverse();
  const kept =
    after === undefined
      ? rows
      : rows.filter((row) => row.computedMs < after.computedMs || compareText(row.id, after.id) < 0);
  return kept.limit(limit).toArray();
}

/** The index prefixes a query reads: each agent asked, or each agent with each grade asked. */
function prefixesOf(query: ReceiptQuery): Prefix[] {
  const agents = [...new Set(query.agents)];
  if (query.grades === undefined) return agents.map((agent): Prefix => [agent]);
  const grades = [...new Set(query.grades)];
  return agents.flatMap((agent) => grades.map((grade): Prefix => [agent, grade]));
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new LedgerError('invalid_input', 'A page holds at least one receipt', {
      table: 'receipts',
      paths: 'limit',
    });
  }
}

/** The claims of `receipts`, by id, read by key (`bulkGet`). */
async function claimsOf(db: LedgerDb, receipts: readonly Receipt[]): Promise<Map<string, Claim>> {
  const ids = [...new Set(receipts.flatMap(({ claimId }) => (claimId === undefined ? [] : [claimId])))];
  const claims = readRows('claims', Claim, await db.claims.bulkGet(ids));
  return new Map(claims.map((claim) => [claim.id, claim]));
}

/**
 * One page of receipts (header): newest first, at most `limit`, each with its claim. A row that fails its strict read
 * is skipped (logged by id, `ledger.row_invalid`) and still counts toward the page, so the page after it starts where
 * this one ended.
 */
export async function receiptPage(db: LedgerDb, query: ReceiptQuery): Promise<ReceiptPage> {
  assertLimit(query.limit);
  return db.transaction('r', [db.receipts, db.claims], async () => {
    const reads = prefixesOf(query).map((prefix) => newestUnder(db, prefix, query, query.limit + 1));
    const lists = await Promise.all(reads);
    const ranked = lists.flat().sort(newestFirst);
    const shown = ranked.slice(0, query.limit);
    const last = shown.at(-1);
    const next =
      ranked.length > query.limit && last !== undefined ? { computedMs: last.computedMs, id: last.id } : null;
    const receipts = readRows('receipts', Receipt, shown);
    const claims = await claimsOf(db, receipts);
    const items = receipts.map((receipt) => ({
      receipt,
      claim: receipt.claimId === undefined ? undefined : claims.get(receipt.claimId),
    }));
    return { items, next };
  });
}

/** A receipt and everything that explains it, as stored: never recomputed. */
export interface ReceiptDetail {
  readonly receipt: Receipt;
  readonly claim: Claim | undefined;
  readonly request: Request | undefined;
  /** The evidence the receipt names, in its order; one the purge removed is missing. */
  readonly observations: readonly Observation[];
  /** What grading saw (the batch's coverage, the grant, the context, the policy's hash), when the ledger holds it. */
  readonly inputs: ReceiptInputs | undefined;
}

/** One receipt's detail (header), or undefined when the ledger holds no such receipt. */
export async function receiptDetail(db: LedgerDb, id: string): Promise<ReceiptDetail | undefined> {
  const tables = [db.receipts, db.claims, db.requests, db.observations, db.receiptInputs, db.batchCoverages];
  return db.transaction('r', tables, async () => {
    const receipt = await getReceipt(db, id);
    if (receipt === undefined) return undefined;
    const evidence = await db.observations.bulkGet([...receipt.observationIds]);
    return {
      receipt,
      claim: receipt.claimId === undefined ? undefined : await getClaim(db, receipt.claimId),
      request: receipt.requestId === undefined ? undefined : await getRequest(db, receipt.requestId),
      observations: readRows('observations', Observation, evidence),
      inputs: await receiptInputsOf(db, receipt.inputsHash),
    };
  });
}

/** The latest coverage ping of every observer and account: by observer, then the latest sync first, then account. */
export async function latestCoverage(db: LedgerDb): Promise<CoveragePing[]> {
  const pings = readRows('coverage', CoveragePing, await db.coverage.toArray());
  return pings.sort(
    (a, b) =>
      compareText(a.observerId, b.observerId) ||
      epochMs(b.lastSyncAt) - epochMs(a.lastSyncAt) ||
      compareText(a.accountHash ?? '', b.accountHash ?? ''),
  );
}

/** Each agent's last pasted import, when it has one: the instant the service worker stored it. */
export async function lastImports(db: LedgerDb): Promise<Partial<Record<AgentId, IsoTs>>> {
  const out: Partial<Record<AgentId, IsoTs>> = {};
  for (const agent of AgentId.options) {
    const at = IsoTs.safeParse(await getMeta(db, lastImportKey(agent)));
    if (at.success) out[agent] = at.data;
  }
  return out;
}

/** The coverage summary (the popup's header, sprint_4 4.2): what each observer last saw, and each agent's last import. */
export interface CoverageSummary {
  readonly coverage: readonly CoveragePing[];
  readonly imports: Partial<Record<AgentId, IsoTs>>;
}

/** The coverage summary in one read transaction. */
export async function coverageSummary(db: LedgerDb): Promise<CoverageSummary> {
  return db.transaction('r', [db.coverage, db.meta], async () => ({
    coverage: await latestCoverage(db),
    imports: await lastImports(db),
  }));
}

/** What the popup shows (sprint_4 4.2), read at one instant of the ledger. */
export interface PopupView {
  /** Today's receipts: the newest graded in the range asked. */
  readonly today: ReceiptPage;
  readonly coverage: CoverageSummary;
  readonly health: readonly AdapterHealth[];
  /**
   * The last grading batch's instant in epoch ms, or null before the first. A PENDING receipt graded before it is
   * one the batches no longer regrade (a claim-less receipt holding reverted overrides, docs/grading.md §7, §8).
   */
  readonly lastBatchMs: number | null;
}

/** The popup's reads (header) in one read transaction, so every part is of the same instant of the ledger. */
export async function popupView(db: LedgerDb, query: ReceiptQuery): Promise<PopupView> {
  assertLimit(query.limit);
  const tables = [db.receipts, db.claims, db.coverage, db.adapterHealth, db.meta];
  return db.transaction('r', tables, async () => ({
    today: await receiptPage(db, query),
    coverage: await coverageSummary(db),
    health: await listAdapterHealth(db),
    lastBatchMs: (await lastBatchMs(db)) ?? null,
  }));
}
