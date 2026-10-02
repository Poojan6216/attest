/**
 * Replay's report (docs/grading.md §9; task 1.9): every mismatch names its receipt, its field and both values; a
 * receipt that cannot be graded again says why (missing inputs, missing policy, missing or unseen subject, an orphan
 * the batch gave away, a grade() error) instead of throwing; one tampered field is exactly one mismatch; and the
 * report never depends on input order. On the hand-built ledger of tests/tools/attest-scenario.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hex } from '../../../src/core/hash';
import { type LedgerSnapshot, REPLAY_FIELDS, replay, type ReplayMismatch } from '../../../src/core/replay';
import { Grant, IsoTs, type Receipt, Sha256 } from '../../../src/core/schema';
import {
  CLAIMS,
  OBSERVATIONS,
  receiptIdOf,
  type ReceiptRef,
  scenarioLedger,
  T1,
  T2,
} from '../../tools/attest-scenario';
import { isoAt, MS_PER_HOUR } from '../../tools/attest-world';

let snapshot: LedgerSnapshot;

beforeAll(async () => {
  ({ snapshot } = await scenarioLedger());
});

function stored(ref: ReceiptRef): Receipt {
  const found = snapshot.receipts.find((receipt) => receipt.id === receiptIdOf(ref));
  if (found === undefined) throw new Error(`no receipt for ${ref}`);
  return found;
}

function withReceipt(ref: ReceiptRef, change: (receipt: Receipt) => Receipt): LedgerSnapshot {
  const id = receiptIdOf(ref);
  return { ...snapshot, receipts: snapshot.receipts.map((r) => (r.id === id ? change(r) : r)) };
}

const one = (ref: ReceiptRef, field: ReplayMismatch['field'], was: string | null, now: string | null) => ({
  receiptId: receiptIdOf(ref),
  field,
  stored: was,
  replayed: now,
});

describe('one tampered field is exactly one mismatch', () => {
  it('grade', async () => {
    const report = await replay(withReceipt('c1', (r) => ({ ...r, grade: 'PARTIAL' })));
    expect(report.mismatches).toEqual([one('c1', 'grade', 'PARTIAL', 'VERIFIED')]);
    expect(report).toMatchObject({ receipts: 13, reproduced: 12, mismatched: 1 });
    expect(report.byField.grade).toBe(1);
  });

  it('ruleId', async () => {
    const report = await replay(withReceipt('c11', (r) => ({ ...r, ruleId: 'partial_coverage' })));
    expect(report.mismatches).toEqual([one('c11', 'ruleId', 'partial_coverage', 'not_found')]);
  });

  it('state (of a receipt holding nothing, so no other batch changes)', async () => {
    const report = await replay(withReceipt('c11', (r) => ({ ...r, state: 'PENDING' })));
    expect(report.mismatches).toEqual([one('c11', 'state', 'PENDING', 'FINAL')]);
  });

  it('inputsHash, with its inputs row moved under the new key', async () => {
    const forged = Sha256.parse('f'.repeat(64));
    const original = stored('c11').inputsHash;
    const inputs = snapshot.receiptInputs.get(original);
    if (inputs === undefined) throw new Error('no inputs');
    const receiptInputs = new Map(snapshot.receiptInputs).set(forged, inputs);
    const tampered = { ...withReceipt('c11', (r) => ({ ...r, inputsHash: forged })), receiptInputs };
    const report = await replay(tampered);
    expect(report.mismatches).toEqual([one('c11', 'inputsHash', forged, original)]);
  });

  it('id: the scope receipt graded from another scope', async () => {
    const original = stored('scope');
    const inputs = snapshot.receiptInputs.get(original.inputsHash);
    if (inputs?.context.scope === undefined) throw new Error('no scope inputs');
    const other = { ...inputs, context: { ...inputs.context, scope: { observed: 'calendar.write' } } };
    const receiptInputs = new Map(snapshot.receiptInputs).set(original.inputsHash, other);
    const report = await replay({ ...snapshot, receiptInputs });
    // The reasons name the scope (by its hash), so they move with it.
    expect(report.mismatches.map((m) => m.field)).toEqual(['id', 'inputsHash', 'reasons']);
    expect(report.mismatches[0]?.stored).toBe(receiptIdOf('scope'));
  });
});

/** SHA-256 of canonical JSON, as the report writes `signals` and `reasons`. */
const hashed = (value: unknown): string => sha256Hex(canonicalJson(value));

