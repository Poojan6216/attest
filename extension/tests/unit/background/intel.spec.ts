import 'fake-indexeddb/auto';
/**
 * The advisory model in the service worker (sprint_5 5.4; src/background/intel.ts; docs/grading.md §3, §5.4), over a
 * real ledger holding the §2 demo with its email claim paraphrased: Muse says it sent Priya "Quarterly deck", and the
 * send is "Q3 deck" (floor 0.8462 under the shipped policy: PARTIAL, PENDING before grace). A provider double
 * records what it is given.
 *  - The PARTIAL claim is asked about once, with exactly its projection and the one candidate it took; the answer is
 *    stored, a batch regrades the receipt VERIFIED, its inputs hold the scores, open pages are told, and replay
 *    reproduces every receipt. The calendar claim, PENDING by rule `pending`, is never asked about.
 *  - A FINAL receipt (a PARTIAL and a NOT_FOUND here) is never asked about.
 *  - A call that times out or throws is no answer: the receipt stays PARTIAL, and the claim is never asked again.
 *  - Turned off, the stored answers count no more: the PENDING receipt is graded rules-only again.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askTheModel, type IntelDeps } from '../../../src/background/intel';
import { runGradingBatch } from '../../../src/background/grading';
import { isoWithLocalOffset } from '../../../src/clock';
import { hashCanonical, idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { replay } from '../../../src/core/replay';
import { Claim, Receipt } from '../../../src/core/schema';
import type { IntelProvider } from '../../../src/intel';
import { inputsHash } from '../../../src/intel/cache';
import { buildInput, type IntelInput } from '../../../src/intel/input';
import { saveFlag } from '../../../src/ledger/consent';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import { replayRecords } from '../../../src/ledger/replay-records';
import { setLogSink } from '../../../src/log';
import { truncateIso } from '../../golden/time';
import { readSnapshot } from '../../tools/attest-snapshot';
import { AT, buildDemo } from '../core/demo-ledger';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { storeDemo } from './demo-store';

const DEPS = { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() };
/** After the batch before grace: a batch must be stamped after the last one. */
const ASKED_AT = '2026-10-06T14:21:00-04:00';
/** ASKED_AT as the service worker writes an instant, in the zone the test runs in (src/clock.ts; CI's is UTC). */
const ASKED_AT_WRITTEN = isoWithLocalOffset(new Date(ASKED_AT));
const opened: LedgerDb[] = [];
let lines: string[] = [];
let restoreLog: () => void = () => undefined;

beforeEach(() => {
  pinClock('2026-10-06T08:00:00-04:00');
  lines = [];
  restoreLog = setLogSink((record) => {
    lines.push(JSON.stringify(record));
  });
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  restoreLog();
  releaseClock();
});

/** The demo's email claim as Muse would say it with the subject paraphrased (the id follows the text, §10). */
function paraphrased(claim: Claim): Claim {
  const text = 'Sent email "Quarterly deck" to Priya';
  const at = truncateIso(claim.claimedAt, 'minute');
  const rawHash = hashCanonical({
    agent: 'muse',
    sourceKind: 'activity_view',
    rowKeyHash: null,
    text,
    claimedAt: at,
  });
  return Claim.parse({ ...claim, id: idFromHash(rawHash), subjectHint: 'Quarterly deck', rawHash });
}

/** The demo stored up to `upTo` with the paraphrased claim, the person's own key on, and one batch at `upTo`. */
async function demoLedger(prefix: string, upTo: string) {
  const db = await openLedger(uniqueDbName(prefix));
  opened.push(db);
  const demo = buildDemo();
  const claim = paraphrased(demo.emailClaim);
  await storeDemo(db, upTo, '', [claim, demo.calendarClaim]);
  await saveFlag(db, 'ATTEST_MODEL_BYO', true);
  pinClock(upTo);
  await runGradingBatch(db, DEPS);
  return { db, demo, claim };
}

const receiptOf = async (db: LedgerDb, claimId: string): Promise<Receipt | undefined> =>
  readRows('receipts', Receipt, await db.receipts.toArray()).find((receipt) => receipt.claimId === claimId);

/** A provider double: records each input, and answers with `answer`. */
function recorder(answer: (input: IntelInput, signal: AbortSignal) => Promise<unknown>) {
  const inputs: IntelInput[] = [];
  const provider: IntelProvider = {
    id: 'byo',
    score: (input, signal) => {
      inputs.push(input);
      return answer(input, signal);
    },
  };
  return { provider, inputs };
}

/** Scores every candidate 1. */
const sure = (input: IntelInput) =>
  Promise.resolve({ scores: input.candidates.map(({ id }) => ({ candidateId: id, score: 1 })) });

const depsWith = (provider: IntelProvider, notify = vi.fn(), timeoutMs?: number): IntelDeps => ({
  grading: DEPS,
  notify,
  provider: () => Promise.resolve(provider),
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
});

