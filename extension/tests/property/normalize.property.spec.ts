/**
 * Task 1.1 properties (fast-check, ≥ 1,000 runs each): amount() only ever returns exact, non-negative, safe
 * integers and round-trips; asciiLower changes A–Z and nothing else; addresses are never normalised; the
 * address comparison is symmetric and consistent; name() is idempotent; IDN decoding agrees with WHATWG.
 * v1.2 §11: subjects drop zero-width and bidi marks before splitting and keep combining marks inside tokens;
 * text that displays differently from how it is stored (a bidi override, a \p{No} digit NFKC changes) gives no
 * name tokens and no counterparty, and a subject with a bidi override gives no tokens.
 */
import { domainToASCII, domainToUnicode } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  amount,
  asciiLower,
  counterparty,
  email,
  type EmailAddress,
  isCurrencyCode,
  name,
  nameTokens,
  resolveRelative,
  sameAddress,
  subjectTokens,
  toUnicodeDomain,
} from '../../src/core/normalize';
import { CURRENCY_MINOR_UNITS } from '../../src/core/units';

const RUNS = { numRuns: 2_000 };
const CURRENCIES = Object.keys(CURRENCY_MINOR_UNITS).filter(isCurrencyCode);
const STOP_WORDS = ['a', 'an', 'the', 'and', 'or', 'of', 'to', 'for'];

/** Characters an amount parser has to make decisions about. */
const AMOUNT_ALPHABET = [
  ...Array.from('0123456789'),
  ...Array.from(".,' \u2019\u00A0\u202F-+()"),
  '$',
  '\u20AC',
  '\u00A3',
  '\u00A5',
  '\u20B9',
  '\u20A9',
  '\uFFE5',
  'US$',
  'CA$',
  'CN\u00A5',
  'USD',
  'EUR',
  'JPY',
  'KWD',
  'kr',
  'e',
  'x',
  '\u200E',
  '\u0661',
];
const amountish = fc
  .array(fc.constantFrom(...AMOUNT_ALPHABET), { maxLength: 16 })
  .map((parts) => parts.join(''));

function checkMoney(result: ReturnType<typeof amount>): void {
  if (result === null) return;
  expect(Number.isSafeInteger(result.minor)).toBe(true);
  expect(result.minor).toBeGreaterThanOrEqual(0);
  expect(Object.is(result.minor, -0)).toBe(false);
  expect(isCurrencyCode(result.currency)).toBe(true);
}

describe('amount() (property)', () => {
  it('never returns a non-integer, negative or unsafe amount, for any text', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: 'grapheme', maxLength: 24 }), amountish),
        fc.boolean(),
        (raw, dollar) => {
          checkMoney(amount(raw, dollar ? { defaultDollar: 'USD' } : {}));
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it('round-trips exactly through every locale style (a lone separator with three decimals is rejected)', () => {
    const style = fc.constantFrom(
      { group: ',', decimal: '.', codeFirst: true },
      { group: '.', decimal: ',', codeFirst: false },
      { group: ' ', decimal: ',', codeFirst: false },
      { group: "'", decimal: '.', codeFirst: true },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e12 }),
        fc.constantFrom(...CURRENCIES),
        style,
        (minor, currency, s) => {
          const exponent = CURRENCY_MINOR_UNITS[currency];
          const scale = 10n ** BigInt(exponent);
          const major = (BigInt(minor) / scale).toString();
          const fraction = (BigInt(minor) % scale).toString().padStart(exponent, '0');
          const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, s.group);
          const number = exponent === 0 ? grouped : `${grouped}${s.decimal}${fraction}`;
          const text = s.codeFirst ? `${currency} ${number}` : `${number} ${currency}`;
          const ambiguous = exponent === 3 && major.length <= 3 && major !== '0';
          expect(amount(text)).toEqual(ambiguous ? null : { minor, currency });
        },
      ),
      RUNS,
    );
  });
});

describe('text that reads differently from how it displays (property)', () => {
  /** Bidi overrides and a sample of \p{No} digits (superscripts, subscripts, circled, fractions). */
  const UNREADABLE = ['\u202D', '\u202E', '\u00B2', '\u2079', '\u2080', '\u2460', '\u00BD', '\u2155'];
  it('amount() and resolveRelative() never read text holding a bidi override or a \\p{No} digit', () => {
    const context = { referenceIso: '2026-10-01T15:00:00-04:00', offsetAt: () => -240 };
    const readable = fc.oneof(
      amountish,
      fc.constantFrom('$10', '\u20AC9,99', '2:03 PM', 'Yesterday', '5 min ago', 'Oct 1'),
    );
    fc.assert(
      fc.property(readable, fc.constantFrom(...UNREADABLE), fc.nat(), (text, mark, at) => {
        const position = at % (text.length + 1);
        const spoiled = `${text.slice(0, position)}${mark}${text.slice(position)}`;
        expect(amount(spoiled, { defaultDollar: 'USD' })).toBeNull();
        expect(resolveRelative(spoiled, context)).toBeNull();
      }),
      RUNS,
    );
  });
});

