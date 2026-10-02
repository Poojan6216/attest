/**
 * Contract v1.4 rules of UNASKED attribution (docs/grading.md §3, §4.3, §7):
 *  - only an ASSIGNABLE claim (§4.3) of the agent of the observation's type suppresses `activityLogAdjacent`; a
 *    vague claim never does, so it cannot hide an UNASKED;
 *  - every window of a `calendar.*` observation is measured from its earliest `observedAt` (when the change was
 *    first seen), not from `occurredAt` (the event start); every other type keeps `occurredAt`;
 *  - with `evaluatedAt`, nothing from after it is read: sessions, entries and claims first read later are
 *    ignored, and an idle interval counts only up to it.
 * Expectations are written from the contract; `isAssignable` is only cross-checked, never the oracle.
 */
import { describe, expect, it } from 'vitest';

import {
  attribute,
  type AttributionActivity,
  type AttributionClaim,
  type AttributionOrphan,
  attributor,
} from '../../../src/core/attribution';
import { isAssignable } from '../../../src/core/features';
import { isoWithOffset } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ActionType, AgentId } from '../../../src/core/schema';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../../src/core/units';

const OFFSET = -240;
/** The anchor of every orphan below: 2026-10-06 14:03 at -04:00. */
const T = Date.parse('2026-10-06T14:03:00-04:00');
const iso = (ms: number): string => isoWithOffset(ms, OFFSET);
const min = (minutes: number): number => T + minutes * MS_PER_MINUTE;
const W = DEFAULT_POLICY.unasked.windows;
const SIGNALS = DEFAULT_POLICY.bp.unasked.signals;

const email = (fields: Partial<AttributionOrphan> = {}): AttributionOrphan => ({
  type: 'email.sent',
  occurredAt: iso(T),
  observedAt: iso(min(20)),
  ...fields,
});
/** A calendar change first seen at T, for an event two days later (`occurredAt` is the event start). */
const calendar = (type: ActionType = 'calendar.created'): AttributionOrphan => ({
  type,
  occurredAt: iso(T + 2 * MS_PER_DAY),
  observedAt: iso(T),
  subjectHint: 'Q3 review',
});

const activity = (fields: Partial<AttributionActivity> = {}): AttributionActivity => ({
  sessions: [],
  idle: [],
  entries: [],
  adapterSyncs: [],
  claims: [],
  ...fields,
});
const at = (agent: AgentId, ms: number) => ({ agent, at: iso(ms) });
const idle = (fromMs: number, toMs: number) => ({ from: iso(fromMs), to: iso(toMs) });
const claim = (fields: Partial<AttributionClaim> = {}): AttributionClaim => ({
  agent: 'muse',
  type: 'email.sent',
  claimedAt: iso(min(-1)),
  claimedAtPrecision: 'minute',
  observedAt: iso(min(-1)),
  ...fields,
});

/** The signals for `orphan` with a muse activity entry at its anchor plus `claims`. */
const withEntry = (orphan: AttributionOrphan, claims: readonly AttributionClaim[], anchorMs = T) =>
  attribute(orphan, activity({ entries: [at('muse', anchorMs)], claims }), DEFAULT_POLICY)?.signals ?? [];

const TARGET = iso(T + 2 * MS_PER_DAY);
/** [label, the orphan's type, the claim, whether §4.3 makes it assignable], written from the contract. */
const CASES: readonly (readonly [string, ActionType, AttributionClaim, boolean])[] = [
  ['an email claim naming an address', 'email.sent', claim({ counterparty: 'priya@company.com' }), true],
  ['an email claim naming a person', 'email.sent', claim({ counterparty: 'Priya' }), true],
  ['"Done! I\'ve sent the email" (no counterparty)', 'email.sent', claim(), false],
  [
    'an email claim with only a subject (not an email identity)',
    'email.sent',
    claim({ subjectHint: 'Q3 deck' }),
    false,
  ],
  ['an email claim whose name has no tokens', 'email.sent', claim({ counterparty: '!!!' }), false],
  [
    'a calendar claim with targetAt and a subject',
    'calendar.created',
    claim({ type: 'calendar.created', targetAt: TARGET, subjectHint: 'Q3 review' }),
    true,
  ],
  [
    'a calendar claim with a subject but no targetAt',
    'calendar.created',
    claim({ type: 'calendar.created', subjectHint: 'Q3 review' }),
    false,
  ],
  [
    'a calendar claim with targetAt but no identity',
    'calendar.created',
    claim({ type: 'calendar.created', targetAt: TARGET }),
    false,
  ],
  [
    'a purchase claim with an amount',
    'purchase.made',
    claim({ type: 'purchase.made', amountCents: 4999, currency: 'USD' }),
    true,
  ],
  ['a purchase claim with nothing to match', 'purchase.made', claim({ type: 'purchase.made' }), false],
  [
    'a claim of a type with no sources',
    'other',
    claim({ type: 'other', counterparty: 'priya@company.com' }),
    false,
  ],
];

