/**
 * The contract v1.2 rules the golden suite must prove (docs/grading.md v1.2; Decisions [1.contract] v1.2).
 * Each entry is a `contract:<tag>` that some scenario must carry, and a predicate that the tagged scenario
 * really exercises the rule, so a mistagged or weakened file fails scenarios.spec.ts instead of passing.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../../src/core/units';
import { type PolicyView } from './build';
import {
  type ExpectedReceipt,
  REASON_PARAMS,
  type Scenario,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs, truncateIso } from './time';

/** A zero-width character between two letters: inside a word. */
const ZERO_WIDTH_IN_WORD = /\p{L}[\u200B-\u200D\u2060\uFEFF]\p{L}/u;
const ASCII_ONLY = /^[\x20-\x7E]+$/;
/** A bidi override (§11 v1.2), and every embedding/override control including the terminator U+202C. */
const BIDI_OVERRIDE = /[\u202D\u202E]/u;
const BIDI_EMBEDDING = /[\u202A-\u202E]/gu;

type Proof = (scenario: Scenario, policy: PolicyView) => boolean;

const claimOf = (s: Scenario, e: ExpectedReceipt): Scenario['input']['claims'][number] | undefined =>
  s.input.claims.find((c) => c.ref === e.ref);
const evidenceOf = (s: Scenario, e: ExpectedReceipt): ScenarioObservation | undefined =>
  s.input.observations.find((o) => o.ref === e.observationRefs[0]);

/** §4.1: a 25-hour local day, and evidence later than start + 24 h + afterClaimMin, still graded as found. */
const dayEndOnDst: Proof = (s, policy) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    const evidence = evidenceOf(s, e);
    if (claim?.claimedAtEnd === undefined || evidence === undefined || claim.claimedAtPrecision !== 'day')
      return false;
    const start = instantMs(truncateIso(claim.claimedAt, 'day'));
    const long = instantMs(claim.claimedAtEnd) - start === MS_PER_DAY + MS_PER_HOUR;
    const lastHour = start + MS_PER_DAY + policy.windows.afterClaimMin * MS_PER_MINUTE;
    return long && instantMs(evidence.occurredAt) > lastHour && e.grade === 'VERIFIED';
  });

/** §6.1: claim without a currency, assigned receipt in another currency → mismatch that waits like PARTIAL. */
const candidateCurrency: Proof = (s) => {
  const hits = s.expect.filter((e) => {
    const grant = s.input.grants.find((g) => g.agent === claimOf(s, e)?.agent);
    const currency = evidenceOf(s, e)?.currency;
    return (
      e.reasonCodes.includes('ceiling.currency_mismatch') &&
      claimOf(s, e)?.currency === undefined &&
      currency !== undefined &&
      currency !== grant?.spendCurrency
    );
  });
  return hits.some((e) => e.state === 'PENDING') && hits.some((e) => e.state === 'FINAL');
};

/** §5.1: identical ASCII addresses with an xn-- label score 1 with cp.non_ascii. */
const identicalXn: Proof = (s) =>
  s.expect.some((e) => {
    const address = claimOf(s, e)?.counterparty ?? '';
    const evidence = evidenceOf(s, e)?.counterparty ?? '';
    return (
      e.grade === 'VERIFIED' &&
      e.reasonCodes.includes('cp.non_ascii') &&
      ASCII_ONLY.test(address) &&
      address.includes('xn--') &&
      evidence.includes('xn--')
    );
  });

/** §5.1: an observation counterparty in display-name form is read through email(). */
const displayNameEvidence: Proof = (s) =>
  s.expect.some((e) => e.grade === 'VERIFIED' && evidenceOf(s, e)?.counterparty?.includes('<') === true);

/** §11: a zero-width character inside a word does not split it. */
const zeroWidthSubject: Proof = (s) =>
  s.expect.some((e) => {
    const subjects = [claimOf(s, e)?.subjectHint, evidenceOf(s, e)?.subjectHint];
    return (
      e.grade === 'VERIFIED' && subjects.some((text) => text !== undefined && ZERO_WIDTH_IN_WORD.test(text))
    );
  });

