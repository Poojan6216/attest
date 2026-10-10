/**
 * The 30-day ledger (sprint_6 6.4: "30-day synthetic ledger (5,000 claims, 50,000 observations): popup < 100 ms, grading
 * pass < 2 s, IndexedDB size < 50 MB"), built as the service worker builds one: 50,000 Gmail Sent rows over the 30 days
 * before `endMs` through `upsertObservation` (the store an observer pass goes through), each day's Sent window through
 * `recordCoverage`, 5,000 pasted claims through `upsertClaim` (half of them about a send that was made, half about one
 * that was not), and the grading batch an import runs (`runGradingBatch`): the receipts, their replay records and the
 * batch's coverage, exactly as stored. Every value is invented. Built in fake IndexedDB in Node; `monthLedgerRows` dumps
 * every table's stored rows, index fields and all, for tests/e2e/perf-ledger.spec.ts to write into Chrome's own
 * IndexedDB, where the size and the popup are measured.
 */
// First: Dexie reads `indexedDB` once, as it loads.
import 'fake-indexeddb/auto';

import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../src/core/policy';
import { IsoTs } from '../../src/core/schema';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../src/core/units';
import { ensureDefaultGrants } from '../../src/background/default-grants';
import { runGradingBatch } from '../../src/background/grading';
import { recordCoverage } from '../../src/ledger/coverage-store';
import { openLedger } from '../../src/ledger/migrations';
import { upsertClaim, upsertObservation } from '../../src/ledger/repo';
import { makeClaim, makeObservation, sha, uniqueDbName } from '../unit/ledger/fixtures';

export const MONTH_DAYS = 30;
export const MONTH_CLAIMS = 5_000;
export const MONTH_OBSERVATIONS = 50_000;
/** Rows written per transaction, as an observer pass's rows are (src/background/observer-messages.ts). */
const CHUNK = 500;

const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());

/** The instant of the `index`-th of `count` rows spread evenly over the month before `endMs`. */
const spread = (endMs: number, index: number, count: number): number =>
  endMs - MONTH_DAYS * MS_PER_DAY + Math.floor((index * MONTH_DAYS * MS_PER_DAY) / count);

async function writeObservations(db: Awaited<ReturnType<typeof openLedger>>, endMs: number): Promise<void> {
  for (let start = 0; start < MONTH_OBSERVATIONS; start += CHUNK) {
    await db.transaction('rw', db.tables, async () => {
      for (let i = start; i < Math.min(start + CHUNK, MONTH_OBSERVATIONS); i += 1) {
        const at = spread(endMs, i, MONTH_OBSERVATIONS);
        const row = makeObservation({
          counterparty: `person${String(i)}@company.example`,
          subjectHint: `Note ${String(i)}`,
          occurredAt: iso(at),
          observedAt: iso(at + MS_PER_MINUTE),
          rowKeyHash: sha(200_000 + i),
        });
        await upsertObservation(db, row, DEFAULT_POLICY, { clockMs: at + MS_PER_MINUTE });
      }
    });
  }
  for (let day = 0; day < MONTH_DAYS; day += 1) {
    const startMs = endMs - (MONTH_DAYS - day) * MS_PER_DAY;
    await recordCoverage(db, {
      observerId: 'gmail.sent',
      source: 'gmail.sent',
      windowStart: iso(startMs),
      windowEnd: iso(startMs + MS_PER_DAY),
      lastSyncAt: iso(startMs + MS_PER_DAY),
      accountHash: sha(1),
    });
  }
}

async function writeClaims(db: Awaited<ReturnType<typeof openLedger>>, endMs: number): Promise<void> {
  for (let start = 0; start < MONTH_CLAIMS; start += CHUNK) {
    await db.transaction('rw', db.tables, async () => {
      for (let i = start; i < Math.min(start + CHUNK, MONTH_CLAIMS); i += 1) {
        // An even claim is about the send of the observation at ten times its index; an odd one, a send never made.
        const observation = i * (MONTH_OBSERVATIONS / MONTH_CLAIMS);
        const at = spread(endMs, observation, MONTH_OBSERVATIONS);
        const made = i % 2 === 0;
        const claim = makeClaim({
          rawHash: sha(500_000 + i),
          counterparty: made
            ? `person${String(observation)}@company.example`
            : `nobody${String(i)}@company.example`,
          subjectHint: made ? `Note ${String(observation)}` : `Never sent ${String(i)}`,
          claimedAt: iso(at),
          observedAt: iso(at + MS_PER_MINUTE),
        });
        await upsertClaim(db, { ...claim, requestId: undefined });
      }
    });
  }
}

/** The month's ledger, built and graded once, in a fake IndexedDB of its own. */
export async function buildMonthLedger(endMs: number) {
  const db = await openLedger(uniqueDbName('perf-month'));
  await ensureDefaultGrants(db, iso(endMs - (MONTH_DAYS + 1) * MS_PER_DAY));
  await writeObservations(db, endMs);
  await writeClaims(db, endMs);
  await runGradingBatch(db, {
    policy: DEFAULT_POLICY,
    policyDocument: DEFAULT_POLICY_DOCUMENT,
    nowMs: () => Date.now(),
  });
  return db;
}

/** Every table of the month's ledger as stored, by table name. */
export async function monthLedgerRows(endMs: number): Promise<Record<string, unknown[]>> {
  const db = await buildMonthLedger(endMs);
  try {
    const rows: Record<string, unknown[]> = {};
    for (const table of db.tables) rows[table.name] = await table.toArray();
    return rows;
  } finally {
    db.close();
  }
}
