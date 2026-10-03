/**
 * gradeBatch returns every receipt with the inputs it was graded with (docs/grading.md §3, v1.4):
 * `{receipt, inputs: {grant, context, policyHash}}`, the coverage being the batch's own, so the caller can store
 * `receiptInputs` for replay (§9). These tests prove the inputs are exactly what grading used: `grade()` called on
 * the receipt's subject with those inputs and the batch's coverage gives the identical receipt, and the grant is
 * the one in force at evaluatedAt. Inputs are built with the golden loader.
 */
import { describe, expect, it } from 'vitest';

import { type BatchReceipt, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { grade } from '../../../src/core/grade';
import { canonicalJson } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import { receiptId } from '../../../src/core/receipt';
import { Grant, type Observation } from '../../../src/core/schema';
import { buildScenario, type LoadedScenario } from '../../golden/load';
import { Scenario } from '../../golden/scenario-schema';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const GMAIL = {
  source: 'gmail.sent',
  lastSyncAt: EVALUATED_AT,
  windowStart: '2026-10-06T12:00:00-04:00',
  windowEnd: EVALUATED_AT,
  accountHash: 'acct-a',
} as const;
const RECEIPTS = { ...GMAIL, source: 'gmail.receipt' } as const;
/** muse in session at 14:00 and the user idle 13:55–14:10: an orphan at 14:01–14:10 scores 7/10 for muse. */
const MUSE_ACTIVE = {
  sessions: [{ agent: 'muse', at: '2026-10-06T14:00:00-04:00' }],
  idle: [{ from: '2026-10-06T13:55:00-04:00', to: '2026-10-06T14:10:00-04:00' }],
  adapterSyncs: [{ agent: 'muse', lastSyncAt: '2026-10-06T14:50:00-04:00' }],
} as const;

const sent = (ref: string, counterparty: string, subjectHint: string, occurredAt: string) =>
  ({ ref, source: 'gmail.sent', type: 'email.sent', counterparty, subjectHint, occurredAt }) as const;
const email = (ref: string, counterparty: string, subjectHint: string, claimedAt: string) =>
  ({ ref, agent: 'muse', type: 'email.sent', counterparty, subjectHint, claimedAt }) as const;
const purchase = (ref: string, amountCents: number, claimedAt: string) =>
  ({
    ref,
    agent: 'muse',
    type: 'purchase.made',
    counterparty: 'acme',
    amountCents,
    currency: 'USD',
    claimedAt,
  }) as const;

/** A batch scenario built by the golden loader; `input` is validated by the scenario schema. */
function load(input: Record<string, unknown>): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'batch inputs unit',
    covers: ['test:batch'],
    mode: 'batch',
    input: {
      evaluatedAt: EVALUATED_AT,
      claims: [],
      observations: [],
      grants: [{ agent: 'muse' }],
      coverage: [],
      ...input,
    },
    expect: [],
  });
  return buildScenario('batch-inputs.spec.json', scenario);
}

async function run(loaded: LoadedScenario, grants = loaded.grants): Promise<BatchReceipt[]> {
  const index = createMemoryIndex([...loaded.observations.values()], 15);
  const policy = loadPolicy(loaded.policyJson);
  const { batchClaims, coverage, activity, fixed } = loaded;
  return gradeBatch(batchClaims, index, grants, policy, coverage, activity, fixed);
}

function claim(loaded: LoadedScenario, ref: string) {
  const found = loaded.claims.get(ref);
  if (found === undefined) throw new Error(`no claim ${ref}`);
  return found;
}

function entryOf(graded: readonly BatchReceipt[], id: string): BatchReceipt {
  const found = graded.find(({ receipt }) => receipt.id === id);
  if (found === undefined) throw new Error(`no receipt ${id}`);
  return found;
}

/** The observations a receipt names, as the loader built them. */
function evidenceOf(loaded: LoadedScenario, entry: BatchReceipt): Observation[] {
  const byId = new Map([...loaded.observations.values()].map((o) => [o.id as string, o]));
  return entry.receipt.observationIds.flatMap((id) => byId.get(id) ?? []);
}