describe('every other field grading computed: one tampered field is exactly one mismatch', () => {
  // c8 is graded in the last batch and holds o7: nothing replayed later reads it.
  const c8 = () => stored('c8');
  const later = IsoTs.parse(isoAt(Date.parse(T2) + MS_PER_HOUR, 0));
  const cases: readonly (readonly [
    ReplayMismatch['field'],
    (r: Receipt) => Receipt,
    () => readonly [string | null, string | null],
  ])[] = [
    ['agent', (r) => ({ ...r, agent: 'claude' }), () => ['claude', 'muse']],
    ['observationIds', (r) => ({ ...r, observationIds: [] }), () => ['[]', `["${OBSERVATIONS.o7.id}"]`]],
    ['requestId', (r) => ({ ...r, requestId: CLAIMS.c1.id }), () => [CLAIMS.c1.id, null]],
    ['confidence', (r) => ({ ...r, confidence: 0 }), () => ['0', canonicalJson(c8().confidence)]],
    ['reasons', (r) => ({ ...r, reasons: [] }), () => [hashed([]), hashed(c8().reasons)]],
    ['signals', (r) => ({ ...r, signals: {} }), () => [hashed({}), hashed(c8().signals)]],
    [
      'policyHash',
      (r) => ({ ...r, policyHash: Sha256.parse('a'.repeat(64)) }),
      () => ['a'.repeat(64), c8().policyHash],
    ],
    ['attribution', (r) => ({ ...r, attribution: 'likely' }), () => ['likely', null]],
    ['finalAt', (r) => ({ ...r, finalAt: later }), () => [later, c8().finalAt ?? null]],
  ];

  it.each(cases)('%s', async (field, change, values) => {
    expect(c8()).toMatchObject({ grade: 'VERIFIED', state: 'FINAL', computedAt: T2 });
    const report = await replay(withReceipt('c8', change));
    const [was, now] = values();
    expect(was).not.toBe(now);
    expect(report.mismatches).toEqual([one('c8', field, was, now)]);
    expect(report.byField[field]).toBe(1);
  });

  it('the lifecycle part is not compared: an override and a supersession are events, not grading', async () => {
    const u9 = stored('u9');
    expect(u9.override).toBeDefined();
    const superseded = withReceipt('u9', (r) => ({
      ...r,
      supersededBy: CLAIMS.c10.id,
      reasons: [...r.reasons, { code: 'superseded', params: { claimId: CLAIMS.c10.id } }],
    }));
    expect((await replay(superseded)).mismatches).toEqual([]);
  });
});

describe('an observation whose content no longer hashes to its contentHash', () => {
  it('is named on the receipt graded with it, by both hashes (never its content)', async () => {
    const edited = { ...OBSERVATIONS.o1, subjectHint: 'edited after projection' };
    const observations = snapshot.observations.map((o) => (o.id === edited.id ? edited : o));
    const report = await replay({ ...snapshot, observations });
    const recomputed = hashed({ ...edited, id: undefined, observedAt: undefined, contentHash: undefined });
    expect(recomputed).not.toBe(edited.contentHash);
    // c1 is graded with o1 at T1; at T2 o1 is fixed to c1, so no other receipt is graded with it.
    expect(new Set(report.mismatches.map((m) => m.receiptId))).toEqual(new Set([receiptIdOf('c1')]));
    expect(report.mismatches[0]).toEqual(one('c1', 'contentHash', edited.contentHash, recomputed));
    expect(report.byField.contentHash).toBe(1);
    expect(JSON.stringify(report)).not.toContain('edited after projection');
  });

  it('is named on an UNASKED receipt graded from it', async () => {
    const edited = { ...OBSERVATIONS.o9, counterparty: 'someone@else.example' };
    const observations = snapshot.observations.map((o) => (o.id === edited.id ? edited : o));
    const report = await replay({ ...snapshot, observations });
    expect(report.mismatches.filter((m) => m.field === 'contentHash')).toEqual([
      one(
        'u9',
        'contentHash',
        edited.contentHash,
        hashed({ ...edited, id: undefined, observedAt: undefined, contentHash: undefined }),
      ),
    ]);
  });
});