/**
 * §11: a subject holding a bidi override yields no tokens, so a pair whose subjects read the same once the
 * override is stripped is still not VERIFIED.
 */
const bidiOverrideSubject: Proof = (s) =>
  s.expect.some((e) => {
    const stored = evidenceOf(s, e)?.subjectHint ?? '';
    const claimed = claimOf(s, e)?.subjectHint;
    const shown = stored.replace(BIDI_EMBEDDING, '').toLowerCase();
    return (
      e.grade !== 'VERIFIED' &&
      claimed !== undefined &&
      BIDI_OVERRIDE.test(stored) &&
      shown === claimed.toLowerCase()
    );
  });

/** §3: an orphan that some agent signal touched but that stays below the threshold yields no receipt. */
const silentOrphan: Proof = (s, policy) => {
  const named = new Set(s.expect.flatMap((e) => [...e.observationRefs, e.ref ?? '']));
  const sessions = s.input.activity?.sessions ?? [];
  const sessionMs = policy.unasked.windows.sessionMin * MS_PER_MINUTE;
  return s.input.observations.some(
    (o) =>
      !named.has(o.ref) &&
      sessions.some((x) => Math.abs(instantMs(x.at) - instantMs(o.occurredAt)) <= sessionMs),
  );
};

/** §8: a best candidate below partial is named by match.best but is not evidence. */
const unassignedBest: Proof = (s) =>
  s.expect.some((e) => e.reasonCodes.includes('match.best') && e.observationRefs.length === 0);

/** §15: every code that carries params (except the scope hash, see README) has its params asserted somewhere. */
export function paramCodesAsserted(scenarios: readonly Scenario[]): string[] {
  const asserted = new Set(
    scenarios.flatMap((s) =>
      s.expect.flatMap((e) =>
        Object.entries(e.reasonParams ?? {}).flatMap(([code, params]) =>
          Object.keys(params).length > 0 ? [code] : [],
        ),
      ),
    ),
  );
  return Object.entries(REASON_PARAMS)
    .filter(([code, params]) => Object.keys(params).length > 0 && code !== 'scope.observed_not_declared')
    .map(([code]) => code)
    .filter((code) => !asserted.has(code));
}

const assertsParams: Proof = (s) => s.expect.some((e) => e.reasonParams !== undefined);

/** §15 order: allowlist.unchecked after the rule's own code, before coverage reasons; override.user last. */
const allowlistOrder: Proof = (s) =>
  s.expect.some((e) => {
    const codes = e.reasonCodes;
    const unchecked = codes.indexOf('allowlist.unchecked');
    const coverage = codes.findIndex((c) => c === 'coverage.account_unbound' || c === 'coverage.no_account');
    return unchecked >= 0 && coverage > unchecked && codes.at(-1) === 'override.user';
  });

/** The local part's [._-] tokens of an address, folded with `fold` (the test's own reading of a fold). */
const localTokens = (address: string, fold: (text: string) => string): string[] =>
  fold(address.slice(0, address.lastIndexOf('@'))).split(/[._-]/u);
const isName = (counterparty: string | undefined): counterparty is string =>
  counterparty !== undefined && !counterparty.includes('@');
const nameMatchesAfter = (name: string, address: string, fold: (text: string) => string): boolean =>
  name
    .toLowerCase()
    .split(/\s+/u)
    .every((token) => localTokens(address, fold).includes(token));

/**
 * §5.1: the local part is ASCII-lowercased (an ASCII-uppercase local part still verifies a name) and never
 * NFKC'd or String#toLowerCase'd (a lookalike that such a fold would match is not VERIFIED).
 */
const nameLocalPartAsciiOnly: Proof = (s) => {
  const pairs = s.expect.flatMap((e) => {
    const name = claimOf(s, e)?.counterparty;
    const address = evidenceOf(s, e)?.counterparty;
    return isName(name) && address !== undefined ? [{ e, name, address }] : [];
  });
  const asciiUpper = pairs.some(
    ({ e, name, address }) =>
      e.grade === 'VERIFIED' && /[A-Z]/u.test(address) && !nameMatchesAfter(name, address, (t) => t),
  );
  const lookalike = pairs.some(
    ({ e, name, address }) =>
      e.grade !== 'VERIFIED' &&
      !ASCII_ONLY.test(address) &&
      nameMatchesAfter(name, address, (t) => t.normalize('NFKC').toLowerCase()),
  );
  return asciiUpper && lookalike;
};

