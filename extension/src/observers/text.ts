/**
 * Text helpers for extractors (sprint_2 carry-forward from the Sprint 1 close, SEC-3).
 *
 * A counterparty, merchant or subject hint is one line (core schema `oneLineText`): `redact.project` refuses a row
 * that holds a line break or control character in one, and the pass is DEGRADED. A vendor cell often wraps a name or
 * subject across lines, so extractors pass every name and subject through `oneLine` first.
 */

/** Runs of white space: JavaScript's `\s` (which includes U+2028 and U+2029) plus U+0085 NEXT LINE. */
const WHITE_SPACE_RUN = /[\s\u0085]+/gu;

/**
 * `text` with every run of white space (spaces, tabs, line and paragraph breaks, no-break spaces) collapsed to one
 * space and the ends trimmed. Any other control character is kept, so `project` still refuses the row: text that
 * holds one is not a name or a subject, and the pass must say so (Hard Rule 6).
 */
export function oneLine(text: string): string {
  return text.replace(WHITE_SPACE_RUN, ' ').trim();
}
