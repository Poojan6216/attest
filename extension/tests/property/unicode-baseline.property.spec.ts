/**
 * SEC-1 (Hard Rule 4), fast-check: every text reader treats a code point Unicode 15.0 does not assign exactly as a
 * 15.0 engine does, as an unassigned code point. Random text mixes 15.0 pieces (letters, digits, marks, spaces,
 * invisible marks, currency, clock words, address parts) with holes; each hole is filled once with code points
 * the engine running the suite assigns but 15.0 does not (Node 22: Unicode 15.1 and 16.0) or that nothing
 * assigns, and once with different ones, some of them noncharacters (unassigned in every Unicode version, which
 * the engine itself treats as Cn). Every reader's result must be the same up to that substitution: a reader that
 * let the engine read one of those code points (NFKC turning an outlined digit into a digit, a 16.0 letter
 * joining a token, a lowercase mapping) would give two different answers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  merchantName,
  prepareMerchant,
  stopWordSet,
  subjectTokensWithout,
} from '../../src/core/features-content';
import {
  amount,
  counterparty,
  email,
  name,
  nameTokens,
  resolveRelative,
  subjectTokens,
} from '../../src/core/normalize';
import { readsDifferently, stripInvisible } from '../../src/core/normalize-text';
import { lowerBaseline } from '../../src/core/unicode-baseline';
import { ASSIGNED, RESERVED_IGNORABLE } from '../../src/core/unicode-table-assigned';

const RUNS = { numRuns: 2_000 };
const IN_BASELINE = new RegExp(`^[${ASSIGNED}${RESERVED_IGNORABLE}]$`, 'u');
const UNASSIGNED_HERE = /^\p{Cn}$/u;
const isNoncharacter = (c: number): boolean => (c >= 0xfdd0 && c <= 0xfdef) || (c & 0xfffe) === 0xfffe;

/** Code points the engine running the suite assigns and Unicode 15.0 does not. */
const ASSIGNED_SINCE: number[] = [];
for (let c = 0; c < 0x110000; c += 1) {
  const character = String.fromCodePoint(c);
  if (!IN_BASELINE.test(character) && !UNASSIGNED_HERE.test(character)) ASSIGNED_SINCE.push(c);
}
/** Unassigned everywhere so far, and not a noncharacter: a 15.0 engine and this one both read them as Cn. */
const UNASSIGNED = [0x0378, 0x0380, 0x05c8, 0x1ccfa, 0x2ebe1, 0x40000, 0x4fffd, 0xdffff].filter(
  (c) => !IN_BASELINE.test(String.fromCodePoint(c)) && UNASSIGNED_HERE.test(String.fromCodePoint(c)),
);
/** Unassigned in every Unicode version: U+FDD0–U+FDEF and the last two code points of every plane. */
const NONCHARACTERS = Array.from({ length: 0x110000 }, (_, c) => c).filter(isNoncharacter);
/** OUTLINED DIGIT ZERO–NINE (16.0): NFKC turns them into 0–9 on an engine that has them. */
const OUTLINED = Array.from({ length: 10 }, (_, digit) => 0x1ccf0 + digit);
/** Unicode 15.1/16.0 letters a reader would fold or join to a token: with case, CJK Ext I, a Kawi sign. */
const LETTERS = [0xa7cb, 0xa7dc, 0x10d50, 0x10d70, 0x2ebf0, 0x1fae9, 0x1c89, 0x11f5a];

const outside = fc.oneof(
  { arbitrary: fc.constantFrom(...OUTLINED.filter((c) => ASSIGNED_SINCE.includes(c))), weight: 2 },
  { arbitrary: fc.constantFrom(...LETTERS.filter((c) => ASSIGNED_SINCE.includes(c))), weight: 1 },
  { arbitrary: fc.constantFrom(...ASSIGNED_SINCE), weight: 3 },
  { arbitrary: fc.constantFrom(...UNASSIGNED), weight: 1 },
);
const replacement = fc.oneof(outside, fc.constantFrom(...NONCHARACTERS));

