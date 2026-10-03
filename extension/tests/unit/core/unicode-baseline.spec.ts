/**
 * SEC-1 (Hard Rule 4): every text reader gives a Unicode 15.0 engine's answer, whatever Unicode the engine running
 * it has. Node 22 (this suite) has Unicode 16.0; Chrome 120, the oldest supported, has 15.0. Each probe below is a
 * character 15.0 does not assign and Node 22 does (or a property Node 22 changed), with the answer an engine
 * that does not know it gives: Chromium 123 (ICU 73/74) gave these results before the fix, Node 22 did not.
 * Every non-ASCII input is a \u escape (Decisions [1.1]).
 */
import { describe, expect, it } from 'vitest';

import { merchantName, stopWordSet } from '../../../src/core/features-content';
import {
  amount,
  counterparty,
  email,
  name,
  nameTokens,
  resolveRelative,
  subjectTokens,
} from '../../../src/core/normalize';
import { stripInvisible } from '../../../src/core/normalize-text';
import {
  asBaseline,
  BASELINE_CLASS,
  lowerBaseline,
  onBaseline,
  trimBaseline,
} from '../../../src/core/unicode-baseline';
import { INVISIBLE } from '../../../src/core/unicode-table-classes';

/** OUTLINED DIGIT ZERO–NINE (Unicode 16.0, Nd; NFKC gives 0–9 on a 16.0 engine). */
const outlined = (digits: string): string =>
  Array.from(digits, (digit) => String.fromCodePoint(0x1ccf0 + Number(digit))).join('');
const CJK_EXT_I = '\u{2EBF0}'; // Unicode 15.1, Lo
const NEW_EMOJI = '\u{1FAE9}'; // FACE WITH BAGS UNDER EYES, Unicode 16.0
const RAMS_HORN_CAPITAL = '\uA7CB'; // Unicode 16.0, Lu, lowercases to U+0264 on a 16.0 engine
const GARAY_CAPITAL = '\u{10D50}'; // Unicode 16.0, Lu
const AHOM_MEDIAL_RA = '\u{1171E}'; // Mn in 15.0, Mc in 16.0
const SIGMA = '\u03A3'; // GREEK CAPITAL LETTER SIGMA: \u03C2 at the end of a word, \u03C3 elsewhere
const STOP = ['the', 'of'];
const CONTEXT = { referenceIso: '2026-10-06T14:00:00-04:00', offsetAt: () => -240 };

describe('a character Unicode 15.0 does not assign reads as unassigned', () => {
  it('outlined digits are no digits: no subject token, no amount, no time (the SEC-1 probe)', () => {
    expect(subjectTokens(`Q3 report ${outlined('2026')}`, STOP)).toEqual(['q3', 'report']);
    expect(subjectTokens(`Invoice ${outlined('10')}`, STOP)).toEqual(['invoice']);
    expect(subjectTokens(`Q3 report 2026`, STOP)).toEqual(['2026', 'q3', 'report']);
    expect(amount(`$${outlined('10')}`, { defaultDollar: 'USD' })).toBeNull();
    expect(amount(`$1${outlined('0')}`, { defaultDollar: 'USD' })).toBeNull();
    expect(resolveRelative(`${outlined('5')} min ago`, CONTEXT)).toBeNull();
    expect(resolveRelative('5 min ago', CONTEXT)?.precision).toBe('minute');
  });

  it('a newer letter is in no name or subject token, and a name keeps it exactly as written', () => {
    expect(subjectTokens(`Report ${CJK_EXT_I}`, STOP)).toEqual(['report']);
    expect(subjectTokens(`ab${CJK_EXT_I}cd`, STOP)).toEqual(['ab', 'cd']);
    expect(nameTokens(`Acme${GARAY_CAPITAL}Store`)).toEqual(['acme', 'store']);
    expect(name(`Acme ${RAMS_HORN_CAPITAL}${GARAY_CAPITAL}`)).toBe(
      `acme ${RAMS_HORN_CAPITAL}${GARAY_CAPITAL}`,
    );
    expect(name(`Caf\u00E9 ${NEW_EMOJI}`)).toBe(`cafe ${NEW_EMOJI}`);
    expect(counterparty(`Acme ${outlined('1')}`)).toEqual({ kind: 'name', tokens: ['acme'] });
    expect(merchantName(`Acme ${outlined('1')}`)).toEqual({
      name: `acme ${outlined('1')}`,
      tokens: ['acme'],
    });
  });

  it('an address keeps a newer character as read, and a stop word holding one matches nothing', () => {
    const address = `p${outlined('1')}@x.com`;
    expect(email(`"P" <${address}>`)).toMatchObject({ address, confusable: true });
    expect(stopWordSet([`Q${outlined('3')}`, 'THE'])).toEqual(new Set([`q${outlined('3')}`, 'the']));
    expect(subjectTokens(`q${outlined('3')} the deck`, [`q${outlined('3')}`, 'the'])).toEqual(['deck', 'q']);
  });

  it('a 15.0 property the engine changed is read as 15.0 has it (U+1171E is Mn: folded away)', () => {
    expect(name(`a${AHOM_MEDIAL_RA}b`)).toBe('ab');
    expect(nameTokens(`a${AHOM_MEDIAL_RA}b`)).toEqual(['ab']);
  });

  it('a final capital sigma after U+1171E lowercases to \u03C2 as on 15.0 (Chromium 123), not \u03C3', () => {
    // U+1171E is Case_Ignorable in 15.0 (Mn) and not in 16.0 (Mc): Node 22 gives "a\u03C3", Chromium 123 "a\u03C2".
    expect(name(`A${AHOM_MEDIAL_RA}${SIGMA}`)).toBe('a\u03C2');
    expect(subjectTokens(`A${AHOM_MEDIAL_RA}${SIGMA}`, STOP)).toEqual([`a${AHOM_MEDIAL_RA}\u03C2`]);
    expect(stopWordSet([`A${AHOM_MEDIAL_RA}${SIGMA}`])).toEqual(new Set([`a${AHOM_MEDIAL_RA}\u03C2`]));
  });

  it('an unassigned default-ignorable code point is stripped, as every engine strips it', () => {
    expect(amount('$1\u{E0080}0', { defaultDollar: 'USD' })).toEqual({ minor: 1000, currency: 'USD' });
    expect(stripInvisible('a\u2065b\u{E01F0}c')).toBe('abc');
    expect(subjectTokens('in\u2065voice', STOP)).toEqual(['invoice']);
  });
});

