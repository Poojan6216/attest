/**
 * The contract v1.4 event rules (docs/grading.md §7, §8) and params corrections (§15), each with a proof that a
 * tagged scenario really exercises it. v14-rules.ts collects them with the other v1.4 rules.
 */
import { grantInForce } from './grants';
import { claimOf, evidenceOf, minutes, minuteWindow, type Proof } from './proof-helpers';
import { type Scenario, type ScenarioEvent } from './scenario-schema';
import { instantMs } from './time';

type Regrade = Extract<ScenarioEvent, { event: 'regrade' }>;

const eventsOf = (s: Scenario): ScenarioEvent[] => s.events ?? [];
const applied = (event: ScenarioEvent): boolean => event.rejected !== true;
const isRegrade = (event: ScenarioEvent): event is Regrade => event.event === 'regrade';

/**
 * §8: a VERIFIED claim that could not be FINAL at the first grading (no sync by then reached end + graceMin)
 * becomes FINAL through an applied regrade at an instant by which such a sync exists.
 */
const regradePendingToFinal: Proof = (s, policy) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    if (claim === undefined || e.grade !== 'VERIFIED' || (e.previousState ?? e.state) !== 'FINAL')
      return false;
    const due = minuteWindow(claim, policy).end + minutes(policy.windows.graceMin);
    const syncs = s.input.coverage.map((c) => instantMs(c.lastSyncAt));
    const finalBy = (atMs: number): boolean => syncs.some((t) => t <= atMs && t >= due);
    return (
      !finalBy(instantMs(s.input.evaluatedAt)) &&
      eventsOf(s).some(
        (ev) => isRegrade(ev) && applied(ev) && ev.ref === e.ref && finalBy(instantMs(ev.evaluatedAt)),
      )
    );
  });

/** §8 v1.4: a regrade computed before the stored receipt is refused while the receipt is still PENDING. */
const regradeStaleRejected: Proof = (s) => {
  const events = eventsOf(s);
  return events.some(
    (ev, i) =>
      isRegrade(ev) &&
      !applied(ev) &&
      instantMs(ev.evaluatedAt) < instantMs(s.input.evaluatedAt) &&
      !events.slice(0, i).some((prior) => prior.ref === ev.ref && applied(prior)) &&
      events.slice(i + 1).some((later) => isRegrade(later) && later.ref === ev.ref && applied(later)),
  );
};

/** §8: once a regrade made the receipt FINAL, a later (not stale) regrade is refused. */
const regradeFinalRejected: Proof = (s) => {
  const events = eventsOf(s);
  return events.some((ev, i) => {
    if (!isRegrade(ev) || applied(ev)) return false;
    const prior = events.slice(0, i).filter((p) => p.ref === ev.ref && applied(p));
    const last = prior.filter(isRegrade).at(-1);
    const e = s.expect.find((x) => x.ref === ev.ref);
    return (
      last !== undefined &&
      prior.every((p) => p.event !== 'override') &&
      instantMs(ev.evaluatedAt) >= instantMs(last.evaluatedAt) &&
      (e?.previousState ?? e?.state) === 'FINAL'
    );
  });
};

/** §8 v1.4: an override dated before the regraded receipt's computedAt (yet after the first grading) is refused. */
const overrideBeforeComputedRejected: Proof = (s) => {
  const events = eventsOf(s);
  return events.some((ev, i) => {
    if (ev.event !== 'override' || applied(ev)) return false;
    const computed = events
      .slice(0, i)
      .filter((p): p is Regrade => isRegrade(p) && p.ref === ev.ref && applied(p))
      .at(-1)?.evaluatedAt;
    const at = instantMs(ev.at);
    return (
      computed !== undefined &&
      instantMs(s.input.evaluatedAt) <= at &&
      at < instantMs(computed) &&
      events.slice(i + 1).some((next) => next.event === 'override' && next.ref === ev.ref && applied(next))
    );
  });
};

