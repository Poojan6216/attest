/**
 * The §5.3 content gate (docs/grading.md v1.11; Sprint 2 wave E decision c), 1,000 runs each against an oracle
 * written out from the contract with BigInt and Date.parse:
 *  - a pair none of whose content features (every applicable feature but `timeProximity`) scores above 0 scores
 *    exactly 0, however close in time: no evidence on time alone;
 *  - every other pair scores exactly the weighted mean Σ wᵢ·vᵢ / Σ wᵢ of §5.3, so the gate changes nothing else;
 *  - the batch path (`RowScorer.fraction`, the one assignment reads) gives the same value as `features()`.
 * Values are recovered exactly from the display signals: `timeProximity` is recomputed from the instants (§5.1), and
 * every other value is 0, 1 or a fraction of small token counts, one per 4-decimal display (any two distinct
 * fractions with denominators up to 16 are more than 1 bp apart). Claims have minute precision.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  applicableFeatures,
  type FeatureClaim,
  type FeatureObservation,
  features,
  isAssignable,
  RowScorer,
} from '../../src/core/features';
import { observedFacts } from '../../src/core/features-observed';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { compareRatio, ratio, RATIO_ZERO } from '../../src/core/ratio';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../src/core/units';

const RUNS = { numRuns: 1_000 };
const BASE_MS = instantMs('2026-10-06T14:02:00-04:00');
const OFFSETS = [-420, -240, 0, 330, 840];
const { windows, bp } = DEFAULT_POLICY;

const instant = (rangeMs: number) =>
  fc
    .tuple(fc.integer({ min: -rangeMs, max: rangeMs }), fc.constantFrom(...OFFSETS))
    .map(([delta, offset]) => isoWithOffset(BASE_MS + delta, offset));

const ADDRESSES = [
  'priya@company.com',
  'raj@company.com',
  'priya+x@company.com',
  'raj@gmail.com',
  'prıya@company.com',
];
const NAMES = ['Priya', 'Priya Kumar', 'Acme Store', 'acme'];
const subject = fc
  .array(fc.constantFrom('q3', 'deck', 'budget', 'invoice', 'plan', 'the'), { maxLength: 3 })
  .map((words) => words.join(' '));

const claimArb: fc.Arbitrary<FeatureClaim> = fc.record(
  {
    type: fc.constantFrom('email.sent', 'calendar.created', 'calendar.deleted', 'purchase.made'),
    claimedAt: instant(MS_PER_MINUTE * 5),
    claimedAtPrecision: fc.constant('minute' as const),
    counterparty: fc.constantFrom(...ADDRESSES, ...NAMES),
    subjectHint: subject,
    targetAt: instant(MS_PER_DAY),
    amountCents: fc.constantFrom(3000, 8000),
    currency: fc.constantFrom('USD', 'CAD'),
  },
  { requiredKeys: ['type', 'claimedAt', 'claimedAtPrecision', 'targetAt'] },
);

const observationArb: fc.Arbitrary<FeatureObservation> = fc.record(
  {
    /** Mostly near (where time alone can reach thresholds.partial), sometimes days away. */
    occurredAt: fc.oneof(instant(MS_PER_MINUTE * 50), instant(MS_PER_DAY * 4)),
    counterparty: fc.constantFrom(...ADDRESSES, ...NAMES),
    merchant: fc.constantFrom('Acme', 'Acme Store', 'Globex'),
    subjectHint: subject,
    amountCents: fc.constantFrom(3000, 8000),
    currency: fc.constantFrom('USD', 'CAD'),
  },
  { requiredKeys: ['occurredAt'] },
);

interface Exact {
  readonly num: bigint;
  readonly den: bigint;
}

/** §5.1 timeProximity of a minute-precision claim, written out: distance to the unit (calendar: to targetAt). */
function timeValue(claim: FeatureClaim, occurredAt: string): Exact {
  const at = Date.parse(occurredAt);
  const calendar = claim.type.startsWith('calendar.');
  const startMs = calendar
    ? Date.parse(claim.targetAt ?? '')
    : Math.floor(Date.parse(claim.claimedAt) / MS_PER_MINUTE) * MS_PER_MINUTE;
  const endMs = calendar ? startMs : startMs + MS_PER_MINUTE;
  const before = at < startMs;
  const delta = before ? startMs - at : Math.max(at - endMs, 0);
  const edge = calendar
    ? windows.calendarDays * MS_PER_DAY
    : (before ? windows.beforeClaimMin : windows.afterClaimMin) * MS_PER_MINUTE;
  const tolerance = windows.toleranceMin * MS_PER_MINUTE;
  if (delta <= tolerance) return { num: 1n, den: 1n };
  if (delta >= edge) return { num: 0n, den: 1n };
  return { num: BigInt(edge - delta), den: BigInt(edge - tolerance) };
}

/** The one fraction with a denominator up to 16 that displays as `shown` (4 decimals). */
function smallFraction(shown: number): Exact {
  for (let den = 1; den <= 16; den += 1) {
    const num = Math.round(shown * den);
    if (Math.round((num / den) * 10_000) / 10_000 === shown) return { num: BigInt(num), den: BigInt(den) };
  }
  throw new Error(`no small fraction displays as ${String(shown)}`);
}

const tally = { gated: 0, nearGated: 0, open: 0 };

describe('the §5.3 content gate: no evidence on time alone (v1.11)', () => {
  it('scores 0 exactly when no content feature scored above 0, else the exact weighted mean', () => {
    fc.assert(
      fc.property(claimArb, observationArb, (claim, observation) => {
        fc.pre(isAssignable(claim, DEFAULT_POLICY));
        const result = features(claim, observation, DEFAULT_POLICY);
        let num = 0n;
        let den = 1n;
        let total = 0n;
        let content = false;
        for (const feature of applicableFeatures(claim, DEFAULT_POLICY)) {
          const shown = result.signals[feature] ?? Number.NaN;
          const value =
            feature === 'timeProximity' ? timeValue(claim, observation.occurredAt) : smallFraction(shown);
          if (feature !== 'timeProximity' && value.num > 0n) content = true;
          const weight = BigInt(bp.features[feature]);
          num = num * value.den + weight * value.num * den;
          den *= value.den;
          total += weight;
        }
        const mean = ratio(num, den * total);
        const expected = content ? mean : RATIO_ZERO;
        expect(compareRatio(result.score, expected)).toBe(0);
        // The batch path assignment reads: the same exact value.
        const out = new Float64Array(2);
        const scorer = new RowScorer(claim, DEFAULT_POLICY);
        const facts = observedFacts(observation, DEFAULT_POLICY.normalize.stopWords);
        const viaFraction = scorer.fraction(facts, out)
          ? ratio(out[0] ?? 0, out[1] ?? 1)
          : scorer.score(facts).ratio;
        expect(compareRatio(viaFraction, expected)).toBe(0);
        if (!content) tally.gated += 1;
        if (!content && 10_000n * mean.num >= BigInt(bp.thresholds.partial) * mean.den) tally.nearGated += 1;
        if (content) tally.open += 1;
      }),
      RUNS,
    );
    expect(tally.gated).toBeGreaterThan(RUNS.numRuns / 10);
    // Not vacuous: pairs whose time alone would have reached thresholds.partial were stopped.
    expect(tally.nearGated).toBeGreaterThan(RUNS.numRuns / 100);
    expect(tally.open).toBeGreaterThan(RUNS.numRuns / 10);
  });
});
