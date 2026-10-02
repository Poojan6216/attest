/**
 * The contract v1.3 rules the golden suite must prove (docs/grading.md v1.3; Decisions [1.contract] v1.3). Each
 * entry is a `contract:<tag>` that some scenario must carry, and a predicate that the tagged scenario really
 * exercises the rule, so a mistagged or weakened file fails v13-rules.spec.ts instead of passing. Every proof is
 * false on a plain exact match, and v13-rules.spec.ts shows each one fails on a broken copy of its own file.
 * This file holds the purchase-coverage, counterparty-reason and allowlist rules; v13-rules-evidence.ts the
 * ceiling, tie-break, first-seen and params rules; v13-rules-text.ts the §11 text rules.
 */
import { type PolicyView } from './build';
import { hasNoParser, receiptOnlyType } from './checks-claims';
import { ASCII_ONLY, bestOf, claimOf, minuteWindow, type Proof } from './proof-helpers';
import { type ExpectedReceipt, type Scenario, type ScenarioClaim } from './scenario-schema';
import { instantMs } from './time';
import { EVIDENCE_RULES } from './v13-rules-evidence';
import { TEXT_RULES } from './v13-rules-text';

/**
 * A receipt interval with an account hash holds the whole minute-precision window of the claim, and a receipt
 * sync reached the window's end (so graceElapsed): with a parser, coverage would be full and NOT_FOUND possible.
 */
function receiptSawWindow(s: Scenario, claim: ScenarioClaim, policy: PolicyView): boolean {
  if (claim.claimedAtPrecision !== undefined && claim.claimedAtPrecision !== 'minute') return false;
  const { from, to } = minuteWindow(claim, policy);
  const receipts = s.input.coverage.filter(
    (c) => c.source === 'gmail.receipt' && c.accountHash !== undefined,
  );
  const holds = receipts.some((c) => instantMs(c.windowStart) <= from && to <= instantMs(c.windowEnd));
  return holds && receipts.some((c) => instantMs(c.lastSyncAt) >= to);
}

function purchases(s: Scenario, policy: PolicyView): { e: ExpectedReceipt; claim: ScenarioClaim }[] {
  return s.expect.flatMap((e) => {
    const claim = claimOf(s, e);
    return claim !== undefined && receiptOnlyType(claim.type, policy) ? [{ e, claim }] : [];
  });
}

/** §6.1: receiptMerchants is matched by the claim's normalised name, and only then can NOT_FOUND be said. */
const purchaseCoverageByName: Proof = (s, policy) =>
  purchases(s, policy).some(({ e, claim }) => {
    const merchants = policy.receiptMerchants ?? [];
    const name = claim.counterparty ?? '';
    const normalisedOnly = !merchants.includes(name) && merchants.includes(name.toLowerCase());
    return normalisedOnly && e.grade === 'NOT_FOUND' && receiptSawWindow(s, claim, policy);
  });

/** §6.1 v1.3: a purchase with no counterparty is capped at partial (coverage.no_parser), never none or full. */
const purchaseNoCounterpartyCapped: Proof = (s, policy) =>
  purchases(s, policy).some(
    ({ e, claim }) =>
      claim.counterparty === undefined &&
      receiptSawWindow(s, claim, policy) &&
      e.ruleId === 'partial_coverage' &&
      e.reasonCodes.includes('coverage.no_parser'),
  );

/** §6.1 v1.3: a counterparty-less purchase matched to an exact receipt is VERIFIED under the cap. */
const purchaseNoParserVerifies: Proof = (s, policy) =>
  purchases(s, policy).some(
    ({ e, claim }) =>
      claim.counterparty === undefined &&
      hasNoParser(claim, policy) &&
      receiptSawWindow(s, claim, policy) &&
      e.grade === 'VERIFIED' &&
      e.score === '1/1' &&
      e.observationRefs.length === 1,
  );

/** §6.1 v1.3: a merchant with no parser and no receipt is partial_coverage once the window was seen. */
const noParserPartialCoverage: Proof = (s, policy) =>
  purchases(s, policy).some(
    ({ e, claim }) =>
      claim.counterparty !== undefined &&
      hasNoParser(claim, policy) &&
      receiptSawWindow(s, claim, policy) &&
      e.ruleId === 'partial_coverage' &&
      e.reasonCodes.join() === 'coverage.partial,coverage.no_parser,match.none',
  );

