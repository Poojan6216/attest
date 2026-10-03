/**
 * Amounts: text → integer minor units + ISO 4217 currency (docs/grading.md §11). Pure.
 *
 * Integer arithmetic only (BigInt), never `parseFloat`: "$0.29" is exactly 29 cents. The minor-unit exponent
 * per currency comes from `CURRENCY_MINOR_UNITS` (units.ts). Anything ambiguous or malformed returns null rather
 * than a guess (Hard Rule 5): an unknown currency, a bare `$` with no caller default, a negative or signed amount,
 * a separator that could be read two ways ("KWD 1.234": 1.234 or 1234?), more decimals than the currency has,
 * or text that reads differently from how it displays (a bidi override: "\u202E01$" shows as "$10"; a
 * superscript digit: "$9⁹⁹" is not "$999").
 *
 * Decimal or grouping? With `.` and `,` both present, the last one is the decimal separator. A space or an
 * apostrophe only ever groups. A lone `.` or `,` is a decimal separator if it is followed by 1..exponent digits,
 * a grouping separator if it splits a well-formed group of three; if both readings fit, the input is rejected.
 * Grouped integers are Western (1,234,567) or Indian (12,34,567) and never start with 0.
 */
import { asciiLower, readsDifferently, stripInvisible } from './normalize-text';
import { asBaseline, BASELINE_CLASS, trimBaseline } from './unicode-baseline';
import { CURRENCY_MINOR_UNITS, DECIMAL_RADIX } from './units';

export type CurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export interface Money {
  /** Integer minor units (cents for USD, yen for JPY, fils for KWD); never negative. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export interface AmountOptions {
  /** What a bare `$` means for this caller. Absent: a bare `$` is ambiguous and the amount is rejected. */
  readonly defaultDollar?: CurrencyCode;
}

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCY_MINOR_UNITS, code);
}

const BARE_DOLLAR = '$';

/** Currencies written with a `$`, so "$10 USD" means USD whatever the caller's default dollar is. */
const DOLLAR_SIGN_CURRENCIES: ReadonlySet<CurrencyCode> = new Set([
  'USD',
  'CAD',
  'AUD',
  'NZD',
  'MXN',
  'HKD',
  'SGD',
]);

/**
 * Unambiguous symbols, keyed by `asciiLower`. `¥` is read as JPY (Decisions: CNY is written `CN¥` or `CNY`).
 * Deliberately absent because they name several currencies: `C$` (CAD, NIO), `kr` (SEK, NOK, DKK, ISK).
 */
const SYMBOLS: readonly (readonly [string, CurrencyCode])[] = [
  ['us$', 'USD'],
  ['ca$', 'CAD'],
  ['a$', 'AUD'],
  ['au$', 'AUD'],
  ['nz$', 'NZD'],
  ['mx$', 'MXN'],
  ['r$', 'BRL'],
  ['hk$', 'HKD'],
  ['s$', 'SGD'],
  ['sg$', 'SGD'],
  ['\u20AC', 'EUR'], // €
  ['\u00A3', 'GBP'], // £
  ['\u00A5', 'JPY'], // ¥
  ['cn\u00A5', 'CNY'], // CN¥
  ['\u20B9', 'INR'], // ₹
  ['\u20A9', 'KRW'], // ₩
];

/** Every symbol and every ISO code in the unit table (any ASCII case), keyed by `asciiLower`. */
const CURRENCY_BY_TOKEN: ReadonlyMap<string, CurrencyCode> = new Map([
  ...Object.keys(CURRENCY_MINOR_UNITS)
    .filter(isCurrencyCode)
    .map((code): [string, CurrencyCode] => [asciiLower(code), code]),
  ...SYMBOLS,
]);

/** Whitespace as Unicode 15.0 defines it (JS `\s`). */
const SPACE = BASELINE_CLASS.space;
/**
 * Prefix token, number, suffix token. The number starts and ends with a digit and may hold `.`, `,`, spaces and
 * apostrophes (' and U+2019); tokens hold no digit, space or separator.
 */
const AMOUNT_SHAPE = new RegExp(
  `^(?<prefix>[^\\d${SPACE}.,'\\u2019]*)[${SPACE}]*(?<number>\\d(?:[\\d.,' \\u2019]*\\d)?)[${SPACE}]*(?<suffix>[^\\d${SPACE}.,'\\u2019]*)$`,
  'u',
);
const DIGIT = /\d/g;
const DIGITS = /^\d+$/;
const DECIMAL_SEPARATORS: ReadonlySet<string> = new Set(['.', ',']);
const WESTERN_FIRST_GROUP = /^[1-9]\d{0,2}$/;
const WESTERN_GROUP = /^\d{3}$/;
const INDIAN_FIRST_GROUP = /^[1-9]\d?$/;
const INDIAN_GROUP = /^\d{2}$/;

/** A currency token: '' when absent, '$' for a bare dollar sign, null when unknown. */
function currencyToken(token: string): CurrencyCode | typeof BARE_DOLLAR | '' | null {
  if (token === '' || token === BARE_DOLLAR) return token;
  return CURRENCY_BY_TOKEN.get(asciiLower(token)) ?? null;
}

