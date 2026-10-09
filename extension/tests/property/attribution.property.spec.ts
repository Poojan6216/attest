/**
 * Property tests for attribute() (docs/grading.md §3, §4.3, §7, contract v1.4), 1,000 runs each:
 *  - equal to an independent oracle that reads §7 literally with linear scans (no index, no binary search):
 *    windows anchored on the earliest observedAt for calendar observations and on occurredAt otherwise, only
 *    assignable claims (decided by hand from §4.3 for the generated claims) suppressing activityLogAdjacent,
 *    a ping at the instant of an entry that fires activityLogAdjacent being that entry (v1.17: with no other ping
 *    in reach only the heavier of the two fires, adjacency on a tie), and nothing from after evaluatedAt read (idle
 *    intervals cut at it);
 *  - independent of the input order of every activity list;
 *  - the result always parses with the strict Attribution schema, carries an agent-specific signal, and its
 *    score is exactly min(Σ fired weights, BASIS_POINTS) in integer basis points;
 *  - `attributor(activity)` agrees with `attribute` on every orphan.
 * Times sit on a coarse grid around the orphan (whole minutes plus ±1 ms), so every window edge is hit.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  attribute,
  type AttributionActivity,
  type AttributionClaim,
  type AttributionOrphan,
  attributor,
} from '../../src/core/attribution';
import { asciiLower, isoWithOffset } from '../../src/core/normalize';
import { loadPolicy, type Policy } from '../../src/core/policy';
import { precisionBounds } from '../../src/core/window';
import {
  type ActionType,
  AgentId,
  Attribution,
  type Attribution as AttributionType,
  IsoTs,
  UnaskedSignal,
} from '../../src/core/schema';
import { BASIS_POINTS, MS_PER_MINUTE } from '../../src/core/units';
import defaultPolicyJson from '../../../policy/default.json';

const RUNS = 1_000;
const T = Date.parse('2026-10-06T14:03:00-04:00');
const OFFSETS = [-240, 0, 330] as const;
const TYPES: readonly ActionType[] = ['email.sent', 'calendar.created'];

const POLICY: Policy = loadPolicy({
  ...defaultPolicyJson,
  unasked: {
    ...defaultPolicyJson.unasked,
    signatures: { muse: ['sent with muse'], chatgpt: ['via chatgpt'], dots: [], claude: ['claude'] },
  },
});
const W = POLICY.unasked.windows;

/** An instant near T: a whole number of minutes (up to ±15) plus −1, 0 or +1 ms, so window edges are hit. */
const instantArb = fc
  .tuple(fc.integer({ min: -15, max: 15 }), fc.constantFrom(-1, 0, 1))
  .map(([minutes, ms]) => T + minutes * MS_PER_MINUTE + ms);
const isoArb = fc
  .tuple(instantArb, fc.constantFrom(...OFFSETS))
  .map(([ms, offset]) => isoWithOffset(ms, offset));
const agentArb = fc.constantFrom(...AgentId.options);

const agentAtArb = fc.record({ agent: agentArb, at: isoArb });
const idleArb = fc
  .tuple(instantArb, fc.integer({ min: 0, max: 8 }), fc.constantFrom(...OFFSETS))
  .map(([from, minutes, offset]) => ({
    from: isoWithOffset(from, offset),
    to: isoWithOffset(from + minutes * MS_PER_MINUTE, offset),
  }));
/** Counterparties and subjects whose §5.2 applicability is known by hand (see `assignable`). */
const COUNTERPARTIES = [undefined, 'priya@company.com', 'Priya', '!!!'] as const;
const SUBJECTS = [undefined, 'Q3 review', 'the'] as const;
const claimArb = fc.record({
  agent: agentArb,
  type: fc.constantFrom(...TYPES),
  counterparty: fc.constantFrom(...COUNTERPARTIES),
  subjectHint: fc.constantFrom(...SUBJECTS),
  targetAt: fc.option(isoArb, { nil: undefined }),
  claimedAt: isoArb,
  claimedAtPrecision: fc.constantFrom('minute' as const, 'minute' as const, 'hour' as const),
  observedAt: isoArb,
});
const syncArb = fc.record({ agent: agentArb, lastSyncAt: isoArb.map((value) => IsoTs.parse(value)) });