describe('gradeBatch returns each receipt with the inputs it was graded with (§3)', () => {
  it('claim receipts: the grant in force, {priorSpendCents}, the policy hash; grade() from them agrees', async () => {
    const loaded = load({
      claims: [
        email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
        purchase('c2', 3_000, '2026-10-06T10:00:00-04:00'),
        purchase('c3', 4_000, '2026-10-06T11:00:00-04:00'),
      ],
      observations: [sent('o1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00')],
      grants: [{ agent: 'muse', spendCeilingCents: 10_000, spendCurrency: 'USD' }],
      coverage: [GMAIL, RECEIPTS],
    });
    const policy = loadPolicy(loaded.policyJson);
    const graded = await run(loaded);
    expect(graded).toHaveLength(3);
    const [grant] = loaded.grants;
    const prior = { c1: 0, c2: 0, c3: 3_000 } as const;
    for (const ref of ['c1', 'c2', 'c3'] as const) {
      const subject = claim(loaded, ref);
      const entry = entryOf(graded, receiptId({ k: 'claim', claimId: subject.id }));
      expect(entry.inputs.grant, ref).toBe(grant);
      expect(entry.inputs.context, ref).toEqual({ priorSpendCents: prior[ref] });
      expect(entry.inputs.policyHash, ref).toBe(policy.policyHash);
      const { context } = entry.inputs;
      const again = grade(
        subject,
        evidenceOf(loaded, entry),
        entry.inputs.grant,
        policy,
        loaded.coverage,
        context,
      );
      expect(canonicalJson(again), ref).toBe(canonicalJson(entry.receipt));
    }
    expect(entryOf(graded, receiptId({ k: 'claim', claimId: claim(loaded, 'c1').id })).receipt.grade).toBe(
      'VERIFIED',
    );
  });

  it('names the grant in force at evaluatedAt: the latest not after it, never a later one', async () => {
    const loaded = load({
      claims: [email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00')],
      coverage: [GMAIL],
    });
    const [base] = loaded.grants;
    if (base === undefined) throw new Error('no grant');
    const older = Grant.parse({ ...base, updatedAt: '2026-10-01T00:00:00-04:00' });
    const inForce = Grant.parse({ ...base, allowedTypes: ['email.sent'], updatedAt: EVALUATED_AT });
    const later = Grant.parse({ ...base, allowedTypes: [], updatedAt: '2026-10-06T15:00:00.001-04:00' });
    const [entry] = await run(loaded, [later, older, inForce]);
    expect(entry?.inputs.grant).toBe(inForce);
    expect(entry?.receipt.ruleId).toBe('not_found');
  });
});

describe('gradeBatch returns the inputs of a receipt without a claim (§3)', () => {
  it('an UNASKED receipt: the attributed agent’s grant and {priorSpendCents: 0, attribution}', async () => {
    const loaded = load({
      observations: [sent('o1', 'vendor@supplier.example', 'Re: invoice', '2026-10-06T14:03:00-04:00')],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    const policy = loadPolicy(loaded.policyJson);
    const [entry, ...rest] = await run(loaded);
    expect(rest).toEqual([]);
    if (entry === undefined) throw new Error('no receipt');
    expect(entry.receipt.grade).toBe('UNASKED');
    expect(entry.inputs.grant).toBe(loaded.grants[0]);
    expect(entry.inputs.policyHash).toBe(policy.policyHash);
    expect(entry.inputs.context).toEqual({
      priorSpendCents: 0,
      attribution: {
        agent: 'muse',
        scoreBp: 7_000,
        signals: ['agentSessionActive', 'userIdle'],
        adapterLastSyncAt: '2026-10-06T14:50:00-04:00',
      },
    });
    const again = grade(null, evidenceOf(loaded, entry), entry.inputs.grant, policy, loaded.coverage, {
      ...entry.inputs.context,
    });
    expect(canonicalJson(again)).toBe(canonicalJson(entry.receipt));
  });

  it('a scope-diff receipt: its agent’s grant and {priorSpendCents: 0, scope: {observed}}', async () => {
    const loaded = load({
      grants: [
        { agent: 'muse', declaredScopes: ['gmail.send'], observedScopes: ['gmail.send', 'gmail.read'] },
      ],
    });
    const policy = loadPolicy(loaded.policyJson);
    const [entry, ...rest] = await run(loaded);
    expect(rest).toEqual([]);
    if (entry === undefined) throw new Error('no receipt');
    expect(entry.receipt.id).toBe(receiptId({ k: 'scope', agent: 'muse', scope: 'gmail.read' }));
    expect(entry.receipt.grade).toBe('OVER_SCOPE');
    expect(entry.inputs).toEqual({
      grant: loaded.grants[0],
      context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } },
      policyHash: policy.policyHash,
    });
    const again = grade(null, [], entry.inputs.grant, policy, loaded.coverage, entry.inputs.context);
    expect(canonicalJson(again)).toBe(canonicalJson(entry.receipt));
  });
});

describe('gradeBatch pairs every receipt with its own inputs (§3)', () => {
  it('pairs each receipt with its own inputs, ordered by receipt id', async () => {
    const loaded = load({
      claims: [
        email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
        email('c2', 'raj@company.com', 'budget', '2026-10-06T14:20:00-04:00'),
      ],
      observations: [sent('o1', 'vendor@supplier.example', 'Re: invoice', '2026-10-06T14:03:00-04:00')],
      grants: [{ agent: 'muse', declaredScopes: [], observedScopes: ['gmail.read'] }],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    const graded = await run(loaded);
    const ids = graded.map(({ receipt }) => receipt.id);
    expect(ids).toEqual([...ids].sort());
    expect(graded).toHaveLength(4);
    for (const { receipt, inputs } of graded) {
      const kind =
        receipt.claimId !== undefined ? 'claim' : receipt.grade === 'UNASKED' ? 'unasked' : 'scope';
      expect(Object.keys(inputs.context).sort(), kind).toEqual(
        {
          claim: ['priorSpendCents'],
          unasked: ['attribution', 'priorSpendCents'],
          scope: ['priorSpendCents', 'scope'],
        }[kind],
      );
    }
  });
});
