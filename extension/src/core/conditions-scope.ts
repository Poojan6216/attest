/**
 * The scope conditions (docs/grading.md §6.1): what the claim, the grant, the context and the assigned
 * candidate say about permission, before any coverage is read. Internal to conditions.ts: import from there.
 *
 * Each check returns `null` when the condition is NOT APPLICABLE (a rule naming it then does not match, §6.1),
 * else what it found, including whether the outcome rests on claim-only facts (an OVER_SCOPE from claim-only
 * facts is FINAL at once; one that depended on the assigned candidate waits like PARTIAL, §8).
 *
 * Amounts are integers (cents); a sum is compared in BigInt so no float decides a grade (§5.3).
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { asciiLower, email, type EmailAddress } from './normalize';
import type { Policy } from './policy';
import type { Claim, GradeContext, Grant, Observation } from './schema';
import { isCalendarType } from './window';

/** The policy fields the scope checks read. A loaded `Policy` satisfies it. */
export type ScopePolicy = Pick<Policy, 'allowlistTypes' | 'spendTypes' | 'bp'>;

/** §6.1 `counterpartyNotAllowed`, when applicable. */
export interface AllowlistCheck {
  readonly value: boolean;
  /** True iff the condition holds only because of the assigned candidate's address (§8: waits for grace). */
  readonly candidateOnly: boolean;
}

/** §6.1 `amountAboveCeiling`, when applicable. */
export interface CeilingCheck {
  readonly value: boolean;
  /** §6.1 Amount: the larger of the amounts counted in `spendCurrency`; absent when none counts. */
  readonly amountCents?: number;
  readonly ceilingCents: number;
  readonly spendCurrency: string;
  /** Amount > ceiling (reason `ceiling.exceeded`). */
  readonly exceeded: boolean;
  /** The currency that differs from `spendCurrency` (reason `ceiling.currency_mismatch`), if one does. */
  readonly mismatchCurrency?: string;
  /** True iff a claim-only fact (its own amount over the ceiling, or its own currency) makes it true. */
  readonly claimOnly: boolean;
}

/** §6.1 `cumulativeAboveCeiling`, when applicable. */
export interface CumulativeCheck {
  readonly value: boolean;
  readonly priorSpendCents: number;
  readonly amountCents: number;
  readonly ceilingCents: number;
}

/** §6.1 `typeNotInGrant`. */
export function typeNotInGrant(claim: Claim, grant: Grant): boolean {
  return !grant.allowedTypes.includes(claim.type);
}

/** §6.1 `targetMissing`: a `calendar.*` claim without `targetAt`. */
export function targetMissing(claim: Claim): boolean {
  return isCalendarType(claim.type) && claim.targetAt === undefined;
}

/**
 * §6.1: entries compare after ASCII-only lowercasing; an entry with `@` is an address and matches only an
 * identical address; any other entry is a domain, matching an equal domain or one ending in `.entry`. A
 * confusable address never matches.
 */
function allowed(address: EmailAddress, allowlist: readonly string[]): boolean {
  if (address.confusable) return false;
  const full = asciiLower(address.address);
  const domain = asciiLower(address.domain);
  return allowlist.some((raw) => {
    const entry = asciiLower(raw);
    if (entry.includes('@')) return full === entry;
    return domain === entry || domain.endsWith(`.${entry}`);
  });
}

/**
 * §6.1 `counterpartyNotAllowed`: false for a type outside `policy.allowlistTypes` or an empty allowlist; true
 * when any known address (the claim's, if it is an address; the assigned candidate's, read through `email()`)
 * matches no entry. With no known address at all it is not applicable (reason `allowlist.unchecked`).
 */
export function counterpartyNotAllowed(
  claim: Claim,
  assigned: Observation | null,
  grant: Grant,
  policy: ScopePolicy,
): AllowlistCheck | null {
  const allowlist = grant.counterpartyAllowlist;
  if (!policy.allowlistTypes.includes(claim.type) || allowlist.length === 0) {
    return { value: false, candidateOnly: false };
  }
  const own = claim.counterparty === undefined ? null : email(claim.counterparty);
  const evidence = assigned?.counterparty === undefined ? null : email(assigned.counterparty);
  if (own === null && evidence === null) return null;
  const ownFails = own !== null && !allowed(own, allowlist);
  const evidenceFails = evidence !== null && !allowed(evidence, allowlist);
  return { value: ownFails || evidenceFails, candidateOnly: !ownFails && evidenceFails };
}

/**
 * The currency a claim's amount is counted in under a grant (§6.1, §6.3): its own, or the grant's `spendCurrency`
 * when it has none (undefined when neither is set). The one reading of a missing claim currency, for the Amount of
 * `amountAboveCeiling`, the guard of `cumulativeAboveCeiling` and the priors `priorSpendCents` sums (scope.ts), so a
 * claim that leaves its currency out never escapes the cumulative ceiling its amount would break (Hard Rule 5).
 */