const activityArb = fc.record({
  sessions: fc.array(agentAtArb, { maxLength: 4 }),
  idle: fc.array(idleArb, { maxLength: 3 }),
  entries: fc.array(agentAtArb, { maxLength: 4 }),
  adapterSyncs: fc.array(syncArb, { maxLength: 4 }),
  claims: fc.array(claimArb, { maxLength: 3 }),
});
const orphanArb = fc.record({
  type: fc.constantFrom(...TYPES),
  occurredAt: fc.constantFrom(T, T + 1, T - 1).map((ms) => isoWithOffset(ms, -240)),
  observedAt: isoArb,
  subjectHint: fc.constantFrom('Invoice', 'INVOICE - SENT WITH MUSE', 'notes via ChatGPT', 'Claude summary'),
});
const evaluatedAtArb = fc.option(isoArb, { nil: undefined });

const ms = (iso: string): number => Date.parse(iso);

// ── The oracle: §7 read literally, linear scans only ────────────────────────────────────────────────────

/**
 * §4.3 for the generated claims, by hand: email needs a counterparty with a token (an address or 'Priya', not
 * '!!!'); a calendar claim needs targetAt and a subject with a token ('Q3 review', not the stop word 'the') or
 * such a counterparty.
 */
function assignable(claim: AttributionClaim): boolean {
  const counterparty = claim.counterparty === 'priya@company.com' || claim.counterparty === 'Priya';
  if (claim.type === 'email.sent') return counterparty;
  return claim.targetAt !== undefined && (claim.subjectHint === 'Q3 review' || counterparty);
}

function oracleSignals(
  agent: AgentId,
  orphan: AttributionOrphan,
  activity: AttributionActivity,
  limit: number,
): UnaskedSignal[] {
  const t = orphan.type.startsWith('calendar.') ? ms(orphan.observedAt) : ms(orphan.occurredAt);
  const within = (at: number, radius: number) => at <= limit && Math.abs(at - t) <= radius * MS_PER_MINUTE;
  const fired = new Set<UnaskedSignal>();
  if (activity.sessions.some((s) => s.agent === agent && within(ms(s.at), W.sessionMin))) {
    fired.add('agentSessionActive');
  }
  const subject = asciiLower(orphan.subjectHint ?? '');
  if (POLICY.unasked.signatures[agent].some((signature) => subject.includes(asciiLower(signature)))) {
    fired.add('agentSignature');
  }
  const explained = activity.claims.some((claim) => {
    if (claim.agent !== agent || claim.type !== orphan.type) return false;
    if (ms(claim.observedAt) > limit || !assignable(claim)) return false;
    const unit = precisionBounds(claim);
    const distance = t < unit.startMs ? unit.startMs - t : t > unit.endMs ? t - unit.endMs : 0;
    return distance <= W.adjacentMin * MS_PER_MINUTE;
  });
  const firing = explained
    ? []
    : activity.entries
        .filter((e) => e.agent === agent && within(ms(e.at), W.adjacentMin))
        .map((e) => ms(e.at));
  if (firing.length > 0) fired.add('activityLogAdjacent');
  const ownPing = activity.sessions.some(
    (s) => s.agent === agent && within(ms(s.at), W.sessionMin) && !firing.includes(ms(s.at)),
  );
  if (fired.has('agentSessionActive') && firing.length > 0 && !ownPing) {
    const weights = POLICY.bp.unasked.signals;
    const lighter =
      weights.agentSessionActive > weights.activityLogAdjacent ? 'activityLogAdjacent' : 'agentSessionActive';
    fired.delete(lighter);
  }
  if (fired.size === 0) return [];
  const covers = (i: { from: string; to: string }) =>
    ms(i.from) <= t - W.idleMin * MS_PER_MINUTE && Math.min(ms(i.to), limit) >= t;
  if (activity.idle.some(covers)) fired.add('userIdle');
  return UnaskedSignal.options.filter((signal) => fired.has(signal));
}

