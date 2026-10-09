import 'fake-indexeddb/auto';
/**
 * A person's override and its revert on a stored receipt (sprint_4 4.3; src/ledger/user-events.ts; docs/grading.md
 * §3, §4.3, §8): one readwrite transaction reads the receipt and stamps the event through `writeUserEvent`, bounded by
 * the receipt's own last event. An override keeps the computed grade beside it and a revert keeps it in `reverted`. The
 * state machine's refusals, an unknown receipt and a revert whose evidence another claim now holds write nothing. With
 * the clock 5 min 1 s back after a batch, an event is stamped 1 ms after that batch; with the clock back below the
 * receipt's own override, the revert is stamped 1 ms after it and saved (tests/unit/ledger/user-event.spec.ts holds the
 * same rule over the simulated ledger, with replay).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordBatchInstant } from '../../../src/ledger/batch-instant';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getReceipt, putReceipt } from '../../../src/ledger/repo';
import { Receipt, type ReceiptInput } from '../../../src/ledger/types';
import { applyUserEvent } from '../../../src/ledger/user-events';
import {
  claimId,
  makeReceipt,
  observationId,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-01T15:00:00Z');
  db = await openLedger(uniqueDbName('user-events'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const FINAL: Partial<ReceiptInput> = { state: 'FINAL', finalAt: '2026-10-01T10:31:00-04:00' };
const override = (grade: 'VERIFIED' | 'NOT_FOUND' = 'NOT_FOUND', reason = 'I sent it myself') =>
  ({ kind: 'override', grade, reason }) as const;

async function stored(overrides: Partial<ReceiptInput> = {}): Promise<Receipt> {
  const receipt = Receipt.parse(makeReceipt({ ...FINAL, ...overrides }));
  await putReceipt(db, receipt);
  return receipt;
}

describe('applyUserEvent: an override and its revert', () => {
  it('overrides beside the computed grade, then reverts, keeping the override in reverted without its reason', async () => {
    const receipt = await stored();
    const done = await applyUserEvent(db, receipt.id, override());
    // Stamped now (the clock), written in the machine's own offset, as every instant the extension stamps.
    expect(done.ok && Date.parse(done.at)).toBe(Date.parse('2026-10-01T15:00:00Z'));
    const overridden = await getReceipt(db, receipt.id);
    expect(overridden).toMatchObject({
      state: 'USER_OVERRIDDEN',
      grade: 'VERIFIED',
      override: { grade: 'NOT_FOUND', reason: 'I sent it myself', previousState: 'FINAL' },
    });
    expect(overridden?.reasons.at(-1)).toEqual({ code: 'override.user', params: { grade: 'NOT_FOUND' } });
    pinClock('2026-10-01T15:05:00Z');
    expect(await applyUserEvent(db, receipt.id, { kind: 'revert' })).toMatchObject({ ok: true });
    const reverted = await getReceipt(db, receipt.id);
    expect(reverted).toMatchObject({ state: 'FINAL', grade: 'VERIFIED' });
    expect(reverted?.override).toBeUndefined();
    expect(reverted?.reverted).toHaveLength(1);
    expect(JSON.stringify(reverted)).not.toContain('I sent it myself');
  });

  it('refuses what the state machine refuses, and an unknown receipt, writing nothing', async () => {
    const receipt = await stored();
    expect(await applyUserEvent(db, receipt.id, { kind: 'revert' })).toEqual({ ok: false, code: 'refused' });
    expect(await applyUserEvent(db, receipt.id, override('VERIFIED', ' ​ '))).toEqual({
      ok: false,
      code: 'refused',
    });
    expect(await applyUserEvent(db, receipt.id, override('VERIFIED', 'x'.repeat(121)))).toEqual({
      ok: false,
      code: 'refused',
    });
    expect(await getReceipt(db, receipt.id)).toEqual(receipt);
    await applyUserEvent(db, receipt.id, override());
    expect(await applyUserEvent(db, receipt.id, override('VERIFIED'))).toEqual({
      ok: false,
      code: 'refused',
    });
    expect(await applyUserEvent(db, ulid(999), override())).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('applyUserEvent: a revert whose evidence another claim holds (§4.3)', () => {
  it("refuses to revert an override to NOT_FOUND whose evidence another claim's receipt now holds", async () => {
    const receipt = await stored({ observationIds: [observationId(1)] });
    await applyUserEvent(db, receipt.id, override('NOT_FOUND'));
    // A later batch gave the released observation to another claim (§4.3).
    await stored({
      id: ulid(302),
      claimId: claimId(102),
      inputsHash: sha(302),
      observationIds: [observationId(1)],
    });
    const held = await getReceipt(db, receipt.id);
    expect(await applyUserEvent(db, receipt.id, { kind: 'revert' })).toEqual({
      ok: false,
      code: 'evidence_taken',
    });
    expect(await getReceipt(db, receipt.id)).toEqual(held);
  });

  it('reverts an override whose evidence nobody else holds, and one to VERIFIED, which released nothing', async () => {
    const lone = await stored({ observationIds: [observationId(1)] });
    await applyUserEvent(db, lone.id, override('NOT_FOUND'));
    expect(await applyUserEvent(db, lone.id, { kind: 'revert' })).toMatchObject({ ok: true });
    const other = await stored({ id: ulid(303), claimId: claimId(103), inputsHash: sha(303) });
    await applyUserEvent(db, other.id, override('VERIFIED'));
    await stored({
      id: ulid(304),
      claimId: claimId(104),
      inputsHash: sha(304),
      observationIds: [observationId(1)],
    });
    expect(await applyUserEvent(db, other.id, { kind: 'revert' })).toMatchObject({ ok: true });
  });
});

describe('applyUserEvent: the stamp (SIM-1, R4-EVENT-ORDER)', () => {
  it('stamps an event 1 ms after the last batch when the clock reads 5 min 1 s before it', async () => {
    const receipt = await stored();
    pinClock('2026-10-01T16:00:00Z');
    await recordBatchInstant(db, '2026-10-01T16:00:00Z');
    pinClock('2026-10-01T15:54:59Z');
    const done = await applyUserEvent(db, receipt.id, override());
    expect(done.ok && Date.parse(done.at)).toBe(Date.parse('2026-10-01T16:00:00Z') + 1);
  });

  it("stamps a revert 1 ms after the receipt's own override when the clock went back below it, and saves it", async () => {
    const receipt = await stored();
    const first = await applyUserEvent(db, receipt.id, override());
    pinClock('2026-10-01T14:55:00Z');
    const revert = await applyUserEvent(db, receipt.id, { kind: 'revert' });
    expect(first.ok && revert.ok && Date.parse(revert.at) - Date.parse(first.at)).toBe(1);
    expect(await getReceipt(db, receipt.id)).toMatchObject({ state: 'FINAL' });
  });
});
