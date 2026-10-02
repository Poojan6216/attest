/**
 * Task 1.7 Done-when, end to end through grade() (docs/grading.md §6.1 unaskedLikely, §7, §15): an orphan
 * attributed by one signal alone is not UNASKED; combinations are; every UNASKED receipt says 'likely' and its
 * reasons render as text that never states the agent acted (Hard Rule 7).
 */
import { describe, expect, it } from 'vitest';

import { attribute, type AttributionActivity } from '../../../src/core/attribution';
import { grade } from '../../../src/core/grade';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import { reasonText } from '../../../src/core/reason-text';
import { Coverage, Grant, IsoTs, Observation, type UnaskedSignal } from '../../../src/core/schema';
import defaultPolicyJson from '../../../../policy/default.json';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const COVERAGE = Coverage.parse({ evaluatedAt: EVALUATED_AT, observers: [] });
const POLICY = loadPolicy({
  ...defaultPolicyJson,
  unasked: {
    ...defaultPolicyJson.unasked,
    signatures: { ...defaultPolicyJson.unasked.signatures, muse: ['sent with muse'] },
  },
});
const GRANT = Grant.parse({
  agent: 'muse',
  allowedTypes: ['email.sent'],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  updatedAt: '2026-10-05T15:00:00-04:00',
});

function observationOf(subjectHint: string): Observation {
  const content = {
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'vendor@supplier.example',
    subjectHint,
    occurredAt: '2026-10-06T14:03:00-04:00',
  } as const;
  const contentHash = sha256Hex(canonicalJson(content));
  return Observation.parse({
    ...content,
    id: idFromHash(contentHash),
    observedAt: '2026-10-06T14:10:00-04:00',
    contentHash,
  });
}

const INGREDIENT: Readonly<Record<UnaskedSignal, Partial<AttributionActivity>>> = {
  agentSessionActive: { sessions: [{ agent: 'muse', at: '2026-10-06T14:00:00-04:00' }] },
  userIdle: { idle: [{ from: '2026-10-06T13:55:00-04:00', to: '2026-10-06T14:05:00-04:00' }] },
  agentSignature: {},
  activityLogAdjacent: { entries: [{ agent: 'muse', at: '2026-10-06T14:04:00-04:00' }] },
};

function gradeOrphan(signals: readonly UnaskedSignal[]) {
  const parts = signals.map((signal) => INGREDIENT[signal]);
  const activity: AttributionActivity = {
    sessions: parts.flatMap((part) => part.sessions ?? []),
    idle: parts.flatMap((part) => part.idle ?? []),
    entries: parts.flatMap((part) => part.entries ?? []),
    adapterSyncs: [{ agent: 'muse', lastSyncAt: IsoTs.parse('2026-10-06T14:50:00-04:00') }],
    claims: [],
  };
  const orphan = observationOf(signals.includes('agentSignature') ? 'Invoice - Sent with Muse' : 'Invoice');
  const attribution = attribute(orphan, activity, POLICY, EVALUATED_AT);
  if (attribution === null) return null;
  return grade(null, [orphan], GRANT, POLICY, COVERAGE, { priorSpendCents: 0, attribution });
}

const BANNED = [
  /\bdid (this|it)\b/i,
  /\b(muse|the agent|agent) (sent|did|made|created|bought)\b/i,
  /\bthis was (?!likely\b)/i,
];

describe('task 1.7 Done-when through grade()', () => {
  it.each<UnaskedSignal>(['agentSessionActive', 'agentSignature', 'activityLogAdjacent'])(
    '%s alone is below the threshold: no UNASKED receipt',
    (signal) => {
      const receipt = gradeOrphan([signal]);
      expect(receipt).not.toBeNull();
      expect(receipt?.grade).not.toBe('UNASKED');
    },
  );

  it('userIdle alone attributes nobody, so there is nothing to grade', () => {
    expect(gradeOrphan(['userIdle'])).toBeNull();
  });

  const COMBINATIONS: readonly (readonly UnaskedSignal[])[] = [
    ['agentSessionActive', 'userIdle'],
    ['agentSessionActive', 'agentSignature'],
    ['agentSessionActive', 'activityLogAdjacent'],
    ['userIdle', 'agentSignature'],
    ['userIdle', 'activityLogAdjacent'],
    ['agentSignature', 'activityLogAdjacent'],
    ['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent'],
  ];

  it.each(COMBINATIONS.map((signals) => [signals.join(' + '), signals] as const))(
    '%s is UNASKED, labelled likely, with one reason per fired signal',
    (_label, signals) => {
      const receipt = gradeOrphan(signals);
      expect(receipt?.grade).toBe('UNASKED');
      expect(receipt?.ruleId).toBe('unasked');
      expect(receipt?.attribution).toBe('likely');
      const codes = receipt?.reasons.map((reason) => reason.code) ?? [];
      expect(codes.every((code) => code.startsWith('unasked.'))).toBe(true);
      expect(codes).toHaveLength(signals.length);
    },
  );

  it('the receipt text never states that the agent acted: every reason says likely, none is banned', () => {
    const receipt = gradeOrphan(['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent']);
    const texts = receipt?.reasons.map(reasonText) ?? [];
    expect(texts).toHaveLength(4);
    for (const text of texts) {
      expect(text).toMatch(/\blikely\b/);
      for (const banned of BANNED) expect(text).not.toMatch(banned);
    }
  });
});
