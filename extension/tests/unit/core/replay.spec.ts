/**
 * Replay (docs/grading.md §9; task 1.9): grouping by computedAt, batch membership, fixed pre-assignments from
 * earlier groups, and overrides, on the hand-built ledger of tests/tools/attest-scenario.ts (two batches, T1 and
 * T2). Each rule is pinned twice: the honest ledger replays exactly, and a ledger whose stored rows tell a different
 * story makes exactly the receipts that rule decides mismatch, so a replay that ignored the rule would fail here.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { type Policy, PolicyError } from '../../../src/core/policy';
import { type LedgerSnapshot, replay, type ReplayReport } from '../../../src/core/replay';
import { IsoTs, type Receipt, type Ulid } from '../../../src/core/schema';
import { LedgerSim } from '../../tools/attest-ledger';
import {
  CLAIM_REFS,
  CLAIMS,
  type ClaimRef,
  OBSERVATIONS,
  OVERRIDE_AT,
  receiptIdOf,
  type ReceiptRef,
  scenarioLedger,
  scenarioWorld,
  T1,
  T2,
  T2_MS,
} from '../../tools/attest-scenario';
import { isoAt, MS_PER_HOUR } from '../../tools/attest-world';

let snapshot: LedgerSnapshot;

/** `ms` as an IsoTs written at `offsetMinutes`. */
const iso = (ms: number, offsetMinutes = 0): IsoTs => IsoTs.parse(isoAt(ms, offsetMinutes));

beforeAll(async () => {
  ({ snapshot } = await scenarioLedger());
});

function stored(ref: ReceiptRef): Receipt {
  const found = snapshot.receipts.find((receipt) => receipt.id === receiptIdOf(ref));
  if (found === undefined) throw new Error(`no receipt for ${ref}`);
  return found;
}

/** The snapshot with the receipt of `ref` replaced by `change(receipt)` (null: deleted). */
function tamper(ref: ReceiptRef, change: (receipt: Receipt) => Receipt | null): LedgerSnapshot {
  const id = receiptIdOf(ref);
  const receipts = snapshot.receipts.flatMap((receipt) => {
    if (receipt.id !== id) return [receipt];
    const next = change(receipt);
    return next === null ? [] : [next];
  });
  return { ...snapshot, receipts };
}

/** The refs of the receipts a report names, in report order, each once. */
function mismatchedRefs(report: ReplayReport): string[] {
  const refs: ReceiptRef[] = [...CLAIM_REFS, 'u9', 'scope'];
  const byId = new Map<Ulid, string>(refs.map((ref) => [receiptIdOf(ref), ref]));
  return [...new Set(report.mismatches.map((one) => byId.get(one.receiptId) ?? one.receiptId))];
}

function fieldsOf(report: ReplayReport, ref: ReceiptRef): string[] {
  return report.mismatches.filter((one) => one.receiptId === receiptIdOf(ref)).map((one) => one.field);
}

function gradeMismatch(report: ReplayReport, ref: ReceiptRef) {
  return report.mismatches.find((one) => one.receiptId === receiptIdOf(ref) && one.field === 'grade');
}

