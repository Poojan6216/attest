/**
 * gradeBatch (docs/grading.md §3, §4.1, §4.3, §7): which observations a batch reads. An orphan is an observation
 * its own source's observer saw, in a pass synced by evaluatedAt, first seen by evaluatedAt, once per contentHash;
 * the claims' candidates obey the same visibility rule, so an observation from after evaluatedAt can never take
 * a claim's place in assignment. Inputs are built with the golden loader.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicy from '../../../../policy/default.json';

import { gradeBatch } from '../../../src/core/batch';
import { seenWindows, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { canonicalJson, sha256Hex } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import { Coverage, type Observation, type Receipt, Sha256 } from '../../../src/core/schema';
import { buildScenario, type LoadedScenario, receiptIdFor } from '../../golden/load';
import { Scenario } from '../../golden/scenario-schema';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const LATE = '2026-10-06T15:30:00-04:00';
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
/** An unclaimed send at 14:03: muse's activity scores it 7/10. */
const ORPHAN = sent('o1', 'vendor@supplier.example', 'Re: invoice', '2026-10-06T14:03:00-04:00');

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
  return buildScenario('batch-orphans.spec.json', scenario);
}

async function run(loaded: LoadedScenario, observations?: readonly Observation[]): Promise<Receipt[]> {
  const index = createMemoryIndex(observations ?? [...loaded.observations.values()], 15);
  const policy = loadPolicy(loaded.policyJson);
  const { batchClaims, grants, coverage, activity, fixed } = loaded;
  const graded = await gradeBatch(batchClaims, index, grants, policy, coverage, activity, fixed);
  return graded.map((entry) => entry.receipt);
}

function observation(loaded: LoadedScenario, ref: string): Observation {
  const found = loaded.observations.get(ref);
  if (found === undefined) throw new Error(`no observation ${ref}`);
  return found;
}

/** Ref → [grade, ruleId, observation refs] for every receipt. */
function summary(loaded: LoadedScenario, receipts: readonly Receipt[]): Record<string, unknown> {
  const refs = new Map<string, string>();
  for (const [ref, claim] of loaded.claims) refs.set(receiptIdFor({ k: 'claim', claimId: claim.id }), ref);
  for (const [ref, o] of loaded.observations)
    refs.set(receiptIdFor({ k: 'unasked', observationId: o.id }), ref);
  const obsRefs = new Map([...loaded.observations].map(([ref, o]) => [o.id as string, ref]));
  const entry = (r: Receipt) => [r.grade, r.ruleId, r.observationIds.map((id) => obsRefs.get(id) ?? id)];
  return Object.fromEntries(receipts.map((r) => [refs.get(r.id) ?? r.id, entry(r)]));
}

