/**
 * printable.ts (Sprint 1 security review SEC-7): every character a terminal could act on is escaped, every other
 * character is kept, and `printableLines` keeps only the newlines between lines.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { printable, printableLines } from '../../tools/printable';

/** Code points a terminal could act on: C0, DEL, C1, bidi and other format characters, separators, private use. */
const ACTIVE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xe000, 0xf8ff],
];

function hasActive(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (ACTIVE_RANGES.some(([from, to]) => code >= from && code <= to)) return true;
  }
  return false;
}

const chars = (...codes: number[]): string => String.fromCodePoint(...codes);

describe('printable', () => {
  it('escapes ESC, BEL, CSI, DEL, newline, bidi overrides, separators, private use and lone surrogates', () => {
    expect(printable(`${chars(0x1b)}]0;t${chars(0x07, 0x1b)}[2J`)).toBe('\\u{1b}]0;t\\u{7}\\u{1b}[2J');
    expect(printable(`a${chars(0x9b)}b${chars(0x7f)}c\nd\re\tf`)).toBe(
      'a\\u{9b}b\\u{7f}c\\u{a}d\\u{d}e\\u{9}f',
    );
    const lone = String.fromCharCode(0xd800);
    expect(printable(`${chars(0x202e)}evil${chars(0x2066, 0x2028, 0x2029, 0xe000)}${lone}`)).toBe(
      '\\u{202e}evil\\u{2066}\\u{2028}\\u{2029}\\u{e000}\\u{d800}',
    );
  });

  it('keeps printable text and non-ASCII letters as written', () => {
    const text = `receipts[0].body: unknown key ${chars(0x2014)} caf${chars(0xe9)} ${chars(0x6771, 0x4eac)} ${chars(0xa7)}9`;
    expect(printable(text)).toBe(text);
  });

  it('never leaves a character a terminal could act on, for any string (1,000 runs)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(hasActive(printable(text))).toBe(false);
        expect(printableLines(text).split('\n').some(hasActive)).toBe(false);
      }),
      { numRuns: 1_000 },
    );
  });

  it('printableLines keeps the newlines between lines and escapes everything else', () => {
    expect(printableLines(`one\ntwo${chars(0x1b)}[2J\nthree`)).toBe('one\ntwo\\u{1b}[2J\nthree');
  });
});
