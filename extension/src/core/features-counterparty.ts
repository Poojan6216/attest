/**
 * The counterparty features (docs/grading.md §5.1, §11), as exact rationals. Internal to features.ts.
 *
 *  - `counterpartyExact` (address claim): 1 iff the two addresses are code-point-identical after ASCII-only
 *    lowercasing (no NFC, no NFKC). Identical confusable addresses (a non-ASCII code point or an `xn--` label)
 *    still score 1, with reason `cp.non_ascii`. A non-identical pair where either side is confusable scores 0
 *    with `cp.confusable`; otherwise a `+tag`-only difference scores 0 with `cp.plus_tag`.
 *  - `counterpartyDomain` (address claim): 1 iff `counterpartyExact` is 1, or the domains are identical,
 *    neither address is confusable, and the domain is not free mail (`policy.commonDomains`) or the two
 *    addresses differ only by a `+tag`.
 *  - `counterpartyName` (name claim): 1 iff every claim name token is a token of the observation address's
 *    local part, ASCII-lowercased (never NFKC'd), with its `+tag` removed, split on `.`, `_` and `-`. The
 *    display name is never read: it is attacker-controlled (red-team strategy 3).
 *
 * The observation side always goes through `email()`, so a display-name form is reduced to its address; an
 * observation with no parseable address scores 0, never "not applicable" (§5.2).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { asciiLower, email, type EmailAddress, sameAddress } from './normalize';
import { RATIO_ONE, RATIO_ZERO, type Ratio } from './ratio';
import type { ReasonCode } from './schema';

/** The reasons a counterparty comparison can give (§15 `cp.*`), in table order. */
export type CounterpartyReason = Extract<ReasonCode, 'cp.plus_tag' | 'cp.confusable' | 'cp.non_ascii'>;

export interface AddressFeatures {
  readonly counterpartyExact: Ratio;
  readonly counterpartyDomain: Ratio;
  /** At most one `cp.*` reason per pair (see `addressFeatures`). */
  readonly reason?: CounterpartyReason;
}

/** §5.1: the local part is split into name tokens on dots, underscores and hyphens. */
const LOCAL_PART_SEPARATOR = /[._-]/;

const NO_MATCH: AddressFeatures = Object.freeze({
  counterpartyExact: RATIO_ZERO,
  counterpartyDomain: RATIO_ZERO,
});

/** The observation's counterparty read through `email()` (§5.1): its address, or null when it has none. */
export function observedAddress(raw: string | undefined): EmailAddress | null {
  return raw === undefined ? null : email(raw);
}

/**
 * `counterpartyExact` and `counterpartyDomain` for an address claim, and the pair's `cp.*` reason.
 *
 * When a pair is both confusable and a `+tag`-only difference, the reason is `cp.confusable` alone: "the
 * same mailbox with another tag" is a claim about identity that a confusable address cannot support.
 */
export function addressFeatures(
  claimed: EmailAddress,
  observed: EmailAddress | null,
  commonDomains: readonly string[],
): AddressFeatures {
  if (observed === null) return NO_MATCH;
  const comparison = sameAddress(claimed, observed);
  if (comparison.exact) {
    const confusable = claimed.confusable || observed.confusable;
    return {
      counterpartyExact: RATIO_ONE,
      counterpartyDomain: RATIO_ONE,
      ...(confusable ? { reason: 'cp.non_ascii' } : {}),
    };
  }
  if (comparison.confusablePair) return { ...NO_MATCH, reason: 'cp.confusable' };
  // Not identical and neither side confusable: both domains are ASCII, compared after ASCII lowercasing.
  const domainCounts =
    comparison.sameDomain && (comparison.plusTagOnly || !commonDomains.includes(asciiLower(observed.domain)));
  return {
    counterpartyExact: RATIO_ZERO,
    counterpartyDomain: domainCounts ? RATIO_ONE : RATIO_ZERO,
    ...(comparison.plusTagOnly ? { reason: 'cp.plus_tag' } : {}),
  };
}

/** The local-part tokens §5.1 matches a name against: `+tag` removed, ASCII-lowercased, split on `[._-]`. */
export function localPartTokens(address: EmailAddress): string[] {
  return asciiLower(address.baseLocal)
    .split(LOCAL_PART_SEPARATOR)
    .filter((token) => token !== '');
}

/**
 * `counterpartyName` for a name claim with tokens `claimTokens` (normalised by `nameTokens`): 1 iff every one
 * is a local-part token of the observed address. No tokens, or no observed address, scores 0.
 */
export function nameFeature(claimTokens: readonly string[], observed: EmailAddress | null): Ratio {
  if (observed === null || claimTokens.length === 0) return RATIO_ZERO;
  const local = new Set(localPartTokens(observed));
  return claimTokens.every((token) => local.has(token)) ? RATIO_ONE : RATIO_ZERO;
}
