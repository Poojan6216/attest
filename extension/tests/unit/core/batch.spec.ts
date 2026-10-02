/**
 * gradeBatch (docs/grading.md §3, §4.3, §7): assignment across claims, never-scored claims, orphans to UNASKED,
 * and inputs from after evaluatedAt. Inputs are built with the golden loader (tests/golden/load.ts), so every
 * object is schema-valid and every id is hash-derived exactly as in the golden suite.
 */
import { describe, expect, it } from 'vitest';

import { type BatchFixed, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { loadPolicy } from '../../../src/core/policy';
import type { Receipt } from '../../../src/core/schema';
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

/** A batch scenario built by the golden loader; `input` is validated by the scenario schema. */
function load(input: Record<string, unknown>): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'batch unit',
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
  return buildScenario('batch.spec.json', scenario);
}

async function run(loaded: LoadedScenario, fixed: readonly BatchFixed[] = loaded.fixed): Promise<Receipt[]> {
  const index = createMemoryIndex([...loaded.observations.values()], 15);
  const policy = loadPolicy(loaded.policyJson);
  const graded = await gradeBatch(
    loaded.batchClaims,
    index,
    loaded.grants,
    policy,
    loaded.coverage,
    loaded.activity,
    fixed,
  );
  return graded.map((entry) => entry.receipt);
}

function idOf(loaded: LoadedScenario, ref: string): string {
  const claim = loaded.claims.get(ref);
  if (claim !== undefined) return receiptIdFor({ k: 'claim', claimId: claim.id });
  const observation = loaded.observations.get(ref);
  if (observation === undefined) throw new Error(`no ref ${ref}`);
  return receiptIdFor({ k: 'unasked', observationId: observation.id });
}

/** Ref → [grade, ruleId, observation refs] for every receipt, so a test states the whole result at once. */
function summary(loaded: LoadedScenario, receipts: readonly Receipt[]): Record<string, unknown> {
  const refs = new Map<string, string>();
  for (const ref of [...loaded.claims.keys(), ...loaded.observations.keys()])
    refs.set(idOf(loaded, ref), ref);
  const obsRefs = new Map([...loaded.observations].map(([ref, o]) => [o.id as string, ref]));
  return Object.fromEntries(
    receipts.map((r) => [
      refs.get(r.id) ?? r.id,
      [r.grade, r.ruleId, r.observationIds.map((id) => obsRefs.get(id) ?? id)],
    ]),
  );
}

