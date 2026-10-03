/**
 * gradeBatch ignores inputs stamped after evaluatedAt (docs/grading.md §3, v1.4: "observations and claims with
 * `observedAt > evaluatedAt`, adapter syncs with `lastSyncAt > evaluatedAt`, and activity sessions, idle intervals
 * and entries after `evaluatedAt` are ignored, so replay at an earlier instant sees exactly what grading saw"),
 * and reads orphans only of types with sources (§3). A claim from after evaluatedAt is neither graded, nor given
 * evidence, nor counted in priorSpendCents, nor read by attribution; activity after it never fires a signal.
 * Inputs are built with the golden loader.
 */
import { describe, expect, it } from 'vitest';

import { BatchError, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { loadPolicy } from '../../../src/core/policy';
import { receiptId } from '../../../src/core/receipt';
import { Claim, type Receipt } from '../../../src/core/schema';
import { buildScenario, type LoadedScenario } from '../../golden/load';
import { Scenario } from '../../golden/scenario-schema';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
/** 1 ms after evaluatedAt: the earliest instant that does not exist yet for the batch. */
const JUST_AFTER = '2026-10-06T15:00:00.001-04:00';
const GMAIL = {
  source: 'gmail.sent',
  lastSyncAt: EVALUATED_AT,
  windowStart: '2026-10-06T12:00:00-04:00',
  windowEnd: EVALUATED_AT,
  accountHash: 'acct-a',
} as const;
const RECEIPTS = { ...GMAIL, source: 'gmail.receipt' } as const;
const muse = (hhmm: string) => ({ agent: 'muse', at: `2026-10-06T${hhmm}-04:00` }) as const;
const at = (hhmm: string) => `2026-10-06T${hhmm}-04:00`;

const sent = (ref: string, counterparty: string, subjectHint: string, occurredAt: string) =>
  ({ ref, source: 'gmail.sent', type: 'email.sent', counterparty, subjectHint, occurredAt }) as const;
const email = (ref: string, counterparty: string, subjectHint: string, claimedAt: string) =>
  ({ ref, agent: 'muse', type: 'email.sent', counterparty, subjectHint, claimedAt }) as const;
/** An unclaimed send at 14:55, five minutes before evaluatedAt. */
const ORPHAN = sent('o1', 'vendor@supplier.example', 'Re: invoice', at('14:55:00'));
/** The user idle 14:40–14:58: covers [14:53, 14:55] (userIdle, 3/10 for every agent). */
const IDLE = [{ from: at('14:40:00'), to: at('14:58:00') }] as const;
const SYNCED = [{ agent: 'muse', lastSyncAt: at('14:59:00') }] as const;

/** A batch scenario built by the golden loader; `input` is validated by the scenario schema. */
function load(input: Record<string, unknown>, policyPatch: Record<string, unknown> = {}): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'batch visibility unit',
    covers: ['test:batch'],
    mode: 'batch',
    policyPatch,
    input: {
      evaluatedAt: EVALUATED_AT,
      claims: [],
      observations: [],
      grants: [{ agent: 'muse' }],
      coverage: [GMAIL],
      ...input,
    },
    expect: [],
  });
  return buildScenario('batch-visibility.spec.json', scenario);
}

async function run(loaded: LoadedScenario, claims = loaded.batchClaims): Promise<Receipt[]> {
  const index = createMemoryIndex([...loaded.observations.values()], 15);
  const policy = loadPolicy(loaded.policyJson);
  const { grants, coverage, activity, fixed } = loaded;
  const graded = await gradeBatch(claims, index, grants, policy, coverage, activity, fixed);
  return graded.map((entry) => entry.receipt);
}

function idOf(loaded: LoadedScenario, ref: string): string {
  const claim = loaded.claims.get(ref);
  if (claim !== undefined) return receiptId({ k: 'claim', claimId: claim.id });
  const observation = loaded.observations.get(ref);
  if (observation === undefined) throw new Error(`no ref ${ref}`);
  return receiptId({ k: 'unasked', observationId: observation.id });
}

