/**
 * Task 1.7: the attribution rules beyond the Done-when (docs/grading.md §7): adjacency suppression by the
 * agent's own same-type claim, signature matching, the likely-agent tie-breaks, adapterLastSyncAt, the shape
 * of the result and typed errors. The Done-when itself (each signal alone below the threshold, combinations
 * above, "likely" text) is in attribution.spec.ts; the helpers below are a copy of that file's (spec files do
 * not import each other, Decisions [1.0]).
 */
import { describe, expect, it } from 'vitest';

import {
  attribute,
  type AttributionActivity,
  type AttributionClaim,
  AttributionError,
  type AttributionOrphan,
  attributor,
} from '../../../src/core/attribution';
import { isoWithOffset, NormalizeError } from '../../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import {
  type AgentId,
  Attribution,
  type Attribution as AttributionType,
  IsoTs,
  type UnaskedSignal,
} from '../../../src/core/schema';
import { MS_PER_MINUTE } from '../../../src/core/units';
import defaultPolicyJson from '../../../../policy/default.json';

const OFFSET = -240;
/** The orphan's occurredAt: 2026-10-06 14:03 at -04:00. */
const T = Date.parse('2026-10-06T14:03:00-04:00');
const iso = (ms: number): string => isoWithOffset(ms, OFFSET);
const min = (minutes: number): number => T + minutes * MS_PER_MINUTE;

/** An email orphan at T, first seen 20 min later: a non-calendar orphan is anchored on occurredAt (§7). */
const orphan = (fields: Partial<AttributionOrphan> = {}): AttributionOrphan => ({
  type: 'email.sent',
  occurredAt: iso(T),
  observedAt: iso(min(20)),
  ...fields,
});

const activity = (fields: Partial<AttributionActivity> = {}): AttributionActivity => ({
  sessions: [],
  idle: [],
  entries: [],
  adapterSyncs: [],
  claims: [],
  ...fields,
});

const session = (agent: AgentId, ms: number) => ({ agent, at: iso(ms) });
const entry = (agent: AgentId, ms: number) => ({ agent, at: iso(ms) });
const idle = (fromMs: number, toMs: number) => ({ from: iso(fromMs), to: iso(toMs) });
const sync = (agent: AgentId, at: string) => ({ agent, lastSyncAt: IsoTs.parse(at) });
/**
 * An ASSIGNABLE claim (§4.3) of `agent` at `ms`: an email claim naming its counterparty (a calendar claim also
 * needs targetAt), read at `ms`. Vague claims are attribution-v14.spec.ts's subject.
 */
const claim = (agent: AgentId, ms: number, fields: Partial<AttributionClaim> = {}): AttributionClaim => ({
  agent,
  type: 'email.sent',
  counterparty: 'priya@company.com',
  claimedAt: iso(ms),
  claimedAtPrecision: 'minute',
  observedAt: iso(ms),
  ...fields,
});

function withUnasked(unasked: Record<string, unknown>): Policy {
  return loadPolicy({ ...defaultPolicyJson, unasked: { ...defaultPolicyJson.unasked, ...unasked } });
}

const SIGNATURES = {
  ...defaultPolicyJson.unasked.signatures,
  muse: ['sent with muse'],
  chatgpt: ['via chatgpt'],
};
/** The shipped policy plus signatures (the shipped list is empty until captured fixtures show real ones). */
const SIGNED = withUnasked({ signatures: SIGNATURES });

const likely = (policy: Policy, attribution: AttributionType | null): boolean =>
  attribution !== null && attribution.scoreBp >= policy.bp.unasked.threshold;

/** One ingredient per signal, for muse, around the orphan at T. */
const INGREDIENT: Readonly<Record<UnaskedSignal, Partial<AttributionActivity>>> = {
  agentSessionActive: { sessions: [session('muse', min(-3))] },
  userIdle: { idle: [idle(min(-5), min(1))] },
  agentSignature: {},
  activityLogAdjacent: { entries: [entry('muse', min(1))] },
};

function scenario(signals: readonly UnaskedSignal[]): [AttributionOrphan, AttributionActivity] {
  const parts = signals.map((signal) => INGREDIENT[signal]);
  const merged = activity({
    sessions: parts.flatMap((part) => part.sessions ?? []),
    idle: parts.flatMap((part) => part.idle ?? []),
    entries: parts.flatMap((part) => part.entries ?? []),
  });
  const subjectHint = signals.includes('agentSignature') ? 'Invoice 4471 - Sent with Muse' : 'Invoice 4471';
  return [orphan({ subjectHint }), merged];
}

