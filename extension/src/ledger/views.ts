/**
 * The ledger reads the UI shows (sprint_4 4.0; src/ui/data.ts calls them for the pages). Each reads through an index or
 * by key, never a whole unbounded table (tests/unit/ledger/views.spec.ts fails on a full scan), and computes nothing
 * beyond joins and sorting: the UI is a view of the ledger (sprint_4 header).
 *
 *  - `receiptPage`: the receipts graded in a range of instants, newest first (`computedAt`, then id), of the agents and
 *    grades asked, `limit` at a time, each with its claim (or, with none, the observation it is about). One read per agent through `[agent+computedMs]` (per agent
 *    and grade through `[agent+grade+computedMs]` when grades are asked), newest first, stops at `limit + 1` receipts,
 *    so a page reads as many rows however many the range holds; the next page resumes after the last receipt shown.
 *    The popup's range starts at local midnight; the timeline's spans its days. A grade is the computed one: an
 *    overridden receipt is found under the grade Attest gave it, and shows the override beside it.
 *  - `coverageSummary`: the latest coverage ping of each observer and account, and each agent's last import.
 *  - `popupView`: the popup's reads in one transaction: today's page, the coverage summary, the health reports and the
 *    last batch instant.
 *  - The small tables, read whole: the latest coverage ping of each observer and account, the health reports and the
 *    grants (one row per observer and account, adapter, agent). The last imports are meta rows read by key.
 * A receipt's detail is ./detail.ts. Neither imports the repo's writers: the popup loads this module at its start, and
 * must paint in under 100 ms (sprint_4 4.2).
 */