/** Ref → [grade, ruleId] for every receipt, so a test states the whole result at once. */
function summary(loaded: LoadedScenario, receipts: readonly Receipt[]): Record<string, unknown> {
  const refs = new Map(
    [...loaded.claims.keys(), ...loaded.observations.keys()].map((r) => [idOf(loaded, r), r]),
  );
  return Object.fromEntries(receipts.map((r) => [refs.get(r.id) ?? r.id, [r.grade, r.ruleId]]));
}

describe('gradeBatch: a claim first seen after evaluatedAt does not exist yet (§3)', () => {
  it('is not graded and takes no evidence: the observation it restates stays an orphan', async () => {
    const loaded = load({
      claims: [
        { ...email('c1', 'vendor@supplier.example', 'Re: invoice', at('14:55:00')), observedAt: JUST_AFTER },
      ],
      observations: [ORPHAN],
      activity: { sessions: [muse('14:50:00')], idle: IDLE, adapterSyncs: SYNCED },
    });
    expect(summary(loaded, await run(loaded))).toEqual({ o1: ['UNASKED', 'unasked'] });
  });

  it('is graded once observed at evaluatedAt exactly (the bound is inclusive)', async () => {
    const loaded = load({
      claims: [
        {
          ...email('c1', 'vendor@supplier.example', 'Re: invoice', at('14:55:00')),
          observedAt: EVALUATED_AT,
        },
      ],
      observations: [ORPHAN],
      activity: { sessions: [muse('14:50:00')], idle: IDLE, adapterSyncs: SYNCED },
    });
    expect(summary(loaded, await run(loaded))).toEqual({ c1: ['VERIFIED', 'verified'] });
  });

  it('is still checked for duplicates: a corrupt batch fails loud whatever it holds (Hard Rule 6)', async () => {
    const loaded = load({
      claims: [{ ...email('c1', 'priya@company.com', 'Q3 deck', at('14:02:00')), observedAt: JUST_AFTER }],
    });
    const [late] = loaded.batchClaims;
    if (late === undefined) throw new Error('no claim');
    await expect(run(loaded, [late, Claim.parse({ ...late })])).rejects.toThrow(
      new BatchError('duplicate_claim'),
    );
  });
});

describe('gradeBatch: a claim first seen after evaluatedAt changes no other receipt (§3, §6.3, §7)', () => {
  it('is not counted in priorSpendCents (§6.3 reads only claims seen by evaluatedAt)', async () => {
    const purchase = (ref: string, claimedAt: string, observedAt: string) => ({
      ref,
      agent: 'muse',
      type: 'purchase.made',
      counterparty: 'acme',
      amountCents: 3_000,
      currency: 'USD',
      claimedAt,
      observedAt,
    });
    const input = (lateObservedAt: string) => ({
      claims: [
        purchase('c1', at('10:00:00'), lateObservedAt),
        purchase('c2', at('11:00:00'), at('11:00:00')),
      ],
      grants: [{ agent: 'muse', spendCeilingCents: 5_000, spendCurrency: 'USD' }],
      coverage: [RECEIPTS],
    });
    const seen = load(input(at('10:00:00')));
    expect(summary(seen, await run(seen))).toMatchObject({ c2: ['OVER_SCOPE', 'over_ceiling_cumulative'] });
    // Without c1's $30, c2 is within the ceiling and no receipt pass covered 11:00.
    const unseen = load(input(JUST_AFTER));
    expect(summary(unseen, await run(unseen))).toEqual({ c2: ['UNVERIFIABLE', 'no_coverage'] });
  });

  it('never suppresses activityLogAdjacent: only claims seen by evaluatedAt explain an entry (§7)', async () => {
    // muse logged an entry at 14:55 (adjacent 4/10) and the user was idle (3/10): 7/10 unless a claim explains it.
    // The claim names someone else, so it never takes o1, and it still waits for its grace (pending).
    const vague = { ref: 'c1', agent: 'muse', type: 'email.sent', counterparty: 'lee@other.example' };
    const input = (observedAt: string) => ({
      claims: [{ ...vague, subjectHint: 'lunch', claimedAt: at('14:55:00'), observedAt }],
      observations: [ORPHAN],
      activity: { entries: [muse('14:55:00')], idle: IDLE, adapterSyncs: SYNCED },
    });
    const explained = load(input(EVALUATED_AT));
    expect(summary(explained, await run(explained))).toEqual({ c1: ['UNVERIFIABLE', 'pending'] });
    const unexplained = load(input(JUST_AFTER));
    expect(summary(unexplained, await run(unexplained))).toEqual({ o1: ['UNASKED', 'unasked'] });
  });
});