describe('activityLogAdjacent: only an assignable claim suppresses it (§4.3, §7)', () => {
  it.each(CASES)('%s: suppresses iff assignable', (_label, type, explaining, assignable) => {
    expect(isAssignable(explaining, DEFAULT_POLICY)).toBe(assignable);
    const orphan = type.startsWith('calendar.') ? calendar(type) : email({ type });
    expect(withEntry(orphan, [explaining])).toEqual(assignable ? [] : ['activityLogAdjacent']);
  });

  it('a vague claim beside an assignable one: the assignable one still suppresses', () => {
    expect(withEntry(email(), [claim(), claim({ counterparty: 'priya@company.com' })])).toEqual([]);
  });
});

describe('activityLogAdjacent suppression: its reach and the vague-claim evasion (§4.3, §7)', () => {
  it('an entry adjacentMin before and a claim adjacentMin after the anchor: suppressed; 1 ms further: not', () => {
    // The entry and the claim's unit are 2 × adjacentMin apart: the farthest pair that can still suppress.
    const explaining = claim({ counterparty: 'priya@company.com', claimedAt: iso(min(W.adjacentMin)) });
    expect(withEntry(email(), [explaining], min(-W.adjacentMin))).toEqual([]);
    // An anchor 1 ms earlier (its entry moved with it): the claim's unit is now adjacentMin + 1 ms away.
    const earlier = email({ occurredAt: iso(T - 1) });
    expect(withEntry(earlier, [explaining], min(-W.adjacentMin) - 1)).toEqual(['activityLogAdjacent']);
    // The other side: a claim whose unit [start, start + 1 min] ends adjacentMin before the anchor.
    const before = claim({ counterparty: 'priya@company.com', claimedAt: iso(min(-W.adjacentMin - 1)) });
    expect(withEntry(email(), [before], min(W.adjacentMin))).toEqual([]);
  });

  it('the entry at the anchor: a claim unit exactly adjacentMin away suppresses, 1 ms further does not', () => {
    // The entry stays well within 2 × adjacentMin of the claim, so only the ±adjacentMin rule decides here.
    const before = claim({ counterparty: 'priya@company.com', claimedAt: iso(min(-W.adjacentMin - 1)) });
    expect(withEntry(email(), [before])).toEqual([]);
    expect(withEntry(email({ occurredAt: iso(T + 1) }), [before], T + 1)).toEqual(['activityLogAdjacent']);
    const after = claim({ counterparty: 'priya@company.com', claimedAt: iso(min(W.adjacentMin)) });
    expect(withEntry(email(), [after])).toEqual([]);
    expect(withEntry(email({ occurredAt: iso(T - 1) }), [after], T - 1)).toEqual(['activityLogAdjacent']);
  });

  it('golden-48 evasion: a vague claim right next to an unclaimed send cannot hide the UNASKED', () => {
    const input = activity({
      entries: [at('muse', min(1))],
      idle: [idle(min(-5), min(1))],
      claims: [claim({ claimedAt: iso(T), observedAt: iso(T) })],
    });
    expect(attribute(email(), input, DEFAULT_POLICY)).toEqual({
      agent: 'muse',
      scoreBp: SIGNALS.userIdle + SIGNALS.activityLogAdjacent,
      signals: ['userIdle', 'activityLogAdjacent'],
    });
  });
});

