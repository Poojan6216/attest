/**
 * The shape of the free text a claim or an observation may carry (docs/grading.md §5.1, §10, §11): a
 * counterparty (an address or a name), a merchant name and a subject hint.
 *
 * Each is one line: no control character (`\p{Cc}`: NUL, tab, CR, LF, ESC, DEL, U+0085 NEL, …) and no line or
 * paragraph separator (U+2028, U+2029). An address, a display name, a merchant and a subject header never hold
 * one; a message body almost always does. So an extractor bug or a compromised content script cannot pass a
 * paragraph of mail off as a counterparty (Hard Rule 2; SEC-3). Invisible format marks (`\p{Cf}`: zero-width,
 * bidi) are not refused: §11 strips them when it reads names and subjects, and a real vendor row may hold them.
 *
 * PURE (Hard Rule 4). Imports nothing from ./schema, so the two never form an import cycle.
 */
import { z } from 'zod';

import { BASELINE_CLASS } from './unicode-baseline';

/** A string with no control character and no line or paragraph separator. */
// Zl and Zp are exactly U+2028 and U+2029 in Unicode 15.0, and Cc is closed forever (§11 Unicode baseline).
export const ONE_LINE = /^[^\p{Cc}\u2028\u2029]*$/u;

/** A visible character: not whitespace and not an invisible format mark (zero-width space, bidi, BOM). */
export const VISIBLE = new RegExp(`[^${BASELINE_CLASS.space}${BASELINE_CLASS.format}]`, 'u');

/** One line of derived text (ONE_LINE), at most `max` code points (a SCHEMA_LIMITS cap, SECURITY-4). */
export function oneLineText(max: number): z.ZodString {
  return z.string().max(max).regex(ONE_LINE, 'must be one line with no control characters');
}
