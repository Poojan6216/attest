/**
 * Text from an export, made safe to write to a terminal (Hard Rule 10; Sprint 1 security review SEC-7).
 *
 *  - `printable(text)`: every character a terminal could act on written as a `\u{…}` escape: C0 and C1 controls
 *    (newline included; ESC starts ANSI sequences, U+009B is the one-byte CSI), DEL, format characters (bidi
 *    overrides, zero-width joiners), line and paragraph separators, private-use and unassigned code points, and
 *    lone surrogates. Everything else, non-ASCII letters included, is kept as written.
 *  - `printableLines(text)`: the same for each line of `text`, keeping the newlines between them: for output the
 *    tool itself split into lines.
 *
 * The `attest replay` CLI writes everything through `printableLines`, and each line built from an export goes
 * through `printable` first, so text from a file can never set the terminal title, clear the screen, or start a
 * line of its own.
 *
 * Node-side tooling (runs under tsx): not part of the extension.
 */

/** The characters `printable` escapes. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]/gu;

function escaped(char: string): string {
  return `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`;
}

export function printable(text: string): string {
  return text.replace(UNPRINTABLE, escaped);
}

export function printableLines(text: string): string {
  return text.split('\n').map(printable).join('\n');
}
