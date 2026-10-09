import 'fake-indexeddb/auto';
/**
 * The UI's ledger reads (sprint_4 4.0; src/ledger/views.ts): receipts newest first across agents, filtered by agent,
 * grade and grading instant, a page at a time with none lost or shown twice, each joined with its claim; a receipt's
 * detail joined with its claim, request, evidence and grading inputs; the coverage summary; and the popup's reads in
 * one transaction. Every read goes through an index or a key: a recorder between Dexie and IndexedDB fails a test on
 * a read of a whole table other than the small ones (one row per observer and account, adapter or agent), and counts
 * the rows a page reads.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { recordBatchInstant } from '../../../src/ledger/batch-instant';
import type { LedgerDb } from '../../../src/ledger/db';
import { toReceiptRow } from '../../../src/ledger/index-fields';
import { lastImportKey } from '../../../src/ledger/meta-keys';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceiptInputs } from '../../../src/ledger/replay-records';
import {
  putAdapterHealth,
  putCoveragePing,
  putReceipt,
  putRequest,
  setMeta,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import {
  type AgentId,
  Coverage,
  type Grade,
  Grant,
  Receipt,
  type ReceiptInput,
} from '../../../src/ledger/types';
import {
  coverageSummary,
  popupView,
  type ReceiptPage,
  receiptDetail,
  receiptPage,
  type ReceiptQuery,
} from '../../../src/ledger/views';
import {
  captureLogs,
  claimId,
  expectLedgerError,
  makeClaim,
  makeGrant,
  makeHealth,
  makeObservation,
  makePing,
  makeReceipt,
  makeRequest,
  observationId,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';
import { fullScans, recordReads, resetRecorder } from './read-recorder';

const T0 = Date.parse('2026-10-01T12:00:00Z');
const MINUTE = 60_000;
const ms = (minutes: number): number => T0 + minutes * MINUTE;
const at = (minutes: number): string => new Date(ms(minutes)).toISOString();
const EVERY: readonly AgentId[] = ['muse', 'chatgpt', 'dots', 'claude'];
const SECRET = 'SSN 078-05-1120';

/** Receipt `n` of `agent`, graded `minutes` after T0, naming the claim `claimId(n)` (none when UNASKED). */
function receipt(n: number, agent: AgentId, minutes: number, grade: Grade = 'VERIFIED'): ReceiptInput {
  const base = makeReceipt({
    id: ulid(n),
    agent,
    claimId: claimId(n),
    grade,
    inputsHash: sha(n),
    computedAt: at(minutes),
  });
  return grade === 'UNASKED' ? { ...omit(base, 'claimId'), attribution: 'likely' } : base;
}

const query = (overrides: Partial<ReceiptQuery> = {}): ReceiptQuery => ({
  agents: EVERY,
  fromMs: ms(-24 * 60),
  toMs: ms(24 * 60),
  limit: 10,
  ...overrides,
});

const ids = (page: ReceiptPage): string[] => page.items.map(({ receipt: { id } }) => id);

/** Every page of `asked`, in order, as the ids each showed. */
async function allPages(db: LedgerDb, asked: ReceiptQuery): Promise<string[][]> {
  const pages: string[][] = [];
  let page = await receiptPage(db, asked);
  pages.push(ids(page));
  while (page.next !== null) {
    page = await receiptPage(db, { ...asked, after: page.next });
    pages.push(ids(page));
  }
  return pages;
}

const inputs = () => ({
  coverage: Coverage.parse({ evaluatedAt: at(10), observers: [] }),
  grant: Grant.parse(makeGrant()),
  context: { priorSpendCents: 0 },
  policyHash: DEFAULT_POLICY.policyHash,
});

let db: LedgerDb;

