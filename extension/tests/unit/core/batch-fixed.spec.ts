/**
 * gradeBatch (docs/grading.md §3, §4.3, §6.1, §6.3): fixed pre-assignments and taken observations, scope-diff
 * receipts, the grant in force at evaluatedAt, cumulative spend read from activity.claims, and the typed
 * errors for batches that cannot be graded exactly. Inputs are built with the golden loader.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicy from '../../../../policy/default.json';

import { type BatchErrorCode, type BatchFixed, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { sha256Hex } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import { type Grant, IsoTs, type Receipt, type Ulid } from '../../../src/core/schema';
import { buildScenario, type LoadedScenario, receiptIdFor } from '../../golden/load';
import { Scenario } from '../../golden/scenario-schema';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const GMAIL = {
  source: 'gmail.sent',
  lastSyncAt: EVALUATED_AT,
  windowStart: '2026-10-06T12:00:00-04:00',
  windowEnd: EVALUATED_AT,
  accountHash: 'acct-a',
} as const;
const MUSE_ACTIVE = {
  sessions: [{ agent: 'muse', at: '2026-10-06T14:00:00-04:00' }],
  idle: [{ from: '2026-10-06T13:55:00-04:00', to: '2026-10-06T14:10:00-04:00' }],
  adapterSyncs: [{ agent: 'muse', lastSyncAt: '2026-10-06T14:50:00-04:00' }],
} as const;

const sent = (ref: string, counterparty: string, subjectHint: string, occurredAt: string) =>
  ({ ref, source: 'gmail.sent', type: 'email.sent', counterparty, subjectHint, occurredAt }) as const;
const email = (ref: string, counterparty: string, subjectHint: string, claimedAt: string) =>
  ({ ref, agent: 'muse', type: 'email.sent', counterparty, subjectHint, claimedAt }) as const;

/** A batch scenario built by the golden loader (`input` and `policyPatch` are validated as in a scenario file). */
function load(input: Record<string, unknown>, policyPatch: Record<string, unknown> = {}): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'batch unit',
    covers: ['test:batch'],
    mode: 'batch',
    policyPatch,
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
  return buildScenario('batch-fixed.spec.json', scenario);
}

interface Overrides {
  readonly fixed?: readonly BatchFixed[];
  readonly grants?: readonly Grant[];
  readonly claims?: LoadedScenario['batchClaims'];
}

async function run(loaded: LoadedScenario, overrides: Overrides = {}): Promise<Receipt[]> {
  const index = createMemoryIndex([...loaded.observations.values()], 15);
  const graded = await gradeBatch(
    overrides.claims ?? loaded.batchClaims,
    index,
    overrides.grants ?? loaded.grants,
    loadPolicy(loaded.policyJson),
    loaded.coverage,
    loaded.activity,
    overrides.fixed ?? loaded.fixed,
  );
  return graded.map((entry) => entry.receipt);
}

const claimId = (loaded: LoadedScenario, ref: string): Ulid => {
  const claim = loaded.claims.get(ref);
  if (claim === undefined) throw new Error(`no claim ${ref}`);
  return claim.id;
};
const observationId = (loaded: LoadedScenario, ref: string): Ulid => {
  const observation = loaded.observations.get(ref);
  if (observation === undefined) throw new Error(`no observation ${ref}`);
  return observation.id;
};
/** The shape of a typed BatchError with `code` (its class and code are what callers branch on). */
const batchError = (code: BatchErrorCode) => ({ name: 'BatchError', code });

const claimReceiptId = (loaded: LoadedScenario, ref: string) =>
  receiptIdFor({ k: 'claim', claimId: claimId(loaded, ref) });

/**
 * c9 is FINAL with o9; o3 is fixed as taken by an overridden UNASKED receipt. c1 would score 1/1 against either,
 * so only the fixing keeps them away; muse's activity would make either an UNASKED orphan.
 */