import { compareText } from '../core/order';
import { type AutoCheckRecord, readAutoCheck } from './auto-check-record';
import { lastBatchMs } from './batch-instant';
import { readRow, readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { alertsMutedKey, lastImportKey } from './agent-keys';
import { epochMs, type ReceiptRow } from './index-fields';
import {
  AdapterHealth,
  AgentId,
  Claim,
  CoveragePing,
  type Grade,
  Grant,
  IsoTs,
  MetaEntry,
  Observation,
  Receipt,
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

/**
 * A receipt as a list shows it: with its claim (none for UNASKED and scope receipts, or a claim the purge removed),
 * and for a receipt with no claim, the observation it is about (an UNASKED receipt's orphan; none for a scope
 * receipt, or one the purge removed).
 */
export interface ReceiptItem {
  readonly receipt: Receipt;
  readonly claim: Claim | undefined;
  readonly orphan: Observation | undefined;
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

/** The first observation of each receipt with no claim (an UNASKED receipt's orphan), by id, read by key. */
async function orphansOf(db: LedgerDb, receipts: readonly Receipt[]): Promise<Map<string, Observation>> {
  const ids = receipts.flatMap(({ claimId, observationIds: [first] }) =>
    claimId === undefined && first !== undefined ? [first] : [],
  );
  const rows = readRows('observations', Observation, await db.observations.bulkGet([...new Set(ids)]));
  return new Map(rows.map((observation) => [observation.id, observation]));
}

/**
 * One page of receipts (header): newest first, at most `limit`, each with its claim. A row that fails its strict read
 * is skipped (logged by id, `ledger.row_invalid`) and still counts toward the page, so the page after it starts where
 * this one ended.
 */
export async function receiptPage(db: LedgerDb, query: ReceiptQuery): Promise<ReceiptPage> {
  assertLimit(query.limit);
  return db.transaction('r', [db.receipts, db.claims, db.observations], async () => {
    const reads = prefixesOf(query).map((prefix) => newestUnder(db, prefix, query, query.limit + 1));
    const lists = await Promise.all(reads);
    const ranked = lists.flat().sort(newestFirst);
    const shown = ranked.slice(0, query.limit);
    const last = shown.at(-1);
    const next =
      ranked.length > query.limit && last !== undefined ? { computedMs: last.computedMs, id: last.id } : null;
    const receipts = readRows('receipts', Receipt, shown);
    const [claims, orphans] = await Promise.all([claimsOf(db, receipts), orphansOf(db, receipts)]);
    const items = receipts.map((receipt): ReceiptItem => {
      const [first] = receipt.observationIds;
      return {
        receipt,
        claim: receipt.claimId === undefined ? undefined : claims.get(receipt.claimId),
        orphan: receipt.claimId === undefined && first !== undefined ? orphans.get(first) : undefined,
      };
    });
    return { items, next };
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

/** Each agent's last pasted import, when it has one: the instant the service worker stored it. One read, by key. */
export async function lastImports(db: LedgerDb): Promise<Partial<Record<AgentId, IsoTs>>> {
  const rows = await db.meta.bulkGet(AgentId.options.map(lastImportKey));
  const out: Partial<Record<AgentId, IsoTs>> = {};
  AgentId.options.forEach((agent, at) => {
    const value = IsoTs.safeParse(readRow('meta', MetaEntry, rows[at])?.value);
    if (value.success) out[agent] = value.data;
  });
  return out;
}

/** The latest health report of every adapter and observer, by id (the primary key's order). */
export async function healthReports(db: LedgerDb): Promise<AdapterHealth[]> {
  return readRows('adapterHealth', AdapterHealth, await db.adapterHealth.toArray());
}

/** Every agent's grant, by agent (the primary key's order). */
export async function grantList(db: LedgerDb): Promise<Grant[]> {
  return readRows('grants', Grant, await db.grants.toArray());
}

/** The coverage summary (the popup's header, sprint_4 4.2): what each observer last saw, and each agent's last import. */
export interface CoverageSummary {
  readonly coverage: readonly CoveragePing[];
  readonly imports: Partial<Record<AgentId, IsoTs>>;
}

/** The coverage summary in one read transaction. */
export async function coverageSummary(db: LedgerDb): Promise<CoverageSummary> {
  return db.transaction('r', [db.coverage, db.meta], async () => {
    const [coverage, imports] = await Promise.all([latestCoverage(db), lastImports(db)]);
    return { coverage, imports };
  });
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
  /** The last time the Gmail auto-check opened Gmail (sprint_4 4.9; ./auto-check.ts), or null. */
  readonly autoCheck: AutoCheckRecord | null;
}

/** The popup's reads (header) in one read transaction, so every part is of the same instant of the ledger. */
export async function popupView(db: LedgerDb, query: ReceiptQuery): Promise<PopupView> {
  assertLimit(query.limit);
  const tables = [db.receipts, db.claims, db.observations, db.coverage, db.adapterHealth, db.meta];
  return db.transaction('r', tables, async () => {
    // Every read at once: each is a round trip to IndexedDB, and the popup has 100 ms (sprint_4 4.2).
    const [today, coverage, health, last, autoCheck] = await Promise.all([
      receiptPage(db, query),
      coverageSummary(db),
      healthReports(db),
      lastBatchMs(db),
      readAutoCheck(db),
    ]);
    return { today, coverage, health, lastBatchMs: last ?? null, autoCheck };
  });
}

/** What the side panel shows above its timeline (sprint_4 4.3), read at one instant of the ledger. */
export interface SidePanelOverview {
  readonly coverage: CoverageSummary;
  readonly health: readonly AdapterHealth[];
  /** As `PopupView.lastBatchMs`: a PENDING receipt graded before it is no longer regraded. */
  readonly lastBatchMs: number | null;
}

/** The side panel's overview in one read transaction. */
export async function sidePanelOverview(db: LedgerDb): Promise<SidePanelOverview> {
  return db.transaction('r', [db.coverage, db.adapterHealth, db.meta], async () => {
    const [coverage, health, last] = await Promise.all([
      coverageSummary(db),
      healthReports(db),
      lastBatchMs(db),
    ]);
    return { coverage, health, lastBatchMs: last ?? null };
  });
}

/** What the options page's Grants show (sprint_4 4.4): every agent's grant, and each agent whose alerts are muted. */
export interface GrantSettings {
  readonly grants: readonly Grant[];
  readonly muted: Partial<Record<AgentId, boolean>>;
}

/** The grant settings in one read transaction: the grants (one per agent), the mutes read by key. */
export async function grantSettings(db: LedgerDb): Promise<GrantSettings> {
  return db.transaction('r', [db.grants, db.meta], async () => {
    const [grants, rows] = await Promise.all([
      grantList(db),
      db.meta.bulkGet(AgentId.options.map(alertsMutedKey)),
    ]);
    const muted: Partial<Record<AgentId, boolean>> = {};
    AgentId.options.forEach((agent, at) => {
      if (readRow('meta', MetaEntry, rows[at])?.value === true) muted[agent] = true;
    });
    return { grants, muted };
  });
}