/** 15.0 text the readers make decisions about: words, address parts, money, clock words, spaces, marks. */
const PIECES = [
  ...'Acme|STORE|Priya|Re:|the|Q3|deck|x.com|p|+tag|@|<|>|"|.|,|$|USD|1|0|9|10|1,234.50|9,99|\'|-'.split('|'),
  ...'2:03|PM|p.m.|min|ago|Yesterday|Oct|Thu|at|:| |  |\t|\n'.split('|'),
  ...'\u20AC|\u00A3|\u00A5|\u00A0|\u3000|\u0085|\u200B|\u200D|\u2066|\uFEFF|\u00AD|\u00E9|e|\u0301'.split(
    '|',
  ),
  ...'\u0308|\u0130|\u03A3|\u0391\u03A3|\u03C2|\uFB01|\uFF31|\uFF13|\u212A|\u1100|\u1161|\uD55C'.split('|'),
  ...'\u0E01|\u{1D400}|\u{1171E}|\u{11F00}'.split('|'),
];
const HOLES = 3;
const hole = fc.integer({ min: 0, max: HOLES - 1 });
const digitOrHole = fc.oneof(fc.constantFrom(...Array.from('0123456789')), hole);
/**
 * A template: pieces and holes (0, 1 or 2), filled once with one set of code points and once with another. Free
 * text, and amounts and times whose digits may be holes (an outlined digit is a digit to a 16.0 NFKC).
 */
const template = fc.oneof(
  fc.array(fc.oneof(fc.constantFrom(...PIECES), hole), { maxLength: 14 }),
  fc
    .tuple(
      fc.constantFrom('$', '\u20AC', 'USD ', ''),
      fc.array(digitOrHole, { minLength: 1, maxLength: 5 }),
      fc.constantFrom('', '.50', ' USD', ',99 \u20AC'),
    )
    .map(([before, digits, after]) => [before, ...digits, after]),
  fc
    .tuple(
      fc.array(digitOrHole, { minLength: 1, maxLength: 2 }),
      fc.constantFrom(' min ago', ' hours ago', ':03 PM', ' Oct', ' days ago'),
    )
    .map(([digits, after]) => [...digits, after]),
);
type Template = readonly (string | number)[];

function fill(parts: Template, codes: readonly number[]): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : String.fromCodePoint(codes[part] ?? 0)))
    .join('');
}

/** `value` with every string in it mapped by `map` (arrays, sets and plain objects walked). */
function mapStrings(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === 'string') return map(value);
  if (Array.isArray(value)) return value.map((item: unknown) => mapStrings(item, map));
  if (value instanceof Set) return new Set([...value].map((item: unknown) => mapStrings(item, map)));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]));
}

const CONTEXT = { referenceIso: '2026-10-06T14:00:00-04:00', offsetAt: () => -240 };
const READERS: readonly (readonly [string, (text: string, stop: readonly string[]) => unknown])[] = [
  ['name', (text) => name(text)],
  ['nameTokens', (text) => nameTokens(text)],
  ['subjectTokens', (text, stop) => subjectTokens(text, stop)],
  ['counterparty', (text) => counterparty(text)],
  ['email', (text) => email(text)],
  ['amount', (text) => amount(text, { defaultDollar: 'USD' })],
  ['resolveRelative', (text) => resolveRelative(text, CONTEXT)],
  ['readsDifferently', (text) => readsDifferently(text)],
  ['stripInvisible', (text) => stripInvisible(text)],
  ['stopWordSet', (text, stop) => stopWordSet([...stop, text])],
  ['subjectTokensWithout', (text, stop) => subjectTokensWithout(text, stopWordSet(stop))],
  ['merchantName', (text) => merchantName(text)],
  ['prepareMerchant', (text) => prepareMerchant(text)],
];

describe('every reader treats a code point Unicode 15.0 does not assign as unassigned (property)', () => {
  it('the engine running the suite assigns characters 15.0 does not, so the property is not vacuous', () => {
    expect(ASSIGNED_SINCE.length).toBeGreaterThan(0);
    expect(OUTLINED.every((c) => ASSIGNED_SINCE.includes(c))).toBe(true);
    expect(LETTERS.filter((c) => ASSIGNED_SINCE.includes(c)).length).toBeGreaterThan(0);
    expect(UNASSIGNED.length).toBeGreaterThan(0);
  });

  it('gives the same result, up to the substitution, when each such code point is replaced by another', () => {
    const codes = (arbitrary: fc.Arbitrary<number>) =>
      fc.uniqueArray(arbitrary, { minLength: HOLES, maxLength: HOLES });
    fc.assert(
      fc.property(template, template, codes(outside), codes(replacement), (text, stop, from, to) => {
        const swap = new Map(
          from.map((code, i): [string, string] => [
            String.fromCodePoint(code),
            String.fromCodePoint(to[i] ?? 0),
          ]),
        );
        const substitute = (value: string) => Array.from(value, (c) => swap.get(c) ?? c).join('');
        const [before, after] = [fill(text, from), fill(text, to)];
        const [stopBefore, stopAfter] = [
          ['the', fill(stop, from)],
          ['the', fill(stop, to)],
        ];
        for (const [label, read] of READERS) {
          expect([label, read(after, stopAfter)]).toEqual([
            label,
            mapStrings(read(before, stopBefore), substitute),
          ]);
        }
      }),
      RUNS,
    );
  }, 120_000);
});

