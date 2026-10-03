/**
 * Replay names exactly what was tampered with (docs/grading.md §9, §10; task 1.9), on many random synthetic
 * ledgers (tests/tools/attest-ledger.ts):
 *  - a computed field no later batch reads (grade, ruleId, agent, requestId, confidence, reasons, signals,
 *    policyHash, attribution, finalAt): exactly one mismatch, on that receipt and that field;
 *  - a field the timeline reads (state, observationIds, computedAt): that receipt on that field, and otherwise only
 *    receipts graded later (what a stored row fixes starts after its own batch, §4.3);
 *  - the grant of one receipt's `receiptInputs` row: exactly one `inputsHash` mismatch, on that receipt;
 *  - an observation's content edited under its old `contentHash`: every receipt holding it is named, and every
 *    `contentHash` mismatch carries the old hash and the hash of the edited content (never the content).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hex } from '../../src/core/hash';
import { type LedgerSnapshot, replay, type ReplayField } from '../../src/core/replay';
import { AgentId, IsoTs, type Receipt, Sha256, Ulid } from '../../src/core/schema';
import { simulate } from '../tools/attest-ledger';

/** qa_tester rule 4: every core property runs at least 1,000 examples. */
const RUNS = 1_000;

/** Small ledgers (1–20 claims, 1–100 observations, 2–4 batches), so 1,000 of them stay cheap. */
const ledgerArb = fc.record({
  seed: fc.integer({ min: 0, max: 0x7fff_ffff }),
  claims: fc.integer({ min: 1, max: 20 }),
  observations: fc.integer({ min: 1, max: 100 }),
  batches: fc.integer({ min: 2, max: 4 }),
  overridesPerGap: fc.integer({ min: 0, max: 3 }),
  pick: fc.nat(),
});

function at<T>(items: readonly T[], pick: number): T {
  const item = items[pick % items.length];
  if (item === undefined) throw new Error('empty list');
  return item;
}

function withReceipt(snapshot: LedgerSnapshot, target: Receipt, next: Receipt): LedgerSnapshot {
  return { ...snapshot, receipts: snapshot.receipts.map((receipt) => (receipt === target ? next : receipt)) };
}

const UNUSED_ID = Ulid.parse('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');

/** Each computed field no later batch reads, and a change that makes it differ from what grading wrote. */
const UNREAD_FIELDS: readonly (readonly [ReplayField, (r: Receipt) => Receipt])[] = [
  ['grade', (r) => ({ ...r, grade: r.grade === 'PARTIAL' ? 'VERIFIED' : 'PARTIAL' })],
  ['ruleId', (r) => ({ ...r, ruleId: r.ruleId === 'partial' ? 'verified' : 'partial' })],
  [
    'agent',
    (r) => ({
      ...r,
      agent: at(
        AgentId.options.filter((a) => a !== r.agent),
        0,
      ),
    }),
  ],
  ['requestId', (r) => ({ ...r, requestId: r.requestId === undefined ? UNUSED_ID : undefined })],
  ['confidence', (r) => ({ ...r, confidence: r.confidence === 0 ? 1 : 0 })],
  ['reasons', (r) => ({ ...r, reasons: [{ code: 'cp.plus_tag', params: {} }, ...r.reasons] })],
  ['signals', (r) => ({ ...r, signals: { ...r.signals, score: (r.signals.score ?? 0) + 1 } })],
  ['policyHash', (r) => ({ ...r, policyHash: Sha256.parse('f'.repeat(64)) })],
  ['attribution', (r) => ({ ...r, attribution: r.attribution === undefined ? 'likely' : undefined })],
  ['finalAt', (r) => ({ ...r, finalAt: r.finalAt === undefined ? r.computedAt : undefined })],
];

/**
 * Evidence the receipt does not hold: a claim receipt holding an observation releases it, an UNASKED receipt keeps
 * naming its orphan first (its subject) and names one more, any other receipt names one it never had.
 */
function otherEvidence(receipt: Receipt): Ulid[] {
  if (receipt.observationIds.length === 0) return [UNUSED_ID];
  return receipt.claimId === undefined ? [...receipt.observationIds, UNUSED_ID] : [];
}

