/**
 * Task 1.7: UNASKED attribution (docs/grading.md §7). Done-when: each signal alone stays below
 * `unasked.threshold`, combinations reach it, and the receipt text never states that the agent acted
 * (asserted at the bottom of this file and, for every code, in reason-text.spec.ts).
 *
 * Every expected score is read from the loaded policy's basis points (`policy.bp`), never typed as a decimal,
 * and compared with the threshold as integers (§5.3).
 */
import { describe, expect, it } from 'vitest';

import {
  attribute,
  type AttributionActivity,
  attributionReasons,
  type AttributionOrphan,
} from '../../../src/core/attribution';
import { isoWithOffset } from '../../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { AGENT_LABEL, reasonText } from '../../../src/core/reason-text';
import {
  type AgentId,
  type Attribution as AttributionType,
  type UnaskedSignal,
} from '../../../src/core/schema';
import { BASIS_POINTS, MS_PER_MINUTE } from '../../../src/core/units';
import defaultPolicyJson from '../../../../policy/default.json';

const OFFSET = -240;
/** The orphan's occurredAt: 2026-10-06 14:03 at -04:00. */
const T = Date.parse('2026-10-06T14:03:00-04:00');
const iso = (ms: number): string => isoWithOffset(ms, OFFSET);
const min = (minutes: number): number => T + minutes * MS_PER_MINUTE;