describe('askTheModel over the paraphrased demo: the PARTIAL claim', () => {
  it('asks once about the PARTIAL claim, with its projection and its one candidate, and regrades it VERIFIED', async () => {
    const { db, demo, claim } = await demoLedger('intel-raise', AT.beforeGrace);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
    expect((await receiptOf(db, claim.id))?.signals.score).toBe(0.8462);
    const { provider, inputs } = recorder(sure);
    const notify = vi.fn();
    pinClock(ASKED_AT);
    expect(await askTheModel(db, depsWith(provider, notify))).toBe(1);
    // Exactly the claim's projection and the one candidate it took: the calendar claim is never asked about.
    expect(inputs).toEqual([buildInput(claim, [demo.priyaRow])]);
    const raised = await receiptOf(db, claim.id);
    expect(raised).toMatchObject({
      grade: 'VERIFIED',
      ruleId: 'verified',
      observationIds: [demo.priyaRow.id],
    });
    // 0.85 · 0.8462 + 0.15 · 1 (§5.4): at or above `verified`.
    expect(raised?.signals).toMatchObject({ modelScore: 1, score: 0.8692 });
    expect(notify).toHaveBeenCalledWith(['receipts']);
    const scores = [{ observationId: demo.priyaRow.id, score: 10_000 }];
    const [input] = inputs;
    if (input === undefined) throw new Error('nothing was asked');
    expect(await db.modelAnswers.toArray()).toEqual([
      {
        claimId: claim.id,
        inputsHash: inputsHash(input),
        provider: 'byo',
        askedAt: ASKED_AT_WRITTEN,
        scores,
      },
    ]);
    const { receiptInputs } = await replayRecords(db);
    expect(receiptInputs[raised?.inputsHash ?? '']?.context.modelScores).toEqual(scores);
    expect(lines.join('\n')).not.toContain('Quarterly');
    // Asked once: the next run sends nothing.
    pinClock('2026-10-06T14:22:00-04:00');
    expect(await askTheModel(db, depsWith(provider))).toBe(0);
    expect(inputs).toHaveLength(1);
    // Every receipt, the raised one included, is reproduced from the export (Hard Rule 4).
    const exported = await exportLedger(db, { exportedAt: '2026-10-06T14:23:00-04:00' });
    const report = await replay(readSnapshot(JSON.parse(JSON.stringify(exported))));
    expect(report).toMatchObject({ reproduced: report.receipts, mismatched: 0 });
  });
});

describe('askTheModel: what is never asked about', () => {
  it('never asks about a FINAL receipt: the PARTIAL and the NOT_FOUND after grace', async () => {
    const { db, claim, demo } = await demoLedger('intel-final', AT.evaluated);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'PARTIAL', state: 'FINAL' });
    expect(await receiptOf(db, demo.calendarClaim.id)).toMatchObject({ grade: 'NOT_FOUND', state: 'FINAL' });
    const { provider, inputs } = recorder(sure);
    pinClock('2026-10-06T15:01:00-04:00');
    expect(await askTheModel(db, depsWith(provider))).toBe(0);
    expect(inputs).toEqual([]);
    expect(await db.modelAnswers.count()).toBe(0);
  });
});

describe('askTheModel: no answer', () => {
  it('a call that times out is no answer: the receipt stays PARTIAL, and the claim is never asked again', async () => {
    const { db, claim } = await demoLedger('intel-timeout', AT.beforeGrace);
    const late = recorder(
      (_, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ scores: [] });
          });
        }),
    );
    pinClock(ASKED_AT);
    expect(await askTheModel(db, depsWith(late.provider, vi.fn(), 20))).toBe(0);
    expect(late.inputs).toHaveLength(1);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
    const [row] = await db.modelAnswers.toArray();
    expect(row).toMatchObject({ claimId: claim.id, provider: 'byo', askedAt: ASKED_AT_WRITTEN });
    expect(row).not.toHaveProperty('scores');
    expect(lines.some((line) => line.includes('intel.timeout'))).toBe(true);
    const sooner = recorder(sure);
    pinClock('2026-10-06T14:22:00-04:00');
    expect(await askTheModel(db, depsWith(sooner.provider))).toBe(0);
    expect(sooner.inputs).toEqual([]);
  });

  it('a provider that throws is no answer either, logged without its words', async () => {
    const { db, claim } = await demoLedger('intel-throws', AT.beforeGrace);
    const failing = recorder(() => Promise.reject(new Error('the key Quarterly deck was refused')));
    pinClock(ASKED_AT);
    expect(await askTheModel(db, depsWith(failing.provider))).toBe(0);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
    expect(lines.some((line) => line.includes('intel.failed'))).toBe(true);
    expect(lines.join('\n')).not.toContain('Quarterly');
  });
});

describe('askTheModel: turned off', () => {
  it('turned off, the stored answers count no more: the PENDING receipt is graded rules-only again', async () => {
    const { db, claim } = await demoLedger('intel-off', AT.beforeGrace);
    pinClock(ASKED_AT);
    expect(await askTheModel(db, depsWith(recorder(sure).provider))).toBe(1);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'VERIFIED', state: 'PENDING' });
    await saveFlag(db, 'ATTEST_MODEL_BYO', false);
    pinClock('2026-10-06T14:22:00-04:00');
    await runGradingBatch(db, DEPS);
    const graded = await receiptOf(db, claim.id);
    expect(graded).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
    expect(graded?.signals).not.toHaveProperty('modelScore');
    // The answer is kept: turned on again, it counts again, and nothing is sent.
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    pinClock('2026-10-06T14:23:00-04:00');
    await runGradingBatch(db, DEPS);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'VERIFIED', state: 'PENDING' });
  });

  it('with no provider, nothing is asked and nothing is stored', async () => {
    const { db } = await demoLedger('intel-none', AT.beforeGrace);
    pinClock(ASKED_AT);
    const deps: IntelDeps = { grading: DEPS, notify: vi.fn(), provider: () => Promise.resolve(null) };
    expect(await askTheModel(db, deps)).toBe(0);
    expect(await db.modelAnswers.count()).toBe(0);
  });
});