async function store(receipts: readonly ReceiptInput[]): Promise<void> {
  for (const row of receipts) await putReceipt(db, row);
}

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('views'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('receiptPage: order, filters and pages', () => {
  it('lists the receipts of a range newest first across agents, a tie broken by the greater id', async () => {
    await store([
      receipt(1, 'muse', 10),
      receipt(2, 'claude', 20),
      receipt(3, 'muse', 20),
      receipt(4, 'dots', 5),
    ]);
    const page = await receiptPage(db, query());
    expect(ids(page)).toEqual([ulid(3), ulid(2), ulid(1), ulid(4)]);
    expect(page.next).toBeNull();
  });

  it('keeps only the agents, grades and instants asked, both ends of the range included', async () => {
    await store([
      receipt(1, 'muse', 5),
      receipt(2, 'muse', 10, 'NOT_FOUND'),
      receipt(3, 'claude', 15, 'NOT_FOUND'),
      receipt(4, 'muse', 20),
      receipt(5, 'muse', 25, 'NOT_FOUND'),
    ]);
    expect(ids(await receiptPage(db, query({ fromMs: ms(10), toMs: ms(20) })))).toEqual([
      ulid(4),
      ulid(3),
      ulid(2),
    ]);
    expect(ids(await receiptPage(db, query({ agents: ['muse'], grades: ['NOT_FOUND'] })))).toEqual([
      ulid(5),
      ulid(2),
    ]);
    expect(ids(await receiptPage(db, query({ agents: ['muse', 'muse'], toMs: ms(5) })))).toEqual([ulid(1)]);
    expect(ids(await receiptPage(db, query({ grades: [] })))).toEqual([]);
    expect(ids(await receiptPage(db, query({ agents: [] })))).toEqual([]);
    expect(ids(await receiptPage(db, query({ fromMs: ms(20), toMs: ms(10) })))).toEqual([]);
  });

  it('pages through a range with no receipt lost or shown twice, a page boundary inside one batch instant', async () => {
    // Seven receipts graded by one batch, so at one instant, across two agents; and three others.
    const batch = [1, 2, 3, 4, 5, 6, 7].map((n) => receipt(n, n % 2 === 0 ? 'claude' : 'muse', 30));
    await store([
      ...batch,
      receipt(8, 'muse', 40),
      receipt(9, 'dots', 20, 'NOT_FOUND'),
      receipt(10, 'claude', 10),
    ]);
    const everything = [8, 7, 6, 5, 4, 3, 2, 1, 9, 10].map(ulid);
    expect(ids(await receiptPage(db, query({ limit: 100 })))).toEqual(everything);
    for (const limit of [1, 2, 3, 4, 9, 10, 11]) {
      const pages = await allPages(db, query({ limit }));
      expect(pages.flat(), `limit ${String(limit)}`).toEqual(everything);
      expect(pages, `limit ${String(limit)}`).toHaveLength(Math.max(1, Math.ceil(everything.length / limit)));
    }
    const kept = everything.filter((id) => id !== ulid(9));
    expect((await allPages(db, query({ limit: 3, grades: ['VERIFIED'] }))).flat()).toEqual(kept);
  });
});

describe('receiptPage: joins and refusals', () => {
  it('joins each receipt with its claim; an UNASKED receipt, or one whose claim is gone, has none', async () => {
    await upsertClaim(db, makeClaim({ rawHash: sha(1) }));
    await store([receipt(1, 'muse', 10), receipt(2, 'muse', 20, 'UNASKED'), receipt(3, 'muse', 30)]);
    const page = await receiptPage(db, query());
    expect(page.items.map(({ claim }) => claim?.id ?? null)).toEqual([null, null, claimId(1)]);
    expect(page.items.map(({ receipt: { grade } }) => grade)).toEqual(['VERIFIED', 'UNASKED', 'VERIFIED']);
  });

  it('skips a row that fails its strict read, logged by id only, and the next page starts after it', async () => {
    await store([receipt(1, 'muse', 10), receipt(3, 'muse', 30)]);
    const corrupt = { ...toReceiptRow(Receipt.parse(receipt(2, 'muse', 20))), body: SECRET };
    await db.receipts.put(corrupt);
    const logs = captureLogs();
    try {
      const first = await receiptPage(db, query({ limit: 2 }));
      expect(ids(first)).toEqual([ulid(3)]);
      expect(first.next).toEqual({ computedMs: ms(20), id: ulid(2) });
      const second = await receiptPage(db, query({ limit: 2, after: { computedMs: ms(20), id: ulid(2) } }));
      expect(ids(second)).toEqual([ulid(1)]);
      expect(second.next).toBeNull();
      const invalid = logs.records.filter(({ event }) => event === 'ledger.row_invalid');
      expect(invalid.map(({ fields }) => fields)).toEqual([{ table: 'receipts', id: ulid(2), issues: 1 }]);
      expect(JSON.stringify(logs.records)).not.toContain(SECRET);
    } finally {
      logs.restore();
    }
  });

  it('refuses a page of no receipts, or of part of one', async () => {
    await expectLedgerError(receiptPage(db, query({ limit: 0 })), 'invalid_input');
    await expectLedgerError(receiptPage(db, query({ limit: 1.5 })), 'invalid_input');
    await expectLedgerError(popupView(db, query({ limit: -1 })), 'invalid_input');
  });
});

describe('receiptDetail', () => {
  it("joins the receipt's claim, request, evidence in the receipt's order and grading inputs", async () => {
    await upsertObservation(db, makeObservation({ rowKeyHash: sha(1) }), DEFAULT_POLICY);
    await upsertObservation(db, makeObservation({ rowKeyHash: sha(2) }), DEFAULT_POLICY);
    await upsertClaim(db, makeClaim({ rawHash: sha(1) }));
    await putRequest(db, makeRequest());
    // The third piece of evidence is gone (the retention purge): the detail lists the two the ledger holds.
    const evidence = [observationId(2), observationId(1), observationId(3)];
    await store([{ ...receipt(1, 'muse', 10), observationIds: evidence }]);
    await putReceiptInputs(db, new Map([[sha(1), inputs()]]));
    const detail = await receiptDetail(db, ulid(1));
    expect(detail?.receipt).toEqual(Receipt.parse({ ...receipt(1, 'muse', 10), observationIds: evidence }));
    expect(detail?.claim?.id).toBe(claimId(1));
    expect(detail?.request?.id).toBe(ulid(201));
    expect(detail?.observations.map(({ id }) => id)).toEqual([observationId(2), observationId(1)]);
    expect(detail?.inputs).toEqual(inputs());
  });

  it('gives undefined for an unknown receipt, and no claim, request or inputs where the ledger holds none', async () => {
    await store([{ ...omit(receipt(2, 'claude', 20, 'UNASKED'), 'requestId'), observationIds: [] }]);
    expect(await receiptDetail(db, ulid(99))).toBeUndefined();
    const detail = await receiptDetail(db, ulid(2));
    expect(detail).toMatchObject({
      claim: undefined,
      request: undefined,
      observations: [],
      inputs: undefined,
    });
  });
});

describe('coverageSummary and popupView', () => {
  it("lists the coverage by observer, the latest sync first, and each agent's last import that reads as an instant", async () => {
    await putCoveragePing(db, makePing({ accountHash: sha(900), lastSyncAt: '2026-10-01T10:00:00Z' }));
    await putCoveragePing(db, makePing({ accountHash: sha(901), lastSyncAt: '2026-10-01T11:00:00Z' }));
    await putCoveragePing(db, makePing({ observerId: 'gcal', source: 'gcal.event', allCalendars: true }));
    await setMeta(db, lastImportKey('muse'), '2026-10-01T09:00:00-04:00');
    await setMeta(db, lastImportKey('claude'), 'not an instant');
    const summary = await coverageSummary(db);
    expect(summary.coverage.map(({ observerId, accountHash }) => [observerId, accountHash])).toEqual([
      ['gcal', sha(900)],
      ['gmail', sha(901)],
      ['gmail', sha(900)],
    ]);
    expect(summary.imports).toEqual({ muse: '2026-10-01T09:00:00-04:00' });
  });

  it("reads today's page, the coverage summary, the health reports and the last batch instant together", async () => {
    await store([receipt(1, 'muse', 10), receipt(2, 'claude', 20), receipt(3, 'muse', -30)]);
    await putAdapterHealth(db, makeHealth());
    const before = await popupView(db, query({ fromMs: ms(0) }));
    expect(before.lastBatchMs).toBeNull();
    await recordBatchInstant(db, at(30));
    const view = await popupView(db, query({ fromMs: ms(0) }));
    expect(ids(view.today)).toEqual([ulid(2), ulid(1)]);
    expect(view.health.map(({ adapterId }) => adapterId)).toEqual(['muse']);
    expect(view.coverage).toEqual(await coverageSummary(db));
    expect(view.lastBatchMs).toBe(ms(30));
  });
});

/** A ledger of 61 receipts (60 VERIFIED of two agents, an UNASKED of a third) and one of each thing they name. */
async function seed(): Promise<void> {
  await upsertObservation(db, makeObservation({ rowKeyHash: sha(1) }), DEFAULT_POLICY);
  await upsertClaim(db, makeClaim({ rawHash: sha(1) }));
  await putRequest(db, makeRequest());
  await putReceiptInputs(db, new Map([[sha(1), inputs()]]));
  await putCoveragePing(db, makePing());
  await putAdapterHealth(db, makeHealth());
  await setMeta(db, lastImportKey('muse'), '2026-10-01T09:00:00-04:00');
  const many = Array.from({ length: 60 }, (_, i) => receipt(i + 1, i % 2 === 0 ? 'muse' : 'claude', i));
  await store([...many, receipt(61, 'dots', 70, 'UNASKED')]);
}

describe('every view reads through an index or by key', () => {
  it('never scans a growing table, and reads receipts only through their two page indexes', async () => {
    await seed();
    const recorder = await recordReads(db);
    const first = await receiptPage(db, query({ limit: 5, grades: ['VERIFIED', 'UNASKED'] }));
    expect(first.next).not.toBeNull();
    if (first.next !== null) await receiptPage(db, query({ limit: 5, after: first.next }));
    await receiptDetail(db, ulid(1));
    await popupView(db, query());
    await coverageSummary(db);
    expect(fullScans(recorder.reads)).toEqual([]);
    const ranged = recorder.reads.filter(
      ({ table, op }) => table === 'receipts' && op !== 'get' && op !== 'getMany',
    );
    expect(ranged.length).toBeGreaterThan(0);
    expect(new Set(ranged.map(({ index }) => index))).toEqual(
      new Set(['[agent+computedMs]', '[agent+grade+computedMs]']),
    );
    // The small tables are read whole, by design: the recorder sees it and allows it.
    expect(recorder.reads.some(({ table, whole }) => table === 'coverage' && whole)).toBe(true);
  });

  it('catches a full scan: the recorder fails a whole-table read (negative control)', async () => {
    await seed();
    const recorder = await recordReads(db);
    await db.receipts.toArray();
    await db.claims.filter(() => true).first();
    expect(fullScans(recorder.reads).map(({ table }) => table)).toEqual(['receipts', 'claims']);
    expect(recorder.rows.get('receipts')).toBe(61);
  });
});

describe('a page reads a bounded number of rows', () => {
  it('reads at most limit + 1 receipts of each agent for a page, however many the range holds', async () => {
    await seed();
    const recorder = await recordReads(db);
    const page = await receiptPage(db, query({ limit: 5 }));
    expect(page.items).toHaveLength(5);
    expect(recorder.rows.get('receipts')).toBe(2 * 6 + 1);
    resetRecorder(recorder);
    await popupView(db, query({ limit: 5 }));
    expect(recorder.rows.get('receipts')).toBe(2 * 6 + 1);
    // The page's claims are read by key, all at once: only the newest five receipts' (none is stored but the first's).
    expect(recorder.reads.filter(({ table }) => table === 'claims').map(({ op }) => op)).toEqual(['getMany']);
    expect(recorder.rows.get('claims') ?? 0).toBe(0);
  });

  it('reads only the receipts of the grades a filter asks, however many others the range holds', async () => {
    await seed();
    const recorder = await recordReads(db);
    const unasked = await receiptPage(db, query({ limit: 5, grades: ['UNASKED'] }));
    expect(ids(unasked)).toEqual([ulid(61)]);
    expect(recorder.rows.get('receipts')).toBe(1);
    resetRecorder(recorder);
    expect(ids(await receiptPage(db, query({ limit: 5, grades: ['NOT_FOUND', 'OVER_SCOPE'] })))).toEqual([]);
    expect(recorder.rows.get('receipts') ?? 0).toBe(0);
    // Four agents and two grades: eight reads, one per agent and grade.
    expect(recorder.reads.filter(({ table }) => table === 'receipts')).toHaveLength(8);
  });
});