describe('a receipt that cannot be graded again says why: inputs, policy, claim', () => {
  it('receiptInputs: no row for its inputsHash', async () => {
    const receiptInputs = new Map(snapshot.receiptInputs);
    receiptInputs.delete(stored('c2').inputsHash);
    const report = await replay({ ...snapshot, receiptInputs });
    expect(report.mismatches).toEqual([one('c2', 'receiptInputs', stored('c2').inputsHash, null)]);
  });

  it('policy: the inputs name a policy the snapshot lacks', async () => {
    const report = await replay({ ...snapshot, policies: new Map() });
    expect(report.mismatched).toBe(13);
    expect(report.byField.policy).toBe(13);
    expect(new Set(report.mismatches.map((m) => m.stored))).toEqual(new Set([stored('c1').policyHash]));
  });

  it('subject: the claim is missing, or was first seen after computedAt', async () => {
    const claims = snapshot.claims.filter((claim) => claim.id !== CLAIMS.c11.id);
    expect((await replay({ ...snapshot, claims })).mismatches).toEqual([
      one('c11', 'subject', CLAIMS.c11.id, null),
    ]);
    const late = { ...CLAIMS.c11, observedAt: IsoTs.parse(isoAt(Date.parse(T1) + MS_PER_HOUR, 0)) };
    const seenLate = snapshot.claims.map((claim) => (claim.id === late.id ? late : claim));
    expect((await replay({ ...snapshot, claims: seenLate })).mismatches).toEqual([
      one('c11', 'subject', CLAIMS.c11.id, null),
    ]);
  });
});

describe('a receipt that cannot be graded again says why: orphans', () => {
  it('subject: the UNASKED receipt names no observation, or one the snapshot lacks', async () => {
    const observations = snapshot.observations.filter((o) => o.id !== OBSERVATIONS.o9.id);
    expect((await replay({ ...snapshot, observations })).mismatches).toEqual([
      one('u9', 'subject', OBSERVATIONS.o9.id, null),
    ]);
    const nameless = await replay(withReceipt('u9', (r) => ({ ...r, observationIds: [] })));
    expect(nameless.mismatches.filter((m) => m.receiptId === receiptIdOf('u9'))).toEqual([
      one('u9', 'subject', null, null),
    ]);
  });

  it('orphan: an override had taken the observation by computedAt (a second row for o9 graded at T2)', async () => {
    const again: Receipt = { ...stored('u9'), computedAt: IsoTs.parse(T2) };
    const report = await replay({ ...snapshot, receipts: [...snapshot.receipts, again] });
    expect(report.mismatches).toEqual([one('u9', 'orphan', OBSERVATIONS.o9.id, 'taken')]);
    expect(report).toMatchObject({ receipts: 14, mismatched: 1 });
  });

  it('orphan: no coverage window of its own source saw the observation (§3), so no batch made it an orphan', async () => {
    const inputsHash = stored('u9').inputsHash;
    const inputs = snapshot.receiptInputs.get(inputsHash);
    if (inputs === undefined) throw new Error('no inputs');
    const blind = { ...inputs, coverage: { ...inputs.coverage, observers: [] } };
    const receiptInputs = new Map(snapshot.receiptInputs).set(inputsHash, blind);
    const report = await replay({ ...snapshot, receiptInputs });
    expect(report.mismatches).toEqual([one('u9', 'orphan', OBSERVATIONS.o9.id, 'uncovered')]);
  });
});

describe('a receipt that cannot be graded again says why: errors', () => {
  it('error: grade() refuses the inputs (a grant of another agent), named by error and code only', async () => {
    const inputsHash = stored('c11').inputsHash;
    const inputs = snapshot.receiptInputs.get(inputsHash);
    if (inputs === undefined) throw new Error('no inputs');
    const grant = Grant.parse({ ...inputs.grant, agent: 'claude' });
    const receiptInputs = new Map(snapshot.receiptInputs).set(inputsHash, { ...inputs, grant });
    const report = await replay({ ...snapshot, receiptInputs });
    expect(report.mismatches).toEqual([one('c11', 'error', null, 'GradeError:agent_mismatch')]);
  });

  it('error: fixed pairs that are not one-to-one stop every receipt of the batch that needs them', async () => {
    const conflicting = withReceipt('c4', (r) => ({ ...r, observationIds: [OBSERVATIONS.o1.id] }));
    const orphanAtT2: Receipt = { ...stored('u9'), computedAt: IsoTs.parse(T2) };
    const report = await replay({ ...conflicting, receipts: [...conflicting.receipts, orphanAtT2] });
    const errors = report.mismatches.filter((m) => m.field === 'error');
    expect(errors.map((m) => m.replayed)).toEqual(Array(6).fill('CandidatesError:fixed_conflict'));
    const refs: ReceiptRef[] = ['c2', 'c3', 'c6', 'c8', 'c10', 'u9'];
    expect(new Set(errors.map((m) => m.receiptId))).toEqual(new Set(refs.map(receiptIdOf)));
    // c4 itself (graded at T1, before the conflict) is named for the evidence it does not hold.
    expect(report.mismatches).toEqual([
      one('c4', 'observationIds', `["${OBSERVATIONS.o1.id}"]`, '[]'),
      ...errors,
    ]);
  });

  it('error: evidence canonical JSON cannot hash (a non-finite number) is reported, never thrown', async () => {
    const broken = { ...OBSERVATIONS.o1, amountCents: Number.NaN };
    const observations = snapshot.observations.map((o) => (o.id === broken.id ? broken : o));
    const report = await replay({ ...snapshot, observations });
    expect(report.mismatches).toEqual([one('c1', 'error', null, 'HashError:non_finite_number')]);
  });

  it('error: an error without a code is named by its name alone, never by its message', async () => {
    const inputsHash = stored('c11').inputsHash;
    const inputs = snapshot.receiptInputs.get(inputsHash);
    if (inputs === undefined) throw new Error('no inputs');
    const coverage = Object.defineProperty({ ...inputs.coverage }, 'observers', {
      get: () => {
        throw new TypeError('secret detail');
      },
    });
    const receiptInputs = new Map(snapshot.receiptInputs).set(inputsHash, { ...inputs, coverage });
    const report = await replay({ ...snapshot, receiptInputs });
    expect(report.mismatches).toEqual([one('c11', 'error', null, 'TypeError')]);
  });
});

