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
  asciiLower,
  counterparty,
  email,
  isCurrencyCode,
  name,
  nameTokens,
  resolveRelative,
  sameAddress,
  stopWordKey,
  subjectTokens,
} from '../../src/core/normalize';
import * as normalizeAmount from '../../src/core/normalize-amount';
import * as normalizeRelative from '../../src/core/normalize-relative';
import * as normalizeText from '../../src/core/normalize-text';
import { readsDifferently, stripInvisible } from '../../src/core/normalize-text';
import { ASSIGNED, RESERVED_IGNORABLE } from '../../src/core/unicode-table-assigned';
import { READER_FILES } from '../unit/core/unicode-fence-files';

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

/**
 * 15.0 text the readers make decisions about: words, address parts, money, clock words, spaces, marks, and lone
 * surrogates (halves of a UTF-16 pair with no partner).
 */
const PIECES = [
  ...'Acme|STORE|Priya|Re:|the|Q3|deck|x.com|p|+tag|@|<|>|"|.|,|$|USD|1|0|9|10|1,234.50|9,99|\'|-'.split('|'),
  ...'2:03|PM|p.m.|min|ago|Yesterday|Oct|Thu|at|:| |  |\t|\n'.split('|'),
  ...'\u20AC|\u00A3|\u00A5|\u00A0|\u3000|\u0085|\u200B|\u200D|\u2066|\uFEFF|\u00AD|\u00E9|e|\u0301'.split(
    '|',
  ),
  ...'\u0308|\u0130|\u03A3|\u0391\u03A3|\u03C2|\uFB01|\uFF31|\uFF13|\u212A|\u1100|\u1161|\uD55C'.split('|'),
  ...'\u0E01|\u{1D400}|\u{1171E}|\u{11F00}|\u034F'.split('|'),
];
/**
 * Lone surrogates: every high half with every low half pairs into a 15.0 character or a plane-5 code point, none
 * of which a hole can hold (checked below), so two of them side by side keep the substitution exact.
 */
const HIGH_HALVES = ['\uD835', '\uD900'];
const LOW_HALVES = ['\uDFCF', '\uDC00', '\uDC29'];
/**
 * The two halves of one character with marks a reader removes between them, which must never pair once the marks
 * are gone: an outlined digit (16.0), U+50000 (the simulated later engine's "1"), 15.0 digits and letters NFKC
 * folds (bold 1, bold p, DIGIT ONE COMMA), and the astral hole.
 */
const SPLIT = ['\u{1CCF1}', '\u{50000}', '\u{1D7CF}', '\u{1D429}', '\u{1F102}', '\u{1FFFE}', '\u{1D400}'];
const BETWEEN = ['\u200B', '\u00AD', '\uFEFF', '\u2066', '\u{E0080}', '\u034F', '\u0301', '\u0308'];
const splitOf = (characters: readonly string[]) =>
  fc
    .tuple(
      fc.constantFrom(...characters),
      fc.array(fc.constantFrom(...BETWEEN), { minLength: 1, maxLength: 2 }),
    )
    .map(([character, marks]) => `${character.charAt(0)}${marks.join('')}${character.charAt(1)}`);
/** Whether a hole can hold `character`: stripInvisible pairs split halves, so the substitution must not meet it. */
const fillable = (character: string): boolean => {
  const c = character.codePointAt(0) ?? 0;
  return ASSIGNED_SINCE.includes(c) || UNASSIGNED.includes(c) || isNoncharacter(c);
};
const UNFILLABLE_SPLIT = SPLIT.filter((character) => !fillable(character));
const HOLES = 3;
const hole = fc.integer({ min: 0, max: HOLES - 1 });
const DIGITS = Array.from('0123456789');
/**
 * A template: pieces, split pairs and holes (0, 1 or 2), filled once with one set of code points and once with
 * another. Free text, and amounts and times whose digits may be holes (an outlined digit is a digit to a 16.0
 * NFKC) or split pairs.
 */