describe('calendar observations are anchored on their earliest observedAt (§7)', () => {
  it.each<ActionType>(['calendar.created', 'calendar.updated', 'calendar.deleted'])(
    '%s: a session near observedAt fires, one near the event start does not',
    (type) => {
      const near = activity({ sessions: [at('muse', min(-W.sessionMin))] });
      expect(attribute(calendar(type), near, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive']);
      const atEventStart = activity({ sessions: [at('muse', T + 2 * MS_PER_DAY)] });
      expect(attribute(calendar(type), atEventStart, DEFAULT_POLICY)).toBeNull();
    },
  );

  it('userIdle covers [observedAt − idleMin, observedAt], not the span before the event start', () => {
    const session = at('muse', min(-1));
    const atSeen = activity({ sessions: [session], idle: [idle(min(-W.idleMin), T)] });
    expect(attribute(calendar(), atSeen, DEFAULT_POLICY)?.signals).toEqual([
      'agentSessionActive',
      'userIdle',
    ]);
    const eventStart = T + 2 * MS_PER_DAY;
    const atStart = activity({
      sessions: [session],
      idle: [idle(eventStart - W.idleMin * MS_PER_MINUTE, eventStart)],
    });
    expect(attribute(calendar(), atStart, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive']);
  });

  it('adjacency and its suppression are measured from observedAt too', () => {
    const explaining = claim({
      type: 'calendar.created',
      targetAt: iso(T + 2 * MS_PER_DAY),
      subjectHint: 'Q3 review',
    });
    expect(withEntry(calendar(), [])).toEqual(['activityLogAdjacent']);
    expect(withEntry(calendar(), [explaining])).toEqual([]);
    // The same claim made two days later, at the event start, explains nothing seen at T.
    const late = { ...explaining, claimedAt: iso(T + 2 * MS_PER_DAY), observedAt: iso(T + 2 * MS_PER_DAY) };
    expect(withEntry(calendar(), [late])).toEqual(['activityLogAdjacent']);
  });

  it("the attributor's occurredMs is ignored for a calendar orphan and used for any other", () => {
    const attributeAll = attributor(activity({ sessions: [at('muse', T)] }), DEFAULT_POLICY);
    const far = T + 2 * MS_PER_DAY;
    expect(attributeAll(calendar(), far)?.signals).toEqual(['agentSessionActive']);
    expect(attributeAll(email(), T)?.signals).toEqual(['agentSessionActive']);
    expect(attributeAll(email({ occurredAt: iso(far) }), far)).toBeNull();
  });

  it('an email orphan is anchored on occurredAt: a session near its observedAt alone does not fire', () => {
    const input = activity({ sessions: [at('muse', min(20))] });
    expect(attribute(email({ observedAt: iso(min(20)) }), input, DEFAULT_POLICY)).toBeNull();
  });
});

describe('with evaluatedAt, nothing from after it is read (§3)', () => {
  const EVALUATED = iso(min(1));

  it('a session after evaluatedAt is ignored; one at evaluatedAt counts; without evaluatedAt both count', () => {
    const late = activity({ sessions: [at('muse', min(1) + 1)] });
    expect(attribute(email(), late, DEFAULT_POLICY, EVALUATED)).toBeNull();
    expect(attribute(email(), late, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive']);
    const onTime = activity({ sessions: [at('muse', min(1))] });
    expect(attribute(email(), onTime, DEFAULT_POLICY, EVALUATED)?.signals).toEqual(['agentSessionActive']);
  });

  it('an activity entry after evaluatedAt is ignored', () => {
    const input = activity({ entries: [at('muse', min(2))] });
    expect(attribute(email(), input, DEFAULT_POLICY, EVALUATED)).toBeNull();
    expect(attribute(email(), input, DEFAULT_POLICY, iso(min(2)))?.signals).toEqual(['activityLogAdjacent']);
  });

  it('a claim first read after evaluatedAt does not suppress; one read by then does', () => {
    const explaining = claim({ counterparty: 'priya@company.com', observedAt: iso(min(1) + 1) });
    const input = activity({ entries: [at('muse', T)], claims: [explaining] });
    expect(attribute(email(), input, DEFAULT_POLICY, EVALUATED)?.signals).toEqual(['activityLogAdjacent']);
    expect(attribute(email(), input, DEFAULT_POLICY, iso(min(1) + 1))).toBeNull();
    expect(attribute(email(), input, DEFAULT_POLICY)).toBeNull();
  });

  it('an idle interval counts only up to evaluatedAt', () => {
    const session = at('muse', min(-1));
    const straddling = activity({ sessions: [session], idle: [idle(min(-5), min(10))] });
    // Anchored before evaluatedAt: the part up to evaluatedAt already covers [anchor − idleMin, anchor].
    expect(attribute(email(), straddling, DEFAULT_POLICY, EVALUATED)?.signals).toEqual([
      'agentSessionActive',
      'userIdle',
    ]);
    // Anchored after evaluatedAt (an occurredAt later than the grading): only evidence after it would cover it.
    const later = email({ occurredAt: iso(min(3)) });
    expect(attribute(later, straddling, DEFAULT_POLICY, EVALUATED)?.signals).toEqual(['agentSessionActive']);
    expect(attribute(later, straddling, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive', 'userIdle']);
    // An interval that starts after evaluatedAt is no evidence at all.
    const after = activity({ sessions: [session], idle: [idle(min(1) + 1, min(10))] });
    const laterStill = email({ occurredAt: iso(min(5)) });
    expect(attribute(laterStill, after, DEFAULT_POLICY, EVALUATED)?.signals).toEqual(['agentSessionActive']);
    expect(attribute(laterStill, after, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive', 'userIdle']);
  });

  it('a calendar orphan first seen after evaluatedAt is anchored there, and the cut applies the same way', () => {
    const seenLate: AttributionOrphan = { ...calendar(), observedAt: iso(min(3)) };
    const input = activity({ sessions: [at('muse', min(3))], idle: [idle(min(-5), min(10))] });
    expect(attribute(seenLate, input, DEFAULT_POLICY, EVALUATED)).toBeNull();
    expect(attribute(seenLate, input, DEFAULT_POLICY)?.signals).toEqual(['agentSessionActive', 'userIdle']);
  });
});
