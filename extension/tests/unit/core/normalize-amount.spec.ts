/**
 * Task 1.1 — amounts (docs/grading.md §11). Integer minor units only; ambiguous or malformed text is rejected,
 * never guessed (Hard Rule 5). Done-when: amounts round-trip exactly.
 */
import { describe, expect, it } from 'vitest';

import { amount, type AmountOptions, type CurrencyCode, isCurrencyCode } from '../../../src/core/normalize';
import { CURRENCY_MINOR_UNITS } from '../../../src/core/units';

const USD = { defaultDollar: 'USD' } as const;

const ACCEPTED: [string, number, CurrencyCode][] = [
  ['$1,234.50', 123_450, 'USD'],
  ['CA$10', 1_000, 'CAD'],
  ['US$5', 500, 'USD'],
  ['\u20AC9,99', 999, 'EUR'],
  ['9,99 \u20AC', 999, 'EUR'],
  ['\u00A33.20', 320, 'GBP'],
  ['\u00A5980', 980, 'JPY'],
  ['USD 10.00', 1_000, 'USD'],
  ['10 EUR', 1_000, 'EUR'],
  ['1.234,50 \u20AC', 123_450, 'EUR'],
  ['$0.29', 29, 'USD'], // 0.29 * 100 is 28.999999999999996 in floating point
  ['$0.07', 7, 'USD'],
  ['$1,234,567.89', 123_456_789, 'USD'],
  ['$1.5', 150, 'USD'],
  ['$1,5', 150, 'USD'],
  ['$1.234', 123_400, 'USD'], // three digits cannot be USD cents: grouping
  ['\u20AC1.234', 123_400, 'EUR'],
  ['$ 10', 1_000, 'USD'],
  ['USD10', 1_000, 'USD'],
  ['usd 10', 1_000, 'USD'],
  ['10\u20AC', 1_000, 'EUR'],
  ['1 234,50 \u20AC', 123_450, 'EUR'],
  ['1\u00A0234,50\u00A0\u20AC', 123_450, 'EUR'], // NBSP grouping (fr-FR)
  ['1\u202F234,50 \u20AC', 123_450, 'EUR'], // narrow NBSP grouping
  ["CHF 1'234.50", 123_450, 'CHF'],
  ['CHF 1\u2019234.50', 123_450, 'CHF'],
  ['$1 234.5', 123_450, 'USD'],
  ['\u20B91,23,456.00', 12_345_600, 'INR'], // Indian grouping
  ['R$ 1.234,56', 123_456, 'BRL'],
  ['CN\u00A5 12.50', 1_250, 'CNY'],
  ['\u00A51,234', 1_234, 'JPY'],
  ['\uFFE5\uFF19\uFF18\uFF10', 980, 'JPY'], // fullwidth ￥９８０
  ['\u20A915,000', 15_000, 'KRW'],
  ['KWD 0.250', 250, 'KWD'],
  ['KWD 1,234.567', 1_234_567, 'KWD'],
  ['BHD 0.5', 500, 'BHD'],
  ['\u200E$10.00\u200F', 1_000, 'USD'], // bidi marks around an amount are dropped
  ['$10 USD', 1_000, 'USD'],
  ['$9,007,199,254,740.99', 900_719_925_474_099, 'USD'],
  // Math.round(parseFloat('90071992547093.15') * 100) is 9007199254709316: only integer arithmetic is exact.
  ['$90,071,992,547,093.15', 9_007_199_254_709_315, 'USD'],
  ['$90,071,992,547,409.91', Number.MAX_SAFE_INTEGER, 'USD'],
  ['KWD 1 234.500', 1_234_500, 'KWD'], // a space only groups, so the '.' is the decimal point
  ['0.999 KWD', 999, 'KWD'],
  ['\uFF25\uFF35\uFF32 10', 1_000, 'EUR'], // fullwidth ＥＵＲ
  ['\u2066$10\u2069', 1_000, 'USD'], // an isolate does not reorder digits: stripped
  ['$1\u200B000', 100_000, 'USD'], // a zero-width space inside the number: what the user sees is $1000
];

const REJECTED: [string, AmountOptions][] = [
  ['$10', {}], // bare $ with no default
  ['$10 EUR', USD], // a dollar sign and a non-dollar currency disagree
  ['\u20AC10 USD', USD],
  ['10', USD], // no currency
  ['1,234.50', USD],
  ['', USD],
  ['$', USD],
  ['-$10', USD],
  ['$-10', USD],
  ['($10.00)', USD],
  ['XYZ 10', USD],
  ['kr 10', USD], // kr is SEK, NOK, DKK or ISK
  ['C$10', USD], // CAD or NIO
  ['$1,234.567', USD], // three decimals for a two-decimal currency
  ['\u00A5980.5', USD], // JPY has no minor unit
  ['KWD 1.234', USD], // 1.234 or 1234: both readings fit
  ['KWD 5.250', USD],
  ['$1.2.3', USD],
  ['$1,,234', USD],
  ['$0,123,456', USD], // a grouped number never starts with 0
  // Negative or signed, in any dash.
  ['\u221210 \u20AC', USD], // U+2212 minus sign
  ['\u2012$10', USD], // figure dash
  ['$10-', USD],
  ['10 \u20AC-', USD],
  ['+$10', USD],
  // Two currencies that disagree.
  ['USD 1,000 CAD', USD],
  ['\u00A510 CNY', USD], // ¥ is read as JPY
  ['\u00A310 EUR', USD],
  ['US $10', USD],
  // Three-decimal currencies: a lone separator before three digits reads both ways.
  ['KWD 1,500', USD],
  ['BHD 12.345', USD],
  ['KWD 1.2345', USD],
  ['1,5 \u00A5', USD],
  // Text that displays differently from how it is stored or folded.
  ['\u202E01$\u202C', USD], // RLO: shows as "$10", stored as "01$"
  ['\u202D$10\u202C', USD], // LRO
  ['$9\u2079\u2079', USD], // superscript cents: $9.99 shown, NFKC gives "$999"
  ['$10\u00B2', USD], // NFKC gives "$102"
  ['$\u2460\u2461', USD], // circled ①②
  ['U\u0405D 10', USD], // Cyrillic Ѕ in "USD"
  ['$90,071,992,547,409.92', USD], // one past Number.MAX_SAFE_INTEGER minor units
];

