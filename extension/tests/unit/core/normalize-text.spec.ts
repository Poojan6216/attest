/**
 * Task 1.1 — names and subjects (docs/grading.md §11). Names are folded (NFKC, case, diacritics, invisible
 * marks) because they are never an identity on their own; subjects follow the §11 pipeline exactly.
 */
import { describe, expect, it } from 'vitest';

import { name, nameTokens, stripInvisible, subjectTokens } from '../../../src/core/normalize';

/** The chosen policy stop-word list (docs/grading.md §12). */
const STOP_WORDS = [
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'for',
  'on',
  'in',
  'at',
  'with',
  'from',
  'by',
  'is',
  'it',
  'this',
  'that',
  'your',
  'my',
  'our',
];

describe('stripInvisible', () => {
  it.each([
    ['pri\u200Bya', 'priya'], // zero-width space
    ['pri\u200C\u200Dya', 'priya'], // ZWNJ, ZWJ
    ['\u202Epriya\u202C', 'priya'], // RLO … PDF
    ['\u200Fpriya\u200E', 'priya'], // RLM, LRM
    ['\u2067priya\u2069', 'priya'], // RLI … PDI
    ['\uFEFFpriya', 'priya'], // BOM
    ['pri\u00ADya', 'priya'], // soft hyphen
    ['priya\u{E0041}', 'priya'], // tag character
    ['priya \u00E9', 'priya \u00E9'], // visible text untouched
  ])('%j \u2192 %j', (input, expected) => {
    expect(stripInvisible(input)).toBe(expected);
  });
});

describe('name()', () => {
  it.each([
    ['Priya', 'priya'],
    ['  PRIYA   SHAH ', 'priya shah'],
    ['Priy\u00E1', 'priya'], // precomposed á
    ['Priya\u0301', 'priya'], // combining acute
    ['Zo\u00EB Salda\u00F1a', 'zoe saldana'],
    ['Jos\u00E9\u00A0\u00D1\u00FA\u00F1ez', 'jose nunez'], // NBSP collapses to a space
    ['Pri\u200Bya', 'priya'],
    ['\u202EPriya\u202C', 'priya'],
    ['Pri\u00ADya', 'priya'],
    ['\u{1D40F}\u{1D42B}\u{1D422}\u{1D432}\u{1D41A}', 'priya'], // mathematical bold: NFKC folds names (never addresses)
    ['\uFF30\uFF52\uFF49\uFF59\uFF41', 'priya'], // fullwidth
    ['\uFB01ona', 'fiona'], // ﬁ ligature
    ['\u0130pek', 'ipek'], // İ lowercases to i + combining dot, which is folded
    ['Stra\u00DFe', 'stra\u00DFe'], // ß is a letter, not a diacritic
    ['\u041F\u0440\u0438\u044F', '\u043F\u0440\u0438\u044F'], // Cyrillic stays Cyrillic (no transliteration)
    ['Priya\tShah\nX', 'priya shah x'],
    ['Priya\u0085Shah', 'priya shah'], // NEL is Unicode whitespace (not JS \s)
    ['\u212Aelly', 'kelly'], // Kelvin sign: names are folded (addresses never are)
    ['\u2126mega', '\u03C9mega'], // Ohm sign → Greek ω
    ['\u212Bngstr\u00F6m', 'angstrom'], // Angstrom sign → Å → a
    ['pri\u03BFya', 'pri\u03BFya'], // Greek omicron stays Greek: a look-alike name is a different name
    ['pr\u0131ya', 'pr\u0131ya'], // dotless ı is a letter, not i plus a mark
    ['\uD55C\uAD6D Kim', '\uD55C\uAD6D kim'], // Hangul syllables recompose after NFD
    ['', ''],
  ])('%j \u2192 %j', (input, expected) => {
    expect(name(input)).toBe(expected);
  });
});

describe('nameTokens()', () => {
  it.each([
    ["O'Brien", ['o', 'brien']],
    ['Jean-Luc Picard', ['jean', 'luc', 'picard']],
    ['Priya Shah (Finance)', ['priya', 'shah', 'finance']],
    ['priya.shah', ['priya', 'shah']],
    ['Priya priya PRIYA', ['priya']],
    ['R2-D2', ['r2', 'd2']],
    ['', []],
    ['\u200B', []],
    // Devanagari प्रिया: the virama (Mn) is folded, the vowel signs (Mc) stay inside the one token.
    ['\u092A\u094D\u0930\u093F\u092F\u093E', ['\u092A\u0930\u093F\u092F\u093E']],
  ])('%j \u2192 %j', (input, expected) => {
    expect(nameTokens(input)).toEqual(expected);
  });
});

describe('subjectTokens()', () => {
  it.each([
    ['Q3 deck', ['deck', 'q3']],
    ['Re: Q3 deck', ['deck', 'q3']],
    ['RE: Fwd: FW: re: Q3 deck', ['deck', 'q3']],
    ['Re Re: deck', ['deck']],
    ['Fwd:Fw:Re:Hello', ['hello']],
    ['Re: Re: re', []],
    ['Meeting re: budget', ['budget', 'meeting', 're']],
    ['Rex: deck', ['deck', 'rex']],
    ['The deck for Priya', ['deck', 'priya']],
    ['Invoice #2026-10', ['10', '2026', 'invoice']],
    ['\uFF31\uFF13 \uFF44\uFF45\uFF43\uFF4B', ['deck', 'q3']], // fullwidth Ｑ３ ｄｅｃｋ
    ['Caf\u00E9 menu', ['caf\u00E9', 'menu']], // subjects keep diacritics (§11 has no folding step)
    ['Cafe\u0301 menu', ['caf\u00E9', 'menu']], // NFKC composes
    ['deck deck DECK', ['deck']],
    ['Zebra apple Mango', ['apple', 'mango', 'zebra']],
    ['', []],
    ['\u2014 \u2026 !!!', []],
  ])('%j \u2192 %j', (input, expected) => {
    expect(subjectTokens(input, STOP_WORDS)).toEqual(expected);
  });

  it('drops only the given stop words', () => {
    expect(subjectTokens('the deck', [])).toEqual(['deck', 'the']);
    expect(subjectTokens('THE deck', ['The'])).toEqual(['deck']);
  });
});