/** §8 v1.4: a PENDING UNASKED regrades to a FINAL UNASKED once the agent's later adapter sync is visible. */
const unaskedRegradeStaysUnasked: Proof = (s) =>
  s.expect.some((e) => {
    if (e.grade !== 'UNASKED' || e.state !== 'FINAL') return false;
    const evaluated = instantMs(s.input.evaluatedAt);
    return eventsOf(s).some(
      (ev) =>
        isRegrade(ev) &&
        applied(ev) &&
        ev.ref === e.ref &&
        (s.input.activity?.adapterSyncs ?? []).some(
          (sync) =>
            sync.agent === e.agent &&
            evaluated < instantMs(sync.lastSyncAt) &&
            instantMs(sync.lastSyncAt) <= instantMs(ev.evaluatedAt),
        ),
    );
  });

/** §7, §8: a PENDING UNASKED that a later grading no longer returns (a claim read since explains it) is deleted. */
const unaskedRegradeDeleted: Proof = (s) =>
  eventsOf(s).some(
    (ev) =>
      isRegrade(ev) &&
      ev.deleted === true &&
      ev.ref.startsWith('o') &&
      !s.expect.some((e) => e.ref === ev.ref) &&
      s.input.claims.some(
        (c) =>
          c.observedAt !== undefined &&
          instantMs(s.input.evaluatedAt) < instantMs(c.observedAt) &&
          instantMs(c.observedAt) <= instantMs(ev.evaluatedAt),
      ),
  );

/** §8 v1.4: a later supersede replaces the earlier claim; repeating the same claim changes nothing. */
const supersedeReplaces: Proof = (s) =>
  s.expect.some((e) => {
    const claims = eventsOf(s).flatMap((ev) =>
      ev.event === 'supersede' && ev.ref === e.ref && applied(ev) ? [ev.claim] : [],
    );
    return new Set(claims).size >= 2 && claims[0] !== e.supersededBy && claims.at(-1) === e.supersededBy;
  });

/** §15 v1.4: coverage.no_parser carries {source}. */
const noParserSourceParam: Proof = (s) =>
  s.expect.some((e) => e.reasonParams?.['coverage.no_parser']?.source === 'gmail.receipt');

/** §15 v1.4: with the claim in spendCurrency, the mismatch's currency is the assigned candidate's. */
const currencyParamCandidate: Proof = (s) =>
  s.expect.some((e) => {
    const spend = grantInForce(s, claimOf(s, e)?.agent)?.spendCurrency;
    const seen = evidenceOf(s, e)?.currency;
    const param = e.reasonParams?.['ceiling.currency_mismatch']?.currency;
    return (
      spend !== undefined &&
      claimOf(s, e)?.currency === spend &&
      seen !== undefined &&
      seen !== spend &&
      param === seen
    );
  });

/**
 * §15 v1.4: when the claim's currency and the assigned candidate's both differ from spendCurrency, and from each
 * other, the mismatch's currency is the claim's (the claim comes first).
 */
const currencyParamClaimFirst: Proof = (s) =>
  s.expect.some((e) => {
    const spend = grantInForce(s, claimOf(s, e)?.agent)?.spendCurrency;
    const own = claimOf(s, e)?.currency;
    const seen = evidenceOf(s, e)?.currency;
    const param = e.reasonParams?.['ceiling.currency_mismatch']?.currency;
    return (
      spend !== undefined &&
      own !== undefined &&
      seen !== undefined &&
      new Set([spend, own, seen]).size === 3 &&
      param === own
    );
  });

export const EVENT_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['regrade_pending_to_final', regradePendingToFinal],
  ['regrade_stale_rejected', regradeStaleRejected],
  ['regrade_final_rejected', regradeFinalRejected],
  ['override_before_computed_rejected', overrideBeforeComputedRejected],
  ['unasked_regrade_stays_unasked', unaskedRegradeStaysUnasked],
  ['unasked_regrade_deleted', unaskedRegradeDeleted],
  ['supersede_replaces', supersedeReplaces],
  ['no_parser_source_param', noParserSourceParam],
  ['currency_mismatch_param_candidate', currencyParamCandidate],
  ['currency_mismatch_param_claim_first', currencyParamClaimFirst],
];