describe('gradeBatch: one-to-one assignment across claims (§4.3)', () => {
  it('gives a contested observation to the better pair; the other claim never sees it', async () => {
    const loaded = load({
      claims: [
        email('c1', 'priya@company.com', 'deck', '2026-10-06T14:00:00-04:00'),
        email('c2', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
      ],
      observations: [sent('o1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00')],
      coverage: [GMAIL],
    });
    const receipts = await run(loaded);
    expect(summary(loaded, receipts)).toEqual({
      c1: ['NOT_FOUND', 'not_found', []],
      c2: ['VERIFIED', 'verified', ['o1']],
    });
    const c1 = receipts.find((r) => r.id === idOf(loaded, 'c1'));
    expect(c1?.reasons.map((r) => r.code)).toEqual(['coverage.account_unbound', 'match.none']);
  });

  it('a claim takes its best observation only; the other one is an orphan and can be UNASKED', async () => {
    const loaded = load({
      claims: [email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00')],
      observations: [
        sent('o1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
        sent('o2', 'priya@company.com', 'lunch', '2026-10-06T14:05:00-04:00'),
      ],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    expect(summary(loaded, await run(loaded))).toEqual({
      c1: ['VERIFIED', 'verified', ['o1']],
      o2: ['UNASKED', 'unasked', ['o2']],
    });
  });

  it('the loser falls back to its next-best candidate: grade sees exclusive candidates (§4.3)', async () => {
    // Both claims score o1 at 1/1 and o2 ({q3, deck, v2}) at 17/18. c1 is earlier, so c1 takes o1 and c2 o2.
    const loaded = load({
      claims: [
        email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:01:00-04:00'),
        email('c2', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
      ],
      observations: [
        sent('o1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
        sent('o2', 'priya@company.com', 'Q3 deck v2', '2026-10-06T14:02:00-04:00'),
      ],
      coverage: [GMAIL],
    });
    const receipts = await run(loaded);
    expect(summary(loaded, receipts)).toEqual({
      c1: ['VERIFIED', 'verified', ['o1']],
      c2: ['VERIFIED', 'verified', ['o2']],
    });
    const c2 = receipts.find((r) => r.id === idOf(loaded, 'c2'));
    expect(c2?.reasons).toEqual([
      { code: 'match.best', params: { observationId: loaded.observations.get('o2')?.id } },
    ]);
  });
});

describe('gradeBatch: claims that are never scored (§4.3)', () => {
  it('never scores an underspecified claim, so it cannot absorb an observation (§4.3, §5.2)', async () => {
    const loaded = load({
      claims: [{ ref: 'c1', agent: 'muse', type: 'email.sent', claimedAt: '2026-10-06T14:02:00-04:00' }],
      observations: [sent('o1', 'raj@company.com', 'Q3 budget', '2026-10-06T14:03:00-04:00')],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    const receipts = await run(loaded);
    expect(summary(loaded, receipts)).toEqual({
      c1: ['UNVERIFIABLE', 'underspecified', []],
      o1: ['UNASKED', 'unasked', ['o1']],
    });
    expect(receipts.find((r) => r.id === idOf(loaded, 'c1'))?.reasons.map((r) => r.code)).toEqual([
      'claim.too_vague',
      'match.none',
    ]);
  });

  it('never scores a calendar claim without targetAt; the event stays an orphan (§4.1, §4.3)', async () => {
    const loaded = load({
      claims: [
        {
          ref: 'c1',
          agent: 'muse',
          type: 'calendar.created',
          subjectHint: 'Q3 review',
          claimedAt: '2026-10-06T14:02:00-04:00',
        },
      ],
      observations: [
        {
          ref: 'o1',
          source: 'gcal.event',
          type: 'calendar.created',
          subjectHint: 'Q3 review',
          occurredAt: '2026-10-06T14:05:00-04:00',
          // §7: a calendar orphan is attributed from when it was first seen, here in muse's session and idle.
          observedAt: '2026-10-06T14:05:00-04:00',
        },
      ],
      coverage: [{ ...GMAIL, source: 'gcal.event', allCalendars: true }],
      activity: MUSE_ACTIVE,
    });
    expect(summary(loaded, await run(loaded))).toEqual({
      c1: ['UNVERIFIABLE', 'no_target', []],
      o1: ['UNASKED', 'unasked', ['o1']],
    });
  });
});

/** An unclaimed send at 14:03: muse's activity scores it 7/10. */
const ORPHAN = sent('o1', 'vendor@supplier.example', 'Re: invoice', '2026-10-06T14:03:00-04:00');

describe('gradeBatch: orphans become UNASKED only when grade says so (§3, §7)', () => {
  const orphan = ORPHAN;

  it('builds the UNASKED receipt from the orphan: its subject id, its observation, "likely", no claim', async () => {
    const loaded = load({ observations: [orphan], coverage: [GMAIL], activity: MUSE_ACTIVE });
    const [receipt, ...rest] = await run(loaded);
    expect(rest).toEqual([]);
    expect(receipt).toMatchObject({
      id: idOf(loaded, 'o1'),
      agent: 'muse',
      grade: 'UNASKED',
      ruleId: 'unasked',
      attribution: 'likely',
      observationIds: [loaded.observations.get('o1')?.id],
      state: 'FINAL',
      computedAt: EVALUATED_AT,
    });
    expect(receipt?.claimId).toBeUndefined();
    expect(receipt?.reasons.map((r) => r.code)).toEqual(['unasked.session', 'unasked.idle']);
  });

  it.each([
    ['a session alone (4/10, below the threshold)', { sessions: MUSE_ACTIVE.sessions }],
    ['idle alone (no agent-specific signal: no attribution)', { idle: MUSE_ACTIVE.idle }],
    ['no activity at all', {}],
  ])('yields no receipt for an orphan with %s', async (_, activity) => {
    const loaded = load({ observations: [orphan], coverage: [GMAIL], activity });
    expect(await run(loaded)).toEqual([]);
  });
});
