/**
 * gradeBatch under attack (docs/grading.md §3, §4.3, §7, §8): a vague claim racing a specific one for the same
 * evidence, a FINAL UNASKED observation that a later claim takes, overrides that keep or free their evidence,
 * and several agents with several grant versions, each receipt compared with `grade()` called directly on the
 * inputs the contract names. Inputs are built with the golden loader, so every id is hash-derived.
 */
import { describe, expect, it } from 'vitest';

import { attribute } from '../../../src/core/attribution';
import { type BatchFixed, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { grade } from '../../../src/core/grade';
import { canonicalJson } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import { type Grant, IsoTs, type Receipt } from '../../../src/core/schema';
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
/** muse in session at 14:00, the user idle 13:55–14:10, muse's adapter synced at 14:50: 7/10, FINAL. */
const MUSE_ACTIVE = {
  sessions: [{ agent: 'muse', at: '2026-10-06T14:00:00-04:00' }],
  idle: [{ from: '2026-10-06T13:55:00-04:00', to: '2026-10-06T14:10:00-04:00' }],
  adapterSyncs: [{ agent: 'muse', lastSyncAt: '2026-10-06T14:50:00-04:00' }],
} as const;

const at = (time: string) => `2026-10-06T${time}:00-04:00`;
const sent = (ref: string, counterparty: string, subjectHint: string, time: string) =>
  ({
    ref,
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty,
    subjectHint,
    occurredAt: at(time),
  }) as const;
const email = (ref: string, counterparty: string, subjectHint: string, time: string, agent = 'muse') =>
  ({ ref, agent, type: 'email.sent', counterparty, subjectHint, claimedAt: at(time) }) as const;

function load(input: Record<string, unknown>): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'batch attacks',
    covers: ['test:batch'],
    mode: 'batch',
    input: { evaluatedAt: EVALUATED_AT, claims: [], observations: [], grants: [{ agent: 'muse' }], ...input },
    expect: [],
  });
  return buildScenario('batch-attacks.spec.json', scenario);
}

interface Overrides {
  readonly claims?: readonly string[];
  readonly fixed?: readonly BatchFixed[];
  readonly grants?: readonly Grant[];
}

/** gradeBatch over the scenario; `claims` names the PENDING claims by ref (default: the loader's batch). */
async function run(loaded: LoadedScenario, overrides: Overrides = {}): Promise<Receipt[]> {
  const claims = overrides.claims?.map((ref) => claimOf(loaded, ref)) ?? loaded.batchClaims;
  const index = createMemoryIndex([...loaded.observations.values()], 15);
  const { coverage, activity } = loaded;
  const grants = overrides.grants ?? loaded.grants;
  const fixed = overrides.fixed ?? loaded.fixed;
  return gradeBatch(claims, index, grants, loadPolicy(loaded.policyJson), coverage, activity, fixed);
}

function claimOf(loaded: LoadedScenario, ref: string) {
  const claim = loaded.claims.get(ref);
  if (claim === undefined) throw new Error(`no claim ${ref}`);
  return claim;
}

function observationOf(loaded: LoadedScenario, ref: string) {
  const observation = loaded.observations.get(ref);
  if (observation === undefined) throw new Error(`no observation ${ref}`);
  return observation;
}

/** Ref → [grade, ruleId, state, observation refs, agent] for every receipt. */
function summary(loaded: LoadedScenario, receipts: readonly Receipt[]): Record<string, unknown> {
  const refs = new Map<string, string>();
  for (const [ref, c] of loaded.claims) refs.set(receiptIdFor({ k: 'claim', claimId: c.id }), ref);
  for (const [ref, o] of loaded.observations)
    refs.set(receiptIdFor({ k: 'unasked', observationId: o.id }), ref);
  const obsRefs = new Map([...loaded.observations].map(([ref, o]) => [o.id as string, ref]));
  const entry = (r: Receipt) => [
    r.grade,
    r.ruleId,
    r.state,
    r.observationIds.map((id) => obsRefs.get(id)),
    r.agent,
  ];
  return Object.fromEntries(receipts.map((r) => [refs.get(r.id) ?? r.id, entry(r)]));
}