describe('gradeBatch: activity after evaluatedAt fires no signal (§3, §7)', () => {
  it('a session ping after evaluatedAt is not read; one at evaluatedAt is', async () => {
    const input = (sessionAt: string) => ({
      observations: [ORPHAN],
      activity: { sessions: [{ agent: 'muse', at: sessionAt }], idle: IDLE, adapterSyncs: SYNCED },
    });
    const now = load(input(EVALUATED_AT));
    const [receipt] = await run(now);
    expect(receipt?.reasons.map((r) => r.code)).toEqual(['unasked.session', 'unasked.idle']);
    const later = load(input(JUST_AFTER));
    expect(await run(later)).toEqual([]);
  });

  it('an activity-log entry after evaluatedAt is not read', async () => {
    // A send at 14:59 with the user idle to 15:00: an entry at 15:00 or 1 ms later is within ±2 min of it.
    const input = (entryAt: string) => ({
      observations: [{ ...ORPHAN, occurredAt: at('14:59:00') }],
      activity: {
        entries: [{ agent: 'muse', at: entryAt }],
        idle: [{ from: at('14:40:00'), to: EVALUATED_AT }],
        adapterSyncs: SYNCED,
      },
    });
    expect(summary(load(input(EVALUATED_AT)), await run(load(input(EVALUATED_AT))))).toEqual({
      o1: ['UNASKED', 'unasked'],
    });
    expect(await run(load(input(JUST_AFTER)))).toEqual([]);
  });

  it('an idle interval counts only up to evaluatedAt: no idle evidence from after it', async () => {
    // A window seen up to 15:30 (synced at 15:00) holds a send at 15:10. Idle 15:05–15:20 would cover
    // [15:08, 15:10], but it lies after evaluatedAt; a session at 15:00 alone scores 4/10, below the threshold.
    const window = { ...GMAIL, windowEnd: at('15:30:00') };
    const late = { ...ORPHAN, occurredAt: at('15:10:00'), observedAt: EVALUATED_AT };
    const input = (idle: readonly { from: string; to: string }[]) => ({
      observations: [late],
      coverage: [window],
      activity: { sessions: [muse('15:00:00')], idle, adapterSyncs: SYNCED },
    });
    expect(await run(load(input([{ from: at('15:05:00'), to: at('15:20:00') }])))).toEqual([]);
    const straddling = load(input([{ from: at('14:50:00'), to: at('15:20:00') }]));
    expect(await run(straddling)).toEqual([]);
    const before = load({ ...input(IDLE), observations: [ORPHAN], coverage: [GMAIL] });
    expect(summary(before, await run(before))).toEqual({ o1: ['UNASKED', 'unasked'] });
  });

  it('an adapter sync after evaluatedAt does not finalise an UNASKED receipt', async () => {
    const input = (lastSyncAt: string) => ({
      observations: [ORPHAN],
      activity: { sessions: [muse('14:50:00')], idle: IDLE, adapterSyncs: [{ agent: 'muse', lastSyncAt }] },
    });
    const [pending] = await run(load(input(JUST_AFTER)));
    expect([pending?.grade, pending?.state]).toEqual(['UNASKED', 'PENDING']);
  });
});

describe('gradeBatch: orphans are observations of a type with sources (§3)', () => {
  it.each(['message.sent', 'other'])('a %s observation in a seen window is never an orphan', async (type) => {
    const loaded = load({
      observations: [ORPHAN, { ...ORPHAN, ref: 'o2', type }],
      activity: { sessions: [muse('14:50:00')], idle: IDLE, adapterSyncs: SYNCED },
    });
    expect(summary(loaded, await run(loaded))).toEqual({ o1: ['UNASKED', 'unasked'] });
  });
});
