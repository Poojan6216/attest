import 'fake-indexeddb/auto';
/**
 * The ledger the UI read gates measure (sprint_4 4.0 done-when: "popup query on a seeded ledger of 5,000 receipts
 * returns in < 50 ms"): tests/perf/ui-reads.perf.spec.ts gates on it and bench/ui.ts records it in RESULTS.md, from
 * this one builder. Deterministic, built as stored rows (the repo's own row builders), in fake-indexeddb.
 *
 *  - The 5,000 receipts and 4,500 claims of ./ui-rows.ts, PENDING, the newest at NOW: 41 h 40 min of grading, so the
 *    popup's day (the 15 hours before NOW here, a zone-free stand-in for "since local midnight") holds 1,800 of them,
 *    ten tied at each instant.
 *  - The receipts' evidence (one observation), the claims' request, the receipts' replay inputs and the batch's
 *    coverage.
 *  - The small tables as a person with two Gmail accounts and a calendar has them: three coverage pings, four health
 *    reports, two agents' last imports, and the last batch instant.
 */
import { Dexie } from 'dexie';

import { DEFAULT_POLICY } from '../../src/core/policy';
import { recordBatchInstant } from '../../src/ledger/batch-instant';
import type { LedgerDb } from '../../src/ledger/db';
import { lastImportKey } from '../../src/ledger/meta-keys';
import { openLedger } from '../../src/ledger/migrations';
import { putReceiptInputs } from '../../src/ledger/replay-records';
import { putAdapterHealth, putCoveragePing, putRequest, setMeta } from '../../src/ledger/repo';
import { Coverage, Grant } from '../../src/ledger/types';
import type { ReceiptQuery } from '../../src/ledger/views';
import { POPUP_RECEIPT_LIMIT, TIMELINE_PAGE_SIZE } from '../../src/config';
import { UI_AGENTS, UI_RECEIPTS, UI_REQUEST_ID, uiReceiptId, uiRows, uiSha } from './ui-rows';

export { UI_RECEIPTS } from './ui-rows';

// Dexie reads `indexedDB` once, when it loads: point it at the fake one whichever module loaded Dexie first (`pnpm
// bench` loads benches that import the ledger before this one).
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const DAY = 24 * HOUR;
export const UI_NOW = Date.parse('2026-10-09T18:00:00Z');

/** Writes the receipts and their claims as stored rows, in one transaction. */
async function writeReceipts(db: LedgerDb): Promise<void> {
  const { receipts, claims } = uiRows(UI_NOW, 'PENDING');
  await db.transaction('rw', [db.receipts, db.claims], async () => {
    await db.receipts.bulkPut(receipts);
    await db.claims.bulkPut(claims);
  });
}

/** The request every claim names, and the replay inputs every receipt names (header). */
async function writeRecords(db: LedgerDb): Promise<void> {
  await putRequest(db, {
    id: UI_REQUEST_ID,
    agent: 'muse',
    conversationId: 'conv-1',
    textHint: 'Email Alice the quarterly numbers',
    textHash: uiSha(9_000_003),
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
  await putReceiptInputs(db, new Map([[uiSha(1), inputs]]));
}

/** The small tables: coverage, health, the last imports and the last batch instant (header). */
async function writeSmallTables(db: LedgerDb): Promise<void> {
  const sent = { observerId: 'gmail', source: 'gmail.sent', userActive: true } as const;
  await putCoveragePing(db, {
    ...sent,
    accountHash: uiSha(901),
    lastSyncAt: iso(UI_NOW),
    windowStart: iso(UI_NOW - HOUR),
    windowEnd: iso(UI_NOW),
  });
  await putCoveragePing(db, {
    ...sent,
    accountHash: uiSha(902),
    lastSyncAt: iso(UI_NOW - HOUR),
    windowStart: iso(UI_NOW - 2 * HOUR),
    windowEnd: iso(UI_NOW - HOUR),
  });
  await putCoveragePing(db, {
    observerId: 'gcal',
    source: 'gcal.event',
    accountHash: uiSha(901),
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
  agents: UI_AGENTS,
  fromMs: UI_NOW - 15 * HOUR,
  toMs: Infinity,
  limit: POPUP_RECEIPT_LIMIT,
};

/** The side panel's first timeline page over the last 60 days, every agent and grade. */
export const TIMELINE_QUERY: ReceiptQuery = {
  agents: UI_AGENTS,
  fromMs: UI_NOW - 60 * DAY,
  toMs: UI_NOW,
  limit: TIMELINE_PAGE_SIZE,
};

/** The same page filtered to the two rarest problem grades. */
export const FILTERED_QUERY: ReceiptQuery = { ...TIMELINE_QUERY, grades: ['NOT_FOUND', 'OVER_SCOPE'] };

/** A receipt from the middle of the ledger, for the detail read. */
export const DETAIL_ID = uiReceiptId(UI_RECEIPTS / 2);