const templateOf = (split: fc.Arbitrary<string>) => {
  const digitOrHole = fc.oneof(fc.constantFrom(...DIGITS), hole, split);
  const piece = fc.constantFrom(...PIECES, ...HIGH_HALVES, ...LOW_HALVES);
  return fc.oneof(
    fc.array(fc.oneof(piece, hole, split), { maxLength: 14 }),
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
};
const template = templateOf(splitOf(SPLIT));
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
/** Two addresses read from the text and the last stop word, compared (an address compared with itself if one). */
function comparedAddresses(text: string, stop: readonly string[]): unknown {
  const address = email(text);
  return address === null ? null : sameAddress(address, email(stop.at(-1) ?? '') ?? address);
}
/** Each reader, by its function (its name labels a failure), and how the properties call it on text. */
const READERS: readonly (readonly [
  (...args: never[]) => unknown,
  (text: string, stop: readonly string[]) => unknown,
])[] = [
  [name, (text) => name(text)],
  [nameTokens, (text) => nameTokens(text)],
  [subjectTokens, (text, stop) => subjectTokens(text, stop)],
  [counterparty, (text) => counterparty(text)],
  [email, (text) => email(text)],
  [sameAddress, comparedAddresses],
  [asciiLower, (text) => asciiLower(text)],
  [stopWordKey, (text) => stopWordKey(text)],
  [amount, (text) => amount(text, { defaultDollar: 'USD' })],
  [isCurrencyCode, (text) => isCurrencyCode(text)],
  [resolveRelative, (text) => resolveRelative(text, CONTEXT)],
  [readsDifferently, (text) => readsDifferently(text)],
  [stripInvisible, (text) => stripInvisible(text)],
  [stopWordSet, (text, stop) => stopWordSet([...stop, text])],
  [subjectTokensWithout, (text, stop) => subjectTokensWithout(text, stopWordSet(stop))],
  [merchantName, (text) => merchantName(text)],
  [prepareMerchant, (text) => prepareMerchant(text)],
];
/**
 * The files whose every export the properties must run, by name: the only src/core files that may call `normalize`
 * (READER_FILES, which tests/unit/core/unicode-fence.spec.ts holds src/core to), so every engine normalisation is
 * reached through one of their exports.
 */
const READER_MODULES: Readonly<Record<string, object>> = {
  'normalize-text.ts': normalizeText,
  'normalize-amount.ts': normalizeAmount,
  'normalize-relative.ts': normalizeRelative,
};

describe('every reader treats a code point Unicode 15.0 does not assign as unassigned (property)', () => {
  it('the engine running the suite assigns characters 15.0 does not, so the property is not vacuous', () => {
    expect(ASSIGNED_SINCE.length).toBeGreaterThan(0);
    expect(OUTLINED.every((c) => ASSIGNED_SINCE.includes(c))).toBe(true);
    expect(LETTERS.filter((c) => ASSIGNED_SINCE.includes(c)).length).toBeGreaterThan(0);
    expect(UNASSIGNED.length).toBeGreaterThan(0);
    const pairs = HIGH_HALVES.flatMap((high) => LOW_HALVES.map((low) => `${high}${low}`));
    expect(pairs.filter(fillable)).toEqual([]);
    expect(UNFILLABLE_SPLIT).toContain('\u{50000}');
  });

  it('gives the same result, up to the substitution, when each such code point is replaced by another', () => {
    const substitutable = templateOf(splitOf(UNFILLABLE_SPLIT));
    const codes = (arbitrary: fc.Arbitrary<number>) =>
      fc.uniqueArray(arbitrary, { minLength: HOLES, maxLength: HOLES });
    fc.assert(
      fc.property(
        substitutable,
        substitutable,
        codes(outside),
        codes(replacement),
        (text, stop, from, to) => {
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
          for (const [reader, read] of READERS) {
            expect([reader.name, read(after, stopAfter)]).toEqual([
              reader.name,
              mapStrings(read(before, stopBefore), substitute),
            ]);
          }
        },
      ),
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
  it('runs every export of the files that may normalise, so no reader there is left out', () => {
    expect(Object.keys(READER_MODULES).sort()).toEqual([...READER_FILES].sort());
    const run: ReadonlySet<unknown> = new Set(READERS.map(([reader]) => reader));
    const exports = Object.entries(READER_MODULES).flatMap(([file, module]) =>
      Object.entries(module).map(([key, value]): [string, unknown] => [`${file} ${key}`, value]),
    );
    expect(exports.length).toBeGreaterThanOrEqual(13);
    const notRun = exports.filter(([, value]) => typeof value !== 'function' || !run.has(value));
    expect(notRun.map(([label]) => label)).toEqual([]);
  });

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
        for (const [reader, read] of READERS) {
          expect([reader.name, onLaterEngine(() => read(text, stop))]).toEqual([
            reader.name,
            read(text, stop),
          ]);
        }
      }),
      RUNS,
    );
  }, 120_000);
});

/** Readers whose result keeps the text as read (an address) are compared with each lone half replaced there too. */
const wellFormed = (text: string): string => text.toWellFormed();
/**
 * Readers that see a lone half as itself, by design: stripInvisible removes marks and keeps the rest as is (the
 * step every reader runs after asBaseline), and sameAddress compares two addresses code point by code point as read
 * (§5.1), so two different lone halves are two different addresses (both are `confusable`).
 */
const KEEPS_HALVES: ReadonlySet<unknown> = new Set([stripInvisible, sameAddress]);

describe('a lone surrogate reads as the U+FFFD it displays as, whatever is removed around it (property)', () => {
  it('leaves out only the readers that see a lone half as itself, each for the reason given', () => {
    expect([...KEEPS_HALVES]).toEqual([stripInvisible, sameAddress]);
    expect(stripInvisible('\uD835​\uDC29')).toBe('\u{1D429}');
    const [a, b] = [email('\uD835@x.com'), email('\uD900@x.com')];
    expect(a !== null && b !== null && sameAddress(a, b)).toMatchObject({
      exact: false,
      confusablePair: true,
    });
    const replaced = email('�@x.com');
    expect(replaced !== null && sameAddress(replaced, replaced).exact).toBe(true);
  });

  it('gives every reader the same answer as on the text with each lone half replaced by U+FFFD', () => {
    const codes = fc.uniqueArray(outside, { minLength: HOLES, maxLength: HOLES });
    fc.assert(
      fc.property(template, template, codes, (parts, stopParts, fill3) => {
        const [text, stop] = [fill(parts, fill3), ['the', fill(stopParts, fill3)]];
        for (const [reader, read] of READERS) {
          if (KEEPS_HALVES.has(reader)) continue;
          expect([reader.name, mapStrings(read(text, stop), wellFormed)]).toEqual([
            reader.name,
            read(wellFormed(text), stop.map(wellFormed)),
          ]);
        }
      }),
      RUNS,
    );
  }, 120_000);
});