/** §11: a name holding a bidi override has no tokens, so an email claim naming only it is underspecified. */
const nameBidiOverride: Proof = (s) =>
  s.expect.some((e) => {
    const name = claimOf(s, e)?.counterparty;
    return isName(name) && BIDI_OVERRIDE.test(name) && e.ruleId === 'underspecified';
  });

const receiptOnly = (s: Scenario, policy: PolicyView, e: ExpectedReceipt): boolean => {
  const type = claimOf(s, e)?.type;
  const sources = type === undefined ? [] : (policy.sourcesByType?.[type] ?? []);
  return sources.length === 1 && sources[0] === 'gmail.receipt';
};

/** §6.1: receiptMerchants is matched by the claim's normalised name, not by its text as written. */
const purchaseCoverageByName: Proof = (s, policy) =>
  s.expect.some((e) => {
    const merchants = policy.receiptMerchants ?? [];
    const name = claimOf(s, e)?.counterparty ?? '';
    const normalisedOnly = !merchants.includes(name) && merchants.includes(name.toLowerCase());
    return receiptOnly(s, policy, e) && normalisedOnly && e.ruleId !== 'no_coverage';
  });

/** §6.1: a purchase claim with no counterparty has coverage none even inside a receipt interval. */
const purchaseNoCounterparty: Proof = (s, policy) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    if (claim === undefined || claim.counterparty !== undefined || !receiptOnly(s, policy, e)) return false;
    const unit = instantMs(truncateIso(claim.claimedAt, 'minute'));
    const from = unit - policy.windows.beforeClaimMin * MS_PER_MINUTE;
    const to = unit + MS_PER_MINUTE + policy.windows.afterClaimMin * MS_PER_MINUTE;
    const seen = s.input.coverage.some(
      (c) =>
        c.source === 'gmail.receipt' &&
        c.accountHash !== undefined &&
        instantMs(c.windowStart) <= from &&
        to <= instantMs(c.windowEnd),
    );
    return claim.claimedAtPrecision === undefined && seen && e.ruleId === 'no_coverage';
  });

/** §3: priorSpendCents counts claims that already hold a FINAL receipt (fixed), not only the batch. */
const priorSpendFromFinal: Proof = (s) => {
  const fixed = new Set((s.input.fixed ?? []).flatMap((pair) => pair.claim ?? []));
  return s.expect.some((e) => {
    const claim = claimOf(s, e);
    const prior = e.reasonParams?.['ceiling.cumulative_exceeded']?.priorSpendCents;
    const fromFixed = s.input.claims
      .filter((c) => fixed.has(c.ref) && c.agent === claim?.agent && c.currency === claim.currency)
      .reduce((sum, c) => sum + (c.amountCents ?? 0), 0);
    const batchBefore = s.input.claims.some(
      (c) => !fixed.has(c.ref) && c.ref !== claim?.ref && c.agent === claim?.agent,
    );
    return typeof prior === 'number' && prior > 0 && prior === fromFixed && !batchBefore;
  });
};

export const V12_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['name_local_part_ascii_only', nameLocalPartAsciiOnly],
  ['name_bidi_override', nameBidiOverride],
  ['purchase_coverage_by_name', purchaseCoverageByName],
  ['purchase_no_counterparty_none', purchaseNoCounterparty],
  ['prior_spend_reads_final_claims', priorSpendFromFinal],
  ['claimed_at_end_dst', dayEndOnDst],
  ['ceiling_candidate_currency', candidateCurrency],
  ['identical_xn_address', identicalXn],
  ['observation_counterparty_email', displayNameEvidence],
  ['subject_zero_width', zeroWidthSubject],
  ['subject_bidi_override', bidiOverrideSubject],
  ['batch_claimless_outputs', silentOrphan],
  ['observation_ids_assigned_only', unassignedBest],
  ['reason_params', assertsParams],
  ['reason_order_allowlist_override', allowlistOrder],
];