/** Each field the timeline reads (replay-timeline.ts), and a change that makes it differ. */
const TIMELINE_FIELDS: readonly (readonly [ReplayField, (r: Receipt) => Receipt])[] = [
  [
    'state',
    (r) =>
      r.override === undefined
        ? { ...r, state: r.state === 'FINAL' ? 'PENDING' : 'FINAL' }
        : {
            ...r,
            override: {
              ...r.override,
              previousState: r.override.previousState === 'FINAL' ? 'PENDING' : 'FINAL',
            },
          },
  ],
  ['observationIds', (r) => ({ ...r, observationIds: otherEvidence(r) })],
  [
    'computedAt',
    (r) => ({ ...r, computedAt: IsoTs.parse(new Date(Date.parse(r.computedAt) + 1).toISOString()) }),
  ],
];

describe('one tampered receipt field', () => {
  it('a field no later batch reads is exactly one mismatch, on that receipt', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        if (snapshot.receipts.length === 0) return;
        const target = at(snapshot.receipts, pick);
        const [field, change] = at(UNREAD_FIELDS, pick);
        const report = await replay(withReceipt(snapshot, target, change(target)));
        expect(report.mismatches.map((m) => [m.receiptId, m.field])).toEqual([[target.id, field]]);
        expect(report).toMatchObject({ mismatched: 1, reproduced: snapshot.receipts.length - 1 });
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('a field the timeline reads names that receipt, and otherwise only receipts graded after it', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        if (snapshot.receipts.length === 0) return;
        const target = at(snapshot.receipts, pick);
        const [field, change] = at(TIMELINE_FIELDS, pick);
        const report = await replay(withReceipt(snapshot, target, change(target)));
        const own = report.mismatches.filter((m) => m.receiptId === target.id);
        expect(own.map((m) => m.field)).toContain(field);
        const computedMs = new Map(snapshot.receipts.map((r) => [r.id, Date.parse(r.computedAt)]));
        const targetMs = Date.parse(target.computedAt);
        for (const other of report.mismatches.filter((m) => m.receiptId !== target.id)) {
          expect(computedMs.get(other.receiptId)).toBeGreaterThan(targetMs);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});

describe('tampered inputs and evidence', () => {
  it("one receipt's grant in receiptInputs is exactly one inputsHash mismatch", async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        if (snapshot.receipts.length === 0) return;
        const target = at(snapshot.receipts, pick);
        const inputs = snapshot.receiptInputs.get(target.inputsHash);
        if (inputs === undefined) throw new Error('every stored receipt has its inputs');
        // A declared scope nothing observes: the grant's hash moves, no outcome can.
        const grant = { ...inputs.grant, declaredScopes: [...inputs.grant.declaredScopes, 'tamper.unused'] };
        const receiptInputs = new Map(snapshot.receiptInputs).set(target.inputsHash, { ...inputs, grant });
        const report = await replay({ ...snapshot, receiptInputs });
        expect(report.mismatches.map((m) => [m.receiptId, m.field])).toEqual([[target.id, 'inputsHash']]);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('an observation edited under its old contentHash is named on the receipts graded with it', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        const held = snapshot.receipts.filter((r) => r.observationIds.length > 0);
        if (held.length === 0) return;
        const holder = at(held, pick);
        const [heldId] = holder.observationIds;
        const original = snapshot.observations.find((o) => o.id === heldId);
        if (original === undefined) throw new Error('every held observation is in the snapshot');
        const edited = { ...original, subjectHint: `edited ${String(pick)}` };
        const observations = snapshot.observations.map((o) => (o === original ? edited : o));
        const report = await replay({ ...snapshot, observations });
        const recomputed = sha256Hex(
          canonicalJson({ ...edited, id: undefined, observedAt: undefined, contentHash: undefined }),
        );
        const named = report.mismatches.filter((m) => m.field === 'contentHash');
        expect(named.length).toBeGreaterThan(0);
        for (const one of named)
          expect(one).toMatchObject({ stored: original.contentHash, replayed: recomputed });
        const reported = new Set(report.mismatches.map((m) => m.receiptId));
        for (const receipt of held.filter((r) => r.observationIds.includes(original.id))) {
          expect(reported.has(receipt.id)).toBe(true);
        }
        expect(JSON.stringify(report)).not.toContain(edited.subjectHint);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
