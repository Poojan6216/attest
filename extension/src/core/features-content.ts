/**
 * The content features (docs/grading.md §5.1, §11), as exact rationals. Internal to features.ts.
 *
 *  - `subjectOverlap`: Jaccard |A∩B| / |A∪B| of the §11 subject token sets (stop words from the policy). An
 *    observation with no subject, or no tokens, scores 0.
 *  - `amountExact`: 1 iff the amounts are equal and both currencies are present and equal.
 *  - `merchantMatch`: 1 iff the claim's normalised counterparty equals the observation's normalised merchant
 *    (`name()`), else the Jaccard of their name tokens; 0 when the observation has none.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { counterparty, name, nameTokens, subjectTokens } from './normalize';
import { RATIO_ONE, RATIO_ZERO, ratio, type Ratio } from './ratio';

/** A merchant or purchase counterparty in §11 normalised form, with at least one name token. */
export interface MerchantName {
  readonly name: string;
  readonly tokens: readonly string[];
}

/** The money fields `amountExact` reads, on a claim or an observation. */
export interface Money {
  readonly amountCents?: number | undefined;
  readonly currency?: string | undefined;
}

/** Jaccard index |A∩B| / |A∪B| of two token sets, exactly; 0 when both are empty. */
export function jaccard(a: readonly string[], b: readonly string[]): Ratio {
  const left = new Set(a);
  const right = new Set(b);
  const shared = [...left].filter((token) => right.has(token)).length;
  const union = left.size + right.size - shared;
  return union === 0 ? RATIO_ZERO : ratio(shared, union);
}

/** §11 subject tokens of an optional subject: none when it is absent. */
export function subjectTokenSet(raw: string | undefined, stopWords: readonly string[]): string[] {
  return raw === undefined ? [] : subjectTokens(raw, stopWords);
}

/** `subjectOverlap` of the claim's tokens with an observation subject. No claim tokens scores 0. */
export function subjectOverlap(
  claimTokens: readonly string[],
  observedSubject: string | undefined,
  stopWords: readonly string[],
): Ratio {
  if (claimTokens.length === 0) return RATIO_ZERO;
  return jaccard(claimTokens, subjectTokenSet(observedSubject, stopWords));
}

/** `amountExact`: 1 iff `amountCents` are equal and both currencies are present and equal (§5.1). */
export function amountExact(claimed: Money, observed: Money): Ratio {
  const same =
    claimed.amountCents !== undefined &&
    claimed.amountCents === observed.amountCents &&
    claimed.currency !== undefined &&
    claimed.currency === observed.currency;
  return same ? RATIO_ONE : RATIO_ZERO;
}

/**
 * `raw` as a merchant name, or null when it is absent, has no name tokens, or is text Attest does not read
 * as a name (`counterparty()` is null: a broken address, or a bidi override that makes it display as a
 * different name, Decisions [1.1]).
 */
export function merchantName(raw: string | undefined): MerchantName | null {
  if (raw === undefined || counterparty(raw) === null) return null;
  const tokens = nameTokens(raw);
  return tokens.length === 0 ? null : { name: name(raw), tokens };
}

/** `merchantMatch` of a claim merchant with an observation's `merchant` field (§5.1). */
export function merchantMatch(claimed: MerchantName, observedMerchant: string | undefined): Ratio {
  const observed = merchantName(observedMerchant);
  if (observed === null) return RATIO_ZERO;
  return claimed.name === observed.name ? RATIO_ONE : jaccard(claimed.tokens, observed.tokens);
}