describe('gradeBatch: a vague claim never takes evidence (§4.3, §5.2)', () => {
  it('a vague claim that would win the tie on time leaves the observation to the specific claim', async () => {
    // Scored, the vague c1 (14:02, time only) would score o1 1/1 and win the tie on its earlier claimedAt;
    // c2 would then be NOT_FOUND. It is never scored, so c2 takes o1. o2 (4/9 for c2, below partial) lies in
    // c1's window too: the vague claim cannot hide it, so muse's activity makes it UNASKED.
    const loaded = load({
      claims: [
        { ref: 'c1', agent: 'muse', type: 'email.sent', claimedAt: at('14:02') },
        email('c2', 'priya@company.com', 'Q3 deck', '14:03'),
      ],
      observations: [
        sent('o1', 'priya@company.com', 'Q3 deck', '14:02'),
        sent('o2', 'raj@company.com', 'budget', '14:05'),
      ],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    const receipts = await run(loaded);
    expect(summary(loaded, receipts)).toEqual({
      c1: ['UNVERIFIABLE', 'underspecified', 'FINAL', [], 'muse'],
      c2: ['VERIFIED', 'verified', 'FINAL', ['o1'], 'muse'],
      o2: ['UNASKED', 'unasked', 'FINAL', ['o2'], 'muse'],
    });
    // Never scored means no candidate read at all: grade() sees an empty list, and inputsHash hashes none (§4.3).
    const [grant] = loaded.grants;
    if (grant === undefined) throw new Error('no grant');
    const policy = loadPolicy(loaded.policyJson);
    const vague = grade(claimOf(loaded, 'c1'), [], grant, policy, loaded.coverage, { priorSpendCents: 0 });
    expect(receipts.find((r) => r.id === vague.id)).toEqual(vague);
  });
});

/** An unclaimed send at 14:03 that muse's activity makes a FINAL UNASKED (7/10), and the claim that explains it. */
const UNASKED_THEN_CLAIMED = () =>
  load({
    claims: [email('c1', 'vendor@supplier.example', 'Re: invoice', '14:04')],
    observations: [sent('o1', 'vendor@supplier.example', 'Re: invoice', '14:03')],
    coverage: [GMAIL],
    activity: { ...MUSE_ACTIVE, claims: [] },
  });

describe('gradeBatch: FINAL UNASKED observations stay assignable; overridden ones are taken (§4.3, §7)', () => {
  it('a later claim takes an observation whose UNASKED receipt is FINAL, and no UNASKED is re-issued', async () => {
    const loaded = UNASKED_THEN_CLAIMED();
    expect(summary(loaded, await run(loaded, { claims: [] }))).toEqual({
      o1: ['UNASKED', 'unasked', 'FINAL', ['o1'], 'muse'],
    });
    // The FINAL UNASKED receipt is not a fixed pre-assignment (only an override fixes it): fixed stays empty.
    expect(summary(loaded, await run(loaded, { claims: ['c1'], fixed: [] }))).toEqual({
      c1: ['VERIFIED', 'verified', 'FINAL', ['o1'], 'muse'],
    });
  });

  it('an overridden UNASKED receipt fixes its observation as taken: no claim gets it, no UNASKED again', async () => {
    const loaded = UNASKED_THEN_CLAIMED();
    const fixed = [{ observationId: observationOf(loaded, 'o1').id, claimId: null }];
    expect(summary(loaded, await run(loaded, { claims: ['c1'], fixed }))).toEqual({
      c1: ['NOT_FOUND', 'not_found', 'FINAL', [], 'muse'],
    });
  });
});

/** c9 (FINAL, overridden) once held o9; c1 restates the same send three minutes later. */
const OVERRIDDEN = () =>
  load({
    claims: [
      email('c9', 'priya@company.com', 'Q3 deck', '13:59'),
      email('c1', 'priya@company.com', 'Q3 deck', '14:02'),
    ],
    observations: [
      { ...sent('o9', 'priya@company.com', 'Q3 deck', '14:01'), occurredAt: '2026-10-06T14:01:30-04:00' },
    ],
    coverage: [GMAIL],
    activity: MUSE_ACTIVE,
  });

describe('gradeBatch: overrides fix their stored evidence; an override to NOT_FOUND fixes none (§4.3)', () => {
  it('an override to VERIFIED keeps c9 → o9 fixed: c1 never sees o9', async () => {
    const loaded = OVERRIDDEN();
    const fixed = [{ observationId: observationOf(loaded, 'o9').id, claimId: claimOf(loaded, 'c9').id }];
    expect(summary(loaded, await run(loaded, { claims: ['c1'], fixed }))).toEqual({
      c1: ['NOT_FOUND', 'not_found', 'FINAL', [], 'muse'],
    });
  });

  it('an override to NOT_FOUND frees o9: c1 takes it, or with no claim it is an orphan', async () => {
    const loaded = OVERRIDDEN();
    expect(summary(loaded, await run(loaded, { claims: ['c1'], fixed: [] }))).toEqual({
      c1: ['VERIFIED', 'verified', 'FINAL', ['o9'], 'muse'],
    });
    expect(summary(loaded, await run(loaded, { claims: [], fixed: [] }))).toEqual({
      o9: ['UNASKED', 'unasked', 'FINAL', ['o9'], 'muse'],
    });
  });

  it('o9 fixed to c9 and also taken (the user overrode its superseded UNASKED receipt): legal, held by both', async () => {
    // state.ts allows overriding a superseded FINAL UNASKED receipt, so a ledger can fix o9 both ways; o9
    // then stays away from every other claim and from the orphans, and nothing throws.
    const loaded = OVERRIDDEN();
    const o9 = observationOf(loaded, 'o9').id;
    const fixed = [
      { observationId: o9, claimId: claimOf(loaded, 'c9').id },
      { observationId: o9, claimId: null },
    ];
    expect(summary(loaded, await run(loaded, { claims: ['c1'], fixed }))).toEqual({
      c1: ['NOT_FOUND', 'not_found', 'FINAL', [], 'muse'],
    });
    expect(await run(loaded, { claims: [], fixed })).toEqual([]);
  });
});

/**
 * muse holds two grant versions (the older forbids email); dots forbids email. c1 (muse) and c2 (dots) each
 * restate a send; o3 at 13:20 is unclaimed and dots' session and the user's idleness make it a dots UNASKED.
 */
const AGENTS = () =>
  load({
    claims: [
      email('c1', 'priya@company.com', 'Q3 deck', '14:02'),
      email('c2', 'raj@company.com', 'budget', '14:50', 'dots'),
    ],
    observations: [
      sent('o1', 'priya@company.com', 'Q3 deck', '14:02'),
      sent('o2', 'raj@company.com', 'budget', '14:50'),
      sent('o3', 'vendor@supplier.example', 'Re: invoice', '13:20'),
    ],
    grants: [{ agent: 'muse' }, { agent: 'dots', allowedTypes: ['calendar.created'] }],
    coverage: [GMAIL],
    activity: {
      sessions: [{ agent: 'dots', at: at('13:19') }],
      idle: [{ from: at('13:15'), to: at('13:30') }],
      adapterSyncs: [{ agent: 'dots', lastSyncAt: at('14:55') }],
    },
  });

function grantVersions(loaded: LoadedScenario) {
  const [muse, dots] = loaded.grants;
  if (muse === undefined || dots === undefined) throw new Error('no grants');
  const older = {
    ...muse,
    allowedTypes: ['calendar.created' as const],
    updatedAt: IsoTs.parse('2026-10-04T09:00:00-04:00'),
  };
  return {
    muse,
    dots,
    older,
    future: { ...dots, allowedTypes: muse.allowedTypes, updatedAt: IsoTs.parse(at('16:00')) },
  };
}

describe('gradeBatch: several agents, each graded with its own grant in force (§3, §7)', () => {
  it('grades each claim and orphan exactly as grade() does with that agent’s grant in force', async () => {
    const loaded = AGENTS();
    const { muse, dots, older, future } = grantVersions(loaded);
    const receipts = await run(loaded, { grants: [future, dots, older, muse] });
    expect(summary(loaded, receipts)).toEqual({
      c1: ['VERIFIED', 'verified', 'FINAL', ['o1'], 'muse'],
      c2: ['OVER_SCOPE', 'over_scope', 'FINAL', ['o2'], 'dots'],
      o3: ['UNASKED', 'unasked', 'FINAL', ['o3'], 'dots'],
    });
    const policy = loadPolicy(loaded.policyJson);
    const { coverage, activity } = loaded;
    const o3 = observationOf(loaded, 'o3');
    const attribution = attribute(o3, activity, policy, EVALUATED_AT);
    if (attribution === null) throw new Error('o3 is not attributed');
    const direct = [
      grade(claimOf(loaded, 'c1'), [observationOf(loaded, 'o1')], muse, policy, coverage, {
        priorSpendCents: 0,
      }),
      grade(claimOf(loaded, 'c2'), [observationOf(loaded, 'o2')], dots, policy, coverage, {
        priorSpendCents: 0,
      }),
      grade(null, [o3], dots, policy, coverage, { priorSpendCents: 0, attribution }),
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(canonicalJson(receipts)).toBe(canonicalJson(direct));
  });

  it('a grant that takes effect after evaluatedAt is not in force: its agent has none (missing_grant)', async () => {
    const loaded = AGENTS();
    const { muse, future } = grantVersions(loaded);
    await expect(run(loaded, { grants: [muse, future] })).rejects.toMatchObject({
      name: 'BatchError',
      code: 'missing_grant',
    });
  });
});

describe('gradeBatch: an adapter sync after evaluatedAt does not exist yet (§3, §7)', () => {
  it('keeps the UNASKED receipt PENDING when the only sync past its grace is after evaluatedAt', async () => {
    // Synced at 15:30 (after the 15:00 evaluation), muse's adapter would finalise o1 (14:03 + 2 + 30 min).
    const late = { agent: 'muse', lastSyncAt: at('15:30') };
    const loaded = load({
      observations: [sent('o1', 'vendor@supplier.example', 'Re: invoice', '14:03')],
      coverage: [GMAIL],
      activity: { ...MUSE_ACTIVE, adapterSyncs: [late] },
    });
    expect(summary(loaded, await run(loaded))).toEqual({
      o1: ['UNASKED', 'unasked', 'PENDING', ['o1'], 'muse'],
    });
    const inTime = load({
      observations: [sent('o1', 'vendor@supplier.example', 'Re: invoice', '14:03')],
      coverage: [GMAIL],
      activity: { ...MUSE_ACTIVE, adapterSyncs: [late, ...MUSE_ACTIVE.adapterSyncs] },
    });
    expect(summary(inTime, await run(inTime))).toEqual({
      o1: ['UNASKED', 'unasked', 'FINAL', ['o1'], 'muse'],
    });
  });
});