describe('asciiLower (property)', () => {
  it('changes exactly the code units A\u2013Z, each to its lowercase letter, and is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 64 }), (text) => {
        const lowered = asciiLower(text);
        expect(lowered.length).toBe(text.length);
        for (let i = 0; i < text.length; i += 1) {
          const unit = text.charCodeAt(i);
          const isUpper = unit >= 0x41 && unit <= 0x5a;
          expect(lowered.charCodeAt(i)).toBe(isUpper ? unit + 0x20 : unit);
        }
        expect(asciiLower(lowered)).toBe(lowered);
      }),
      RUNS,
    );
  });
});

const ADDRESS_PARTS = [
  ...Array.from('abcxyzABCKI019'),
  '.',
  '+',
  '-',
  '_',
  '@',
  '@',
  '<',
  '>',
  '"',
  ' ',
  'xn--',
  'XN--',
  '\u0131',
  '\u0430',
  '\u{1D429}',
  '\uFF50',
  '\u212A',
  '\u0130',
  '\u200B',
  '\u202E',
  '\u00E9',
  'e\u0301',
];
const addressish = fc
  .array(fc.constantFrom(...ADDRESS_PARTS), { minLength: 3, maxLength: 20 })
  .map((parts) => parts.join(''));
const NON_ASCII = /\P{ASCII}/u;

describe('email() and sameAddress() (property)', () => {
  it('keeps the address exactly as read and flags confusables from the raw form', () => {
    fc.assert(
      fc.property(addressish, (raw) => {
        const parsed = email(raw);
        if (parsed === null) return;
        expect(raw).toContain(parsed.address);
        expect(parsed.address).toBe(`${parsed.local}@${parsed.domain}`);
        expect(parsed.local).toBe(
          parsed.plusTag === undefined ? parsed.baseLocal : `${parsed.baseLocal}+${parsed.plusTag}`,
        );
        const ace = parsed.domain.split('.').some((label) => /^xn--/i.test(label));
        expect(parsed.confusable).toBe(NON_ASCII.test(parsed.address) || ace);
        expect(email(parsed.address)).toEqual(parsed);
      }),
      { numRuns: 5_000 },
    );
  });

  it('is symmetric and internally consistent', () => {
    // Small alphabets so that exact, plus-tag-only, same-domain and confusable pairs all occur often.
    const local = fc
      .array(fc.constantFrom('p', 'P', 'r', '\u0131', '\u212A', '+', 'x'), { minLength: 1, maxLength: 4 })
      .map((parts) => parts.join(''));
    const domain = fc.constantFrom('c.com', 'C.COM', 'xn--p.com', 'c\u00F6.com', 'd.org');
    const address = fc.tuple(local, domain).map(([l, d]): EmailAddress | null => email(`${l}@${d}`));
    fc.assert(
      fc.property(address, address, (a, b) => {
        if (a === null || b === null) return;
        const forward = sameAddress(a, b);
        expect(sameAddress(b, a)).toEqual(forward);
        expect(forward.exact).toBe(asciiLower(a.address) === asciiLower(b.address));
        if (forward.exact)
          expect(forward).toMatchObject({ sameDomain: true, plusTagOnly: false, confusablePair: false });
        if (forward.plusTagOnly) expect(forward.sameDomain).toBe(true);
        if (forward.nonAscii) expect(forward.exact).toBe(true);
        expect(forward.confusablePair).toBe(!forward.exact && (a.confusable || b.confusable));
        expect(sameAddress(a, a)).toMatchObject({ exact: true, confusablePair: false });
      }),
      RUNS,
    );
  });
});

