import 'fake-indexeddb/auto';
/**
 * The ledger the UI read gates measure (sprint_4 4.0 done-when: "popup query on a seeded ledger of 5,000 receipts
 * returns in < 50 ms"): tests/perf/ui-reads.perf.spec.ts gates on it and bench/ui.ts records it in RESULTS.md, from
 * this one builder. Deterministic, built as stored rows (the repo's own row builders), in fake-indexeddb.
 *
 *  - 5,000 receipts of the four agents, graded by batches five minutes apart, ten at each batch instant, the newest at
 *    NOW: 41 h 40 min of grading, so the popup's day (the 15 hours before NOW here, a zone-free stand-in for "since
 *    local midnight") holds 1,800 of them, ten tied at each instant. Grades: 70% VERIFIED, 10% NOT_FOUND, 10% UNASKED
 *    (no claim), 4% UNVERIFIABLE, 4% PARTIAL, 2% OVER_SCOPE.
 *  - A claim for every receipt that names one (4,500), the receipt's evidence (one observation), its request, its
 *    replay inputs and the batch's coverage.
 *  - The small tables as a person with two Gmail accounts and a calendar has them: three coverage pings, four health
 *    reports, two agents' last imports, and the last batch instant.
 */
import { Dexie } from 'dexie';

import { idFromHash } from '../../src/core/hash';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { recordBatchInstant } from '../../src/ledger/batch-instant';
import type { LedgerDb } from '../../src/ledger/db';
import { type ClaimRow, type ReceiptRow, toClaimRow, toReceiptRow } from '../../src/ledger/index-fields';
import { lastImportKey } from '../../src/ledger/meta-keys';
import { openLedger } from '../../src/ledger/migrations';
import { putReceiptInputs } from '../../src/ledger/replay-records';
import { putAdapterHealth, putCoveragePing, putRequest, setMeta } from '../../src/ledger/repo';
import { type AgentId, Claim, Coverage, type Grade, Grant, Receipt } from '../../src/ledger/types';
import type { ReceiptQuery } from '../../src/ledger/views';
import { POPUP_RECEIPT_LIMIT, TIMELINE_PAGE_SIZE } from '../../src/config';

// Dexie reads `indexedDB` once, when it loads: point it at the fake one whichever module loaded Dexie first (`pnpm
// bench` loads benches that import the ledger before this one).
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

export const UI_RECEIPTS = 5_000;
const PER_BATCH = 10;
const BATCH_MS = 5 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const UI_NOW = Date.parse('2026-10-09T18:00:00Z');
const AGENTS: readonly AgentId[] = ['muse', 'chatgpt', 'dots', 'claude'];

/** The grade of receipt `i`, cycling through a mix of 50: 35 VERIFIED, 5 NOT_FOUND, 5 UNASKED, 2, 2 and 1 others. */
function gradeOf(i: number): Grade {
  const slot = i % 50;
  if (slot < 35) return 'VERIFIED';
  if (slot < 40) return 'NOT_FOUND';
  if (slot < 45) return 'UNASKED';
  if (slot < 47) return 'UNVERIFIABLE';
  if (slot < 49) return 'PARTIAL';
  return 'OVER_SCOPE';
}

const sha = (n: number): string => n.toString(16).padStart(32, '0').repeat(2);
const ulid = (n: number): string => `01JA${String(n).padStart(22, '0')}`;
const iso = (ms: number): string => new Date(ms).toISOString();
const REQUEST_ID = ulid(9_000_001);
const OBSERVATION_ID = idFromHash(sha(9_000_002));

/** The id of receipt `i` (0 the newest). */
export const uiReceiptId = (i: number): string => ulid(i + 1);

function claimOf(i: number, agent: AgentId, gradedMs: number) {
  const rawHash = sha(i + 1);
  return Claim.parse({
    id: idFromHash(rawHash),
    agent,
    requestId: REQUEST_ID,
    type: 'email.sent',
    counterparty: 'alice@example.com',
    subjectHint: 'Quarterly numbers',
    claimedAt: iso(gradedMs - 10 * 60_000),
    claimedAtPrecision: 'minute',
    observedAt: iso(gradedMs - 5 * 60_000),
    sourceKind: 'activity_view',
    extractor: { id: `import.${agent}`, version: '1.1.0', confidence: 0.9 },
    rawHash,
  });
}

function receiptOf(i: number, agent: AgentId, gradedMs: number) {
  const grade = gradeOf(i);
  const common = {
    id: uiReceiptId(i),
    agent,
    observationIds: [OBSERVATION_ID],
    grade,
    confidence: 0.92,
    ruleId: 'verified',
    reasons: [{ code: 'match.best', params: { observationId: OBSERVATION_ID } }],
    signals: { timeProximity: 0.9, counterpartyExact: 1 },
    state: 'PENDING',
    policyHash: DEFAULT_POLICY.policyHash,
    inputsHash: sha(1),
    computedAt: iso(gradedMs),
  };
  return Receipt.parse(
    grade === 'UNASKED'
      ? { ...common, attribution: 'likely' }
      : { ...common, claimId: idFromHash(sha(i + 1)), requestId: REQUEST_ID },
  );
}