function oracleSync(agent: AgentId, activity: AttributionActivity, evaluatedAt: string | undefined) {
  const eligible = activity.adapterSyncs.filter(
    (sync) => sync.agent === agent && (evaluatedAt === undefined || ms(sync.lastSyncAt) <= ms(evaluatedAt)),
  );
  const latest = Math.max(...eligible.map((sync) => ms(sync.lastSyncAt)));
  return eligible
    .filter((sync) => ms(sync.lastSyncAt) === latest)
    .map((sync) => sync.lastSyncAt)
    .sort()[0];
}

function oracle(
  orphan: AttributionOrphan,
  activity: AttributionActivity,
  evaluatedAt: string | undefined,
): AttributionType | null {
  const limit = evaluatedAt === undefined ? Number.POSITIVE_INFINITY : ms(evaluatedAt);
  const candidates = AgentId.options
    .map((agent) => {
      const signals = oracleSignals(agent, orphan, activity, limit);
      const total = signals.reduce((sum, signal) => sum + POLICY.bp.unasked.signals[signal], 0);
      return { agent, signals, scoreBp: Math.min(total, BASIS_POINTS) };
    })
    .filter((candidate) => candidate.signals.length > 0)
    .sort(
      (a, b) => b.scoreBp - a.scoreBp || b.signals.length - a.signals.length || (a.agent < b.agent ? -1 : 1),
    );
  const best = candidates[0];
  if (best === undefined) return null;
  const lastSync = oracleSync(best.agent, activity, evaluatedAt);
  return lastSync === undefined ? best : { ...best, adapterLastSyncAt: lastSync };
}

/** A deterministic permutation of each list (reverse, then rotate by one). */
function shuffled(activity: AttributionActivity): AttributionActivity {
  const mix = <T>(items: readonly T[]): T[] => {
    const reversed = [...items].reverse();
    return [...reversed.slice(1), ...reversed.slice(0, 1)];
  };
  return {
    sessions: mix(activity.sessions),
    idle: mix(activity.idle),
    entries: mix(activity.entries),
    adapterSyncs: mix(activity.adapterSyncs),
    claims: mix<AttributionClaim>(activity.claims),
  };
}

describe('attribute() properties (§7)', () => {
  it('equals the literal oracle', () => {
    fc.assert(
      fc.property(orphanArb, activityArb, evaluatedAtArb, (orphan, activity, evaluatedAt) => {
        expect(attribute(orphan, activity, POLICY, evaluatedAt)).toEqual(
          oracle(orphan, activity, evaluatedAt),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('does not depend on the order of any activity list', () => {
    fc.assert(
      fc.property(orphanArb, activityArb, evaluatedAtArb, (orphan, activity, evaluatedAt) => {
        expect(attribute(orphan, shuffled(activity), POLICY, evaluatedAt)).toEqual(
          attribute(orphan, activity, POLICY, evaluatedAt),
        );
      }),
      { numRuns: RUNS },
    );
  });
});

describe('attribute() properties (§7): shape and batching', () => {
  it('always yields a schema-valid attribution with an agent signal and an exact capped score', () => {
    fc.assert(
      fc.property(orphanArb, activityArb, (orphan, activity) => {
        const result = attribute(orphan, activity, POLICY);
        if (result === null) return;
        expect(Attribution.parse(result)).toEqual(result);
        expect(result.signals.some((signal) => signal !== 'userIdle')).toBe(true);
        const total = result.signals.reduce((sum, signal) => sum + POLICY.bp.unasked.signals[signal], 0);
        expect(result.scoreBp).toBe(Math.min(total, BASIS_POINTS));
        expect(Number.isSafeInteger(result.scoreBp)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('attributor(activity) agrees with attribute() on several orphans against one activity', () => {
    fc.assert(
      fc.property(
        fc.array(orphanArb, { minLength: 1, maxLength: 4 }),
        activityArb,
        evaluatedAtArb,
        (orphans, activity, evaluatedAt) => {
          const attributeAll = attributor(activity, POLICY, evaluatedAt);
          for (const orphan of orphans) {
            expect(attributeAll(orphan)).toEqual(attribute(orphan, activity, POLICY, evaluatedAt));
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
