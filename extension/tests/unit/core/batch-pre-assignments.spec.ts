/**
 * batch-fixed.ts (docs/grading.md §4.3, §8, §9): the one rule for which observations the stored FINAL and
 * USER_OVERRIDDEN receipts fix, and in which batches. gradeBatch keeps the pre-assignments in force at its own
 * evaluatedAt and replay rebuilds every batch with the same ones (Hard Rule 4), so the rule is pinned here on its own:
 *  - `preAssignments` of the scenario ledger (attest-scenario.ts), every case of the rule with its instants;
 *  - what it never reads (a stored grade or ruleId, the order of the rows), and the later of two rows for a claim;
 *  - `inForceAt` at both ends, to the millisecond and across offsets, and `fixedInForce`'s split and order.
 */
import { describe, expect, it } from 'vitest';

import { type BatchFixed, fixedInForce, inForceAt, preAssignments } from '../../../src/core/batch-fixed';
import { NormalizeError } from '../../../src/core/normalize';
import { IsoTs, type Receipt, Ulid } from '../../../src/core/schema';
import {
  CLAIMS,
  OBSERVATIONS,
  OVERRIDE_AT,
  receiptIdOf,
  type ReceiptRef,
  scenarioLedger,
  T1,
  T1_MS,
  T2,
} from '../../tools/attest-scenario';
import { isoAt, MS_PER_HOUR } from '../../tools/attest-world';

const { snapshot } = await scenarioLedger();
const CLAIM_REFS = new Map(Object.entries(CLAIMS).map(([ref, claim]) => [claim.id, ref]));
const OBSERVATION_REFS = new Map(Object.entries(OBSERVATIONS).map(([ref, row]) => [row.id, ref]));
const INSTANTS = new Map([
  [T1, 'T1'],
  [T2, 'T2'],
  [OVERRIDE_AT, 'OVERRIDE_AT'],
]);

/** [observation, claim (null: taken), after, until?, released?] by scenario name; a released span `from…to`. */
function named(fixed: readonly BatchFixed[]): (string | null)[][] {
  const name = (at: string) => INSTANTS.get(at) ?? at;
  return fixed.map((pair) => {
    const claim = pair.claimId === null ? null : (CLAIM_REFS.get(pair.claimId) ?? pair.claimId);
    const row = [OBSERVATION_REFS.get(pair.observationId) ?? pair.observationId, claim];
    const instants = pair.until === undefined ? [pair.after] : [pair.after, pair.until];
    const released = (pair.released ?? []).map(
      ({ from, to }) => `released ${name(from)}…${to === undefined ? '' : name(to)}`,
    );
    return [...row, ...instants.map(name), ...released];
  });
}

function stored(ref: ReceiptRef): Receipt {
  const found = snapshot.receipts.find((receipt) => receipt.id === receiptIdOf(ref));
  if (found === undefined) throw new Error(`no receipt ${ref}`);
  return found;
}

/** The scenario's receipts with `ref`'s replaced by `change(ref's)`. */
function tampered(ref: ReceiptRef, change: (receipt: Receipt) => Receipt): Receipt[] {
  const target = stored(ref);
  return snapshot.receipts.map((receipt) => (receipt === target ? change(receipt) : receipt));
}

const iso = (ms: number): IsoTs => IsoTs.parse(isoAt(ms, 0));

