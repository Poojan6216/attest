/**
 * SEC-1 (Hard Rule 4): the unicode fence's lists, pinned one entry per probe (unicode-fence.spec.ts). Every method
 * it refuses is refused alone, called, spelled and destructured; every Unicode property name but `ASCII` and `Cc`
 * is a class escape; and every way a regular expression can fold case by the engine's tables, a backreference
 * under `i` and an inline modifier group included, is found on its own. Dropping any entry from the scan fails here.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { findings, type Rule } from './unicode-fence-scan';

const rulesOf = (text: string): Rule[] => [...new Set(findings('sample.ts', text).map(({ rule }) => rule))];
const expectRules = (rows: readonly (readonly [string, readonly Rule[]])[]): void => {
  for (const [source, rules] of rows) expect([source, rulesOf(source)]).toEqual([source, rules]);
};

/** The names in a block of text separated by white space. */
function words(text: string): string[] {
  return text.trim().split(/\s+/);
}

/** Whether the engine reads `name` as a Unicode property (`\p{name}` compiles with the `u` flag). */
function isProperty(name: string): boolean {
  try {
    return new RegExp(`\\p{${name}}`, 'u') instanceof RegExp;
  } catch {
    return false;
  }
}

/** Every member the scan refuses, and the rule it breaks. */
const METHODS: readonly (readonly [string, Rule])[] = [
  ['toUpperCase', 'other-case'],
  ['toLocaleLowerCase', 'other-case'],
  ['toLocaleUpperCase', 'other-case'],
  ['localeCompare', 'other-case'],
  ['trim', 'trim'],
  ['trimStart', 'trim'],
  ['trimEnd', 'trim'],
  ['trimLeft', 'trim'],
  ['trimRight', 'trim'],
  ['normalize', 'normalize'],
  ['toLowerCase', 'lowercase'],
  ['compile', 'regexp-built'],
  ['match', 'regexp-built'],
  ['matchAll', 'regexp-built'],
  ['search', 'regexp-built'],
];

describe('the unicode fence refuses each engine method on its own', () => {
  it('called, called by a written key, spelled as a key, and destructured', () => {
    for (const [method, rule] of METHODS) {
      expectRules([
        [`const f = (s: S) => s.${method}('a');`, [rule]],
        [`const f = (s: S) => s['${method}']('a');`, [rule]],
        [`const f = (s: S) => Reflect.get(s, '${method}');`, [rule]],
        [`const { ${method} } = String.prototype;`, [rule]],
      ]);
    }
    expectRules([
      ["const R = Reflect.get(Object(1), 'RegExp');", ['regexp-built']],
      ['const C = RegExp;', ['regexp-built']],
      ['const N = Intl.NumberFormat;', ['other-case']],
    ]);
  });
});

/** General_Category values and aliases (ECMA-262 table-unicode-general-category-values). */
const GENERAL_CATEGORY = words(`
  L Letter LC Cased_Letter Lu Uppercase_Letter Ll Lowercase_Letter Lt Titlecase_Letter Lm Modifier_Letter Lo
  Other_Letter M Mark Combining_Mark Mn Nonspacing_Mark Mc Spacing_Mark Me Enclosing_Mark N Number Nd
  Decimal_Number digit Nl Letter_Number No Other_Number P Punctuation punct Pc Connector_Punctuation Pd
  Dash_Punctuation Ps Open_Punctuation Pe Close_Punctuation Pi Initial_Punctuation Pf Final_Punctuation Po
  Other_Punctuation S Symbol Sm Math_Symbol Sc Currency_Symbol Sk Modifier_Symbol So Other_Symbol Z Separator Zs
  Space_Separator Zl Line_Separator Zp Paragraph_Separator C Other Cc Control cntrl Cf Format Cs Surrogate Co
  Private_Use Cn Unassigned
`);
/** Binary properties and aliases (ECMA-262 table-binary-unicode-properties). */
const BINARY = words(`
  ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M
  Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL
  Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash
  Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component EComp Emoji_Modifier EMod
  Emoji_Modifier_Base EBase Emoji_Presentation EPres Extended_Pictographic ExtPict Extender Ext Grapheme_Base
  Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue
  IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math
  Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical
  Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo
  Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS
`);
/** Script values, long and short (a sample: the fence reads no value of these names at all). */
const SCRIPTS = words(
  'Latin Latn Greek Grek Cyrillic Cyrl Han Hani Common Zyyy Inherited Zinh Qaai Unknown Zzzz Kawi',
);
/** Every property name the engine reads, alone and as `name=value`. */
const PROPERTY_NAMES = [
  ...GENERAL_CATEGORY,
  ...BINARY,
  ...GENERAL_CATEGORY.flatMap((value) => [`gc=${value}`, `General_Category=${value}`]),
  ...SCRIPTS.flatMap((value) =>
    ['sc', 'Script', 'scx', 'Script_Extensions'].map((name) => `${name}=${value}`),
  ),
];
/** The two names fixed forever, so the only ones the fence accepts. */
const FIXED = new Set(['ASCII', 'Cc']);
/** Names that differ from those two only in spelling: the engine rejects or reads them as other properties. */
const NEAR_MISSES = ['ASCII_', 'ascii', 'cc', 'CC', 'Cc_', 'Ccc', 'gc=Cc', 'ASCII ', ' Cc', 'C', ''];

