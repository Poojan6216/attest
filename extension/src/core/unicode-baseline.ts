/**
 * The Unicode baseline (docs/grading.md §11, Decisions.md [SEC-1]): src/core reads text the way an engine with
 * Unicode 15.0 reads it, whatever Unicode version the engine running it has. Pure.
 *
 * Why. `\p{…}`, `\s`, `trim()`, `normalize()` and `toLowerCase()` follow the Unicode version of the engine's ICU.
 * Chrome 120, the oldest Chrome Attest supports (minimum_chrome_version), ships ICU 73.1: Unicode 15.0. Node 22
 * and current Chrome have 16.0 or later, in which OUTLINED DIGIT ONE (U+1CCF1) is a digit that NFKC turns into
 * "1", while 15.0 leaves it unassigned. The same claim and observation would get different subject tokens, score
 * and grade on two engines, and replay would report a grade mismatch on unchanged inputs (Hard Rule 4).
 *
 * How.
 *  - Character properties come from tables generated from the 15.0 Unicode Character Database
 *    (unicode-table-*.ts, by scripts/gen-unicode-baseline.ts), never from the engine: the readers build their
 *    regular expressions from `BASELINE_CLASS`, trim with `trimBaseline` and lowercase with `lowerBaseline`
 *    (tests/unit/core/unicode-fence.spec.ts refuses any other use in src/core).
 *  - Normalisation and case mapping still come from the engine, which never sees a code point 15.0 does not
 *    assign: `asBaseline` replaces each with a noncharacter of the same UTF-16 length (U+FDD0 in the BMP,
 *    U+1FFFE above it). A noncharacter is unassigned (Cn) in every Unicode version, forever: no decomposition,
 *    no case mapping, canonical combining class 0, in none of the tables. That is exactly how a 15.0 engine
 *    treats a newer character. `onBaseline` puts the original code points back, in order, into a result that
 *    keeps them (a folded name); every step it runs keeps each noncharacter, in order.
 *  - A lone surrogate (half of a UTF-16 pair with no partner) becomes U+FFFD, the replacement character it
 *    displays as, and stays U+FFFD. Every reader swaps before it removes anything, so removing an invisible or
 *    nonspacing mark between two halves can never pair them into a character the text did not hold:
 *    "\uD833\u200B\uDCF1" would otherwise become U+1CCF1, which a 16.0 NFKC reads as "1" and a 15.0 one keeps.
 *  - An unassigned code point that 15.0 already makes Default_Ignorable (U+2065, U+FFF0–U+FFF8, the reserved tag
 *    and variation-selector ranges) is left as it is: every reader strips it as `invisible`.
 *  - `lowerBaseline` decides the one context-dependent lowercase mapping (final sigma) from the 15.0 tables, and
 *    keeps a 15.0 character the engine would lowercase into a newer one.
 *
 * What stays the engine's: the normalisation of 15.0 characters (frozen by Unicode's normalisation stability
 * policy) and the context-free lowercase mappings between 15.0 characters (Unicode keeps every existing case
 * pair, and has so far paired existing characters only with newly encoded ones). tests/unit/core/
 * unicode-tables.spec.ts checks both on the engine running the suite and fails when a new engine breaks either.
 */
import { ASSIGNED, RESERVED_IGNORABLE, UNICODE_BASELINE_VERSION } from './unicode-table-assigned';
import { CASE_IGNORABLE, CASED } from './unicode-table-case';
import {
  FORMAT,
  INVISIBLE,
  LETTER_OR_DIGIT,
  MARK,
  NONSPACING_MARK,
  OTHER_NUMBER,
  SPACE,
  WHITE_SPACE,
} from './unicode-table-classes';

export { UNICODE_BASELINE_VERSION };

/**
 * Character class bodies (for the `u` flag) of the Unicode 15.0 properties the readers use. Frozen, and every
 * member is a string, so no module can rewrite a class at load time: the unicode fence trusts these members as the
 * 15.0 classes (tests/unit/core/unicode-baseline.spec.ts checks it).
 */
export const BASELINE_CLASS = Object.freeze({
  /** Letters, digits and marks: General_Category L, N or M (what a §11 token is made of). */
  token: `${LETTER_OR_DIGIT}${MARK}`,
  /** Letters and digits: General_Category L or N. */
  letterOrDigit: LETTER_OR_DIGIT,
  /** General_Category Mn. */
  nonspacingMark: NONSPACING_MARK,
  /** General_Category No (superscript, subscript, circled and fraction digits, …). */
  otherNumber: OTHER_NUMBER,
  /** General_Category Cf (format controls: zero-width, bidi, BOM, soft hyphen, tags). */
  format: FORMAT,
  /** General_Category Cf, and every Default_Ignorable_Code_Point. */
  invisible: INVISIBLE,
  /** What ECMAScript `\s` and `String#trim` match: all in the BMP. */
  space: SPACE,
  /** The White_Space property. */
  whiteSpace: WHITE_SPACE,
  /** Cased: what lowercasing's Final_Sigma context counts as a cased letter. */
  cased: CASED,
  /** Case_Ignorable: what that context skips. */
  caseIgnorable: CASE_IGNORABLE,
} as const);

const NON_ASCII = /\P{ASCII}/u;
const BMP_HOLE = '\uFDD0';
const ASTRAL_HOLE = '\u{1FFFE}';
/** U+FFFD REPLACEMENT CHARACTER (So in every version: no decomposition, no case mapping, never a token). */
const REPLACEMENT = '\uFFFD';
/**
 * A code point 15.0 neither assigns nor makes default-ignorable, a hole character already in the text, or a lone
 * surrogate (with the `u` flag a class of surrogates matches only a half with no partner).
 */