describe('name(), nameTokens(), subjectTokens() (property)', () => {
  const text = fc.string({ unit: 'grapheme', maxLength: 40 });
  it('name() is idempotent and leaves no invisible mark, ASCII capital or stray whitespace', () => {
    fc.assert(
      fc.property(text, (raw) => {
        const folded = name(raw);
        expect(name(folded)).toBe(folded);
        expect(folded).not.toMatch(/[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Mn}A-Z]/u);
        expect(folded).toBe(folded.trim());
        expect(folded).not.toMatch(/\s\s/u);
        expect(nameTokens(folded)).toEqual(nameTokens(raw));
      }),
      RUNS,
    );
  });

  it('subjectTokens() is a sorted set with no empty token or stop word, unchanged by a reply prefix', () => {
    fc.assert(
      fc.property(text, (raw) => {
        const tokens = subjectTokens(raw, STOP_WORDS);
        expect([...tokens].sort()).toEqual(tokens);
        expect(new Set(tokens).size).toBe(tokens.length);
        expect(tokens.filter((token) => token === '' || STOP_WORDS.includes(token))).toEqual([]);
        expect(subjectTokens(`Re: Fwd: ${raw}`, STOP_WORDS)).toEqual(subjectTokens(`Re: ${raw}`, STOP_WORDS));
      }),
      RUNS,
    );
  });
});

/** Any text, and `mark` inserted into `raw` at a position chosen by `at` (v1.2 \u00A711 properties below). */
const anyText = fc.string({ unit: 'grapheme', maxLength: 40 });
const insert = (raw: string, mark: string, at: number): string => {
  const position = at % (raw.length + 1);
  return `${raw.slice(0, position)}${mark}${raw.slice(position)}`;
};

describe('v1.2 \u00A711: subjects drop invisible marks and keep combining marks (property)', () => {
  /** Zero-width characters, bidi marks and isolates, the BOM, a soft hyphen, a variation selector. */
  const INVISIBLE = [
    '\u200B',
    '\u200C',
    '\u200D',
    '\u200E',
    '\u200F',
    '\u2066',
    '\u2069',
    '\uFEFF',
    '\u00AD',
    '\uFE0F',
  ];

  it('an invisible mark anywhere in a subject changes none of its tokens', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom(...INVISIBLE), fc.nat(), (raw, mark, at) => {
        expect(subjectTokens(insert(raw, mark, at), STOP_WORDS)).toEqual(subjectTokens(raw, STOP_WORDS));
      }),
      RUNS,
    );
  });

  it('subject tokens are runs of letters, digits and marks only, with no invisible character', () => {
    fc.assert(
      fc.property(anyText, (raw) => {
        for (const token of subjectTokens(raw, STOP_WORDS)) {
          expect(token).toMatch(/^[\p{L}\p{N}\p{M}]+$/u);
          expect(token).not.toMatch(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u);
        }
      }),
      RUNS,
    );
  });
});

describe('v1.2 \u00A711: text that reads differently from how it is stored gives no tokens (property)', () => {
  /** Bidi overrides, and \p{No} digits NFKC turns into other digits. */
  const OVERRIDES = ['\u202D', '\u202E'];
  const NFKC_DIGITS = ['\u00B2', '\u2079', '\u2080', '\u2460', '\u00BD', '\u2155', '\u3280'];

  it('a bidi override anywhere leaves a subject with no tokens, and a name with none either', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom(...OVERRIDES), fc.nat(), (raw, mark, at) => {
        const spoiled = insert(raw, mark, at);
        expect(subjectTokens(spoiled, STOP_WORDS)).toEqual([]);
        expect(nameTokens(spoiled)).toEqual([]);
        expect(name(spoiled)).toBe('');
      }),
      RUNS,
    );
  });

  it('a \\p{No} digit NFKC would change leaves a name with no tokens and no name counterparty', () => {
    fc.assert(
      fc.property(anyText, fc.constantFrom(...NFKC_DIGITS), fc.nat(), (raw, digit, at) => {
        const spoiled = insert(raw, digit, at);
        expect(nameTokens(spoiled)).toEqual([]);
        expect(counterparty(spoiled)?.kind).not.toBe('name');
      }),
      RUNS,
    );
  });
});

describe('toUnicodeDomain (property)', () => {
  const LETTERS = [
    ...Array.from('abcxyz09'),
    '\u00E9',
    '\u00FC',
    '\u00F1',
    '\u00F8',
    '\u0430',
    '\u0431',
    '\u044F',
    '\u03B1',
    '\u03C9',
    '\u4E2D',
    '\u6587',
    '\u65E5',
    '\uD55C',
    '\u0E01',
    '\u{1F600}',
  ];
  const label = fc
    .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 12 })
    .map((parts) => parts.join(''));
  it('decodes exactly what WHATWG domainToASCII encodes', () => {
    fc.assert(
      fc.property(label, label, (first, second) => {
        const ace = domainToASCII(`${first}.${second}.com`);
        fc.pre(ace !== '');
        expect(toUnicodeDomain(ace)).toBe(domainToUnicode(ace));
      }),
      { numRuns: 1_000 },
    );
  });
});