/** Each way a property name reaches a pattern: a literal, `\P`, and the text of a string. */
const forms = (name: string): string[] => [
  `const R = /\\p{${name}}/u;`,
  `const R = /[^\\P{${name}}]/u;`,
  `const P = '\\\\p{${name}}';`,
];

describe('the unicode fence accepts exactly two property names, ASCII and Cc', () => {
  it('the list names properties the engine reads, so the pin tests real names', () => {
    expect(PROPERTY_NAMES.filter((name) => !isProperty(name))).toEqual([]);
    expect([...FIXED].every(isProperty)).toBe(true);
  });

  it('every other property name, value and alias is a class escape, in every form', () => {
    for (const name of [...PROPERTY_NAMES, ...NEAR_MISSES]) {
      const rules: Rule[] = FIXED.has(name) ? [] : ['property'];
      for (const source of forms(name)) expect([source, rulesOf(source)]).toEqual([source, rules]);
    }
  });

  it('any other name is a class escape too (property)', () => {
    const name = fc.stringMatching(/^[A-Za-z_=]{0,14}$/).filter((text) => !FIXED.has(text));
    fc.assert(
      fc.property(name, (text) => {
        for (const source of forms(text)) expect([source, rulesOf(source)]).toEqual([source, ['property']]);
      }),
    );
  });
});

describe('the unicode fence finds every case folding by the engine tables, one probe at a time', () => {
  it('i with u or v, in a literal and in flags given as text', () => {
    expectRules([
      ['const R = /k/vi;', ['unicode-ignore-case']],
      ['const R = /k/iu;', ['unicode-ignore-case']],
      ["const R = new RegExp('k', 'iv');", ['unicode-ignore-case']],
      ["const R = new RegExp('k', 'ui');", ['unicode-ignore-case']],
      ['const R = /\\xE9/i;', ['unicode-ignore-case']],
    ]);
  });

  it('a backreference or legacy octal escape under i, which compares captured text by the engine tables', () => {
    expectRules([
      ['const DOUBLED = /(.)\\1/i;', ['unicode-ignore-case']],
      ['const DOUBLED = /(?<c>.)\\k<c>/i;', ['unicode-ignore-case']],
      ["const DOUBLED = new RegExp('(.)\\\\1', 'i');", ['unicode-ignore-case']],
      ["const DOUBLED = new RegExp(/(.)\\1/, 'i');", ['unicode-ignore-case']],
      ["const P = `(.)\\\\1`; const R = new RegExp(P, 'gi');", ['unicode-ignore-case']],
      ['const E_ACUTE = /\\351/i;', ['unicode-ignore-case']],
      ['const DOUBLED = /\\\\\\1/i;', ['unicode-ignore-case']],
    ]);
    for (let group = 1; group <= 9; group += 1) {
      expectRules([[`const R = /${'(.)'.repeat(group)}\\${group}/i;`, ['unicode-ignore-case']]]);
    }
  });

  it('an inline modifier group, whatever the flags', () => {
    expectRules([
      ["const LAMBDA = new RegExp('(?i:\\\\u019B)', 'u');", ['unicode-ignore-case']],
      ['const LAMBDA = /(?i:\\u019B)/u;', ['unicode-ignore-case']],
      ['const R = /(?i:k)/;', ['unicode-ignore-case']],
      ['const R = /(?-i:k)/i;', ['unicode-ignore-case']],
      ['const R = /(?i-s:k)/;', ['unicode-ignore-case']],
      ['const R = /(?m:k)/;', ['unicode-ignore-case']],
      ["const P = '(?i:k)'; const R = new RegExp(P, 'u');", ['unicode-ignore-case']],
      ["const R = new RegExp(/(?i:k)/, 'g');", ['unicode-ignore-case']],
      ['const R = /\\\\(?i:k)/;', ['unicode-ignore-case']],
    ]);
  });

  it('accepts groups, lookarounds, escaped digits and parentheses, and backreferences without i', () => {
    const clean = [
      'const R = /(.)\\1/;',
      'const R = /(.)\\1/u;',
      'const R = /(?<c>.)\\k<c>/g;',
      'const R = /\\\\1/i;',
      'const R = /\\(?i:k/i;',
      'const R = /(?:a)(?=b)(?!c)(?<=d)(?<!e)(?<n>f)/i;',
      "const R = new RegExp('(?:a)\\\\\\\\1', 'i');",
      "const R = new RegExp('^xn--', 'i');",
    ];
    for (const source of clean) expect([source, rulesOf(source)]).toEqual([source, []]);
  });
});