/** Writes the receipts and their claims as stored rows, in one transaction. */
async function writeReceipts(db: LedgerDb): Promise<void> {
  const receipts: ReceiptRow[] = [];
  const claims: ClaimRow[] = [];
  for (let i = 0; i < UI_RECEIPTS; i += 1) {
    const agent = AGENTS[i % AGENTS.length] ?? 'muse';
    const gradedMs = UI_NOW - Math.floor(i / PER_BATCH) * BATCH_MS;
    receipts.push(toReceiptRow(receiptOf(i, agent, gradedMs)));
    if (gradeOf(i) !== 'UNASKED') claims.push(toClaimRow(claimOf(i, agent, gradedMs)));
  }
  await db.transaction('rw', [db.receipts, db.claims], async () => {
    await db.receipts.bulkPut(receipts);
    await db.claims.bulkPut(claims);
  });
}

/** The request every claim names, and the replay inputs every receipt names (header). */
async function writeRecords(db: LedgerDb): Promise<void> {
  await putRequest(db, {
    id: REQUEST_ID,
    agent: 'muse',
    conversationId: 'conv-1',
    textHint: 'Email Alice the quarterly numbers',
    textHash: sha(9_000_003),
    ts: iso(UI_NOW - DAY),
  });
  const grant = Grant.parse({
    agent: 'muse',
    allowedTypes: ['email.sent'],
    counterpartyAllowlist: ['example.com'],
    spendCeilingCents: null,
    declaredScopes: [],
    updatedAt: iso(UI_NOW - 2 * DAY),
  });
  const coverage = Coverage.parse({ evaluatedAt: iso(UI_NOW), observers: [] });
  const inputs = { coverage, grant, context: { priorSpendCents: 0 }, policyHash: DEFAULT_POLICY.policyHash };
  await putReceiptInputs(db, new Map([[sha(1), inputs]]));
}

/** The small tables: coverage, health, the last imports and the last batch instant (header). */
async function writeSmallTables(db: LedgerDb): Promise<void> {
  const sent = { observerId: 'gmail', source: 'gmail.sent', userActive: true } as const;
  await putCoveragePing(db, {
    ...sent,
    accountHash: sha(901),
    lastSyncAt: iso(UI_NOW),
    windowStart: iso(UI_NOW - HOUR),
    windowEnd: iso(UI_NOW),
  });
  await putCoveragePing(db, {
    ...sent,
    accountHash: sha(902),
    lastSyncAt: iso(UI_NOW - HOUR),
    windowStart: iso(UI_NOW - 2 * HOUR),
    windowEnd: iso(UI_NOW - HOUR),
  });
  await putCoveragePing(db, {
    observerId: 'gcal',
    source: 'gcal.event',
    accountHash: sha(901),
    allCalendars: true,
    userActive: false,
    lastSyncAt: iso(UI_NOW - 2 * HOUR),
    windowStart: iso(UI_NOW - 3 * DAY),
    windowEnd: iso(UI_NOW + 4 * DAY),
  });
  for (const adapterId of ['gmail', 'gmail.receipts', 'gcal', 'paste']) {
    await putAdapterHealth(db, {
      adapterId,
      version: '1.0.0',
      status: 'OK',
      reasons: [],
      checkedAt: iso(UI_NOW),
    });
  }
  await setMeta(db, lastImportKey('muse'), iso(UI_NOW - HOUR));
  await setMeta(db, lastImportKey('claude'), iso(UI_NOW - 3 * HOUR));
  await recordBatchInstant(db, iso(UI_NOW));
}

/** Opens a new ledger named `name` and writes the workload into it (header). */
export async function buildUiLedger(name: string): Promise<LedgerDb> {
  const db = await openLedger(name);
  await writeReceipts(db);
  await writeRecords(db);
  await writeSmallTables(db);
  return db;
}

/** The popup's query: today's newest receipts, today being the 15 hours before NOW. */
export const POPUP_QUERY: ReceiptQuery = {
  agents: AGENTS,
  fromMs: UI_NOW - 15 * HOUR,
  toMs: Infinity,
  limit: POPUP_RECEIPT_LIMIT,
};

/** The side panel's first timeline page over the last 60 days, every agent and grade. */
export const TIMELINE_QUERY: ReceiptQuery = {
  agents: AGENTS,
  fromMs: UI_NOW - 60 * DAY,
  toMs: UI_NOW,
  limit: TIMELINE_PAGE_SIZE,
};

/** The same page filtered to the two rarest problem grades. */
export const FILTERED_QUERY: ReceiptQuery = { ...TIMELINE_QUERY, grades: ['NOT_FOUND', 'OVER_SCOPE'] };

/** A receipt from the middle of the ledger, for the detail read. */
export const DETAIL_ID = uiReceiptId(UI_RECEIPTS / 2);