const fixedScenario = () =>
  load({
    claims: [
      email('c9', 'priya@company.com', 'Q3 deck', '2026-10-06T13:59:00-04:00'),
      email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
    ],
    observations: [
      sent('o9', 'priya@company.com', 'Q3 deck', '2026-10-06T14:01:30-04:00'),
      sent('o3', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
      sent('o2', 'raj@company.com', 'Q3 budget', '2026-10-06T14:02:00-04:00'),
    ],
    coverage: [GMAIL],
    activity: MUSE_ACTIVE,
    fixed: [
      { claim: 'c9', observation: 'o9' },
      { claim: null, observation: 'o3' },
    ],
  });

describe('gradeBatch: fixed pre-assignments and taken observations (§4.3)', () => {
  const scenario = fixedScenario;

  it('keeps fixed and taken observations from every other claim and from the orphans', async () => {
    const loaded = scenario();
    const receipts = await run(loaded);
    expect(receipts.map((r) => [r.id, r.grade, r.ruleId, r.observationIds])).toEqual([
      [claimReceiptId(loaded, 'c1'), 'PARTIAL', 'partial', [observationId(loaded, 'o2')]],
    ]);
  });

  it('without the fixing, the same inputs give c1 the exact match and leave an orphan', async () => {
    const loaded = scenario();
    const receipts = await run(loaded, { fixed: [], claims: [...loaded.claims.values()] });
    const graded = receipts.filter((r) => r.claimId !== undefined).map((r) => r.grade);
    expect(graded.sort()).toEqual(['VERIFIED', 'VERIFIED']);
    expect(receipts.filter((r) => r.grade === 'UNASKED')).toHaveLength(1);
  });
});

describe('gradeBatch: pre-assignments that cannot be graded exactly throw (Hard Rule 6)', () => {
  const scenario = fixedScenario;

  it('throws claim_fixed for a claim that is graded and also fixed (a FINAL claim is never regraded)', async () => {
    const loaded = scenario();
    const all = [...loaded.claims.values()];
    await expect(run(loaded, { claims: all })).rejects.toMatchObject(batchError('claim_fixed'));
  });

  it('throws duplicate_claim for a claim given twice', async () => {
    const loaded = scenario();
    const c1 = loaded.claims.get('c1');
    if (c1 === undefined) throw new Error('no c1');
    await expect(run(loaded, { claims: [c1, c1] })).rejects.toMatchObject(batchError('duplicate_claim'));
  });

  it('throws CandidatesError(fixed_conflict) for fixed pairs that are not one-to-one', async () => {
    const loaded = scenario();
    const fixed = [
      { observationId: observationId(loaded, 'o9'), claimId: claimId(loaded, 'c9') },
      { observationId: observationId(loaded, 'o2'), claimId: claimId(loaded, 'c9') },
    ];
    await expect(run(loaded, { fixed })).rejects.toMatchObject({
      name: 'CandidatesError',
      code: 'fixed_conflict',
    });
  });
});

const SCOPE_GRANTS = [
  {
    agent: 'muse',
    declaredScopes: ['gmail.send'],
    observedScopes: ['gmail.read', 'gmail.send', 'gmail.read'],
  },
  { agent: 'chatgpt', declaredScopes: ['gmail.send'], observedScopes: ['gmail.send'] },
];

describe('gradeBatch: scope-diff receipts (§6.1)', () => {
  const grants = SCOPE_GRANTS;

  it('returns one OVER_SCOPE receipt per undeclared observed scope, keyed by {agent, scope}', async () => {
    const receipts = await run(load({ grants }));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: receiptIdFor({ k: 'scope', agent: 'muse', scope: 'gmail.read' }),
      agent: 'muse',
      grade: 'OVER_SCOPE',
      ruleId: 'over_scope_observed',
      observationIds: [],
      state: 'FINAL',
    });
    expect(receipts[0]?.claimId).toBeUndefined();
    expect(receipts[0]?.reasons).toEqual([
      { code: 'scope.observed_not_declared', params: { scopeHash: sha256Hex('gmail.read') } },
    ]);
  });
});