/** Whether `value` is a primitive, or a frozen object whose every own property is deeply frozen. */
function deeplyFrozen(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return true;
  return (
    Object.isFrozen(value) && Reflect.ownKeys(value).every((key) => deeplyFrozen(Reflect.get(value, key)))
  );
}

describe('BASELINE_CLASS, which the unicode fence trusts as the 15.0 classes', () => {
  it('is deeply frozen: no module can rewrite a class at load time', () => {
    expect(deeplyFrozen(BASELINE_CLASS)).toBe(true);
    expect(Object.values(BASELINE_CLASS).every((body) => typeof body === 'string')).toBe(true);
    expect(() => Object.assign(BASELINE_CLASS, { invisible: ['\\', 'p{Cf}'].join('') })).toThrow(TypeError);
    expect(() => Object.defineProperty(BASELINE_CLASS, 'extra', { value: '' })).toThrow(TypeError);
    expect(BASELINE_CLASS.invisible).toBe(INVISIBLE);
    expect(deeplyFrozen({ a: Object.freeze({}) })).toBe(false);
    expect(deeplyFrozen(Object.freeze({ a: {} }))).toBe(false);
  });
});

describe('asBaseline, onBaseline, trimBaseline, lowerBaseline', () => {
  it('asBaseline swaps each code point outside 15.0 for a noncharacter of the same length', () => {
    expect(asBaseline('plain ASCII')).toBe('plain ASCII');
    expect(asBaseline(`a${outlined('1')}b${RAMS_HORN_CAPITAL}\u00E9`)).toBe('a\u{1FFFE}b\uFDD0\u00E9');
    expect(asBaseline('\u0378\u{50000}')).toBe('\uFDD0\u{1FFFE}');
    expect(asBaseline('\u2065\u{E0080}\uFDD1')).toBe('\u2065\u{E0080}\uFDD1');
    const text = `${CJK_EXT_I}x${NEW_EMOJI}\u0378`;
    expect(asBaseline(text)).toHaveLength(text.length);
  });

  it('onBaseline puts every swapped code point back in order, holes already in the text included', () => {
    const text = `\uFDD0${outlined('1')}A\u{1FFFE}${RAMS_HORN_CAPITAL}`;
    expect(onBaseline(text, (baseline) => baseline.toLowerCase())).toBe(
      `\uFDD0${outlined('1')}a\u{1FFFE}${RAMS_HORN_CAPITAL}`,
    );
    expect(onBaseline(text, () => '')).toBe('');
    expect(onBaseline('ASCII', (baseline) => baseline.toLowerCase())).toBe('ascii');
  });

  it('trimBaseline trims what String#trim trims on 15.0 text, and nothing outside 15.0', () => {
    expect(trimBaseline('\u3000\u00A0 x \uFEFF\u2028')).toBe('x');
    expect(trimBaseline(' \t ')).toBe('');
    expect(trimBaseline(`\u0085x\u0085`)).toBe('\u0085x\u0085');
    expect(trimBaseline(`${NEW_EMOJI} x ${outlined('1')}`)).toBe(`${NEW_EMOJI} x ${outlined('1')}`);
    expect(trimBaseline(' \u{1D400} ')).toBe('\u{1D400}');
  });

  it('lowerBaseline decides final sigma as ICU does, from the 15.0 Cased and Case_Ignorable tables', () => {
    const rows: readonly (readonly [string, string])[] = [
      [
        `\u039F\u0394\u03A5${SIGMA}${SIGMA}\u0395\u03A5${SIGMA}`,
        '\u03BF\u03B4\u03C5\u03C3\u03C3\u03B5\u03C5\u03C2',
      ],
      [SIGMA, '\u03C3'],
      [`A${SIGMA}`, 'a\u03C2'],
      [`A${SIGMA}B`, 'a\u03C3b'],
      [`A${SIGMA}:B`, 'a\u03C3:b'], // ':' is MidLetter: skipped
      [`A:${SIGMA}`, 'a:\u03C2'],
      [`\u1D2C${SIGMA}`, '\u1D2C\u03C3'], // Cased and Case_Ignorable: ICU skips it
      [`A\u0345${SIGMA}`, 'a\u0345\u03C2'],
      [`\u01C5${SIGMA}`, '\u01C6\u03C2'], // Lt is cased
      [`A${SIGMA}\u{1D400}`, 'a\u03C3\u{1D400}'],
      [`A${SIGMA}\uFDD0`, 'a\u03C2\uFDD0'], // a noncharacter is neither
      [`A${SIGMA} ${SIGMA}`, 'a\u03C2 \u03C3'],
      ['Plain \u00C9COLE', 'plain \u00E9cole'],
    ];
    for (const [text, lower] of rows) {
      expect([text, lowerBaseline(text)]).toEqual([text, lower]);
      expect([text, text.toLowerCase()]).toEqual([text, lower]); // the engine agrees: no 16.0 property involved
    }
  });
});