describe('gradeBatch: an orphan lies in a window its own source was seen in (§3, §4.3)', () => {
  it('ignores observations outside every window their own source was seen in', async () => {
    // Gmail was seen up to 14:02 only. o1 (14:03) has muse's signals but no window; o3 is a calendar event
    // and no calendar was seen; o2 (14:01:30) lies inside the window and is UNASKED.
    const early = '2026-10-06T14:02:00-04:00';
    const loaded = load({
      observations: [
        ORPHAN,
        sent('o2', 'vendor@supplier.example', 'Re: other', '2026-10-06T14:01:30-04:00'),
        { ...ORPHAN, ref: 'o3', source: 'gcal.event', type: 'calendar.created' },
      ],
      coverage: [{ ...GMAIL, lastSyncAt: early, windowEnd: early }],
      activity: MUSE_ACTIVE,
    });
    expect(summary(loaded, await run(loaded))).toEqual({ o2: ['UNASKED', 'unasked', ['o2']] });
  });

  it("ignores an observation inside another source's window: only its own observer saw it", async () => {
    const loaded = load({
      observations: [ORPHAN, { ...ORPHAN, ref: 'o2', source: 'gcal.event' }],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    expect(summary(loaded, await run(loaded))).toEqual({ o1: ['UNASKED', 'unasked', ['o1']] });
  });

  it("reads its own source's window even when that source is not one of its type's sources (§3)", async () => {
    // o2 is an email.sent row from the calendar observer. email.sent's relevant source is gmail.sent, but §3 asks
    // only for "a coverage interval of their own source": gcal.event saw 12:00–15:00, so o2 is an orphan.
    const calendar = { ...GMAIL, source: 'gcal.event', allCalendars: true };
    const loaded = load({
      observations: [{ ...ORPHAN, ref: 'o2', source: 'gcal.event' }],
      coverage: [calendar],
      activity: MUSE_ACTIVE,
    });
    expect(summary(loaded, await run(loaded))).toEqual({ o2: ['UNASKED', 'unasked', ['o2']] });
    // With a policy giving email.sent both sources, each row needs its own source's window: o1 (gmail.sent) has
    // none, o2 (gcal.event) has one.
    const both = load(
      {
        observations: [ORPHAN, { ...ORPHAN, ref: 'o2', source: 'gcal.event' }],
        coverage: [calendar],
        activity: MUSE_ACTIVE,
      },
      { sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } },
    );
    expect(summary(both, await run(both))).toEqual({ o2: ['UNASKED', 'unasked', ['o2']] });
  });
});

describe('gradeBatch: orphan windows are exact and only count passes synced by evaluatedAt (§3)', () => {
  it('several disjoint windows: closed at both ends, exact to the millisecond, nothing in the gap', async () => {
    // gmail.sent saw [12:00, 13:00] and [14:00, 15:00]. Every row has muse's session and the user's idle (7/10).
    const t = (hhmmss: string) => `2026-10-06T${hhmmss}-04:00`;
    const rows = [
      '11:59:59.999',
      '12:00:00',
      '13:00:00',
      '13:00:00.001',
      '13:59:59.999',
      '14:00:00',
      '15:00:00',
    ];
    const loaded = load({
      observations: rows.map((time, i) => sent(`o${String(i)}`, 'vendor@supplier.example', 'Re: x', t(time))),
      coverage: [
        { ...GMAIL, lastSyncAt: t('13:00:00'), windowEnd: t('13:00:00') },
        { ...GMAIL, windowStart: t('14:00:00') },
      ],
      activity: {
        sessions: ['12:00:00', '13:00:00', '14:00:00', '15:00:00'].map((time) => ({
          agent: 'muse',
          at: t(time),
        })),
        idle: [{ from: t('11:00:00'), to: EVALUATED_AT }],
        adapterSyncs: [{ agent: 'muse', lastSyncAt: EVALUATED_AT }],
      },
    });
    const unasked = (ref: string) => [ref, ['UNASKED', 'unasked', [ref]]];
    expect(summary(loaded, await run(loaded))).toEqual(
      Object.fromEntries(['o1', 'o2', 'o5', 'o6'].map(unasked)),
    );
  });

  it('ignores a window that only a pass synced after evaluatedAt saw (§3)', async () => {
    // o1 (14:30) lies only in the 15:30 pass's window; o2 (13:30) in the 14:00 pass's. Both have signals.
    const fourteen = '2026-10-06T14:00:00-04:00';
    const loaded = load({
      observations: [
        { ...ORPHAN, occurredAt: '2026-10-06T14:30:00-04:00', observedAt: '2026-10-06T14:40:00-04:00' },
        sent('o2', 'vendor@supplier.example', 'Re: other', '2026-10-06T13:30:00-04:00'),
      ],
      coverage: [
        { ...GMAIL, lastSyncAt: fourteen, windowEnd: fourteen },
        { ...GMAIL, lastSyncAt: LATE, windowEnd: LATE },
      ],
      activity: {
        ...MUSE_ACTIVE,
        sessions: [13, 14].map((hour) => ({ agent: 'muse', at: `2026-10-06T${String(hour)}:30:00-04:00` })),
        idle: [{ from: '2026-10-06T13:20:00-04:00', to: '2026-10-06T14:40:00-04:00' }],
      },
    });
    expect(summary(loaded, await run(loaded))).toEqual({ o2: ['UNASKED', 'unasked', ['o2']] });
  });
});

describe('gradeBatch: an orphan yields a receipt only when grade calls it UNASKED (§3)', () => {
  it('drops an orphan that matches another claim-less rule (a policy rule for unlikely attributions)', async () => {
    // muse's session alone scores 4/10 < 6/10: the patched rule `unasked_unlikely` matches, not `unasked`.
    const unlikely = { id: 'unasked_unlikely', when: { unaskedLikely: false }, then: 'UNVERIFIABLE' };
    const rules = [defaultPolicy.rules[0], unlikely, ...defaultPolicy.rules.slice(1)];
    const activity = { sessions: MUSE_ACTIVE.sessions };
    const loaded = load({ observations: [ORPHAN], coverage: [GMAIL], activity }, { rules });
    expect(await run(loaded)).toEqual([]);
    const likely = load({ observations: [ORPHAN], coverage: [GMAIL], activity: MUSE_ACTIVE }, { rules });
    expect(summary(likely, await run(likely))).toEqual({ o1: ['UNASKED', 'unasked', ['o1']] });
  });
});

describe('gradeBatch: what was first seen after evaluatedAt does not exist yet (§3)', () => {
  it('as a candidate: the claim finds nothing, and future coverage does not count', async () => {
    const loaded = load({
      claims: [email('c1', 'vendor@supplier.example', 'Re: invoice', '2026-10-06T14:03:00-04:00')],
      observations: [{ ...ORPHAN, observedAt: LATE }],
      coverage: [{ ...GMAIL, lastSyncAt: LATE, windowEnd: LATE }],
      activity: MUSE_ACTIVE,
    });
    expect(summary(loaded, await run(loaded))).toEqual({ c1: ['UNVERIFIABLE', 'no_coverage', []] });
  });

  it('as an orphan: no receipt, even inside a window with signals', async () => {
    const loaded = load({
      observations: [{ ...ORPHAN, observedAt: LATE }],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    expect(await run(loaded)).toEqual([]);
  });

  it("in assignment: it never takes a claim's place, so the claim keeps the evidence it can see", async () => {
    // o1 would be c1's exact match but is first seen at 15:30. c1 × o2 = 0.99 beats c2 × o2 = 17/18, so c1
    // takes o2. Were o1 assignable, c1 would take it, c2 would take o2, and c1 would be graded with nothing.
    const loaded = load({
      claims: [
        email('c1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'),
        email('c2', 'priya@company.com', 'Q3 deck notes', '2026-10-06T14:05:00-04:00'),
      ],
      observations: [
        { ...sent('o1', 'priya@company.com', 'Q3 deck', '2026-10-06T14:02:00-04:00'), observedAt: LATE },
        sent('o2', 'priya@company.com', 'Q3 deck', '2026-10-06T14:05:00-04:00'),
      ],
      coverage: [GMAIL],
    });
    expect(summary(loaded, await run(loaded))).toEqual({
      c1: ['VERIFIED', 'verified', ['o2']],
      c2: ['NOT_FOUND', 'not_found', []],
    });
  });
});

describe('gradeBatch: one orphan per contentHash (§4.1)', () => {
  it('counts an observation seen twice once, with the same receipt whatever order the sightings come in', async () => {
    const loaded = load({
      observations: [
        { ...ORPHAN, observedAt: '2026-10-06T14:10:00-04:00' },
        { ...ORPHAN, ref: 'o2', observedAt: '2026-10-06T14:40:00-04:00' },
      ],
      coverage: [GMAIL],
      activity: MUSE_ACTIVE,
    });
    const receipts = await run(loaded);
    expect(receipts.map((r) => r.id)).toEqual([
      receiptIdFor({ k: 'unasked', observationId: observation(loaded, 'o1').id }),
    ]);
    expect(observation(loaded, 'o1').id).toBe(observation(loaded, 'o2').id);
    const reversed = await run(loaded, [observation(loaded, 'o2'), observation(loaded, 'o1')]);
    expect(canonicalJson(reversed)).toBe(canonicalJson(receipts));
  });

  it('throws duplicate_receipt for a corrupt ledger: two different observations under one id', async () => {
    const loaded = load({ observations: [ORPHAN], coverage: [GMAIL], activity: MUSE_ACTIVE });
    const real = observation(loaded, 'o1');
    const forged = { ...real, subjectHint: 'Re: forged', contentHash: Sha256.parse(sha256Hex('forged')) };
    await expect(run(loaded, [real, forged])).rejects.toMatchObject({
      name: 'BatchError',
      code: 'duplicate_receipt',
    });
  });
});

describe('seenWindows: the windows each source was seen in (§3)', () => {
  it('merges overlapping and touching windows per source and drops passes synced after evaluatedAt', () => {
    const at = (time: string) => `2026-10-06T${time}:00-04:00`;
    const pass = (source: string, from: string, to: string, sync = to) =>
      ({
        observerId: source,
        source,
        lastSyncAt: at(sync),
        windowStart: at(from),
        windowEnd: at(to),
      }) as const;
    const coverage = Coverage.parse({
      evaluatedAt: at('15:00'),
      observers: [
        pass('gmail.sent', '13:00', '14:00'),
        pass('gmail.sent', '12:00', '13:00'),
        pass('gmail.sent', '14:30', '14:45'),
        pass('gmail.sent', '12:00', '16:00', '15:30'),
        pass('gcal.event', '10:00', '11:00'),
        pass('gcal.event', '10:30', '10:45'),
      ],
    });
    const ms = (time: string) => Date.parse(at(time));
    expect(Object.fromEntries(seenWindows(coverage))).toEqual({
      'gmail.sent': [
        { startMs: ms('12:00'), endMs: ms('14:00') },
        { startMs: ms('14:30'), endMs: ms('14:45') },
      ],
      'gcal.event': [{ startMs: ms('10:00'), endMs: ms('11:00') }],
    });
  });
});

describe('visibleAt: the index as it was at evaluatedAt (§3)', () => {
  it('leaves observations first seen after evaluatedAt out of both kinds of read', async () => {
    const loaded = load({
      observations: [
        ORPHAN,
        {
          ...sent('o2', 'vendor@supplier.example', 'Re: later', '2026-10-06T14:04:00-04:00'),
          observedAt: LATE,
        },
      ],
      coverage: [GMAIL],
    });
    const index = visibleAt(
      createMemoryIndex([...loaded.observations.values()], 15),
      Date.parse(EVALUATED_AT),
    );
    const from = Date.parse('2026-10-06T14:00:00-04:00');
    const to = Date.parse('2026-10-06T14:10:00-04:00');
    const ids = (rows: readonly Observation[]) => rows.map((row) => row.id);
    const visible = [observation(loaded, 'o1').id];
    expect(ids(await index.byTypeAndBucket('email.sent', from, to))).toEqual(visible);
    expect(ids(await index.byCounterpartyToken('supplier.example', from, to))).toEqual(visible);
  });
});