/** The address with any +tag removed from its local part. */
function untagged(address: string): string {
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const plus = local.indexOf('+');
  return `${plus < 0 ? local : local.slice(0, plus)}${address.slice(at)}`;
}

/** §11: any code point above U+007F, or a domain label starting with xn-- (any ASCII case). */
const confusable = (address: string): boolean => !ASCII_ONLY.test(address) || /[@.]xn--/iu.test(address);

/** §5.1 v1.3: a confusable pair that differs only by a +tag gets cp.confusable, never cp.plus_tag. */
const cpConfusableReplacesPlusTag: Proof = (s) =>
  s.expect.some((e) => {
    const claimed = claimOf(s, e)?.counterparty ?? '';
    const seen = bestOf(s, e)?.counterparty ?? '';
    const plusOnly = claimed !== seen && claimed.includes('@') && untagged(claimed) === untagged(seen);
    return (
      plusOnly &&
      (confusable(claimed) || confusable(seen)) &&
      e.reasonCodes.includes('cp.confusable') &&
      !e.reasonCodes.includes('cp.plus_tag')
    );
  });

/** §11 v1.3: an XN-- label in upper case is still confusable (both sides here), so never a plain +tag pair. */
const xnAnyAsciiCase: Proof = (s) =>
  s.expect.some((e) => {
    const claimed = claimOf(s, e)?.counterparty ?? '';
    const seen = bestOf(s, e)?.counterparty ?? '';
    const upperOnly = (address: string): boolean => address.includes('XN--') && ASCII_ONLY.test(address);
    return (
      upperOnly(claimed) &&
      upperOnly(seen) &&
      e.reasonCodes.includes('cp.confusable') &&
      e.grade !== 'VERIFIED' &&
      e.grade !== 'PARTIAL'
    );
  });

/** §5.1 v1.3: cp.* reasons come only from address claims (a name claim against a +tag address has none). */
const cpOnlyAddressClaims: Proof = (s) =>
  s.expect.some((e) => {
    const claimed = claimOf(s, e)?.counterparty;
    const seen = bestOf(s, e)?.counterparty ?? '';
    return (
      claimed !== undefined &&
      !claimed.includes('@') &&
      untagged(seen) !== seen &&
      e.grade === 'VERIFIED' &&
      !e.reasonCodes.some((code) => code.startsWith('cp.'))
    );
  });

/** §6.1 v1.3: a calendar claim with only a subject and no assigned candidate leaves the allowlist unchecked. */
const allowlistSubjectOnly: Proof = (s) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    const grant = s.input.grants.find((g) => g.agent === claim?.agent);
    return (
      claim?.type.startsWith('calendar.') === true &&
      claim.counterparty === undefined &&
      claim.subjectHint !== undefined &&
      (grant?.counterpartyAllowlist ?? []).length > 0 &&
      e.reasonCodes.includes('allowlist.unchecked')
    );
  });

/** §15 v1.3: coverage.never_completed is the pending rule's own code, so it precedes allowlist.unchecked. */
const neverCompletedFirst: Proof = (s) =>
  s.expect.some(
    (e) =>
      e.ruleId === 'pending' &&
      e.state === 'FINAL' &&
      e.reasonCodes[0] === 'coverage.never_completed' &&
      e.reasonCodes[1] === 'allowlist.unchecked',
  );

export const V13_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['purchase_coverage_by_name', purchaseCoverageByName],
  ['purchase_no_counterparty_capped', purchaseNoCounterpartyCapped],
  ['purchase_no_parser_verifies', purchaseNoParserVerifies],
  ['no_parser_partial_coverage', noParserPartialCoverage],
  ['cp_confusable_replaces_plus_tag', cpConfusableReplacesPlusTag],
  ['xn_any_ascii_case', xnAnyAsciiCase],
  ['cp_only_address_claims', cpOnlyAddressClaims],
  ['allowlist_subject_only_unchecked', allowlistSubjectOnly],
  ['never_completed_before_unchecked', neverCompletedFirst],
  ...EVIDENCE_RULES,
  ...TEXT_RULES,
];
