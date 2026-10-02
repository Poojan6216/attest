/**
 * Text normalisation for matching: addresses, names, subjects (docs/grading.md §11, §5.1). Pure.
 *
 * Addresses are NEVER Unicode-normalised: NFKC turns 𝐩 (U+1D429) and fullwidth ｐ (U+FF50) into `p`, and NFC
 * still folds the Kelvin sign K (U+212A) into `K`. An address is kept exactly as read; `confusable` is set from
 * that raw form; equality is code-point identity after lowercasing ASCII A–Z only (by table, never
 * `String#toLowerCase`, which maps the Kelvin sign to `k`). Names and subjects, which are never identities on
 * their own, are folded (NFKC, case, and for names diacritics and invisible marks) so a claim's "Priyá" can meet
 * an observation's "priya".
 */
import { isAceLabel } from './punycode';

const ASCII_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASCII_LOWER = 'abcdefghijklmnopqrstuvwxyz';
/** Without the `u` and `i` flags this matches exactly the 26 code units A–Z. */
const ASCII_UPPER_LETTER = /[A-Z]/g;

/**
 * Invisible code points: format controls (zero-width space/joiners, LRM/RLM, the bidi embeddings, overrides
 * and isolates, the BOM, soft hyphen, tag characters) and every other default-ignorable code point (Hangul
 * fillers, variation selectors, the combining grapheme joiner).
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const NON_ASCII = /\P{ASCII}/u;
const NONSPACING_MARK = /\p{Mn}/gu;
/** JS `\s` plus the rest of Unicode White_Space (NEL U+0085 is whitespace but not `\s`). */
const WHITESPACE_RUN = /[\s\p{White_Space}]+/gu;

/**
 * The bidi embeddings LRE (U+202A) and RLE (U+202B) and overrides LRO (U+202D) and RLO (U+202E) make text
 * display in an order other than the one it is stored in: "\u202E01$" shows as "$10", "\u202Eayirp" as "priya",
 * and an RLE run can move a number or a name across its neighbours. Marks (LRM, RLM) and isolates are only
 * stripped; text with an embedding or override is not read at all (reject, never guess; §11 v1.3).
 */
const BIDI_REORDER = /[\u202A\u202B\u202D\u202E]/u;
/**
 * Superscript, subscript, circled and fraction digits (`\p{No}`): NFKC turns them into plain digits, so
 * "$9⁹⁹" (nine dollars ninety-nine) would read as "$999", "5² min ago" as "52 min ago" and "Priya²" as
 * "priya2". A `\p{No}` character NFKC leaves alone (Ethiopic ፲, Bengali ৴) reads as it displays.
 */
const OTHER_NUMBER = /\p{No}/gu;

/** Characters that can never appear in an unquoted address (RFC 5322 specials, whitespace, controls). */
const ADDRESS_FORBIDDEN = /[\s\p{Cc}()<>[\]\\,;:"]/u;
/** A quoted string in a display name (`"…"`, backslash escapes allowed). */
const QUOTED_STRING = /"(?:[^"\\]|\\.)*"/gu;
const ANGLE_BRACKET = /[<>]/;
/** After NFKC, a counterparty containing one of these was meant as an address; if it is not one, it is nothing. */
const ADDRESS_MARKERS = /[@<>]/;

/**
 * ASCII text, which every folding below leaves as it is but for case: it has no invisible, bidi or `\p{No}`
 * character, NFKC, NFD and NFC are identities on it, and its only letters, digits and whitespace are `[A-Za-z]`,
 * `[0-9]` and `[\t\n\v\f\r ]`. Names and subjects take the plain path for it (a property test pins the two).
 */
const ASCII_ONLY = /^\p{ASCII}*$/u;
const ASCII_NON_TOKEN = /[^a-z0-9]+/;
const ASCII_WHITESPACE_RUN = /[\t\n\v\f\r ]+/g;
/** Name tokens: runs of letters, digits and the (spacing or enclosing) marks left after diacritic folding. */
const NAME_TOKEN_SEPARATOR = /[^\p{L}\p{N}\p{M}]+/u;
/** Subject tokens, exactly per §11: a combining mark NFKC cannot compose (İ → i + U+0307) never splits a word. */
const SUBJECT_TOKEN_SEPARATOR = /[^\p{L}\p{N}\p{M}]+/u;
const REPLY_PREFIXES: ReadonlySet<string> = new Set(['re', 'fw', 'fwd']);

