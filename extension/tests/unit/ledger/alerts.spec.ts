import 'fake-indexeddb/auto';
/**
 * The alerts the ledger keeps (sprint_4 4.6; src/ledger/alerts.ts): a receipt made FINAL as NOT_FOUND, UNASKED or
 * OVER_SCOPE, not superseded, is queued once, ever; nothing else is. Settling is for good, before anything is shown:
 * shown (with the action it is about: the claim's, the UNASKED receipt's observation, none for a scope receipt), muted,
 * overridden, superseded or gone; a second take settles nothing again. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { alertsMutedKey } from '../../../src/ledger/agent-keys';
import { ALERTS_PER_TAKE, queueAlerts, takeAlerts } from '../../../src/ledger/alerts';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt, setMeta, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { IsoTs, Receipt, type ReceiptInput } from '../../../src/ledger/types';
import {
  claimId,
  makeClaim,
  makeObservation,
  makeReceipt,
  observationId,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const FINAL_AT = '2026-10-01T11:00:00-04:00';
const HANDLED_AT = IsoTs.parse('2026-10-01T11:05:00-04:00');
let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-01T11:00:00-04:00');
  db = await openLedger(uniqueDbName('alerts'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** A FINAL receipt `n` of `grade` about claim 101, graded at FINAL_AT. */
const final = (n: number, grade: Receipt['grade'], overrides: Partial<ReceiptInput> = {}): Receipt =>
  Receipt.parse(
    makeReceipt({
      id: ulid(n),
      grade,
      ruleId: grade === 'VERIFIED' ? 'verified' : 'not_found',
      reasons: [{ code: 'match.none', params: {} }],
      observationIds: [],
      state: 'FINAL',
      computedAt: FINAL_AT,
      finalAt: FINAL_AT,
      ...overrides,
    }),
  );

/**
 * A FINAL UNASKED receipt `n` about the observation `rowKeyHash: sha(1)`, likely Claude's; superseded by claim 101 when
 * `superseded` (with the reason that says so).
 */
const unasked = (n: number, superseded = false): Receipt =>
  Receipt.parse({
    ...omit(
      makeReceipt({
        id: ulid(n),
        agent: 'claude',
        grade: 'UNASKED',
        ruleId: 'unasked',
        reasons: [
          { code: 'unasked.session', params: { agent: 'claude' } },
          ...(superseded ? [{ code: 'superseded' as const, params: { claimId: claimId(101) } }] : []),
        ],
        observationIds: [observationId(1)],
        state: 'FINAL',
        computedAt: FINAL_AT,
        finalAt: FINAL_AT,
      }),
      'claimId',
    ),
    attribution: 'likely',
    ...(superseded ? { supersededBy: claimId(101) } : {}),
  });

async function store(...receipts: Receipt[]): Promise<void> {
  for (const receipt of receipts) await putReceipt(db, receipt);
}

describe('queueAlerts', () => {
  it('queues each FINAL NOT_FOUND, UNASKED and OVER_SCOPE receipt not superseded, once, ever', async () => {
    const queued = [final(1, 'NOT_FOUND'), unasked(2), final(3, 'OVER_SCOPE')];
    const quiet = [
      final(4, 'VERIFIED'),
      final(5, 'UNVERIFIABLE'),
      final(6, 'PARTIAL'),
      Receipt.parse({ ...makeReceipt({ id: ulid(7), grade: 'NOT_FOUND' }), state: 'PENDING' }),
      unasked(8, true),
    ];
    expect(await queueAlerts(db, [...queued, ...quiet])).toBe(3);
    expect(await queueAlerts(db, queued)).toBe(0);
    const rows = await db.alerts.toArray();
    expect(rows.map(({ receiptId, grade, state, finalAt }) => [receiptId, grade, state, finalAt])).toEqual([
      [ulid(1), 'NOT_FOUND', 'pending', FINAL_AT],
      [ulid(2), 'UNASKED', 'pending', FINAL_AT],
      [ulid(3), 'OVER_SCOPE', 'pending', FINAL_AT],
    ]);
  });
});

describe('takeAlerts', () => {
  it('settles each pending alert for good, with the action it is about, and shows none twice', async () => {
    await upsertClaim(db, makeClaim({ rawHash: sha(101) }));
    await upsertObservation(db, makeObservation({ rowKeyHash: sha(1) }), DEFAULT_POLICY);
    const scope = final(3, 'OVER_SCOPE', { claimId: undefined, ruleId: 'over_scope_observed' });
    const receipts = [
      final(1, 'NOT_FOUND', { claimId: claimId(101) }),
      unasked(2),
      Receipt.parse(omit(scope, 'claimId')),
    ];
    await store(...receipts);
    await queueAlerts(db, receipts);
    const taken = await takeAlerts(db, HANDLED_AT);
    expect(taken.shown).toEqual([
      {
        receiptId: ulid(1),
        agent: 'muse',
        grade: 'NOT_FOUND',
        action: { type: 'email.sent', at: '2026-10-01T10:14:00-04:00' },
      },
      {
        receiptId: ulid(2),
        agent: 'claude',
        grade: 'UNASKED',
        action: { type: 'email.sent', at: makeObservation({ rowKeyHash: sha(1) }).occurredAt },
      },
      { receiptId: ulid(3), agent: 'muse', grade: 'OVER_SCOPE', action: undefined },
    ]);
    expect((await db.alerts.toArray()).map(({ state, handledAt }) => [state, handledAt])).toEqual([
      ['shown', HANDLED_AT],
      ['shown', HANDLED_AT],
      ['shown', HANDLED_AT],
    ]);
    expect(await takeAlerts(db, HANDLED_AT)).toEqual({ shown: [], quiet: {} });
  });
});

describe('takeAlerts: what shows nothing', () => {
  it('shows none for a muted agent, an overridden or superseded receipt, or one purged first', async () => {
    await setMeta(db, alertsMutedKey('muse'), true);
    const muted = final(1, 'NOT_FOUND');
    const overridden = final(2, 'NOT_FOUND', { agent: 'claude' });
    const superseded = unasked(3);
    const gone = final(4, 'NOT_FOUND', { agent: 'dots' });
    await queueAlerts(db, [muted, overridden, superseded, gone]);
    await store(
      muted,
      Receipt.parse({
        ...overridden,
        state: 'USER_OVERRIDDEN',
        reasons: [...overridden.reasons, { code: 'override.user', params: { grade: 'VERIFIED' } }],
        override: { grade: 'VERIFIED', reason: 'I sent it', at: HANDLED_AT, previousState: 'FINAL' },
      }),
      unasked(3, true),
    );
    expect(await takeAlerts(db, HANDLED_AT)).toEqual({
      shown: [],
      quiet: { muted: 1, overridden: 1, superseded: 1, gone: 1 },
    });
    // Unmuting later shows nothing of what came while muted.
    await setMeta(db, alertsMutedKey('muse'), false);
    expect((await takeAlerts(db, HANDLED_AT)).shown).toEqual([]);
  });

  it(`settles at most ${String(ALERTS_PER_TAKE)} at a time, the rest at the next take`, async () => {
    const many = Array.from({ length: ALERTS_PER_TAKE + 2 }, (_, index) => final(index + 1, 'NOT_FOUND'));
    await store(...many);
    await queueAlerts(db, many);
    expect((await takeAlerts(db, HANDLED_AT)).shown).toHaveLength(ALERTS_PER_TAKE);
    expect((await takeAlerts(db, HANDLED_AT)).shown).toHaveLength(2);
  });
});