describe('the scenario ledger', () => {
  it('is graded as tests/tools/attest-scenario.ts says', () => {
    const table = CLAIM_REFS.map((ref) => {
      const { grade, state, computedAt, observationIds } = stored(ref);
      return [ref, grade, state, computedAt === T1 ? 'T1' : 'T2', observationIds.length];
    });
    expect(table).toEqual([
      ['c1', 'VERIFIED', 'FINAL', 'T1', 1],
      ['c2', 'NOT_FOUND', 'FINAL', 'T2', 0],
      ['c3', 'VERIFIED', 'FINAL', 'T2', 1],
      ['c4', 'NOT_FOUND', 'FINAL', 'T1', 0],
      ['c5', 'VERIFIED', 'USER_OVERRIDDEN', 'T1', 1],
      ['c6', 'NOT_FOUND', 'FINAL', 'T2', 0],
      ['c7', 'VERIFIED', 'USER_OVERRIDDEN', 'T1', 1],
      ['c8', 'VERIFIED', 'FINAL', 'T2', 1],
      ['c10', 'NOT_FOUND', 'FINAL', 'T2', 0],
      ['c11', 'NOT_FOUND', 'FINAL', 'T1', 0],
      ['c12', 'UNVERIFIABLE', 'FINAL', 'T1', 0],
    ]);
    expect(stored('c12').ruleId).toBe('underspecified');
    expect(stored('c5').override?.previousState).toBe('PENDING');
    expect(stored('c7').override).toMatchObject({ grade: 'NOT_FOUND', previousState: 'FINAL' });
    expect(stored('u9')).toMatchObject({ grade: 'UNASKED', computedAt: T1, state: 'USER_OVERRIDDEN' });
    expect(stored('scope')).toMatchObject({
      grade: 'OVER_SCOPE',
      ruleId: 'over_scope_observed',
      state: 'FINAL',
    });
    expect(snapshot.receipts).toHaveLength(13);
  });

  it('holds c3 and c5 PENDING at T1, so their stored rows are not what T1 saw', async () => {
    const world = scenarioWorld();
    const sim = new LedgerSim(world);
    await sim.grade(T1, world.policyAt(0).policy);
    const atT1 = (ref: ClaimRef) => sim.receipts.get(receiptIdOf(ref));
    expect(atT1('c3')).toMatchObject({
      grade: 'VERIFIED',
      state: 'PENDING',
      observationIds: [OBSERVATIONS.o3.id],
    });
    expect(atT1('c5')).toMatchObject({
      grade: 'VERIFIED',
      state: 'PENDING',
      observationIds: [OBSERVATIONS.o5.id],
    });
    expect(atT1('c2')).toBeUndefined();
  });
});

describe('replay of the honest ledger', () => {
  it('reproduces every receipt, in two batches', async () => {
    const report = await replay(snapshot);
    expect(report).toMatchObject({ receipts: 13, batches: 2, reproduced: 13, mismatched: 0, mismatches: [] });
    expect(Object.values(report.byField).every((count) => count === 0)).toBe(true);
  });

  it('groups by instant, not by how computedAt is written (the rewritten text alone is the mismatch)', async () => {
    const rewritten = tamper('c4', (receipt) => ({ ...receipt, computedAt: iso(Date.parse(T1), 330) }));
    expect(stored('c4').computedAt).not.toBe(iso(Date.parse(T1), 330));
    const report = await replay(rewritten);
    expect(report).toMatchObject({ batches: 2, reproduced: 12 });
    expect(report.mismatches).toEqual([
      { receiptId: receiptIdOf('c4'), field: 'computedAt', stored: iso(Date.parse(T1), 330), replayed: T1 },
    ]);
  });

  it('lists mismatches by computedAt instant, then receipt id, then field, whatever the input order', async () => {
    const both = {
      ...snapshot,
      receipts: [...snapshot.receipts].reverse().map((receipt) => {
        if (receipt.id === receiptIdOf('c8'))
          return { ...receipt, grade: 'PARTIAL' as const, ruleId: 'partial' };
        if (receipt.id === receiptIdOf('c11')) return { ...receipt, ruleId: 'pending' };
        return receipt;
      }),
    };
    const report = await replay(both);
    expect(
      report.mismatches.map((one) => [mismatchedRefs({ ...report, mismatches: [one] })[0], one.field]),
    ).toEqual([
      ['c11', 'ruleId'],
      ['c8', 'grade'],
      ['c8', 'ruleId'],
    ]);
  });
});