describe("activityLogAdjacent is suppressed by the agent's own same-type claim (golden 48)", () => {
  const adjacentOnly = (claims: readonly AttributionClaim[], entryMs = min(0)) =>
    attribute(orphan(), activity({ entries: [entry('muse', entryMs)], claims }), DEFAULT_POLICY);

  it('without a claim, the entry fires', () => {
    expect(adjacentOnly([])?.signals).toEqual(['activityLogAdjacent']);
  });

  it('a muse email.sent claim a minute earlier explains it (assigned or not): no signal, no attribution', () => {
    expect(adjacentOnly([claim('muse', min(-1))])).toBeNull();
  });

  it('a claim of another type does not explain it (even an assignable one)', () => {
    const calendar = { type: 'calendar.created', targetAt: iso(min(60)), subjectHint: 'Q3 review' } as const;
    expect(adjacentOnly([claim('muse', min(-1), calendar)])?.signals).toEqual(['activityLogAdjacent']);
  });

  it("another agent's claim does not explain it", () => {
    expect(adjacentOnly([claim('chatgpt', min(-1))])?.signals).toEqual(['activityLogAdjacent']);
  });

  it("the claim's time is its precision unit: a minute claim ending exactly adjacentMin before still explains", () => {
    // 14:00 minute precision → unit [14:00, 14:01]; the orphan at 14:03 is 2 min = adjacentMin past its end.
    expect(adjacentOnly([claim('muse', min(-3))])).toBeNull();
    // 13:59 → unit [13:59, 14:00]: 3 min away.
    expect(adjacentOnly([claim('muse', min(-4))])?.signals).toEqual(['activityLogAdjacent']);
  });

  it('a claim after the orphan explains it up to adjacentMin away', () => {
    expect(adjacentOnly([claim('muse', min(2))])).toBeNull();
    expect(adjacentOnly([claim('muse', min(3))])?.signals).toEqual(['activityLogAdjacent']);
  });

  it('a day-precision claim whose day contains the orphan explains it (its unit is the whole day)', () => {
    const dayStart = Date.parse('2026-10-06T00:00:00-04:00');
    expect(adjacentOnly([claim('muse', dayStart, { claimedAtPrecision: 'day' })])).toBeNull();
  });

  it('the suppression only removes activityLogAdjacent; the session signal still fires', () => {
    const input = activity({
      sessions: [session('muse', min(-3))],
      entries: [entry('muse', min(0))],
      claims: [claim('muse', min(-1))],
    });
    expect(attribute(orphan(), input, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive']);
  });

  it("an entry's own type is not read: a typed entry of another type still fires", () => {
    const input = activity({ entries: [{ ...entry('muse', min(0)), type: 'calendar.created' as const }] });
    expect(attribute(orphan(), input, DEFAULT_POLICY)?.signals).toEqual(['activityLogAdjacent']);
  });
});

describe('agentSignature: case-insensitive substring of the subject hint', () => {
  const signatureOf = (subjectHint: string | undefined) =>
    attribute(orphan(subjectHint === undefined ? {} : { subjectHint }), activity(), SIGNED)?.signals ?? [];

  it.each(['Invoice - Sent with Muse', 'INVOICE - SENT WITH MUSE', 'sent with muse', 'xsent with musex'])(
    '%j contains the signature',
    (subject) => {
      expect(signatureOf(subject)).toEqual(['agentSignature']);
    },
  );

  it('a signature written in capitals in the policy matches too', () => {
    const upper = withUnasked({ signatures: { ...SIGNATURES, muse: ['SENT WITH MUSE'] } });
    expect(attribute(orphan({ subjectHint: 'sent with muse' }), activity(), upper)?.agent).toBe('muse');
  });

  it.each([
    ['fullwidth letters', '\uFF33\uFF25\uFF2E\uFF34 with muse'],
    ['a zero-width space inside', 'sent with mu\u200Bse'],
    ['a partial signature', 'sent with mus'],
  ])('%s do not match (no NFKC, ASCII-only case folding)', (_label, subject) => {
    expect(signatureOf(subject)).toEqual([]);
  });

  it('a Kelvin sign in the subject is not the letter k (String#toLowerCase would fold it to k)', () => {
    const policy = withUnasked({ signatures: { ...SIGNATURES, muse: ['booked by muse'] } });
    const signalsOf = (subjectHint: string) =>
      attribute(orphan({ subjectHint }), activity(), policy)?.signals ?? [];
    expect(signalsOf('BOOKED BY MUSE')).toEqual(['agentSignature']);
    expect(signalsOf('BOOKED BY MUSE')).toEqual([]);
  });

  it('an observation with no subject hint has no signature', () => {
    expect(signatureOf(undefined)).toEqual([]);
  });

  it('the shipped policy has no signatures, so no subject ever fires one', () => {
    expect(attribute(orphan({ subjectHint: 'Sent with Muse' }), activity(), DEFAULT_POLICY)).toBeNull();
  });
});

describe('the likely agent: highest score, then most signals, then agent id', () => {
  it('equal scores: more fired signals wins even against a lower agent id', () => {
    const policy = withUnasked({
      signals: { agentSessionActive: 0.4, userIdle: 0.3, agentSignature: 0.8, activityLogAdjacent: 0.4 },
      signatures: { ...SIGNATURES, claude: ['by claude'] },
    });
    const input = activity({ sessions: [session('muse', min(-1))], entries: [entry('muse', min(1))] });
    const result = attribute(orphan({ subjectHint: 'notes by claude' }), input, policy);
    expect(policy.bp.unasked.signals.agentSignature).toBe(
      policy.bp.unasked.signals.agentSessionActive + policy.bp.unasked.signals.activityLogAdjacent,
    );
    expect(result?.agent).toBe('muse');
    expect(result?.signals).toEqual(['agentSessionActive', 'activityLogAdjacent']);
  });

  it('a higher score beats more signals', () => {
    const policy = withUnasked({
      signals: { agentSessionActive: 0.4, userIdle: 0.3, agentSignature: 0.9, activityLogAdjacent: 0.4 },
      signatures: { ...SIGNATURES, claude: ['by claude'] },
    });
    const input = activity({ sessions: [session('muse', min(-1))], entries: [entry('muse', min(1))] });
    expect(attribute(orphan({ subjectHint: 'notes by claude' }), input, policy)?.agent).toBe('claude');
  });

  it("two agents both above the threshold: the higher score wins, and neither borrows the other's signals", () => {
    const input = activity({
      sessions: [session('muse', min(-1)), session('chatgpt', min(5))],
      entries: [entry('muse', min(1))],
    });
    const { agentSessionActive, agentSignature, activityLogAdjacent } = SIGNED.bp.unasked.signals;
    const muse = attribute(orphan(), input, SIGNED);
    expect(muse).toEqual({
      agent: 'muse',
      scoreBp: agentSessionActive + activityLogAdjacent,
      signals: ['agentSessionActive', 'activityLogAdjacent'],
    });
    expect(likely(SIGNED, muse)).toBe(true);
    expect(attribute(orphan({ subjectHint: 'Notes via ChatGPT' }), input, SIGNED)).toEqual({
      agent: 'chatgpt',
      scoreBp: agentSessionActive + agentSignature,
      signals: ['agentSessionActive', 'agentSignature'],
    });
  });

  it('a full tie goes to the lowest agent id, whatever the input order', () => {
    const agents: AgentId[] = ['muse', 'dots', 'claude', 'chatgpt'];
    const forward = activity({ sessions: agents.map((agent) => session(agent, min(-1))) });
    const backward = activity({ sessions: [...forward.sessions].reverse() });
    expect(attribute(orphan(), forward, DEFAULT_POLICY)?.agent).toBe('chatgpt');
    expect(attribute(orphan(), backward, DEFAULT_POLICY)?.agent).toBe('chatgpt');
    const withoutChatgpt = activity({
      sessions: forward.sessions.filter((item) => item.agent !== 'chatgpt'),
    });
    expect(attribute(orphan(), withoutChatgpt, DEFAULT_POLICY)?.agent).toBe('claude');
  });
});

describe("adapterLastSyncAt: the attributed agent's latest adapter sync", () => {
  const input = (syncs: AttributionActivity['adapterSyncs']) =>
    activity({ sessions: [session('muse', min(-1))], adapterSyncs: syncs });

  it("is the latest of the attributed agent's syncs, never another agent's", () => {
    const syncs = [
      sync('muse', '2026-10-06T14:20:00-04:00'),
      sync('muse', '2026-10-06T14:50:00-04:00'),
      sync('chatgpt', '2026-10-06T15:30:00-04:00'),
    ];
    expect(attribute(orphan(), input(syncs), DEFAULT_POLICY)?.adapterLastSyncAt).toBe(
      '2026-10-06T14:50:00-04:00',
    );
  });

  it('compares instants, not strings', () => {
    const syncs = [sync('muse', '2026-10-06T18:40:00Z'), sync('muse', '2026-10-06T14:50:00-04:00')];
    // 18:40Z is 14:40 at -04:00: later as a string, earlier as an instant.
    expect(attribute(orphan(), input(syncs), DEFAULT_POLICY)?.adapterLastSyncAt).toBe(
      '2026-10-06T14:50:00-04:00',
    );
  });

  it('ignores syncs after evaluatedAt when one is given', () => {
    const syncs = [sync('muse', '2026-10-06T14:20:00-04:00'), sync('muse', '2026-10-06T14:50:00-04:00')];
    const result = attribute(orphan(), input(syncs), DEFAULT_POLICY, '2026-10-06T14:30:00-04:00');
    expect(result?.adapterLastSyncAt).toBe('2026-10-06T14:20:00-04:00');
    const atTheInstant = attribute(orphan(), input(syncs), DEFAULT_POLICY, '2026-10-06T14:50:00-04:00');
    expect(atTheInstant?.adapterLastSyncAt).toBe('2026-10-06T14:50:00-04:00');
  });

  it('is absent (not undefined-valued) without a sync at or before evaluatedAt', () => {
    const none = attribute(orphan(), input([]), DEFAULT_POLICY);
    expect(none).not.toBeNull();
    expect(none !== null && 'adapterLastSyncAt' in none).toBe(false);
    const late = attribute(
      orphan(),
      input([sync('muse', '2026-10-06T15:00:00-04:00')]),
      DEFAULT_POLICY,
      '2026-10-06T14:30:00-04:00',
    );
    expect(late !== null && 'adapterLastSyncAt' in late).toBe(false);
  });

  it('equal instants written in different offsets resolve the same way in any input order', () => {
    const a = sync('muse', '2026-10-06T18:50:00Z');
    const b = sync('muse', '2026-10-06T14:50:00-04:00');
    const first = attribute(orphan(), input([a, b]), DEFAULT_POLICY)?.adapterLastSyncAt;
    const second = attribute(orphan(), input([b, a]), DEFAULT_POLICY)?.adapterLastSyncAt;
    expect(first).toBe(second);
    expect(first).toBe('2026-10-06T14:50:00-04:00');
  });
});

describe('the result', () => {
  it('parses with the strict Attribution schema, signals in table order', () => {
    const [observation, input] = scenario([
      'activityLogAdjacent',
      'agentSignature',
      'userIdle',
      'agentSessionActive',
    ]);
    const result = attribute(
      observation,
      { ...input, adapterSyncs: [sync('muse', '2026-10-06T14:50:00-04:00')] },
      SIGNED,
    );
    expect(Attribution.parse(result)).toEqual(result);
    expect(result?.signals).toEqual([
      'agentSessionActive',
      'userIdle',
      'agentSignature',
      'activityLogAdjacent',
    ]);
  });

  it('is returned below the threshold too: grade() decides unaskedLikely', () => {
    const result = attribute(orphan(), activity({ sessions: [session('muse', min(-1))] }), DEFAULT_POLICY);
    expect(result).not.toBeNull();
    expect(likely(DEFAULT_POLICY, result)).toBe(false);
  });

  it('weights are policy data: changing a signal weight changes the score with no code change', () => {
    const heavier = withUnasked({
      signals: { ...defaultPolicyJson.unasked.signals, agentSessionActive: 0.65 },
    });
    const input = activity({ sessions: [session('muse', min(-1))] });
    expect(attribute(orphan(), input, heavier)?.scoreBp).toBe(heavier.bp.unasked.signals.agentSessionActive);
    expect(likely(heavier, attribute(orphan(), input, heavier))).toBe(true);
  });

  it('attributor(activity) gives the same answer as attribute for each orphan', () => {
    const input = activity({
      sessions: [session('muse', min(-3)), session('dots', min(100))],
      entries: [entry('dots', min(101))],
      idle: [idle(min(95), min(110))],
    });
    const attributeAll = attributor(input, DEFAULT_POLICY);
    for (const at of [min(0), min(100), min(300)]) {
      const observation = orphan({ occurredAt: iso(at) });
      expect(attributeAll(observation)).toEqual(attribute(observation, input, DEFAULT_POLICY));
    }
  });
});

describe('errors are typed and loud', () => {
  it('an occurredAt without an offset throws NormalizeError', () => {
    expect(() =>
      attribute(orphan({ occurredAt: '2026-10-06T14:03:00' }), activity(), DEFAULT_POLICY),
    ).toThrow(NormalizeError);
  });

  it('a window bound outside the safe-integer range throws AttributionError', () => {
    const maxMinutes = Math.floor(Number.MAX_SAFE_INTEGER / MS_PER_MINUTE);
    const huge = withUnasked({ windows: { ...defaultPolicyJson.unasked.windows, sessionMin: maxMinutes } });
    const input = activity({ sessions: [session('muse', min(0))] });
    expect(() => attribute(orphan(), input, huge)).toThrow(AttributionError);
  });
});