describe('the report', () => {
  it('counts per field, in REPLAY_FIELDS order, and lists receipts by instant, then id, then field', async () => {
    const tampered = {
      ...snapshot,
      receipts: snapshot.receipts.map((r) => {
        if (r.id === receiptIdOf('c8')) return { ...r, grade: 'PARTIAL' as const, ruleId: 'partial' };
        if (r.id === receiptIdOf('c11')) return { ...r, state: 'PENDING' as const };
        return r;
      }),
    };
    const report = await replay(tampered);
    expect(Object.keys(report.byField)).toEqual([...REPLAY_FIELDS]);
    expect(report.byField).toMatchObject({ grade: 1, ruleId: 1, state: 1, inputsHash: 0 });
    expect(report.mismatches.map((m) => [m.receiptId, m.field])).toEqual([
      [receiptIdOf('c11'), 'state'],
      [receiptIdOf('c8'), 'grade'],
      [receiptIdOf('c8'), 'ruleId'],
    ]);
    expect(report).toMatchObject({ receipts: 13, batches: 2, reproduced: 11, mismatched: 2 });
  });

  it('does not depend on the order of claims, observations or receipts, and is the same twice', async () => {
    const tampered = withReceipt('c4', (r) => ({ ...r, grade: 'VERIFIED' }));
    const reversed = {
      ...tampered,
      claims: [...tampered.claims].reverse(),
      observations: [...tampered.observations].reverse(),
      receipts: [...tampered.receipts].reverse(),
    };
    const [a, b, c] = await Promise.all([replay(tampered), replay(reversed), replay(tampered)]);
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(canonicalJson(c)).toBe(canonicalJson(a));
  });
});

describe('the report, on odd snapshots', () => {
  it('never changes the snapshot it reads', async () => {
    const before = canonicalJson([snapshot.claims, snapshot.observations, snapshot.receipts]);
    await replay(snapshot);
    expect(canonicalJson([snapshot.claims, snapshot.observations, snapshot.receipts])).toBe(before);
  });

  it('reads a row listed twice once: an observation, and a claim whose latest grading decides its batches', async () => {
    const o3 = snapshot.observations.find((o) => o.id === OBSERVATIONS.o3.id);
    if (o3 === undefined) throw new Error('no o3');
    const c3 = stored('c3');
    // An older row for c3 (computed at T1): if it decided c3's batches, c3 would be in no batch at T2. The row
    // itself is not reproduced (its inputs say T2), and nothing else is touched.
    const older: Receipt = { ...c3, computedAt: IsoTs.parse(T1) };
    for (const receipts of [
      [older, ...snapshot.receipts],
      [...snapshot.receipts, older],
    ]) {
      const report = await replay({ ...snapshot, observations: [...snapshot.observations, o3], receipts });
      expect(report).toMatchObject({ receipts: 14, mismatched: 1 });
      expect(report.mismatches).toEqual([one('c3', 'computedAt', T1, T2)]);
    }
  });

  it('replays an empty ledger as nothing to do', async () => {
    const empty = { ...snapshot, receipts: [] };
    expect(await replay(empty)).toMatchObject({ receipts: 0, batches: 0, reproduced: 0, mismatches: [] });
  });
});