/** Lowercases ASCII A–Z only; every other code unit (including K U+212A and İ U+0130) is left as is. */
export function asciiLower(text: string): string {
  return text.replace(ASCII_UPPER_LETTER, (upper) => ASCII_LOWER.charAt(ASCII_UPPER.indexOf(upper)));
}

/** Removes zero-width, bidi-control and other invisible code points. Never applied to addresses. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/**
 * True when `text` cannot be read as the user sees it (§11): it holds a bidi embedding or override (its display
 * order differs from its stored order) or a `\p{No}` digit that NFKC would turn into a different number.
 * Amounts, times and names in such text are rejected rather than guessed (Hard Rule 5).
 */
export function readsDifferently(text: string): boolean {
  if (BIDI_REORDER.test(text)) return true;
  return (text.match(OTHER_NUMBER) ?? []).some((digit) => digit.normalize('NFKC') !== digit);
}

export interface EmailAddress {
  /** The address exactly as read: display name, angle brackets and surrounding whitespace removed, nothing else. */
  readonly address: string;
  readonly local: string;
  readonly domain: string;
  /** The local part before its `+tag` (the whole local part when there is none). */
  readonly baseLocal: string;
  /**
   * The text after the first `+` that follows a non-empty base (possibly empty), when there is one. A leading
   * `+` is part of the base: `+a@x.com` has no base mailbox to tag.
   */
  readonly plusTag?: string;
  /** True iff the address has a code point above U+007F, or a domain label starting `xn--` (any ASCII case). */
  readonly confusable: boolean;
}

/** The §5.1 comparison of two addresses. Each flag is a structural fact; features.ts decides the score. */
export interface AddressComparison {
  /** Code-point identical after `asciiLower` (no NFC, no NFKC). */
  readonly exact: boolean;
  /** Not exact, but the same domain and the same local part once each `+tag` is removed. */
  readonly plusTagOnly: boolean;
  /** Not exact, and at least one side is confusable. */
  readonly confusablePair: boolean;
  /** Exact, and the address contains a non-ASCII code point. */
  readonly nonAscii: boolean;
  /** The domains are identical after `asciiLower`. */
  readonly sameDomain: boolean;
}

export type Counterparty =
  | ({ readonly kind: 'address' } & EmailAddress)
  | { readonly kind: 'name'; readonly tokens: readonly string[] };

/**
 * The address part of `raw`: the text inside the final `<…>` when it ends with `>`, else the whole text. Null
 * when the display name holds another `<` or `>` outside quotes (`<a@x.com>, <b@y.com>`, or a nested
 * `"P" <evil@x<p@y>`): which address is meant would be a guess.
 */
function extractAddress(raw: string): string | null {
  const text = raw.trim();
  if (!text.endsWith('>')) return text;
  const open = text.lastIndexOf('<');
  if (open < 0) return null;
  const displayName = text.slice(0, open).replace(QUOTED_STRING, '');
  return ANGLE_BRACKET.test(displayName) ? null : text.slice(open + 1, -1).trim();
}

/** Dot-separated, non-empty parts: no leading, trailing or doubled dot (and not empty). */
function dotSeparated(text: string): boolean {
  return text !== '' && !text.startsWith('.') && !text.endsWith('.') && !text.includes('..');
}

/**
 * Extracts an address from raw text (`"Priya" <p@x.com>` → `p@x.com`; the display name is attacker-controlled
 * and dropped). Returns null for anything that is not a single unquoted address with one `@`, a dot-atom local
 * part and a domain of at least two labels. Non-ASCII is accepted (RFC 6531) and flagged `confusable`.
 */
export function email(raw: string): EmailAddress | null {
  const address = extractAddress(raw);
  if (address === null || ADDRESS_FORBIDDEN.test(address)) return null;
  const at = address.indexOf('@');
  if (at < 0 || at !== address.lastIndexOf('@')) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (!dotSeparated(local) || !dotSeparated(domain) || !domain.includes('.')) return null;
  const confusable = NON_ASCII.test(address) || domain.split('.').some(isAceLabel);
  const plus = local.indexOf('+', 1);
  if (plus < 0) return { address, local, domain, baseLocal: local, confusable };
  return {
    address,
    local,
    domain,
    baseLocal: local.slice(0, plus),
    plusTag: local.slice(plus + 1),
    confusable,
  };
}

