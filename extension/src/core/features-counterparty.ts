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
import { asciiLower, email, type EmailAddress } from './normalize';
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
const ASCII_CAPITAL = /[A-Z]/;

/** `asciiLower`, skipped for text with no ASCII capital (it would return the text unchanged). */
function lowered(text: string): string {
  return ASCII_CAPITAL.test(text) ? asciiLower(text) : text;
}

/**
 * An address with the ASCII-lowercased parts §5.1 compares, lowered once per parsed address (a claim's, or an
 * observation's) instead of once per pair, and its local-part name tokens.
 */
export interface PreparedAddress {
  readonly address: EmailAddress;
  readonly lowerAddress: string;
  readonly lowerDomain: string;
  readonly lowerBaseLocal: string;
  /** `localPartTokens(address)`, as a set. */
  readonly localTokens: ReadonlySet<string>;
}

export function prepareAddress(address: EmailAddress): PreparedAddress {
  const lowerBaseLocal = lowered(address.baseLocal);
  return {
    address,
    lowerAddress: lowered(address.address),
    lowerDomain: lowered(address.domain),
    lowerBaseLocal,
    localTokens: new Set(splitLocal(lowerBaseLocal)),
  };
}

/** The observation's counterparty read through `email()` (§5.1): its address, or null when it has none. */
export function observedAddress(raw: string | undefined): EmailAddress | null {
  return raw === undefined ? null : email(raw);
}

/** The §5.1 outcome of an address pair: which address features are 1, and the pair's `cp.*` reason. */
export interface AddressVerdict {
  readonly exact: boolean;
  readonly domain: boolean;
  readonly reason?: CounterpartyReason;
}

const NO_MATCH: AddressVerdict = Object.freeze({ exact: false, domain: false });
const EXACT: AddressVerdict = Object.freeze({ exact: true, domain: true });
const EXACT_NON_ASCII: AddressVerdict = Object.freeze({ exact: true, domain: true, reason: 'cp.non_ascii' });
const CONFUSABLE: AddressVerdict = Object.freeze({ exact: false, domain: false, reason: 'cp.confusable' });
const SAME_DOMAIN: AddressVerdict = Object.freeze({ exact: false, domain: true });
const PLUS_TAG: AddressVerdict = Object.freeze({ exact: false, domain: true, reason: 'cp.plus_tag' });

/**
 * `counterpartyExact`, `counterpartyDomain` and the `cp.*` reason of an address claim, from prepared addresses.
 * The flags are `sameAddress`'s (normalize.ts), read from the same ASCII-lowercased parts: exact iff the whole
 * addresses are equal; a confusable pair iff not exact and either side is confusable; a `+tag`-only difference
 * iff not exact, the domains are equal and so are the base local parts. A property test pins it to
 * `sameAddress` and `addressFeatures`' v1.3 form.
 *
 * When a pair is both confusable and a `+tag`-only difference, the reason is `cp.confusable` alone: "the same
 * mailbox with another tag" is a claim about identity that a confusable address cannot support.
 */
export function addressVerdict(
  claimed: PreparedAddress,
  observed: PreparedAddress | null,
  commonDomains: readonly string[],
): AddressVerdict {
  if (observed === null) return NO_MATCH;
  const confusable = claimed.address.confusable || observed.address.confusable;
  if (claimed.lowerAddress === observed.lowerAddress) return confusable ? EXACT_NON_ASCII : EXACT;
  if (confusable) return CONFUSABLE;
  // Not identical and neither side confusable: both domains are ASCII, compared after ASCII lowercasing.
  if (claimed.lowerDomain !== observed.lowerDomain) return NO_MATCH;
  if (claimed.lowerBaseLocal === observed.lowerBaseLocal) return PLUS_TAG;
  return commonDomains.includes(observed.lowerDomain) ? NO_MATCH : SAME_DOMAIN;
}

/**
 * `counterpartyExact` and `counterpartyDomain` for an address claim, and the pair's `cp.*` reason
 * (`addressVerdict` as exact rationals).
 */
export function addressFeatures(
  claimed: EmailAddress,
  observed: EmailAddress | null,
  commonDomains: readonly string[],
): AddressFeatures {
  const verdict = addressVerdict(
    prepareAddress(claimed),
    observed === null ? null : prepareAddress(observed),
    commonDomains,
  );
  return {
    counterpartyExact: verdict.exact ? RATIO_ONE : RATIO_ZERO,
    counterpartyDomain: verdict.domain ? RATIO_ONE : RATIO_ZERO,
    ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
  };
}

function splitLocal(lowerBaseLocal: string): string[] {
  return lowerBaseLocal.split(LOCAL_PART_SEPARATOR).filter((token) => token !== '');
}

/** The local-part tokens §5.1 matches a name against: `+tag` removed, ASCII-lowercased, split on `[._-]`. */
export function localPartTokens(address: EmailAddress): string[] {
  return splitLocal(asciiLower(address.baseLocal));
}

/**
 * `counterpartyName` for a name claim with tokens `claimTokens` (normalised by `nameTokens`): 1 iff every one
 * is a local-part token of the observed address. No tokens, or no observed address, scores 0.
 */
export function nameFeature(claimTokens: readonly string[], observed: EmailAddress | null): Ratio {
  const prepared = observed === null ? null : prepareAddress(observed);
  return nameMatches(claimTokens, prepared) ? RATIO_ONE : RATIO_ZERO;
}

/** Whether `counterpartyName` is 1, against a prepared observed address. */
export function nameMatches(claimTokens: readonly string[], observed: PreparedAddress | null): boolean {
  if (observed === null || claimTokens.length === 0) return false;
  return claimTokens.every((token) => observed.localTokens.has(token));
}
