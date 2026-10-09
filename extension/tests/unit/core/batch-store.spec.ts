/**
 * src/core/batch-store.ts (sprint_3 3.13; docs/grading.md §3, §7, §8, §9): how a batch's receipts replace the stored
 * ones, the rule the background and the replay simulator share. Played on the §2 demo graded at two instants: before
 * grace (all PENDING) and after it (VERIFIED, NOT_FOUND and UNASKED, FINAL).
 */
import { describe, expect, it } from 'vitest';

import type { BatchReceipt } from '../../../src/core/batch';
import { storeBatch, supersede } from '../../../src/core/batch-store';
import type { Receipt, Ulid } from '../../../src/core/schema';
import { transition } from '../../../src/core/state';
import { AT, buildDemo, gradeDemo } from './demo-ledger';

async function batchAt(at: string) {
  const graded = await gradeDemo(buildDemo(), at);
  const items: BatchReceipt[] = graded.all.map((receipt) => {
    const inputs = graded.inputs.get(receipt.id);
    if (inputs === undefined) throw new Error('no inputs');
    return { receipt, inputs };
  });
  return { ...graded, items };
}

const mapOf = (receipts: readonly Receipt[]): Map<Ulid, Receipt> => new Map(receipts.map((r) => [r.id, r]));

describe('storeBatch', () => {
  it('inserts every new subject with its inputs, the batch’s coverage beside each', async () => {
    const batch = await batchAt(AT.beforeGrace);
    const stored = storeBatch(new Map(), batch.items, batch.coverage);
    expect(stored.put.map((r) => r.id)).toEqual(batch.all.map((r) => r.id));
    expect(stored.deleted).toEqual([]);
    expect(stored.released).toEqual([]);
    for (const receipt of stored.put) {
      expect(stored.inputs.get(receipt.inputsHash)).toEqual({
        coverage: batch.coverage,
        ...batch.inputs.get(receipt.id),
      });
    }
  });

  it('replaces a PENDING row through regrade, and releases the inputs no receipt names any more', async () => {
    const early = await batchAt(AT.beforeGrace);
    const late = await batchAt(AT.evaluated);
    const before = mapOf(early.all);
    expect(early.all.every((r) => r.state === 'PENDING')).toBe(true);
    const stored = storeBatch(before, late.items, late.coverage);
    const [email] = stored.put.filter((r) => r.id === late.email.id);
    expect(email).toEqual(transition(early.email, { event: 'regrade', next: late.email }));
    expect([...stored.released].sort()).toEqual(early.all.map((r) => r.inputsHash).sort());
    expect([...stored.inputs.keys()].sort()).toEqual(late.all.map((r) => r.inputsHash).sort());
  });

  it('keeps a FINAL, overridden or superseded row as stored and discards its regrade', async () => {
    const late = await batchAt(AT.evaluated);
    const overridden = transition(late.calendar, {
      event: 'override',
      grade: 'VERIFIED',
      reason: 'I made it myself',
      at: AT.nextDay,
    });
    const stored = storeBatch(mapOf([late.email, overridden, late.unasked]), late.items, late.coverage);
    expect(late.email.state).toBe('FINAL');
    expect(stored.put).toEqual([]);
    expect(stored.inputs.size).toBe(0);
    expect(stored.released).toEqual([]);
  });

  it('deletes a PENDING claim-less row the batch no longer produces, unless it holds a reverted override', async () => {
    const early = await batchAt(AT.beforeGrace);
    const late = await batchAt(AT.evaluated);
    const claimsOnly = late.items.filter(({ receipt }) => receipt.claimId !== undefined);
    const gone = storeBatch(mapOf([early.unasked]), claimsOnly, late.coverage);
    expect(gone.deleted).toEqual([early.unasked.id]);
    expect(gone.released).toEqual([early.unasked.inputsHash]);
    const held = transition(
      transition(early.unasked, { event: 'override', grade: 'NOT_FOUND', reason: 'mine', at: AT.secondLook }),
      { event: 'revert', at: AT.museResync },
    );
    const kept = storeBatch(mapOf([held]), claimsOnly, late.coverage);
    expect([kept.deleted, kept.released]).toEqual([[], []]);
  });
});

describe('supersede', () => {
  it('marks the UNASKED receipt of an observation a FINAL claim receipt holds, once', async () => {
    const late = await batchAt(AT.evaluated);
    const [vendorRow] = late.unasked.observationIds;
    if (vendorRow === undefined) throw new Error('the UNASKED receipt names no observation');
    const claim: Receipt = { ...late.email, observationIds: [vendorRow] };
    const changed = supersede(mapOf([claim, late.unasked]));
    expect(changed).toEqual([
      transition(late.unasked, { event: 'supersede', claimId: late.email.claimId ?? '' }),
    ]);
    expect(supersede(mapOf([claim, ...changed]))).toEqual([]);
    const pending: Receipt = { ...claim, state: 'PENDING' };
    expect(supersede(mapOf([pending, late.unasked]))).toEqual([]);
  });
});
