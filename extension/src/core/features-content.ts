/**
 * The content features (docs/grading.md §5.1, §11), as exact rationals. Internal to features.ts.
 *
 *  - `subjectOverlap`: Jaccard |A∩B| / |A∪B| of the §11 subject token sets (stop words from the policy). An
 *    observation with no subject, or no tokens, scores 0.
 *  - `amountExact` (applicable when the claim has `amountCents`): 1 iff the amounts are equal and both
 *    currencies are present and equal; a currency missing on either side scores 0.
 *  - `merchantMatch`: 1 iff the claim's normalised counterparty equals the observation's normalised merchant
 *    (`name()`), else the Jaccard of their name tokens; 0 when the observation has none. Merchant text is read
 *    through `counterparty()`: text it rejects has no name tokens (claim: not applicable; observation: 0).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { counterparty, name, nameTokens, subjectTokens } from './normalize';
import { NUMBER_RATIO_ZERO, type NumberRatio, RATIO_ONE, RATIO_ZERO, type Ratio, ratioOf } from './ratio';

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
  return ratioOf(jaccardOf(new Set(a), new Set(b)));
}

/** `jaccard` of two sets as two integers (`shared / union`, not reduced); the shared 0 when both are empty. */
export function jaccardOf(a: ReadonlySet<string>, b: ReadonlySet<string>): NumberRatio {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? NUMBER_RATIO_ZERO : { num: shared, den: union };
}

/** §11 subject tokens of an optional subject: none when it is absent. */
export function subjectTokenSet(raw: string | undefined, stopWords: readonly string[]): string[] {
  return raw === undefined ? [] : subjectTokens(raw, stopWords);
}

interface StopWords {
  readonly words: readonly string[];
  readonly set: ReadonlySet<string>;
}

/** Each stop-word list as §11 compares it, built once per list object while its words are the same. */
const STOP_WORDS = new WeakMap<readonly string[], StopWords>();
const NO_STOP_WORDS: readonly string[] = Object.freeze([]);

/** The stop words NFKC-normalised and lowercased, exactly as `subjectTokens` compares them, as a set. */
export function stopWordSet(stopWords: readonly string[]): ReadonlySet<string> {
  const held = STOP_WORDS.get(stopWords);
  const same =
    held?.words.length === stopWords.length && held.words.every((word, i) => word === stopWords[i]);
  if (held !== undefined && same) return held.set;
  const set = new Set(stopWords.map((word) => word.normalize('NFKC').toLowerCase()));
  STOP_WORDS.set(stopWords, { words: [...stopWords], set });
  return set;
}

/**
 * `subjectTokenSet(raw, stopWords)` as a set, with the stop words given as `stopWordSet(stopWords)`: the tokens
 * `subjectTokens` keeps with no stop words (reply prefixes stripped, de-duplicated), minus the stop words. That
 * is the set `subjectTokens` returns, without building the stop-word set for every subject (a property test
 * pins the two together).
 */
export function subjectTokensWithout(raw: string | undefined, stop: ReadonlySet<string>): Set<string> {
  const tokens = new Set<string>();
  if (raw === undefined) return tokens;
  for (const token of subjectTokens(raw, NO_STOP_WORDS)) if (!stop.has(token)) tokens.add(token);
  return tokens;
}

/** `subjectOverlap` of the claim's tokens with an observation subject. No claim tokens scores 0. */
export function subjectOverlap(
  claimTokens: readonly string[],
  observedSubject: string | undefined,
  stopWords: readonly string[],
): Ratio {
  return tokenOverlap(claimTokens, subjectTokenSet(observedSubject, stopWords));
}

/** `subjectOverlap` from the observation's subject tokens (already `subjectTokenSet`). No claim tokens scores 0. */
export function tokenOverlap(claimTokens: readonly string[], observedTokens: readonly string[]): Ratio {
  return claimTokens.length === 0 ? RATIO_ZERO : jaccard(claimTokens, observedTokens);
}

/**
 * `amountExact`: 1 iff `amountCents` are equal and both currencies are present and equal; a currency missing on
 * either side scores 0 (§5.1 v1.3).
 */
export function amountExact(claimed: Money, observed: Money): Ratio {
  return sameMoney(claimed, observed) ? RATIO_ONE : RATIO_ZERO;
}

/** Whether `amountExact` is 1. */
export function sameMoney(claimed: Money, observed: Money): boolean {
  return (
    claimed.amountCents !== undefined &&
    claimed.amountCents === observed.amountCents &&
    claimed.currency !== undefined &&
    claimed.currency === observed.currency
  );
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
  return merchantMatchName(claimed, merchantName(observedMerchant));
}

/** `merchantMatch` from the observation's merchant already read by `merchantName` (null: no name tokens). */
export function merchantMatchName(claimed: MerchantName, observed: MerchantName | null): Ratio {
  if (observed === null) return RATIO_ZERO;
  return claimed.name === observed.name ? RATIO_ONE : jaccard(claimed.tokens, observed.tokens);
}

/** A merchant or purchase counterparty's name tokens as a set (at least one), read once per claim or observation. */
export interface PreparedMerchant {
  readonly tokens: ReadonlySet<string>;
}

/**
 * `merchantName(raw)?.tokens` as a set, or null when `merchantName` is null, reading the text once: the name
 * tokens `counterparty()` already split are the ones `nameTokens(raw)` gives.
 */
export function prepareMerchant(raw: string | undefined): PreparedMerchant | null {
  if (raw === undefined) return null;
  const party = counterparty(raw);
  if (party === null) return null;
  const tokens = party.kind === 'name' ? party.tokens : nameTokens(raw);
  return tokens.length === 0 ? null : { tokens: new Set(tokens) };
}

/**
 * `merchantMatchName` over prepared merchants, as two integers: the Jaccard of the token sets. Equal normalised
 * names have equal (non-empty) token sets, whose Jaccard is 1, so the name comparison of §5.1 never gives
 * another value and is not repeated here (a property test pins this to `merchantMatchName`).
 */
export function merchantMatchOf(
  claimed: PreparedMerchant | null,
  observed: PreparedMerchant | null,
): NumberRatio {
  if (claimed === null || observed === null) return NUMBER_RATIO_ZERO;
  return jaccardOf(claimed.tokens, observed.tokens);
}
