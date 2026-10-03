/**
 * SEC-1 (Hard Rule 4): negative and positive controls for the unicode fence (unicode-fence.spec.ts). Each probe
 * below reads the engine's Unicode tables and got past an earlier, text-based scan: a class escape or case-folding
 * flags built at run time, `iu` flags in a string, `\s` before a letter, and code after a string holding `//`. The
 * scan must find every one, and nothing in the patterns src/core builds from the Unicode 15.0 tables.
 */
import { describe, expect, it } from 'vitest';

import { findings, type Rule } from './unicode-fence-scan';

/** The import the readers use: `BASELINE_CLASS` resolves only through it. */
const IMPORT = "import { BASELINE_CLASS } from './unicode-baseline'; ";
/** A sample source: `~` stands for a backtick and `#{` for a template substitution, so a sample reads as code. */
const sample = (text: string): string => text.replace(/~/g, '`').replace(/#\{/g, '${');
/** The rules a sample breaks, each once, in the order the walk meets them. */
const rulesOf = (text: string): Rule[] => [
  ...new Set(findings('sample.ts', sample(text)).map(({ rule }) => rule)),
];
const expectRules = (rows: readonly (readonly [string, readonly Rule[]])[]): void => {
  for (const [source, rules] of rows) expect([source, rulesOf(source)]).toEqual([source, rules]);
};

describe('the unicode fence finds what it looks for (negative controls)', () => {
  it('finds each probe that read the engine Unicode past the text scan', () => {
    expectRules([
      [
        String.raw`const BACKSLASH = '\\'; const LETTER = new RegExp(~#{BACKSLASH}p{L}+~, 'u');`,
        ['property'],
      ],
      [
        String.raw`const FLAGS = 'iu'; const u2 = (s: string) => new RegExp('k', FLAGS).test(s);`,
        ['regexp-built'],
      ],
      [String.raw`const LAMBDA = new RegExp('\\u019B', 'iu');`, ['unicode-ignore-case']],
      [String.raw`const AGO_WORD = /\sago/u;`, ['space-class']],
      [String.raw`const SEP = 'a//b'; const fold = (s: string) => s.normalize('NFKC');`, ['normalize']],
      [
        String.raw`const upper = String.prototype.toUpperCase; const u3 = (s: string) => upper.call(s);`,
        ['other-case'],
      ],
      [String.raw`const P = '\\p{L}'; const p11 = (s: string) => new RegExp(P, 'u').test(s);`, ['property']],
      [String.raw`const p12 = (s: string) => /\p{L}/u.test(s);`, ['property']],
      [String.raw`const p13 = (s: string) => s.normalize('NFKC');`, ['normalize']],
    ]);
  });

  it('finds a method reached through a name the file spells, and a class escape it composes', () => {
    expectRules([
      [String.raw`const f = (s: string, p: string) => String.prototype.match.call(s, p);`, ['regexp-built']],
      [String.raw`const f = (s: string, p: string) => s.search.bind(s)(p);`, ['regexp-built']],
      [String.raw`const k = 'normalize'; const f = (s: string) => Reflect.get(s, k);`, ['normalize']],
      [String.raw`const f = (s: string) => Reflect.get(s, 'norm' + 'alize');`, ['normalize']],
      [String.raw`const f = (s: string) => Reflect.get(s, ~toLower#{'Case'}~);`, ['lowercase']],
      [String.raw`const B = '\\'; const P = B + 'p{L}'; const Q = ~#{B}s~;`, ['property', 'space-class']],
      [
        String.raw`const { match } = String.prototype; const R = Reflect.get(/x/, 'compile');`,
        ['regexp-built'],
      ],
    ]);
  });

  it('folds case by the engine tables: i with u or v, or i on a pattern that is not plain ASCII', () => {
    expectRules([
      [String.raw`const R = /x/vi; const S = new RegExp('x', 'giu');`, ['unicode-ignore-case']],
      [String.raw`const R = /caf\u00E9/i;`, ['unicode-ignore-case']],
      [String.raw`const R = new RegExp('\\u0264', 'i');`, ['unicode-ignore-case']],
      [`${IMPORT}const R = new RegExp(~[#{BASELINE_CLASS.token}]~, 'i');`, ['unicode-ignore-case']],
    ]);
  });
});

describe('the unicode fence refuses a regular expression built at run time', () => {
  it('refuses every way to build one from text only run time knows', () => {
    const built = [
      String.raw`const R = new RegExp('[' + BASELINE_CLASS.token + ']', 'u');`,
      `${IMPORT}const R = new RegExp('[' + BASELINE_CLASS.token + ']', 'u');`,
      String.raw`const R = new RegExp('a' + 'b', 'u');`,
      String.raw`const f = (x: string) => new RegExp(~[#{x}]~, 'u');`,
      String.raw`const R = new RegExp('a');`,
      String.raw`const R = RegExp('a', 'u', 'x');`,
      String.raw`const C = RegExp; const R = new C('a', 'u');`,
      String.raw`const R = Reflect.construct(RegExp, ['a', 'u']);`,
      String.raw`const R = new globalThis.RegExp('a', 'u');`,
      String.raw`const R = new RegExp(String.raw~a~, 'u');`,
      String.raw`const R = new RegExp(...ARGS);`,
      String.raw`const f = (s: string, p: string) => s.search(p);`,
      String.raw`const f = (s: string) => s.match('a');`,
      String.raw`const f = (s: string) => s['matchAll']('a');`,
      String.raw`const f = (r: RegExp) => r.compile('a', 'u');`,
      `${IMPORT}const SPACE = BASELINE_CLASS.space; const f = (SPACE: string) => new RegExp(~[#{SPACE}]~, 'u');`,
      `${IMPORT}let SPACE = BASELINE_CLASS.space; const R = new RegExp(~[#{SPACE}]~, 'u');`,
      `${IMPORT}const R = new RegExp(~[#{BASELINE_CLASS.nothing}]~, 'u');`,
    ];
    for (const source of built) expect([source, rulesOf(source)]).toEqual([source, ['regexp-built']]);
  });

  it('trusts BASELINE_CLASS and the tables only when imported, by name, from the generated modules', () => {
    const untrusted = [
      `const BASELINE_CLASS = { token: 'x' }; const R = new RegExp(~[#{BASELINE_CLASS.token}]~, 'u');`,
      `${IMPORT}const BASELINE_CLASS = 1; const R = new RegExp(~[#{BASELINE_CLASS.token}]~, 'u');`,
      `import { BASELINE_CLASS } from './unicode-baselines'; const R = new RegExp(~[#{BASELINE_CLASS.token}]~, 'u');`,
      `import { BASELINE_CLASS as B } from './unicode-baseline'; const R = new RegExp(~[#{B.token}]~, 'u');`,
      `import { ASSIGNED } from './unicode-table-extra'; const U = new RegExp(~[^#{ASSIGNED}]~, 'u');`,
      `import { X as ASSIGNED } from './unicode-table-assigned'; const U = new RegExp(~[^#{ASSIGNED}]~, 'u');`,
    ];
    for (const source of untrusted) expect([source, rulesOf(source)]).toEqual([source, ['regexp-built']]);
  });
});

describe('the unicode fence finds a class escape however it is written (negative controls)', () => {
  it('in raw and cooked text, in a composed pattern, and engine case or normalisation however reached', () => {
    expectRules([
      [String.raw`const R = new RegExp(String.raw~\p{L}~, 'u');`, ['regexp-built', 'property']],
      [String.raw`const S = '\x5Cp{L}'; const T = '\\S+';`, ['property', 'space-class']],
      [String.raw`const S = 'Q3 \p{L}';`, ['property']],
      [`${IMPORT}const R = new RegExp(~[#{BASELINE_CLASS.token}\\\\s]~, 'u');`, ['space-class']],
      [String.raw`const f = (s: string) => s['normalize']('NFC') + s.trimStart();`, ['normalize', 'trim']],
      [
        String.raw`const { toLowerCase } = String.prototype; const c = Intl.Collator;`,
        ['lowercase', 'other-case'],
      ],
      [
        String.raw`const f = (a: string, b: string) => a.localeCompare(b) + a.toLocaleUpperCase();`,
        ['other-case'],
      ],
      [String.raw`const f = (s: string) => String.prototype.normalize.call(s, 'NFC');`, ['normalize']],
      [
        String.raw`const f = (s: string) => [s.trim, s.normalize.bind(s), s['toLowerCase']['apply']];`,
        ['trim', 'normalize', 'lowercase'],
      ],
      [String.raw`const { call, length } = String.prototype.toUpperCase;`, ['other-case']],
    ]);
  });
});

describe('the unicode fence accepts what src/core builds from the Unicode 15.0 tables (positive controls)', () => {
  it('accepts patterns built from 15.0 classes, plain ASCII case folding, data, types and comments', () => {
    const clean = [
      `${IMPORT}const A = new RegExp(~[#{BASELINE_CLASS.token}]~, 'u');`,
      `${IMPORT}const C = ~[^#{BASELINE_CLASS.space}#{BASELINE_CLASS.format}]~; const N = new RegExp(~^#{C}+$~, 'u');`,
      String.raw`${IMPORT}const SPACE = BASELINE_CLASS.space; const S = new RegExp(~[#{SPACE}\\d]~, 'gu');`,
      `import { ASSIGNED } from './unicode-table-assigned'; const U = new RegExp(~[^#{ASSIGNED}]~, 'u');`,
      String.raw`const OK = /\P{ASCII}|[\p{Cc}]/u; const G = /xn--/i; const L = /\\s/; const T = '\\\\s';`,
      String.raw`const O = new RegExp('[\\p{Cc}]', 'gu'); const f = (s: string) => s.match(O) ?? s.search(/a/);`,
      String.raw`const isRe = (x: unknown): x is RegExp => x instanceof RegExp; const SEP = 'a//b';`,
      String.raw`const f = (policy: P) => policy.normalize.stopWords; const { stopWords } = POLICY.normalize;`,
      String.raw`const f = (groups: G) => [groups.rule, groups.match, groups.search ?? []];`,
      String.raw`const I = new RegExp('^xn--', 'i'); type K = 'normalize' | 'trim'; const O = { 'trim': 1 };`,
      String.raw`/* \p{L} \s s.trim() new RegExp(x) */ // s.normalize() /\p{N}/iu Intl 'normalize'`,
    ];
    for (const source of clean) expect([source, rulesOf(source)]).toEqual([source, []]);
  });
});