describe('fixed pre-assignments come from the FINAL receipts of earlier batches', () => {
  it('c1, FINAL at T1 holding o1, keeps c2 from o1 at T2', async () => {
    const report = await replay(tamper('c1', (receipt) => ({ ...receipt, observationIds: [] })));
    expect(mismatchedRefs(report)).toEqual(['c1', 'c2']);
    // The edited row itself is named: grading c1 again assigns it o1.
    expect(report.mismatches.filter((one) => one.receiptId === receiptIdOf('c1'))).toEqual([
      {
        receiptId: receiptIdOf('c1'),
        field: 'observationIds',
        stored: '[]',
        replayed: `["${OBSERVATIONS.o1.id}"]`,
      },
    ]);
    expect(gradeMismatch(report, 'c2')).toEqual({
      receiptId: receiptIdOf('c2'),
      field: 'grade',
      stored: 'NOT_FOUND',
      replayed: 'VERIFIED',
    });
  });

  it('nothing is fixed in the batch that graded it: c3, stored at T2, still took o3 from c4 at T1', async () => {
    const report = await replay(tamper('c3', () => null));
    expect(report.receipts).toBe(12);
    expect(mismatchedRefs(report)).toEqual(['c4', 'c6']);
    expect(gradeMismatch(report, 'c4')).toMatchObject({ stored: 'NOT_FOUND', replayed: 'PARTIAL' });
    // Without c3, o3 also stays among c6's candidates at T2 (below partial, so c6's grade holds): the candidates
    // hash moves, and so do the reasons and signals, which now describe o3 as c6's best candidate.
    expect(fieldsOf(report, 'c6')).toEqual(['inputsHash', 'reasons', 'signals']);
    expect(gradeMismatch(report, 'c6')).toBeUndefined();
  });

  it('a claim first seen after an instant is not in that batch (c10 would take o9 from the UNASKED receipt)', async () => {
    const early = { ...CLAIMS.c10, observedAt: iso(Date.parse(T1) - MS_PER_HOUR) };
    const claims = snapshot.claims.map((claim) => (claim.id === early.id ? early : claim));
    const report = await replay({ ...snapshot, claims });
    expect(mismatchedRefs(report)).toEqual(['u9', 'c10']);
    expect(report.mismatches.filter((one) => one.receiptId === receiptIdOf('u9'))).toEqual([
      { receiptId: receiptIdOf('u9'), field: 'orphan', stored: OBSERVATIONS.o9.id, replayed: CLAIMS.c10.id },
    ]);
    expect(
      report.mismatches.filter((one) => one.receiptId === receiptIdOf('c10')).map((one) => one.field),
    ).toEqual(['inputsHash']);
  });
});

describe('overrides', () => {
  const afterT2 = iso(T2_MS + MS_PER_HOUR);

  it('an overridden receipt is compared on its previousState', async () => {
    expect(stored('c5').state).toBe('USER_OVERRIDDEN');
    const report = await replay(
      tamper('c5', (receipt) => ({
        ...receipt,
        override: { grade: 'VERIFIED', reason: 'tampered', at: OVERRIDE_AT, previousState: 'FINAL' },
      })),
    );
    expect(report.mismatches).toEqual([
      { receiptId: receiptIdOf('c5'), field: 'state', stored: 'FINAL', replayed: 'PENDING' },
    ]);
  });

  it('an override of a PENDING receipt fixes its observation from its `at` on (c5 keeps o5 from c6)', async () => {
    const late = tamper('c5', (receipt) => ({
      ...receipt,
      override: { grade: 'VERIFIED', reason: 'late', at: afterT2, previousState: 'PENDING' },
    }));
    const report = await replay(late);
    expect(mismatchedRefs(report)).toEqual(['c6']);
    expect(gradeMismatch(report, 'c6')).toMatchObject({ stored: 'NOT_FOUND', replayed: 'VERIFIED' });
  });

  it('an override to NOT_FOUND releases the observation (c8 takes o7 from c7)', async () => {
    const kept = tamper('c7', (receipt) => ({
      ...receipt,
      override: { grade: 'VERIFIED', reason: 'kept', at: OVERRIDE_AT, previousState: 'FINAL' },
    }));
    const report = await replay(kept);
    expect(mismatchedRefs(report)).toEqual(['c8']);
    expect(gradeMismatch(report, 'c8')).toMatchObject({ stored: 'VERIFIED', replayed: 'NOT_FOUND' });
  });

  it('before an override, the FINAL state it overrode still fixes the observation', async () => {
    const late = tamper('c7', (receipt) => ({
      ...receipt,
      override: { grade: 'NOT_FOUND', reason: 'late', at: afterT2, previousState: 'FINAL' },
    }));
    const report = await replay(late);
    expect(mismatchedRefs(report)).toEqual(['c8']);
  });
});