describe('preAssignments of the scenario ledger (§4.3)', () => {
  it('fixes each claim’s evidence after its last grading, and each override as the rule says', () => {
    expect(named(preAssignments(snapshot.receipts))).toEqual([
      ['o1', 'c1', 'T1'], // FINAL at T1
      ['o3', 'c3', 'T2'], // PENDING at T1, FINAL at T2: fixed only after its last grading
      ['o5', 'c5', 'T1'], // PENDING until an override to VERIFIED: after its last grading, not after the override
      ['o7', 'c7', 'T1', 'released OVERRIDE_AT…'], // FINAL until an override to NOT_FOUND, which releases it after its `at`
      ['o7', 'c8', 'T2'],
      ['o9', null, 'OVERRIDE_AT'], // an overridden UNASKED receipt takes its orphan after the override
    ]);
  });

  it('keeps a FINAL receipt’s evidence for good under an override to VERIFIED; a PENDING one to NOT_FOUND fixes none', () => {
    const kept = tampered('c7', (receipt) => ({
      ...receipt,
      override: { grade: 'VERIFIED', reason: 'kept', at: OVERRIDE_AT, previousState: 'FINAL' },
    }));
    expect(named(preAssignments(kept))).toContainEqual(['o7', 'c7', 'T1']);
    const dropped = tampered('c5', (receipt) => ({
      ...receipt,
      override: { grade: 'NOT_FOUND', reason: 'dropped', at: OVERRIDE_AT, previousState: 'PENDING' },
    }));
    expect(named(preAssignments(dropped)).filter(([, claim]) => claim === 'c5')).toEqual([]);
    // An UNASKED receipt overridden before its own computedAt (a corrupt ledger) takes its orphan after the latter.
    const early = tampered('u9', (receipt) => ({
      ...receipt,
      override: { grade: 'VERIFIED', reason: 'early', at: iso(T1_MS - MS_PER_HOUR), previousState: 'FINAL' },
    }));
    expect(named(preAssignments(early))).toContainEqual(['o9', null, 'T1']);
  });

  it('reads no stored grade or ruleId, and not the order of the rows', () => {
    const expected = preAssignments(snapshot.receipts);
    const regraded = tampered('c1', (receipt) => ({ ...receipt, grade: 'NOT_FOUND', ruleId: 'not_found' }));
    expect(preAssignments(regraded)).toEqual(expected);
    const claims = expected.filter((pair) => pair.claimId !== null);
    expect(preAssignments([...snapshot.receipts].reverse()).filter((p) => p.claimId !== null)).toEqual(
      claims,
    );
  });
});

describe('preAssignments of a corrupt ledger', () => {
  it('of two rows for one claim, reads the later grading: computedAt, then id', () => {
    const c1 = stored('c1');
    const twin = (fields: Partial<Receipt>): Receipt => ({ ...c1, observationIds: [], ...fields });
    const laterId = twin({ id: Ulid.parse('7ZZZZZZZZZZZZZZZZZZZZZZZZZ') });
    const earlierId = twin({ id: Ulid.parse('00000000000000000000000000') });
    const laterAt = twin({ id: Ulid.parse('00000000000000000000000000'), computedAt: IsoTs.parse(T2) });
    const ofC1 = (rows: readonly Receipt[]) =>
      named(preAssignments(rows)).filter(([, claim]) => claim === 'c1');
    for (const rows of [
      [c1, laterId],
      [laterId, c1],
    ])
      expect(ofC1(rows)).toEqual([]);
    for (const rows of [
      [c1, earlierId],
      [earlierId, c1],
    ])
      expect(ofC1(rows)).toEqual([['o1', 'c1', 'T1']]);
    expect(ofC1([laterAt, c1])).toEqual([]);
  });
});

describe('inForceAt and fixedInForce', () => {
  const [o1, o3] = [OBSERVATIONS.o1.id, OBSERVATIONS.o3.id];
  const [c1, c3] = [CLAIMS.c1.id, CLAIMS.c3.id];

  it('is in force strictly after `after` and at or before `until`, to the millisecond, in any offset', () => {
    const pair = { observationId: o1, claimId: c1, after: iso(T1_MS), until: iso(T1_MS + 1_000) };
    const at = [T1_MS - 1, T1_MS, T1_MS + 1, T1_MS + 1_000, T1_MS + 1_001];
    expect(at.map((ms) => inForceAt(pair, ms))).toEqual([false, false, true, true, false]);
    const open = { observationId: o1, claimId: c1, after: IsoTs.parse(isoAt(T1_MS, 330)) };
    expect([T1_MS, T1_MS + 1, T1_MS + 10 * MS_PER_HOUR].map((ms) => inForceAt(open, ms))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('throws NormalizeError(invalid_iso) for an instant that is not an IsoTs, rather than guessing', () => {
    const broken = { observationId: o1, claimId: c1, after: 'yesterday' as IsoTs };
    expect(() => inForceAt(broken, T1_MS)).toThrow(new NormalizeError('invalid_iso'));
  });

  it('splits the pairs in force into fixed (claim id, then observation id order) and taken', () => {
    const after = iso(T1_MS - 1);
    const later = iso(T1_MS);
    const fixed: BatchFixed[] = [
      { observationId: o3, claimId: c3, after },
      { observationId: o1, claimId: c1, after },
      { observationId: o3, claimId: null, after },
      { observationId: o1, claimId: null, after: later },
    ];
    const [first, second] = [c1, c3].sort();
    const result = fixedInForce(fixed, T1_MS);
    expect(result.fixed.map((pair) => pair.claimId)).toEqual([first, second]);
    expect(result.fixed).toContainEqual({ observationId: o1, claimId: c1 });
    expect([...result.taken]).toEqual([o3]);
  });
});