function resolveCurrency(prefix: string, suffix: string, options: AmountOptions): CurrencyCode | null {
  const before = currencyToken(prefix);
  const after = currencyToken(suffix);
  if (before === null || after === null) return null;
  if (before === BARE_DOLLAR && after !== '' && after !== BARE_DOLLAR && DOLLAR_SIGN_CURRENCIES.has(after)) {
    return after;
  }
  const first = before === BARE_DOLLAR ? (options.defaultDollar ?? null) : before;
  const second = after === BARE_DOLLAR ? (options.defaultDollar ?? null) : after;
  if (first === null || second === null) return null;
  if (first === '') return second === '' ? null : second;
  if (second === '') return first;
  return first === second ? first : null;
}

/** `text` is a grouped integer with separator `separator`, Western or Indian style; never a leading 0. */
function isGrouped(text: string, separator: string): boolean {
  const [head = '', ...tail] = text.split(separator);
  if (tail.length === 0) return false;
  const western = WESTERN_FIRST_GROUP.test(head) && tail.every((group) => WESTERN_GROUP.test(group));
  const last = tail[tail.length - 1] ?? '';
  const middle = tail.slice(0, -1);
  const indian =
    INDIAN_FIRST_GROUP.test(head) &&
    WESTERN_GROUP.test(last) &&
    middle.every((group) => INDIAN_GROUP.test(group));
  return western || indian;
}

function isFraction(text: string, exponent: number): boolean {
  return DIGITS.test(text) && text.length <= exponent;
}

interface DecimalParts {
  readonly integer: string;
  readonly fraction: string;
}

/** One `.` or `,` and nothing else: decimal, grouping, or (when both fit) ambiguous. */
function splitLoneSeparator(text: string, separator: string, exponent: number): DecimalParts | null {
  const at = text.indexOf(separator);
  const integer = text.slice(0, at);
  const fraction = text.slice(at + 1);
  const asDecimal = isFraction(fraction, exponent);
  const asGroup = isGrouped(text, separator);
  if (asDecimal === asGroup) return null;
  return asDecimal ? { integer, fraction } : { integer: integer + fraction, fraction: '' };
}

/** Two kinds of separator: the last one in the text is the decimal separator (once), the other groups. */
function splitMixed(text: string, separators: string, exponent: number): DecimalParts | null {
  const decimal = separators.slice(-1);
  const groups = [...new Set(separators)].filter((separator) => separator !== decimal);
  const [group] = groups;
  const at = text.lastIndexOf(decimal);
  if (group === undefined || groups.length > 1 || !DECIMAL_SEPARATORS.has(decimal)) return null;
  if (text.indexOf(decimal) !== at) return null;
  const integer = text.slice(0, at);
  const fraction = text.slice(at + 1);
  if (!isGrouped(integer, group) || !isFraction(fraction, exponent)) return null;
  return { integer: integer.split(group).join(''), fraction };
}

function splitNumber(text: string, exponent: number): DecimalParts | null {
  const separators = text.replace(DIGIT, '');
  const kinds = new Set(separators);
  const [only] = kinds;
  if (only === undefined) return { integer: text, fraction: '' };
  if (kinds.size > 1) return splitMixed(text, separators, exponent);
  if (DECIMAL_SEPARATORS.has(only) && separators.length === 1)
    return splitLoneSeparator(text, only, exponent);
  return isGrouped(text, only) ? { integer: text.split(only).join(''), fraction: '' } : null;
}

function minorUnits(text: string, exponent: number): number | null {
  const parts = splitNumber(text, exponent);
  if (parts === null) return null;
  const scale = BigInt(DECIMAL_RADIX) ** BigInt(exponent);
  const minor = BigInt(parts.integer) * scale + BigInt(parts.fraction.padEnd(exponent, '0') || '0');
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

/**
 * "$1,234.50", "CA$10", "US$5", "€9,99", "9,99 €", "£3.20", "¥980", "USD 10.00", "10 EUR", "1.234,50 €",
 * "1 234,50 €", "CHF 1'234.50", "₹1,23,456.00" → `{ minor, currency }`; anything else → null. Invisible marks
 * are dropped and the text is NFKC-folded first (fullwidth ￥９８０ is ¥980), as Unicode 15.0 folds it: a newer
 * character, such as an outlined digit (U+1CCF0–U+1CCF9, Unicode 16.0), is not a digit (unicode-baseline.ts).
 */
export function amount(raw: string, options: AmountOptions = {}): Money | null {
  if (readsDifferently(raw)) return null;
  const text = trimBaseline(stripInvisible(asBaseline(raw).normalize('NFKC')));
  const groups = AMOUNT_SHAPE.exec(text)?.groups;
  if (groups === undefined) return null;
  const currency = resolveCurrency(groups.prefix ?? '', groups.suffix ?? '', options);
  if (currency === null) return null;
  const minor = minorUnits(groups.number ?? '', CURRENCY_MINOR_UNITS[currency]);
  return minor === null ? null : { minor, currency };
}