const MALFORMED: [string][] = [
  ['$.50'],
  ['$10.'],
  ['$1 23'],
  ['12 34 \u20AC'],
  ['$1,234.5,6'],
  ['$9,999,999,999,999,999.99'], // beyond Number.MAX_SAFE_INTEGER minor units
  ['USD 10 USD 10'],
  ['$10\u00A0000\u00A0000.5\u20AC'],
  ['ten dollars'],
  ['$1e3'],
  ['$0x10'],
  ['$\u0661\u0660'], // Arabic-Indic digits are not read
];

describe('amount(): accepted forms', () => {
  it.each(ACCEPTED)('%j \u2192 %d %s', (raw, minor, currency) => {
    expect(amount(raw, USD)).toEqual({ minor, currency });
  });

  it('a bare $ is the caller-supplied default dollar, unless a dollar currency code says otherwise', () => {
    expect(amount('$10', { defaultDollar: 'CAD' })).toEqual({ minor: 1_000, currency: 'CAD' });
    expect(amount('$10 USD', { defaultDollar: 'CAD' })).toEqual({ minor: 1_000, currency: 'USD' });
    expect(amount('CA$10', USD)).toEqual({ minor: 1_000, currency: 'CAD' });
  });
});

describe('amount(): rejected rather than guessed', () => {
  it.each(REJECTED)('%j is rejected', (raw, options) => {
    expect(amount(raw, options)).toBeNull();
  });

  it.each(MALFORMED)('%j is malformed', (raw) => {
    expect(amount(raw, USD)).toBeNull();
  });
});

/** Writes `minor` of `currency` the way a receipt would, in one of several locale styles. */
function format(minor: number, currency: CurrencyCode, style: 'en' | 'de' | 'fr' | 'ch'): string {
  const exponent = CURRENCY_MINOR_UNITS[currency];
  const scale = 10n ** BigInt(exponent);
  const major = (BigInt(minor) / scale).toString();
  const fraction = (BigInt(minor) % scale).toString().padStart(exponent, '0');
  const separators = { en: [',', '.'], de: ['.', ','], fr: [' ', ','], ch: ["'", '.'] }[style];
  const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, separators[0] ?? '');
  const number = exponent === 0 ? grouped : `${grouped}${separators[1] ?? ''}${fraction}`;
  return style === 'en' ? `${currency} ${number}` : `${number} ${currency}`;
}

describe('CURRENCY_MINOR_UNITS (units.ts)', () => {
  it('holds the ISO 4217 exponents amount() relies on, and nothing reads an unlisted code', () => {
    expect(CURRENCY_MINOR_UNITS).toEqual({
      USD: 2,
      CAD: 2,
      AUD: 2,
      NZD: 2,
      EUR: 2,
      GBP: 2,
      INR: 2,
      CHF: 2,
      SEK: 2,
      NOK: 2,
      DKK: 2,
      MXN: 2,
      BRL: 2,
      CNY: 2,
      HKD: 2,
      SGD: 2,
      JPY: 0,
      KRW: 0,
      KWD: 3,
      BHD: 3,
    });
    expect(Object.isFrozen(CURRENCY_MINOR_UNITS)).toBe(true);
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('toString')).toBe(false);
    expect(amount('SEK 12,50')).toEqual({ minor: 1_250, currency: 'SEK' });
  });
});

describe('amount(): exact round trip', () => {
  const minors = [0, 1, 5, 29, 99, 100, 101, 999, 1_000, 123_450, 1_000_000, 987_654_321, 1_000_000_000_000];
  const currencies: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'KRW'];
  const styles = ['en', 'de', 'fr', 'ch'] as const;
  const cases = minors.flatMap((minor) =>
    currencies.flatMap((currency) =>
      styles.map((style) => [format(minor, currency, style), minor, currency] as const),
    ),
  );

  it.each(cases)('%j', (text, minor, currency) => {
    expect(amount(text)).toEqual({ minor, currency });
  });

  it('three-decimal currencies round-trip whenever the text is unambiguous', () => {
    expect(amount(format(1_234_567, 'KWD', 'en'))).toEqual({ minor: 1_234_567, currency: 'KWD' });
    expect(amount(format(250, 'KWD', 'de'))).toEqual({ minor: 250, currency: 'KWD' });
    // "KWD 5.250" is 5.250 or 5250: documented as rejected.
    expect(format(5_250, 'KWD', 'en')).toBe('KWD 5.250');
    expect(amount(format(5_250, 'KWD', 'en'))).toBeNull();
  });
});
