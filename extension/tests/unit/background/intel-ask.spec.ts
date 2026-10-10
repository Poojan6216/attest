import 'fake-indexeddb/auto';
/**
 * Who is asked and about what (sprint_5 5.4; src/background/intel.ts): `chooseProvider` takes Chrome's on-device model
 * when the person turned it on and Chrome has it ready, else the person's own key when they turned that on and saved
 * one, else none; `claimsToAsk` takes the claims whose receipt is PENDING by rule `partial` with one observation, never
 * asked before and still in the ledger, at most MODEL_ASKS_PER_RUN, those claimed earliest first. Every value is
 * invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chooseProvider, claimsToAsk, type ProviderSources } from '../../../src/background/intel';
import { MODEL_ASKS_PER_RUN } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { PromptApi, PromptAvailability } from '../../../src/intel/providers/builtin';
import { saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { claimAsk } from '../../../src/ledger/model-answers';
import { putReceipt, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { ModelAnswer } from '../../../src/ledger/types';
import {
  claimId,
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

const KEY = 'sk-ant-invented-0000000000000000';
let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-06T14:21:00-04:00');
  db = await openLedger(uniqueDbName('intel-ask'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** A Prompt API that says `availability`, and the sources a test reads back: how often each was asked. */
function sources(availability: PromptAvailability | null, byo: boolean) {
  const asked = { promptApi: 0, byo: 0 };
  const api: PromptApi = {
    availability: () => Promise.resolve(availability ?? 'unavailable'),
    create: () => Promise.reject(new Error('not in this test')),
  };
  const made: ProviderSources = {
    promptApi: () => {
      asked.promptApi += 1;
      return availability === null ? null : api;
    },
    byo: () => {
      asked.byo += 1;
      return Promise.resolve(byo ? { vendor: 'anthropic', key: KEY } : null);
    },
  };
  return { made, asked };
}

describe('chooseProvider', () => {
  it('asks nothing of Chrome or storage while both models are off', async () => {
    const { made, asked } = sources('available', true);
    expect(await chooseProvider(db, made)).toBeNull();
    expect(asked).toEqual({ promptApi: 0, byo: 0 });
  });

  it('takes the on-device model when it is on and ready, and never reads the key then', async () => {
    await saveFlag(db, 'ATTEST_MODEL', true);
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    const { made, asked } = sources('available', true);
    expect((await chooseProvider(db, made))?.id).toBe('builtin');
    expect(asked.byo).toBe(0);
  });

  it('takes the person’s own key when the on-device model is on but not ready, or not there', async () => {
    await saveFlag(db, 'ATTEST_MODEL', true);
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    for (const availability of ['downloadable', 'downloading', 'unavailable', null] as const) {
      expect((await chooseProvider(db, sources(availability, true).made))?.id, String(availability)).toBe(
        'byo',
      );
    }
  });

  it('takes none when the on-device model is not ready and no key is on, or none is saved', async () => {
    await saveFlag(db, 'ATTEST_MODEL', true);
    expect(await chooseProvider(db, sources('downloadable', true).made)).toBeNull();
    await saveFlag(db, 'ATTEST_MODEL', false);
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    expect(await chooseProvider(db, sources('available', false).made)).toBeNull();
  });
});

/** Claim `n`, claimed `minutes` after 14:00, with observation `n`; its receipt PENDING by rule `rule`. */
async function store(n: number, minutes: number, overrides: Parameters<typeof makeReceipt>[0] = {}) {
  const claimedAt = `2026-10-06T14:${String(minutes).padStart(2, '0')}:00-04:00`;
  await upsertClaim(db, makeClaim({ rawHash: sha(1_000 + n), claimedAt, observedAt: claimedAt }));
  await upsertObservation(db, makeObservation({ rowKeyHash: sha(n) }), DEFAULT_POLICY);
  await putReceipt(
    db,
    makeReceipt({
      id: ulid(3_000 + n),
      claimId: claimIdOf(n),
      observationIds: [observationId(n)],
      grade: 'PARTIAL',
      ruleId: 'partial',
      reasons: [{ code: 'match.best', params: { observationId: observationId(n) } }],
      ...overrides,
    }),
  );
}

const claimIdOf = (n: number): string => makeClaim({ rawHash: sha(1_000 + n) }).id;

describe('claimsToAsk', () => {
  it('takes only a PENDING receipt by rule `partial`, with one observation, never asked before', async () => {
    await store(1, 1);
    await store(2, 2, { ruleId: 'verified', grade: 'VERIFIED' });
    await store(3, 3, { state: 'FINAL', finalAt: '2026-10-06T14:20:00-04:00' });
    await store(4, 4, { observationIds: [] });
    await store(5, 5);
    await claimAsk(
      db,
      ModelAnswer.parse({
        claimId: claimIdOf(5),
        inputsHash: sha(70),
        provider: 'byo',
        askedAt: '2026-10-06T14:20:00-04:00',
      }),
    );
    // A receipt whose claim the ledger does not hold is left out.
    await putReceipt(
      db,
      makeReceipt({ id: ulid(3_900), claimId: claimId(9_999), grade: 'PARTIAL', ruleId: 'partial' }),
    );
    const asks = await claimsToAsk(db);
    expect(asks.map(({ claim, observation }) => [claim.id, observation.id])).toEqual([
      [claimIdOf(1), observationId(1)],
    ]);
  });

  it(`takes at most ${String(MODEL_ASKS_PER_RUN)} a run, those claimed earliest first`, async () => {
    const minutes = Array.from({ length: MODEL_ASKS_PER_RUN + 2 }, (_, i) => 50 - i * 3);
    for (const [i, minute] of minutes.entries()) await store(i + 1, minute);
    const asks = await claimsToAsk(db);
    const earliest = [...minutes.entries()]
      .sort(([, a], [, b]) => a - b)
      .slice(0, MODEL_ASKS_PER_RUN)
      .map(([i]) => claimIdOf(i + 1));
    expect(asks.map(({ claim }) => claim.id)).toEqual(earliest);
  });
});
