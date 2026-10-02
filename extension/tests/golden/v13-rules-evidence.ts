/**
 * The contract v1.3 rules about evidence and params (docs/grading.md v1.3 §4.1, §5.1, §6.1, §8, §15): ceilings
 * against a receipt's currency, the best-candidate tie-break, calendar first-seen across duplicates, amountExact
 * with a missing currency and the scope hash. Each proof says whether a tagged scenario really exercises its
 * rule; v13-rules.ts collects them with the other v1.3 rules.
 */
import { MS_PER_DAY } from '../../src/core/units';
import { grantInForce } from './grants';
import { bestOf, claimOf, evidenceOf, minutes, minuteWindow, type Proof } from './proof-helpers';
import { type ExpectedReceipt, type Scenario, type ScenarioObservation } from './scenario-schema';
import { instantMs, truncateIso } from './time';

const grantOf = (s: Scenario, e: ExpectedReceipt): Scenario['input']['grants'][number] | undefined =>
  grantInForce(s, claimOf(s, e)?.agent);

/** §6.1 v1.3: a claim in spendCurrency, assigned a receipt in another currency → ceiling.currency_mismatch. */
const thirdCurrencyReceipt: Proof = (s) =>
  s.expect.some((e) => {
    const spend = grantOf(s, e)?.spendCurrency;
    const seen = evidenceOf(s, e)?.currency;
    return (
      spend !== undefined &&
      claimOf(s, e)?.currency === spend &&
      seen !== undefined &&
      seen !== spend &&
      e.ruleId === 'over_ceiling' &&
      e.reasonCodes.includes('ceiling.currency_mismatch')
    );
  });

/** §6.1 v1.3: an Amount above the ceiling keeps ceiling.exceeded next to a currency mismatch, params asserted. */
const exceededAndMismatch: Proof = (s) =>
  s.expect.some((e) => {
    const params = e.reasonParams ?? {};
    return (
      e.reasonCodes.includes('ceiling.exceeded') &&
      e.reasonCodes.includes('ceiling.currency_mismatch') &&
      params['ceiling.exceeded'] !== undefined &&
      params['ceiling.currency_mismatch'] !== undefined
    );
  });

const sameContent = (a: ScenarioObservation, b: ScenarioObservation): boolean =>
  a.type === b.type && a.counterparty === b.counterparty && a.subjectHint === b.subjectHint;

/**
 * §8 v1.3: equal best scores break by observation id. The file pins a best candidate with a lower id but a
 * later occurredAt than an equal one (same content, both inside the claim's unit, so both score the same), once
 * assigned and once below partial.
 */
const bestTieById: Proof = (s, policy) => {
  const ascending = s.assertIds?.ascending ?? [];
  const tied = s.expect.filter((e) => {
    const claim = claimOf(s, e);
    const best = bestOf(s, e);
    if (claim === undefined || best === undefined) return false;
    const { start, end } = minuteWindow(claim, policy);
    const inUnit = (o: ScenarioObservation): boolean =>
      start <= instantMs(o.occurredAt) && instantMs(o.occurredAt) <= end;
    return s.input.observations.some(
      (o) =>
        o.ref !== best.ref &&
        sameContent(o, best) &&
        inUnit(o) &&
        inUnit(best) &&
        instantMs(o.occurredAt) < instantMs(best.occurredAt) &&
        ascending.some(([low, high]) => low === best.ref && high === o.ref),
    );
  });
  return tied.some((e) => e.observationRefs.length === 1) && tied.some((e) => e.observationRefs.length === 0);
};

/** §4.1 v1.3: the earliest observedAt of a contentHash group decides calendar.created first-seen. */
const firstSeenDuplicates: Proof = (s, policy) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    if (claim?.type !== 'calendar.created' || claim.targetAt === undefined) return false;
    const bound = instantMs(truncateIso(claim.claimedAt, 'minute')) - minutes(policy.windows.beforeClaimMin);
    const reach = policy.windows.calendarDays * MS_PER_DAY;
    const byRef = (ref: string): ScenarioObservation | undefined =>
      s.input.observations.find((o) => o.ref === ref);
    return (s.assertIds?.equal ?? []).some(([a, b]) => {
      const pair = [byRef(a), byRef(b)];
      const seen = pair.flatMap((o) => (o?.observedAt === undefined ? [] : [instantMs(o.observedAt)]));
      const near = pair.every(
        (o) =>
          o?.type === claim.type &&
          Math.abs(instantMs(o.occurredAt) - instantMs(claim.targetAt ?? '')) <= reach &&
          o.subjectHint === claim.subjectHint,
      );
      return near && seen.length === 2 && Math.min(...seen) < bound && Math.max(...seen) >= bound
        ? e.grade === 'NOT_FOUND' && e.observationRefs.length === 0
        : false;
    });
  });

/** §4.1 v1.3: the first-seen bound is start(p,t) − beforeClaimMin, not the raw claimedAt − beforeClaimMin. */
const firstSeenUnitStart: Proof = (s, policy) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    const seen = evidenceOf(s, e)?.observedAt;
    if (claim?.type !== 'calendar.created' || seen === undefined) return false;
    const before = minutes(policy.windows.beforeClaimMin);
    const fromUnit = instantMs(truncateIso(claim.claimedAt, 'minute')) - before;
    const fromRaw = instantMs(claim.claimedAt) - before;
    return fromUnit <= instantMs(seen) && instantMs(seen) < fromRaw && e.grade === 'VERIFIED';
  });

/** §15 v1.3: scope.observed_not_declared carries {scopeHash: sha256Hex(scope)}, asserted on a scope receipt. */
const scopeHashParams: Proof = (s) =>
  s.expect.some(
    (e) =>
      e.scope !== undefined && e.reasonParams?.['scope.observed_not_declared']?.scopeHash === e.scope.scope,
  );

/**
 * §5.1 v1.3: amountExact applies when the claim has amountCents, and a currency missing on either side scores 0:
 * equal amounts with one currency missing never make a perfect score.
 */
const amountExactCurrencyMissing: Proof = (s) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    const seen = evidenceOf(s, e);
    if (claim?.amountCents === undefined || seen?.amountCents !== claim.amountCents) return false;
    const oneMissing = (claim.currency === undefined) !== (seen.currency === undefined);
    return oneMissing && e.score !== null && e.score !== '1/1';
  });

export const EVIDENCE_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['ceiling_third_currency', thirdCurrencyReceipt],
  ['ceiling_exceeded_and_mismatch', exceededAndMismatch],
  ['best_tie_by_observation_id', bestTieById],
  ['calendar_first_seen_duplicates', firstSeenDuplicates],
  ['first_seen_unit_start', firstSeenUnitStart],
  ['scope_hash_params', scopeHashParams],
  ['amount_exact_currency_missing', amountExactCurrencyMissing],
];