/**
 * A simulated later engine. Unicode will assign more characters, and an engine that knows them will give them
 * compatibility decompositions (to `@`, `<`, digits, spaces), lowercase mappings and the White_Space property.
 * Code points no engine assigns yet stand in for them, and one 15.0 letter (U+05D0) gains a newly encoded
 * lowercase partner: while the readers run, `normalize`, `toLowerCase` and `trim` behave as that engine's would.
 * A reader that let the engine read such a code point gives a different answer; one that hides them
 * (unicode-baseline.ts) gives the same answer as on the engine running the suite. This holds on any engine,
 * whatever Unicode version Node moves to.
 */
const FUTURE_NFKC: ReadonlyMap<string, string> = new Map([
  ['\u0378', '@'],
  ['\u0379', '7'],
  ['\u0380', '<'],
  ['\u{50000}', '1'],
  ['\u{1CCFA}', ' '],
]);
const FUTURE_LOWER: ReadonlyMap<string, string> = new Map([
  ['\u0381', 'q'],
  ['\u{50001}', 'a'],
  ['\u05D0', '\u0383'], // a 15.0 letter given a newly encoded lowercase partner (as 8.0 did for Cherokee)
]);
const FUTURE_SPACE = '\u0382';
const FUTURE = [...FUTURE_NFKC.keys(), ...FUTURE_LOWER.keys(), FUTURE_SPACE].map(
  (c) => c.codePointAt(0) ?? 0,
);

type StringMethod = 'normalize' | 'toLowerCase' | 'trim';
/** The engine's own methods, as property descriptors, to call and to restore. */
const ENGINE = new Map(
  (['normalize', 'toLowerCase', 'trim'] as const).map((method): [StringMethod, PropertyDescriptor] => [
    method,
    Object.getOwnPropertyDescriptor(String.prototype, method) ?? {},
  ]),
);
const engine = (method: StringMethod) =>
  ENGINE.get(method)?.value as (this: string, ...args: (string | undefined)[]) => string;
const mapped = (text: string, map: ReadonlyMap<string, string>) =>
  Array.from(text, (c) => map.get(c) ?? c).join('');
const FUTURE_EDGES = new RegExp(`^${FUTURE_SPACE}+|${FUTURE_SPACE}+$`, 'gu');

/** The simulated later engine's normalize, toLowerCase and trim. */
const LATER: Readonly<Record<StringMethod, (this: string, form?: string) => string>> = {
  normalize(form) {
    const text = form === 'NFKC' || form === 'NFKD' ? mapped(this, FUTURE_NFKC) : this;
    return engine('normalize').call(text, form);
  },
  toLowerCase() {
    return engine('toLowerCase').call(mapped(this, FUTURE_LOWER));
  },
  trim() {
    return engine('trim').call(this).replace(FUTURE_EDGES, '');
  },
};

/** Runs `read` on the simulated later engine, then puts the engine's own methods back. */
function onLaterEngine<T>(read: () => T): T {
  for (const [method, value] of Object.entries(LATER)) {
    Object.defineProperty(String.prototype, method, { ...ENGINE.get(method as StringMethod), value });
  }
  try {
    return read();
  } finally {
    for (const [method, descriptor] of ENGINE) Object.defineProperty(String.prototype, method, descriptor);
  }
}

describe('every reader keeps a code point Unicode 15.0 does not assign from a later engine (property)', () => {
  it('the simulated engine reads those code points (so the property is not vacuous)', () => {
    expect(onLaterEngine(() => 'p\u0378x.com'.normalize('NFKC'))).toBe('p@x.com');
    expect(onLaterEngine(() => 'A\u0381'.toLowerCase())).toBe('aq');
    expect(onLaterEngine(() => '\u05D0'.toLowerCase())).toBe('\u0383');
    expect(onLaterEngine(() => `${FUTURE_SPACE}x${FUTURE_SPACE}`.trim())).toBe('x');
    expect('p\u0378x.com'.normalize('NFKC')).toBe('p\u0378x.com');
  });

  it('gives every reader the same answer on the later engine as on this one', () => {
    const futureOrOutside = fc.oneof(fc.constantFrom(...FUTURE), outside);
    const codes = fc.uniqueArray(futureOrOutside, { minLength: HOLES, maxLength: HOLES });
    fc.assert(
      fc.property(template, template, codes, (parts, stopParts, fill3) => {
        const [text, stop] = [fill(parts, fill3), ['the', fill(stopParts, fill3)]];
        for (const [label, read] of READERS) {
          expect([label, onLaterEngine(() => read(text, stop))]).toEqual([label, read(text, stop)]);
        }
      }),
      RUNS,
    );
  }, 120_000);
});

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