const orphan = (fields: Partial<AttributionOrphan> = {}): AttributionOrphan => ({
  type: 'email.sent',
  occurredAt: iso(T),
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

const bp = (policy: Policy, signals: readonly UnaskedSignal[]): number =>
  Math.min(
    signals.reduce((sum, signal) => sum + policy.bp.unasked.signals[signal], 0),
    BASIS_POINTS,
  );
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

describe('each signal alone stays below unasked.threshold (task 1.7 Done-when)', () => {
  it.each<UnaskedSignal>(['agentSessionActive', 'agentSignature', 'activityLogAdjacent'])(
    '%s alone attributes muse with only its own weight',
    (signal) => {
      const [observation, input] = scenario([signal]);
      const result = attribute(observation, input, SIGNED);
      expect(result).toEqual({
        agent: 'muse',
        scoreBp: SIGNED.bp.unasked.signals[signal],
        signals: [signal],
      });
      expect(likely(SIGNED, result)).toBe(false);
    },
  );

  it('userIdle alone attributes nobody: it is not an agent signal', () => {
    const [observation, input] = scenario(['userIdle']);
    expect(attribute(observation, input, SIGNED)).toBeNull();
  });

  it('nothing at all attributes nobody', () => {
    expect(attribute(orphan(), activity(), SIGNED)).toBeNull();
  });
});

describe('combinations reach unasked.threshold (task 1.7 Done-when)', () => {
  const COMBINATIONS: readonly (readonly UnaskedSignal[])[] = [
    ['agentSessionActive', 'userIdle'],
    ['agentSessionActive', 'agentSignature'],
    ['agentSessionActive', 'activityLogAdjacent'],
    ['userIdle', 'agentSignature'],
    ['userIdle', 'activityLogAdjacent'],
    ['agentSignature', 'activityLogAdjacent'],
    ['agentSessionActive', 'userIdle', 'agentSignature'],
    ['agentSessionActive', 'agentSignature', 'activityLogAdjacent'],
    ['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent'],
  ];

  it.each(COMBINATIONS.map((signals) => [signals.join(' + '), signals] as const))('%s', (_label, signals) => {
    const [observation, input] = scenario(signals);
    const result = attribute(observation, input, SIGNED);
    expect(result).toEqual({ agent: 'muse', scoreBp: bp(SIGNED, signals), signals });
    expect(likely(SIGNED, result)).toBe(true);
  });

  it('the score is capped at BASIS_POINTS: all four signals sum past 1', () => {
    const all: UnaskedSignal[] = ['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent'];
    const sum = all.reduce((total, signal) => total + SIGNED.bp.unasked.signals[signal], 0);
    expect(sum).toBeGreaterThan(BASIS_POINTS);
    const [observation, input] = scenario(all);
    expect(attribute(observation, input, SIGNED)?.scoreBp).toBe(BASIS_POINTS);
  });

  it('golden 07: session + idle = 7000 bp for muse', () => {
    const input = activity({ sessions: [session('muse', min(-3))], idle: [idle(min(-13), min(7))] });
    expect(attribute(orphan(), input, DEFAULT_POLICY)).toEqual({
      agent: 'muse',
      scoreBp:
        DEFAULT_POLICY.bp.unasked.signals.agentSessionActive + DEFAULT_POLICY.bp.unasked.signals.userIdle,
      signals: ['agentSessionActive', 'userIdle'],
    });
  });
});

describe('each agent is scored separately (golden 47)', () => {
  it("one agent's session and another's activity entry never add up", () => {
    const input = activity({ sessions: [session('muse', min(-3))], entries: [entry('chatgpt', min(1))] });
    const result = attribute(orphan(), input, DEFAULT_POLICY);
    expect(result?.scoreBp).toBe(DEFAULT_POLICY.bp.unasked.signals.agentSessionActive);
    expect(result?.signals).toHaveLength(1);
    expect(likely(DEFAULT_POLICY, result)).toBe(false);
  });

  it('two signals of one agent do add up, and the other agent gets nothing', () => {
    const input = activity({
      sessions: [session('chatgpt', min(2))],
      entries: [entry('chatgpt', min(-1))],
    });
    expect(attribute(orphan(), input, DEFAULT_POLICY)).toEqual({
      agent: 'chatgpt',
      scoreBp: bp(DEFAULT_POLICY, ['agentSessionActive', 'activityLogAdjacent']),
      signals: ['agentSessionActive', 'activityLogAdjacent'],
    });
  });

  it("userIdle joins every candidate agent's score, and only theirs", () => {
    const input = activity({ entries: [entry('dots', min(0))], idle: [idle(min(-2), min(0))] });
    expect(attribute(orphan(), input, DEFAULT_POLICY)).toEqual({
      agent: 'dots',
      scoreBp: bp(DEFAULT_POLICY, ['userIdle', 'activityLogAdjacent']),
      signals: ['userIdle', 'activityLogAdjacent'],
    });
  });

  it("a signature names its own agent only (chatgpt's signature attributes chatgpt)", () => {
    const result = attribute(orphan({ subjectHint: 'Notes via ChatGPT' }), activity(), SIGNED);
    expect(result?.agent).toBe('chatgpt');
    expect(result?.signals).toEqual(['agentSignature']);
  });
});

describe('userIdle needs positive evidence', () => {
  const base = { sessions: [session('muse', min(-3))] };
  const signalsWith = (idleList: AttributionActivity['idle']) =>
    attribute(orphan(), activity({ ...base, idle: idleList }), DEFAULT_POLICY)?.signals;

  it('no recorded idle interval is never idle', () => {
    expect(signalsWith([])).toEqual(['agentSessionActive']);
  });

  it('an interval covering exactly [occurredAt − idleMin, occurredAt] counts (inclusive)', () => {
    const idleMin = DEFAULT_POLICY.unasked.windows.idleMin;
    expect(signalsWith([idle(min(-idleMin), min(0))])).toEqual(['agentSessionActive', 'userIdle']);
  });

  it('an interval that starts 1 ms late does not cover the span', () => {
    const idleMin = DEFAULT_POLICY.unasked.windows.idleMin;
    expect(signalsWith([idle(min(-idleMin) + 1, min(5))])).toEqual(['agentSessionActive']);
  });

  it('an interval that ends 1 ms before occurredAt does not cover the span', () => {
    expect(signalsWith([idle(min(-10), T - 1)])).toEqual(['agentSessionActive']);
  });

  it('golden 46 o3: an interval that starts after occurredAt − idleMin does not count', () => {
    expect(signalsWith([idle(min(-1), min(7))])).toEqual(['agentSessionActive']);
  });

  it('two touching intervals do not combine: one recorded interval must cover the span', () => {
    expect(signalsWith([idle(min(-2), min(-1)), idle(min(-1), min(0))])).toEqual(['agentSessionActive']);
  });

  it('idle data far from the orphan is not idle at the orphan', () => {
    expect(signalsWith([idle(min(-120), min(-60)), idle(min(60), min(120))])).toEqual(['agentSessionActive']);
  });
});

describe('signal windows are inclusive and exact to the millisecond', () => {
  const sessionMin = DEFAULT_POLICY.unasked.windows.sessionMin;
  const adjacentMin = DEFAULT_POLICY.unasked.windows.adjacentMin;
  const sessionAt = (ms: number) =>
    attribute(orphan(), activity({ sessions: [session('muse', ms)] }), DEFAULT_POLICY);
  const entryAt = (ms: number) =>
    attribute(orphan(), activity({ entries: [entry('muse', ms)] }), DEFAULT_POLICY);

  it.each([
    ['before', -1],
    ['after', 1],
  ] as const)('a session ping exactly sessionMin %s fires; 1 ms further does not', (_side, sign) => {
    expect(sessionAt(min(sign * sessionMin))?.signals).toEqual(['agentSessionActive']);
    expect(sessionAt(min(sign * sessionMin) + sign)).toBeNull();
  });

  it.each([
    ['before', -1],
    ['after', 1],
  ] as const)('an activity entry exactly adjacentMin %s fires; 1 ms further does not', (_side, sign) => {
    expect(entryAt(min(sign * adjacentMin))?.signals).toEqual(['activityLogAdjacent']);
    expect(entryAt(min(sign * adjacentMin) + sign)).toBeNull();
  });

  it('windows come from the policy: a wider sessionMin reaches a farther ping', () => {
    const wide = withUnasked({
      windows: { ...defaultPolicyJson.unasked.windows, sessionMin: sessionMin * 3 },
    });
    const input = activity({ sessions: [session('muse', min(-2 * sessionMin))] });
    expect(attribute(orphan(), input, DEFAULT_POLICY)).toBeNull();
    expect(attribute(orphan(), input, wide)?.signals).toEqual(['agentSessionActive']);
  });
});

describe('the receipt text never states that the agent acted (task 1.7 Done-when)', () => {
  const BANNED = [
    /\bdid (this|it)\b/i,
    /\b(muse|chatgpt|dots|claude|the agent|agent) (sent|did|made|created|bought)\b/i,
  ];

  it.each<AgentId>(['muse', 'chatgpt', 'dots', 'claude'])(
    'every reason of a %s attribution says "likely"',
    (agent) => {
      const all: UnaskedSignal[] = [
        'agentSessionActive',
        'userIdle',
        'agentSignature',
        'activityLogAdjacent',
      ];
      const reasons = attributionReasons({ agent, signals: all });
      expect(reasons.map((reason) => reason.params)).toEqual(all.map(() => ({ agent })));
      const texts = reasons.map(reasonText);
      expect(texts).toHaveLength(all.length);
      for (const text of texts) {
        expect(text).toMatch(/\blikely\b/);
        expect(text).toContain(AGENT_LABEL[agent]);
        for (const banned of BANNED) expect(text).not.toMatch(banned);
      }
    },
  );

  it('attributionReasons lists the fired signals (userIdle included) in §15 order, naming the agent', () => {
    const [observation, input] = scenario(['activityLogAdjacent', 'userIdle', 'agentSessionActive']);
    const result = attribute(observation, input, SIGNED);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(attributionReasons(result)).toEqual([
      { code: 'unasked.session', params: { agent: 'muse' } },
      { code: 'unasked.idle', params: { agent: 'muse' } },
      { code: 'unasked.adjacent', params: { agent: 'muse' } },
    ]);
  });
});