describe('gradeBatch: the grant in force at evaluatedAt (§3)', () => {
  const grants = SCOPE_GRANTS;

  it('reads the grant in force at evaluatedAt: the latest not after it; a later one is ignored', async () => {
    const loaded = load({ grants });
    const [muse] = loaded.grants;
    if (muse === undefined) throw new Error('no grant');
    const later = {
      ...muse,
      observedScopes: ['gmail.send'],
      updatedAt: IsoTs.parse('2026-10-06T14:00:00-04:00'),
    };
    const future = {
      ...muse,
      observedScopes: ['calendar.write'],
      updatedAt: IsoTs.parse('2026-10-06T16:00:00-04:00'),
    };
    expect(await run(loaded, { grants: [future, later, muse] })).toEqual([]);
    const futureOnly = await run(loaded, { grants: [future, muse] });
    expect(futureOnly.map((r) => r.id)).toEqual([
      receiptIdFor({ k: 'scope', agent: 'muse', scope: 'gmail.read' }),
    ]);
  });

  it('returns none when the policy grades an undeclared scope as anything but OVER_SCOPE (§3)', async () => {
    const rules = defaultPolicy.rules.map((rule) =>
      rule.id === 'over_scope_observed' ? { ...rule, then: 'UNVERIFIABLE' } : rule,
    );
    expect(await run(load({ grants }, { rules }))).toEqual([]);
  });

  it('throws ambiguous_grant for two grants of one agent in force from the same instant', async () => {
    const loaded = load({ grants });
    const [muse] = loaded.grants;
    if (muse === undefined) throw new Error('no grant');
    const twin = { ...muse, declaredScopes: [] };
    await expect(run(loaded, { grants: [muse, twin] })).rejects.toMatchObject(batchError('ambiguous_grant'));
  });
});

describe('gradeBatch: grants and cumulative spend', () => {
  it('throws missing_grant for a claim whose agent has no grant in force (core never invents one)', async () => {
    const loaded = load({
      claims: [
        { ...email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'), agent: 'claude' },
      ],
      coverage: [GMAIL],
    });
    await expect(run(loaded)).rejects.toMatchObject(batchError('missing_grant'));
  });

  it('throws missing_grant for an orphan attributed to an agent with no grant', async () => {
    const loaded = load({
      observations: [sent('o1', 'vendor@supplier.example', 'Re: invoice', '2026-10-06T14:03:00-04:00')],
      coverage: [GMAIL],
      activity: { ...MUSE_ACTIVE, sessions: [{ agent: 'dots', at: '2026-10-06T14:00:00-04:00' }] },
    });
    await expect(run(loaded)).rejects.toMatchObject(batchError('missing_grant'));
  });

  it('sums prior spend over activity.claims (FINAL claims included), not over the batch alone (§6.3)', async () => {
    // c9 (3000 USD, FINAL, not graded) and c1 (3000 USD) against a 5000 USD ceiling.
    const purchase = (ref: string, claimedAt: string) =>
      ({
        ref,
        agent: 'muse',
        type: 'purchase.made',
        counterparty: 'acme',
        amountCents: 3000,
        currency: 'USD',
        claimedAt,
      }) as const;
    const input = {
      claims: [purchase('c9', '2026-10-06T10:02:00-04:00'), purchase('c1', '2026-10-06T11:02:00-04:00')],
      grants: [{ agent: 'muse', spendCeilingCents: 5000, spendCurrency: 'USD' }],
    };
    const withHistory = load(input);
    const c1 = withHistory.claims.get('c1');
    if (c1 === undefined) throw new Error('no c1');
    const [receipt] = await run(withHistory, { claims: [c1] });
    expect(receipt?.ruleId).toBe('over_ceiling_cumulative');
    expect(receipt?.reasons[0]).toEqual({
      code: 'ceiling.cumulative_exceeded',
      params: { priorSpendCents: 3000, amountCents: 3000, ceilingCents: 5000 },
    });
    const batchOnly = load({ ...input, activity: { claims: ['c1'] } });
    const [alone] = await run(batchOnly, { claims: [c1] });
    expect(alone?.ruleId).not.toBe('over_ceiling_cumulative');
    const noHistory = load({ ...input, activity: { claims: [] } });
    const [fresh] = await run(noHistory, { claims: [c1] });
    expect(fresh?.ruleId).toBe(alone?.ruleId);
  });
});
