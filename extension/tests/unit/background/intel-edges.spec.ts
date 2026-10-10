import 'fake-indexeddb/auto';
/**
 * The advisory model in the service worker at its edges (Sprint 5 QA review; src/background/intel.ts; sprint_5 5.3,
 * 5.4; agents/intel_engineer.md rule 7), over a real ledger holding the §2 demo with its email claim paraphrased
 * (PARTIAL, PENDING before grace, as tests/unit/background/intel.spec.ts builds it):
 *  - with both models off, a claim due is never asked about: no provider is chosen (so neither Chrome nor the key's
 *    storage is read), nothing is stored, and the receipt stays as the rules graded it. intel.spec.ts turns the key off
 *    only after the claim was asked;
 *  - two runs at once (an import's and the grace alarm's) reach the same PARTIAL claim: one call between them, one
 *    answer stored, and the receipt raised once. The module promises "a claim is asked once, even by two runs at
 *    once"; until now only one run at a time was tested.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGradingBatch } from '../../../src/background/grading';
import { askTheModel, type IntelDeps } from '../../../src/background/intel';
import { hashCanonical, idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { Claim, Receipt } from '../../../src/core/schema';
import type { IntelProvider } from '../../../src/intel';
import type { IntelInput } from '../../../src/intel/input';
import { saveFlag } from '../../../src/ledger/consent';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { setLogSink } from '../../../src/log';
import { truncateIso } from '../../golden/time';
import { AT, buildDemo } from '../core/demo-ledger';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { storeDemo } from './demo-store';

const DEPS = { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() };
const ASKED_AT = '2026-10-06T14:21:00-04:00';
const opened: LedgerDb[] = [];
let restoreLog: () => void = () => undefined;

beforeEach(() => {
  pinClock('2026-10-06T08:00:00-04:00');
  restoreLog = setLogSink(() => undefined);
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  restoreLog();
  releaseClock();
});

/** The demo's email claim with its subject paraphrased (the id follows the text, §10). */
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

/** The demo stored before grace with the paraphrased claim, and one batch: the claim PARTIAL, PENDING. */
async function demoLedger(prefix: string) {
  const db = await openLedger(uniqueDbName(prefix));
  opened.push(db);
  const demo = buildDemo();
  const claim = paraphrased(demo.emailClaim);
  await storeDemo(db, AT.beforeGrace, '', [claim, demo.calendarClaim]);
  pinClock(AT.beforeGrace);
  await runGradingBatch(db, DEPS);
  return { db, claim };
}

const receiptOf = async (db: LedgerDb, claimId: string): Promise<Receipt | undefined> =>
  readRows('receipts', Receipt, await db.receipts.toArray()).find((receipt) => receipt.claimId === claimId);

/** Scores every candidate 1, a tick later, counting its calls. */
function sureProvider() {
  const inputs: IntelInput[] = [];
  const provider: IntelProvider = {
    id: 'byo',
    score: async (input) => {
      inputs.push(input);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { scores: input.candidates.map(({ id }) => ({ candidateId: id, score: 1 })) };
    },
  };
  return { provider, inputs };
}

describe('askTheModel with both models off', () => {
  it('asks nothing about a claim due, chooses no provider, and stores nothing', async () => {
    const { db, claim } = await demoLedger('intel-edges-off');
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
    const { provider, inputs } = sureProvider();
    const choose = vi.fn(() => Promise.resolve(provider));
    pinClock(ASKED_AT);
    const deps: IntelDeps = { grading: DEPS, notify: vi.fn(), provider: choose };
    expect(await askTheModel(db, deps)).toBe(0);
    expect(choose).not.toHaveBeenCalled();
    expect(inputs).toEqual([]);
    expect(await db.modelAnswers.count()).toBe(0);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
  });
});

describe('askTheModel: two runs at once', () => {
  it('make one call between them for the one PARTIAL claim, store one answer, and raise it once', async () => {
    const { db, claim } = await demoLedger('intel-edges-twice');
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    const { provider, inputs } = sureProvider();
    const notify = vi.fn();
    const deps: IntelDeps = { grading: DEPS, notify, provider: () => Promise.resolve(provider) };
    pinClock(ASKED_AT);
    const answered = await Promise.all([askTheModel(db, deps), askTheModel(db, deps)]);
    expect([...answered].sort()).toEqual([0, 1]);
    expect(inputs).toHaveLength(1);
    expect(await db.modelAnswers.count()).toBe(1);
    expect(await receiptOf(db, claim.id)).toMatchObject({ grade: 'VERIFIED', state: 'PENDING' });
  });
});