describe('overrides at a batch instant, and overrides of UNASKED receipts', () => {
  const afterT2 = iso(T2_MS + MS_PER_HOUR);

  it('an override at the very instant of a later batch is in force in that batch, as the background applied it', async () => {
    const world = scenarioWorld();
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    sim.override(receiptIdOf('c7'), 'NOT_FOUND', T2);
    sim.override(receiptIdOf('u9'), 'VERIFIED', T2);
    await sim.grade(T2, policy);
    const ledger = sim.snapshot();
    const after = (ref: ReceiptRef) => ledger.receipts.find((receipt) => receipt.id === receiptIdOf(ref));
    expect(after('c7')?.override?.at).toBe(T2);
    expect(after('c8')).toMatchObject({ grade: 'VERIFIED', computedAt: T2 });
    expect(after('c10')).toMatchObject({ grade: 'NOT_FOUND', computedAt: T2 });
    expect(await replay(ledger)).toMatchObject({ mismatched: 0, reproduced: ledger.receipts.length });
  });

  it('an UNASKED receipt overridden at its own computedAt is still graded in its own batch', async () => {
    // QA Sprint 1 review: taking the orphan in the batch that graded it (not only after it) survived the suite.
    const world = scenarioWorld();
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    sim.override(receiptIdOf('u9'), 'VERIFIED', T1);
    await sim.grade(T2, policy);
    const ledger = sim.snapshot();
    const u9 = ledger.receipts.find((receipt) => receipt.id === receiptIdOf('u9'));
    expect(u9).toMatchObject({ computedAt: T1, override: { at: T1 } });
    expect(await replay(ledger)).toMatchObject({ mismatched: 0, reproduced: ledger.receipts.length });
  });

  it('an overridden UNASKED receipt takes its observation from its `at` on (c10 never gets o9)', async () => {
    const final: Receipt = { ...stored('u9'), state: 'FINAL' };
    delete final.override;
    const late = { grade: 'VERIFIED', reason: 'late', at: afterT2, previousState: 'FINAL' } as const;
    const reports = await Promise.all([
      replay(tamper('u9', () => final)),
      replay(tamper('u9', (receipt) => ({ ...receipt, override: late }))),
    ]);
    for (const report of reports) {
      expect(mismatchedRefs(report)).toEqual(['c10']);
      expect(gradeMismatch(report, 'c10')).toMatchObject({ stored: 'NOT_FOUND', replayed: 'VERIFIED' });
    }
  });
});

describe('a snapshot policy loadPolicy did not return (Hard Rule 6)', () => {
  it('throws PolicyError(policy_not_loaded) once, before replaying, instead of an error on every receipt', async () => {
    const [entry] = snapshot.policies;
    if (entry === undefined) throw new Error('the scenario ledger holds a policy');
    const [hash, policy] = entry;
    // A copy with the original's values and policyHash: valid, but not what loadPolicy returned (SEC-2).
    const copy: Policy = { ...policy };
    const notLoaded = new PolicyError([], 'policy_not_loaded');
    await expect(replay({ ...snapshot, policies: new Map([[hash, copy]]) })).rejects.toThrow(notLoaded);
    // Even when no receipt names it: the snapshot itself is the caller's bug.
    const unused = new Map([...snapshot.policies, ['0'.repeat(64), copy]]);
    await expect(replay({ ...snapshot, policies: unused })).rejects.toThrow(notLoaded);
    expect(await replay(snapshot)).toMatchObject({ mismatched: 0, reproduced: snapshot.receipts.length });
  });
});
