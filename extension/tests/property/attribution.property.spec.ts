/**
 * Property tests for attribute() (docs/grading.md §7), 1,000 runs each:
 *  - equal to an independent oracle that reads §7 literally with linear scans (no index, no binary search);
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
const TIMEOUT_MS = 30_000;
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
const claimArb = fc.record({
  agent: agentArb,
  type: fc.constantFrom(...TYPES),
  claimedAt: isoArb,
  claimedAtPrecision: fc.constantFrom('minute' as const, 'minute' as const, 'hour' as const),
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
  subjectHint: fc.constantFrom('Invoice', 'INVOICE - SENT WITH MUSE', 'notes via ChatGPT', 'Claude summary'),
});
const evaluatedAtArb = fc.option(isoArb, { nil: undefined });

const ms = (iso: string): number => Date.parse(iso);

// ── The oracle: §7 read literally, linear scans only ────────────────────────────────────────────────────

function oracleSignals(
  agent: AgentId,
  orphan: AttributionOrphan,
  activity: AttributionActivity,
): UnaskedSignal[] {
  const t = ms(orphan.occurredAt);
  const within = (at: number, radius: number) => Math.abs(at - t) <= radius * MS_PER_MINUTE;
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
    const unit = precisionBounds(claim);
    const distance = t < unit.startMs ? unit.startMs - t : t > unit.endMs ? t - unit.endMs : 0;
    return distance <= W.adjacentMin * MS_PER_MINUTE;
  });
  if (!explained && activity.entries.some((e) => e.agent === agent && within(ms(e.at), W.adjacentMin))) {
    fired.add('activityLogAdjacent');
  }
  if (fired.size === 0) return [];
  const idle = activity.idle.some((i) => ms(i.from) <= t - W.idleMin * MS_PER_MINUTE && ms(i.to) >= t);
  if (idle) fired.add('userIdle');
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
  const candidates = AgentId.options
    .map((agent) => {
      const signals = oracleSignals(agent, orphan, activity);
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
  it(
    'equals the literal oracle',
    () => {
      fc.assert(
        fc.property(orphanArb, activityArb, evaluatedAtArb, (orphan, activity, evaluatedAt) => {
          expect(attribute(orphan, activity, POLICY, evaluatedAt)).toEqual(
            oracle(orphan, activity, evaluatedAt),
          );
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT_MS,
  );

  it(
    'does not depend on the order of any activity list',
    () => {
      fc.assert(
        fc.property(orphanArb, activityArb, evaluatedAtArb, (orphan, activity, evaluatedAt) => {
          expect(attribute(orphan, shuffled(activity), POLICY, evaluatedAt)).toEqual(
            attribute(orphan, activity, POLICY, evaluatedAt),
          );
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT_MS,
  );
});

describe('attribute() properties (§7): shape and batching', () => {
  it(
    'always yields a schema-valid attribution with an agent signal and an exact capped score',
    () => {
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
    },
    TIMEOUT_MS,
  );

  it(
    'attributor(activity) agrees with attribute() on several orphans against one activity',
    () => {
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
    },
    TIMEOUT_MS,
  );
});
