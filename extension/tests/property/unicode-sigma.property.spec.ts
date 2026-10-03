/**
 * SEC-1 (Hard Rule 4), fast-check: `lowerBaseline` decides the one context-dependent lowercase mapping, capital
 * sigma at the end of a word (SpecialCasing Final_Sigma), from the Unicode 15.0 Cased and Case_Ignorable tables, and
 * gives the engine's own answer wherever the engine's properties agree with 15.0.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { lowerBaseline } from '../../src/core/unicode-baseline';

/**
 * Characters around a capital sigma that decide its lowercase (Final_Sigma): cased letters (Lu, Ll, Lt, astral),
 * case-ignorable marks, modifiers, format characters and mid-word punctuation, characters that are both (ICU
 * skips them), uncased characters, noncharacters and a character outside 15.0. U+1171E, whose Case_Ignorable
 * property 16.0 changed, is left out: unicode-baseline.spec.ts pins it to the 15.0 answer.
 */
const SIGMA_CONTEXT = Array.from(
  "A\u03A3\u03A3\u03C3\u03C2a\u01C5\u0391\u03C9\u0301\u0345\u02B0\u1D2C\u00B4:.'\u00AD\u200B 1-\u4E2D\uFDD0\u0378\u00DF\u0130",
).concat(['\u{1D400}', '\u{1D41A}', '\u{1FFFE}', '\u{1CCF1}', '\u{E0001}', '\u{10400}']);

describe('lowerBaseline equals the engine lowercase wherever the engine agrees with 15.0 (property)', () => {
  it('decides every final sigma as ICU does, in random sigma contexts', () => {
    const text = fc.string({ unit: fc.constantFrom(...SIGMA_CONTEXT), maxLength: 12 });
    fc.assert(
      fc.property(text, (raw) => {
        expect([raw, lowerBaseline(raw)]).toEqual([raw, raw.toLowerCase()]);
      }),
      { numRuns: 5_000 },
    );
  });
});
