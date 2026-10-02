/**
 * features() memos (src/core/features-memo.ts) never change a result (fast-check, 1,000 runs): one claim object
 * and one observation object are edited in place by a random sequence of field changes and policy switches,
 * and after every step features() on them equals features() on fresh copies the memos have never seen, value
 * for value, or both throw the same typed error. Hard Rule 4: a memo only ever saves work.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import {
  type FeatureClaim,
  type FeatureObservation,
  type FeatureResult,
  features,
} from '../../src/core/features';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import { ActionType } from '../../src/core/schema';

const RUNS = { numRuns: 1_000 };
const PROPERTY_TIMEOUT_MS = 60_000;

const POLICIES: readonly Policy[] = [
  DEFAULT_POLICY,
  loadPolicy({
    ...defaultPolicyJson,
    normalize: { stopWords: [...defaultPolicyJson.normalize.stopWords, 'deck', 'acme'] },
  }),
  loadPolicy({ ...defaultPolicyJson, windows: { ...defaultPolicyJson.windows, afterClaimMin: 90 } }),
  // Built by hand: other windows, but the shipped policy's very own stop-word array.
  { ...DEFAULT_POLICY, windows: { ...DEFAULT_POLICY.windows, beforeClaimMin: 30, afterClaimMin: 5 } },
];

const times = fc.constantFrom(
  '2026-10-06T14:02:00-04:00',
  '2026-10-06T14:30:00-04:00',
  '2026-10-06T18:31:00Z',
  '2026-10-06T00:00:00-04:00',
  '2026-10-07T00:00:00-04:00',
);
const parties = fc.constantFrom(
  undefined,
  'priya@company.com',
  'priya+x@company.com',
  'prıya@company.com',
  'Priya',
  'Acme Store',
  'acme@',
);
const subjects = fc.constantFrom(undefined, '', 'Q3 deck', 'Re: Q3 deck review', 'the', '‮kced');
const amounts = fc.constantFrom(undefined, 0, 3000);
const currencies = fc.constantFrom(undefined, 'USD', 'CAD');

const claimEdit: fc.Arbitrary<Partial<FeatureClaim>> = fc.oneof(
  fc.record({ type: fc.constantFrom(...ActionType.options) }),
  fc.record({ claimedAt: times }),
  fc.record({ claimedAtPrecision: fc.constantFrom('minute' as const, 'hour' as const, 'day' as const) }),
  fc.record({ claimedAtEnd: fc.option(times, { nil: undefined }) }),
  fc.record({ targetAt: fc.option(times, { nil: undefined }) }),
  fc.record({ counterparty: parties }),
  fc.record({ subjectHint: subjects }),
  fc.record({ amountCents: amounts }),
  fc.record({ currency: currencies }),
);

const observationEdit: fc.Arbitrary<Partial<FeatureObservation>> = fc.oneof(
  fc.record({ occurredAt: times }),
  fc.record({ counterparty: parties }),
  fc.record({ merchant: parties }),
  fc.record({ subjectHint: subjects }),
  fc.record({ amountCents: amounts }),
  fc.record({ currency: currencies }),
);

type Step =
  | { readonly kind: 'claim'; readonly edit: Partial<FeatureClaim> }
  | { readonly kind: 'observation'; readonly edit: Partial<FeatureObservation> }
  | { readonly kind: 'policy'; readonly index: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  claimEdit.map((edit): Step => ({ kind: 'claim', edit })),
  observationEdit.map((edit): Step => ({ kind: 'observation', edit })),
  fc.nat({ max: POLICIES.length - 1 }).map((index): Step => ({ kind: 'policy', index })),
);

type Outcome = { readonly ok: FeatureResult } | { readonly threw: string; readonly code: unknown };

/** features() as a comparable outcome: its result, or the thrown error's class name and code. */
function outcome(claim: FeatureClaim, observation: FeatureObservation, policy: Policy): Outcome {
  try {
    return { ok: features(claim, observation, policy) };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { threw: error.name, code: 'code' in error ? error.code : undefined };
  }
}

/** An outcome as text (the exact score as p/q), to tell whether a step changed it. */
function summary(result: Outcome): string {
  if ('threw' in result) return `${result.threw}:${String(result.code)}`;
  const { score, signals, reasonCodes } = result.ok;
  return `${String(score.num)}/${String(score.den)} ${JSON.stringify(signals)} ${reasonCodes.join(',')}`;
}

const tally = { steps: 0, changed: 0, threw: 0 };

describe('features() memos (property)', () => {
  it(
    'after any sequence of in-place edits, scores exactly like fresh copies',
    () => {
      fc.assert(
        fc.property(fc.array(step, { minLength: 1, maxLength: 10 }), (steps) => {
          const claim: FeatureClaim = {
            type: 'email.sent',
            claimedAt: '2026-10-06T14:02:00-04:00',
            claimedAtPrecision: 'minute',
            counterparty: 'priya@company.com',
          };
          const observation: FeatureObservation = { occurredAt: '2026-10-06T14:20:00-04:00' };
          let policy = DEFAULT_POLICY;
          let previous = outcome(claim, observation, policy);
          for (const next of steps) {
            if (next.kind === 'claim') Object.assign(claim, next.edit);
            else if (next.kind === 'observation') Object.assign(observation, next.edit);
            else policy = POLICIES[next.index] ?? DEFAULT_POLICY;
            const memo = outcome(claim, observation, policy);
            expect(memo).toStrictEqual(outcome(structuredClone(claim), structuredClone(observation), policy));
            tally.steps += 1;
            if (summary(memo) !== summary(previous)) tally.changed += 1;
            if ('threw' in memo) tally.threw += 1;
            previous = memo;
          }
        }),
        RUNS,
      );
      // Not vacuous: edits really changed results (so a stale memo would show), and errors were compared too.
      expect(tally.changed).toBeGreaterThan(tally.steps / 4);
      expect(tally.threw).toBeGreaterThan(20);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
