import 'fake-indexeddb/auto';
/**
 * Turning a model off stops it at once (Sprint 5 close, security review SEC-2, QA GAP 11; src/background/model-run.ts;
 * Hard Rule 1). With two claims due, a run asks about the first, and while that call is in flight the person turns
 * their own key off, forgets it, saves another, or switches Chrome's on-device model off: the call's signal is aborted,
 * its answer never counts, and the second claim is never asked. Switching the usage numbers stops nothing. A stop that
 * fired before a call means the provider is never asked. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onByoForget, onByoSave } from '../../../src/background/byo';
import { onFlagSet } from '../../../src/background/flags';
import { askTheModel } from '../../../src/background/intel';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { Claim, Observation } from '../../../src/core/schema';
import { type IntelProvider, scoresFor } from '../../../src/intel';
import { buildInput, type IntelInput } from '../../../src/intel/input';
import { readFlags, saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { setLogSink, type LogRecord } from '../../../src/log';
import {
  makeClaim,
  makeObservation,
  makeReceipt,
  observationId,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from '../ledger/fixtures';

const DEPS = { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() };
const KEY = 'sk-ant-invented-stop-0123456789abcdef';
/** Far longer than any test: a call that ends did so because it was stopped, not because its time ran out. */
const NO_TIME_LIMIT = 60_000;

let db: LedgerDb;
let records: LogRecord[];
let restoreLog: () => void;

beforeEach(async () => {
  pinClock('2026-10-06T14:21:00-04:00');
  db = await openLedger(uniqueDbName('intel-stop'));
  records = [];
  restoreLog = setLogSink((record) => records.push(record));
});

afterEach(() => {
  db.close();
  restoreLog();
  releaseClock();
});

/** Claim `n`, PENDING by rule `partial` with observation `n` (as intel-ask.spec.ts stores one). */
async function partialClaim(n: number, minutes: number): Promise<void> {
  const claimedAt = `2026-10-06T14:${String(minutes).padStart(2, '0')}:00-04:00`;
  const claim = makeClaim({ rawHash: sha(1_000 + n), claimedAt, observedAt: claimedAt });
  await upsertClaim(db, claim);
  await upsertObservation(db, makeObservation({ rowKeyHash: sha(n) }), DEFAULT_POLICY);
  await putReceipt(
    db,
    makeReceipt({
      id: ulid(3_000 + n),
      claimId: claim.id,
      observationIds: [observationId(n)],
      grade: 'PARTIAL',
      ruleId: 'partial',
      reasons: [{ code: 'match.best', params: { observationId: observationId(n) } }],
    }),
  );
}

/**
 * A provider `id` whose call, the first time, runs `during` and then waits until its signal aborts: what a stop does to
 * a call in flight. It records each input and each signal.
 */
function stalling(id: IntelProvider['id'], during: () => Promise<unknown>) {
  const inputs: IntelInput[] = [];
  const signals: AbortSignal[] = [];
  const provider: IntelProvider = {
    id,
    score: async (input, signal) => {
      inputs.push(input);
      signals.push(signal);
      await during();
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    },
  };
  return { provider, inputs, signals };
}

const ask = (provider: IntelProvider) =>
  askTheModel(db, {
    grading: DEPS,
    notify: () => undefined,
    provider: () => Promise.resolve(provider),
    timeoutMs: NO_TIME_LIMIT,
  });

const ctx = () => ({ db: () => Promise.resolve(db), notify: () => undefined });
const events = () => records.map((record) => record.event);

describe('a run stops when the person turns the model off', () => {
  beforeEach(async () => {
    await partialClaim(1, 1);
    await partialClaim(2, 2);
  });

  it('sends no other claim once the person turns their own key off during a call (QA red test)', async () => {
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    const inputs: IntelInput[] = [];
    const provider: IntelProvider = {
      id: 'byo',
      score: async (input) => {
        inputs.push(input);
        await saveFlag(db, 'ATTEST_MODEL_BYO', false); // "Turn off my own key", during the first call
        return { scores: [] };
      },
    };
    await askTheModel(db, {
      grading: DEPS,
      notify: () => undefined,
      provider: () => Promise.resolve(provider),
    });
    expect(inputs).toHaveLength(1);
  });

  it('forgetting the key aborts the call in flight, and asks no other claim', async () => {
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    const { provider, inputs, signals } = stalling('byo', () => onByoForget(ctx()));
    expect(await ask(provider)).toBe(0);
    expect(inputs).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(events()).toContain('intel.stopped');
    expect((await readFlags(db)).ATTEST_MODEL_BYO).toBe(false);
    expect(await db.modelAnswers.count()).toBe(1); // the claim asked keeps its row, with no scores
    expect((await db.modelAnswers.toArray()).every((row) => !('scores' in row))).toBe(true);
  });

  it('saving another key stops the run that holds the old one', async () => {
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    const save = () => onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, ctx());
    const { provider, inputs, signals } = stalling('byo', save);
    await ask(provider);
    expect(inputs).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('a run stops when the person switches a model, and only then', () => {
  beforeEach(async () => {
    await partialClaim(1, 1);
    await partialClaim(2, 2);
  });

  it('switching Chrome’s on-device model off stops its run', async () => {
    await saveFlag(db, 'ATTEST_MODEL', true);
    const off = () => onFlagSet({ type: 'flag.set', flag: 'ATTEST_MODEL', on: false }, ctx());
    const { provider, inputs, signals } = stalling('builtin', off);
    await ask(provider);
    expect(inputs).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('switching the usage numbers stops nothing', async () => {
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    const inputs: IntelInput[] = [];
    const provider: IntelProvider = {
      id: 'byo',
      score: async (input) => {
        inputs.push(input);
        await onFlagSet({ type: 'flag.set', flag: 'ATTEST_TELEMETRY', on: true }, ctx());
        return { scores: [] };
      },
    };
    await ask(provider);
    expect(inputs).toHaveLength(2);
  });
});

describe('scoresFor', () => {
  it('never asks the provider when the stop has already fired', async () => {
    const input = buildInput(Claim.parse(makeClaim()), [Observation.parse(makeObservation())]);
    const { provider, inputs } = stalling('byo', () => Promise.resolve());
    const stop = new AbortController();
    stop.abort();
    expect(await scoresFor(provider, input, NO_TIME_LIMIT, stop.signal)).toBeUndefined();
    expect(inputs).toEqual([]);
  });
});
