import 'fake-indexeddb/auto';
/**
 * Perf gate (Sprint 3 close, tech review TECH-2): the grading batch the service worker runs after each import and
 * every five minutes on the grace alarm (src/background/grading.ts `runGradingBatch`), over a real ledger at the size
 * 90 days of heavy use leave: 2,000 pasted claims (22 a day) and their receipts. The batch reads and parses every claim
 * and receipt; this gate holds that steady state, a batch that regrades only the last day's PENDING receipts, to its
 * budget, and the idle one, nothing PENDING and nothing stored, to almost nothing. Fake IndexedDB in Node: the
 * growth and the budget are the point, not Chrome's own numbers.
 */
import { describe, expect, it } from 'vitest';

import { ensureDefaultGrants } from '../../src/background/default-grants';
import { runGradingBatch } from '../../src/background/grading';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../src/core/policy';
import { IsoTs } from '../../src/core/schema';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../src/core/units';
import type { LedgerDb } from '../../src/ledger/db';
import { openLedger } from '../../src/ledger/migrations';
import { upsertClaim } from '../../src/ledger/repo';
import { makeClaim, sha, uniqueDbName } from '../unit/ledger/fixtures';
import { describeRuns, measure } from './measure';

const CLAIMS = 2_000;
const DAYS = 90;
/** The budget of a steady-state batch at CLAIMS claims, in median CPU ms. */
const GATE_MS = 1_500;
/** The budget of a batch with nothing to grade: nothing PENDING, nothing stored since the last one that graded. */
const IDLE_GATE_MS = 50;

const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());
const deps = (atMs: number) => ({
  policy: DEFAULT_POLICY,
  policyDocument: DEFAULT_POLICY_DOCUMENT,
  nowMs: () => atMs,
});

/** CLAIMS email claims spread over the DAYS before `endMs`, each read a minute after it was made. */
async function ledgerOf(endMs: number): Promise<LedgerDb> {
  const db = await openLedger(uniqueDbName('perf-batch'));
  await ensureDefaultGrants(db, iso(endMs - DAYS * MS_PER_DAY));
  const step = (DAYS * MS_PER_DAY) / CLAIMS;
  for (let i = 0; i < CLAIMS; i += 1) {
    const claimedMs = endMs - DAYS * MS_PER_DAY + Math.floor(i * step);
    const claim = makeClaim({
      rawHash: sha(10_000 + i),
      counterparty: `person${String(i)}@example.org`,
      claimedAt: iso(claimedMs),
      observedAt: iso(claimedMs + MS_PER_MINUTE),
    });
    await upsertClaim(db, { ...claim, requestId: undefined });
  }
  return db;
}

describe('perf gate (Sprint 3 close, TECH-2): the grading batch over 90 days of claims', () => {
  it(`a steady-state batch at ${String(CLAIMS)} claims takes a median < ${String(GATE_MS)} ms of CPU`, async () => {
    const endMs = Date.now();
    const db = await ledgerOf(endMs);
    try {
      const first = await runGradingBatch(db, deps(endMs + MS_PER_MINUTE));
      expect(first).toMatchObject({ claims: CLAIMS, written: CLAIMS, skipped: false });
      let atMs = endMs + MS_PER_MINUTE;
      const measured = await measure(
        () => (atMs += 5 * MS_PER_MINUTE),
        (at) => runGradingBatch(db, deps(at)),
        (_at, summary) => [summary?.skipped, summary?.claims],
      );
      console.log(describeRuns(`steady-state batch at ${String(CLAIMS)} claims`, measured));
      // Only the last day's claims are still PENDING: about CLAIMS / DAYS of them are regraded, never all.
      for (const run of measured.runs) {
        expect(run.result[0]).toBe(false);
        expect(run.result[1]).toBeLessThan((2 * CLAIMS) / DAYS);
      }
      expect(measured.medianCpuMs).toBeLessThan(GATE_MS);
      // Two days on, the last day's receipts are FINAL too: every later batch has nothing to grade, and skips.
      atMs += 2 * MS_PER_DAY;
      expect(await runGradingBatch(db, deps(atMs))).toMatchObject({ skipped: false });
      const idle = await measure(
        () => (atMs += 5 * MS_PER_MINUTE),
        (at) => runGradingBatch(db, deps(at)),
        (_at, summary) => summary?.skipped,
      );
      console.log(describeRuns(`idle batch at ${String(CLAIMS)} claims`, idle));
      expect(idle.runs.map((run) => run.result)).toEqual([true, true, true]);
      expect(idle.medianCpuMs).toBeLessThan(IDLE_GATE_MS);
    } finally {
      db.close();
    }
  }, 600_000);
});