/** §5.1: compares two addresses exactly as read; a `+tag` difference is reported, never erased. */
export function sameAddress(a: EmailAddress, b: EmailAddress): AddressComparison {
  const exact = asciiLower(a.address) === asciiLower(b.address);
  const sameDomain = asciiLower(a.domain) === asciiLower(b.domain);
  return {
    exact,
    plusTagOnly: !exact && sameDomain && asciiLower(a.baseLocal) === asciiLower(b.baseLocal),
    confusablePair: !exact && (a.confusable || b.confusable),
    nonAscii: exact && NON_ASCII.test(a.address),
    sameDomain,
  };
}

/**
 * A display name folded for matching: invisible marks removed, NFKC, lowercased, diacritics folded (NFD, then
 * nonspacing marks removed, then NFC), Unicode whitespace collapsed. Idempotent. Text that reads differently
 * from how it displays (`readsDifferently`) folds to '' and so has no tokens: "\u202Eayirp" shows "priya".
 */
export function name(raw: string): string {
  if (ASCII_ONLY.test(raw)) return raw.toLowerCase().replace(ASCII_WHITESPACE_RUN, ' ').trim();
  if (readsDifferently(raw)) return '';
  const compatible = stripInvisible(stripInvisible(raw).normalize('NFKC'));
  const folded = compatible.toLowerCase().normalize('NFD').replace(NONSPACING_MARK, '').normalize('NFC');
  return folded.replace(WHITESPACE_RUN, ' ').trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** The distinct tokens of `name(raw)`, in order of first appearance. */
export function nameTokens(raw: string): string[] {
  const separator = ASCII_ONLY.test(raw) ? ASCII_NON_TOKEN : NAME_TOKEN_SEPARATOR;
  return unique(
    name(raw)
      .split(separator)
      .filter((token) => token !== ''),
  );
}

/**
 * A claim's or observation's counterparty: an address when `raw` holds one, else a name (its tokens may be
 * empty). Null when there is nothing; when the text was meant as an address (`@`, `<`, `>`) but is not a
 * valid one (a broken address must never be matched as a name); or when the name reads differently from how
 * it displays (a bidi embedding or override, a superscript digit), so the user would see one name ("priya")
 * while Attest matched another ("ayirp").
 */
export function counterparty(raw: string | undefined): Counterparty | null {
  if (raw === undefined || raw.trim() === '') return null;
  const address = email(raw);
  if (address !== null) return { kind: 'address', ...address };
  if (ADDRESS_MARKERS.test(raw.normalize('NFKC')) || readsDifferently(raw)) return null;
  return { kind: 'name', tokens: nameTokens(raw) };
}

/**
 * §11 subject tokens: remove zero-width and bidi marks → NFKC → lowercase → split on runs of characters that
 * are not letters, digits or marks → drop empty → strip leading `re`, `fw`, `fwd` tokens repeatedly → drop stop
 * words → a set, returned sorted by code unit (deterministic). "Inv\u200Boice" is one token, "İstanbul" is
 * one token, and a subject holding a bidi embedding or override has none (its displayed words are not its
 * stored ones).
 */
export function subjectTokens(raw: string, stopWords: readonly string[]): string[] {
  const ascii = ASCII_ONLY.test(raw);
  if (!ascii && BIDI_REORDER.test(raw)) return [];
  const words = ascii
    ? raw.toLowerCase().split(ASCII_NON_TOKEN)
    : stripInvisible(raw).normalize('NFKC').toLowerCase().split(SUBJECT_TOKEN_SEPARATOR);
  const tokens = words.filter((token) => token !== '');
  const first = tokens.findIndex((token) => !REPLY_PREFIXES.has(token));
  const body = first < 0 ? [] : tokens.slice(first);
  const stop = new Set(stopWords.map((word) => word.normalize('NFKC').toLowerCase()));
  return unique(body.filter((token) => !stop.has(token))).sort();
}