export function spendCurrencyOf(
  currency: string | undefined,
  spendCurrency: string | undefined,
): string | undefined {
  return currency ?? spendCurrency;
}

/** §6.1 "counted in spendCurrency": the claim's currency is absent or equals `spendCurrency` (`spendCurrencyOf`). */
export function countedInSpendCurrency(currency: string | undefined, spendCurrency: string): boolean {
  return spendCurrencyOf(currency, spendCurrency) === spendCurrency;
}

/** The spend guard shared by both ceiling conditions: a spend type and a ceiling (then a currency, by schema). */
function ceilingOf(
  claim: Claim,
  grant: Grant,
  policy: ScopePolicy,
): { cents: number; currency: string } | null {
  if (!policy.spendTypes.includes(claim.type)) return null;
  if (grant.spendCeilingCents === null || grant.spendCurrency === undefined) return null;
  return { cents: grant.spendCeilingCents, currency: grant.spendCurrency };
}

/** The larger of two optional amounts. */
function larger(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * §6.1 `amountAboveCeiling`: applicable for a spend type with a ceiling and a known amount (the claim's or the
 * assigned candidate's). Amount = the larger of the claim's amount (when its currency is absent or equals
 * `spendCurrency`) and the candidate's (when its currency equals `spendCurrency`). True when Amount > ceiling, or
 * when the claim's or the candidate's currency is present and differs from `spendCurrency`.
 */
export function amountAboveCeiling(
  claim: Claim,
  assigned: Observation | null,
  grant: Grant,
  policy: ScopePolicy,
): CeilingCheck | null {
  const ceiling = ceilingOf(claim, grant, policy);
  if (ceiling === null) return null;
  if (claim.amountCents === undefined && assigned?.amountCents === undefined) return null;
  const claimCounts = countedInSpendCurrency(claim.currency, ceiling.currency);
  const claimAmount = claimCounts ? claim.amountCents : undefined;
  const candidateAmount = assigned?.currency === ceiling.currency ? assigned.amountCents : undefined;
  const amountCents = larger(claimAmount, candidateAmount);
  const exceeded = amountCents !== undefined && amountCents > ceiling.cents;
  const claimMismatch = claimCounts ? undefined : claim.currency;
  const candidateMismatch =
    assigned?.currency !== undefined && assigned.currency !== ceiling.currency
      ? assigned.currency
      : undefined;
  const mismatchCurrency = claimMismatch ?? candidateMismatch;
  const claimExceeded = claimAmount !== undefined && claimAmount > ceiling.cents;
  return {
    value: exceeded || mismatchCurrency !== undefined,
    ...(amountCents === undefined ? {} : { amountCents }),
    ceilingCents: ceiling.cents,
    spendCurrency: ceiling.currency,
    exceeded,
    ...(mismatchCurrency === undefined ? {} : { mismatchCurrency }),
    claimOnly: claimExceeded || claimMismatch !== undefined,
  };
}

/**
 * §6.1 `cumulativeAboveCeiling`: applicable for a spend type with a ceiling and a claim amount counted in
 * `spendCurrency` (`countedInSpendCurrency`: its currency absent or equal); true when `context.priorSpendCents +
 * claim.amountCents > spendCeilingCents` (exact, BigInt).
 */
export function cumulativeAboveCeiling(
  claim: Claim,
  grant: Grant,
  context: GradeContext,
  policy: ScopePolicy,
): CumulativeCheck | null {
  const ceiling = ceilingOf(claim, grant, policy);
  if (ceiling === null || claim.amountCents === undefined) return null;
  if (!countedInSpendCurrency(claim.currency, ceiling.currency)) return null;
  const total = BigInt(context.priorSpendCents) + BigInt(claim.amountCents);
  return {
    value: total > BigInt(ceiling.cents),
    priorSpendCents: context.priorSpendCents,
    amountCents: claim.amountCents,
    ceilingCents: ceiling.cents,
  };
}

/** §6.1 `observedScopeExceedsDeclared` (claim-less): not applicable without `context.scope`. */
export function observedScopeExceedsDeclared(grant: Grant, context: GradeContext): boolean | null {
  if (context.scope === undefined) return null;
  return !grant.declaredScopes.includes(context.scope.observed);
}

/** §6.1 `unaskedLikely` (claim-less): the attribution score ≥ `unasked.threshold`, exactly in basis points. */
export function unaskedLikely(context: GradeContext, policy: ScopePolicy): boolean | null {
  if (context.attribution === undefined) return null;
  return unaskedLikelyAt(context.attribution.scoreBp, policy);
}

/** `unaskedLikely` of a context whose attribution scores `scoreBp` basis points. */
export function unaskedLikelyAt(scoreBp: number, policy: ScopePolicy): boolean {
  return scoreBp >= policy.bp.unasked.threshold;
}