const OUTSIDE_BASELINE = new RegExp(
  `[^${ASSIGNED}${RESERVED_IGNORABLE}]|[\\u{FDD0}\\u{1FFFE}]|[\\u{D800}-\\u{DFFF}]`,
  'gu',
);
const LONE_SURROGATE = /^[\u{D800}-\u{DFFF}]$/u;
const HOLE = /[\uFDD0\u{1FFFE}]/gu;
/** A code point 15.0 neither assigns nor makes default-ignorable (a hole is a noncharacter: assigned). */
const UNASSIGNED = new RegExp(`[^${ASSIGNED}${RESERVED_IGNORABLE}]`, 'u');
const SPACE_CHARACTER = new RegExp(`^[${SPACE}]$`, 'u');
const CAPITAL_SIGMA = '\u03A3';
const SMALL_SIGMA = '\u03C3';
const FINAL_SIGMA = '\u03C2';
const CASED_CHARACTER = new RegExp(`^[${CASED}]$`, 'u');
const CASE_IGNORABLE_CHARACTER = new RegExp(`^[${CASE_IGNORABLE}]$`, 'u');

/**
 * `text` with every code point outside the baseline replaced by a hole, each one pushed to `held`, and every lone
 * surrogate replaced by U+FFFD (never held: put back, two halves could pair).
 */
function swap(text: string, held: string[] | null): string {
  if (!NON_ASCII.test(text)) return text;
  return text.replace(OUTSIDE_BASELINE, (code) => {
    if (LONE_SURROGATE.test(code)) return REPLACEMENT;
    held?.push(code);
    return code.length === 1 ? BMP_HOLE : ASTRAL_HOLE;
  });
}

/**
 * `text` with each code point Unicode 15.0 does not assign replaced by a noncharacter of the same UTF-16 length,
 * and each lone surrogate by U+FFFD, for a reader whose result never holds those code points (tokens, an amount,
 * a time, a yes/no): the engine's `normalize()` and `toLowerCase()` then treat them as a 15.0 engine does, and no
 * later removal can join two surrogate halves. Every reader calls it before it removes any character. ASCII text
 * is returned as is.
 */
export function asBaseline(text: string): string {
  return swap(text, null);
}

/**
 * `fold(asBaseline(text))` with the replaced code points put back, in order, where their noncharacters ended up:
 * for a reader whose result keeps them (`name()`). A lone surrogate stays U+FFFD. `fold` may normalise, change
 * case, and replace or remove characters of the baseline classes, but must keep every noncharacter, in order.
 */
export function onBaseline(text: string, fold: (baseline: string) => string): string {
  const held: string[] = [];
  const folded = fold(swap(text, held));
  if (held.length === 0) return folded;
  let next = 0;
  return folded.replace(HOLE, (hole) => {
    const code = held[next] ?? hole;
    next += 1;
    return code;
  });
}

function isSpace(text: string, index: number): boolean {
  return SPACE_CHARACTER.test(text.charAt(index));
}

/** `text.trim()` as a Unicode 15.0 engine computes it: leading and trailing `BASELINE_CLASS.space` removed. */
export function trimBaseline(text: string): string {
  if (!NON_ASCII.test(text)) return text.trim();
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text, start)) start += 1;
  while (end > start && isSpace(text, end - 1)) end -= 1;
  return text.slice(start, end);
}

/**
 * Whether the first character before (`step` -1) or after (`step` 1) `points[at]` that is not Case_Ignorable is
 * Cased, as ICU's `isFollowedByCasedLetter` decides it (a character both Cased and Case_Ignorable is skipped).
 */
function casedBeside(points: readonly string[], at: number, step: number): boolean {
  for (let i = at + step; i >= 0 && i < points.length; i += step) {
    const point = points[i] ?? '';
    if (!CASE_IGNORABLE_CHARACTER.test(point)) return CASED_CHARACTER.test(point);
  }
  return false;
}

/** `text` with each capital sigma replaced by the small sigma 15.0's Final_Sigma context gives it. */
function withSigmasDecided(text: string): string {
  const points = Array.from(text);
  const decided = points.map((point, at) => {
    if (point !== CAPITAL_SIGMA) return point;
    return casedBeside(points, at, -1) && !casedBeside(points, at, 1) ? FINAL_SIGMA : SMALL_SIGMA;
  });
  return decided.join('');
}

/** One code point lowercased, or kept when the engine maps it to a code point 15.0 does not assign. */
function lowerPoint(point: string): string {
  const lower = point.toLowerCase();
  return UNASSIGNED.test(lower) ? point : lower;
}

/**
 * `text.toLowerCase()` as a Unicode 15.0 engine computes it, for text `asBaseline` prepared.
 *  - The one mapping that reads its neighbours, capital sigma (U+03A3) to final ς at the end of a word and σ
 *    elsewhere (SpecialCasing Final_Sigma), is decided from the 15.0 Cased and Case_Ignorable tables: an engine
 *    decides it from its own, and a 15.0 character whose properties a later version changed (U+1171E: Mn in
 *    15.0, Mc in 16.0) would otherwise give "aσ" on one engine and "aς" on another.
 *  - Every other mapping is context-free, so when the engine maps a 15.0 character to one 15.0 does not assign
 *    (a later version giving an old capital a newly encoded lowercase partner, as 8.0 did for Cherokee), that
 *    character is kept as 15.0 keeps it.
 */
export function lowerBaseline(text: string): string {
  if (!NON_ASCII.test(text)) return text.toLowerCase();
  const decided = text.includes(CAPITAL_SIGMA) ? withSigmasDecided(text) : text;
  const lower = decided.toLowerCase();
  return UNASSIGNED.test(lower) ? Array.from(decided, lowerPoint).join('') : lower;
}
