/**
 * Task 1.1 — addresses (docs/grading.md §11, §5.1; ledger_engineer rule 7). Table-driven over the nasty inputs:
 * unicode confusables (dotless ı, Cyrillic а/ѕ/е/о/у, Greek ο, mathematical bold 𝐩, fullwidth ｐ, the Kelvin, Ohm
 * and Angstrom signs, Turkish İ, combining marks, NFKC-only equivalents), RTL and zero-width marks, display-name
 * spoofing, plus tags and IDN `xn--` domains. Done-when: the dotless-i address is flagged confusable and never
 * equated with the ASCII one.
 */
import { describe, expect, it } from 'vitest';

import {
  type AddressComparison,
  asciiLower,
  counterparty,
  email,
  type EmailAddress,
  sameAddress,
} from '../../../src/core/normalize';

const DOTLESS_I = '\u0131';
const CYRILLIC_A = '\u0430';
const BOLD_P = '\u{1D429}';
const FULLWIDTH_P = '\uFF50';
const KELVIN = '\u212A';
const OHM = '\u2126';
const ANGSTROM = '\u212B';
const ZWSP = '\u200B';
const RLO = '\u202E';
const LRO = '\u202D';
const PDF = '\u202C';
const NBSP = '\u00A0';

function parsed(raw: string): EmailAddress {
  const address = email(raw);
  if (address === null) throw new Error(`fixture is not an address: ${raw}`);
  return address;
}

const ASCII_LOWER_ROWS: [string, string][] = [
  ['PRIYA@COMPANY.COM', 'priya@company.com'],
  ['a1B2-C3', 'a1b2-c3'],
  ['', ''],
  [`${KELVIN}elly`, `${KELVIN}elly`], // String#toLowerCase would give "kelly"
  ['\u0130stanbul', '\u0130stanbul'], // İ stays İ (toLowerCase gives i + combining dot)
  ['\u00C0\u00C9\u03A3', '\u00C0\u00C9\u03A3'], // À É Σ untouched
  ['\uFF21\uFF22', '\uFF21\uFF22'], // fullwidth Ａ Ｂ untouched
  [`${OHM}${ANGSTROM}`, `${OHM}${ANGSTROM}`], // Ohm and Angstrom signs untouched
  ['XN--PPLE-43D', 'xn--pple-43d'],
];

/** [raw, address, baseLocal, domain, plusTag, confusable]. */
type EmailRow = readonly [string, string, string, string, string | undefined, boolean];
const plain = (raw: string, local: string, domain: string, confusable: boolean): EmailRow => [
  raw,
  `${local}@${domain}`,
  local,
  domain,
  undefined,
  confusable,
];

const EMAIL_ROWS: readonly EmailRow[] = [
  plain('priya@company.com', 'priya', 'company.com', false),
  plain('  priya@company.com \t', 'priya', 'company.com', false),
  plain('"Priya" <priya@company.com>', 'priya', 'company.com', false),
  plain('Priya Shah <priya@company.com>', 'priya', 'company.com', false),
  plain('Shah, Priya <priya@company.com>', 'priya', 'company.com', false),
  plain('<priya@company.com>', 'priya', 'company.com', false),
  plain('"Pri>ya" <priya@company.com>', 'priya', 'company.com', false), // brackets inside quotes are text
  plain('"Pri\\"<ya" <priya@company.com>', 'priya', 'company.com', false), // escaped quote inside quotes
  // Display-name spoofing: the display name is attacker-controlled and dropped; the real address is kept.
  plain('"Priya" <attacker@evil.tld>', 'attacker', 'evil.tld', false),
  plain('"priya@company.com" <attacker@evil.tld>', 'attacker', 'evil.tld', false),
  plain('priya@company.com <attacker@evil.tld>', 'attacker', 'evil.tld', false),
  // Stored exactly as read: no lowercasing.
  plain('Priya@Company.COM', 'Priya', 'Company.COM', false),
  // Plus tags are reported, never erased.
  ['priya+x@company.com', 'priya+x@company.com', 'priya', 'company.com', 'x', false],
  ['priya+@company.com', 'priya+@company.com', 'priya', 'company.com', '', false],
  ['priya+a+b@company.com', 'priya+a+b@company.com', 'priya', 'company.com', 'a+b', false],
  // A leading + is part of the base: there is no base mailbox to tag.
  plain('+x@company.com', '+x', 'company.com', false),
  ['+x+y@company.com', '+x+y@company.com', '+x', 'company.com', 'y', false],
  // Confusables: flagged from the raw address, never NFKC-folded into "priya".
  plain(`pr${DOTLESS_I}ya@company.com`, `pr${DOTLESS_I}ya`, 'company.com', true),
  plain(`priy${CYRILLIC_A}@company.com`, `priy${CYRILLIC_A}`, 'company.com', true),
  plain(`${BOLD_P}riya@company.com`, `${BOLD_P}riya`, 'company.com', true),
  plain(`${FULLWIDTH_P}riya@company.com`, `${FULLWIDTH_P}riya`, 'company.com', true),
  plain(`${KELVIN}elly@company.com`, `${KELVIN}elly`, 'company.com', true),
  plain(`${OHM}mega@company.com`, `${OHM}mega`, 'company.com', true),
  plain(`${ANGSTROM}ngstrom@company.com`, `${ANGSTROM}ngstrom`, 'company.com', true),
  plain('pri\u03BFya@company.com', 'pri\u03BFya', 'company.com', true), // Greek omicron
  plain('\u0455ales@company.com', '\u0455ales', 'company.com', true), // Cyrillic dze ѕ
  plain('prie\u0301ya@company.com', 'prie\u0301ya', 'company.com', true), // combining acute stays separate
  plain('\uFB01ona@company.com', '\uFB01ona', 'company.com', true), // ﬁ ligature (NFKC would give "fiona")
  plain('priya\u00B2@company.com', 'priya\u00B2', 'company.com', true), // superscript ² (NFKC would give 2)
  plain(`pri${ZWSP}ya@company.com`, `pri${ZWSP}ya`, 'company.com', true),
  plain(`priya${RLO}@company.com`, `priya${RLO}`, 'company.com', true),
  // Non-ASCII or ACE domains: an xn-- label (any case, any position) is confusable even though it is ASCII.
  plain('priya@xn--pple-43d.com', 'priya', 'xn--pple-43d.com', true),
  plain('priya@XN--pple-43d.com', 'priya', 'XN--pple-43d.com', true),
  plain('priya@mail.xn--pple-43d.com', 'priya', 'mail.xn--pple-43d.com', true),
  plain('priya@c\u00F6mpany.com', 'priya', 'c\u00F6mpany.com', true),
  plain('priya@compan\u0443.com', 'priya', 'compan\u0443.com', true), // Cyrillic у
  plain('priya@\u0130stanbul.com', 'priya', '\u0130stanbul.com', true), // Turkish İ
  plain('priya@company.c\u03BFm', 'priya', 'company.c\u03BFm', true), // Greek omicron in the TLD
  plain('priya@axn--b.com', 'priya', 'axn--b.com', false),
  plain('xn--priya@company.com', 'xn--priya', 'company.com', false), // xn-- matters in domain labels only
];

const NOT_ADDRESSES: string[] = [
  '',
  'priya',
  'priya@',
  '@company.com',
  'priya@company',
  'priya@@company.com',
  'a@b@company.com',
  'priya @company.com',
  `priya${NBSP}@company.com`,
  'pri\u0000ya@company.com',
  'priya.@company.com',
  '.priya@company.com',
  'pri..ya@company.com',
  'priya@company..com',
  'priya@company.com.',
  '"quoted"@company.com',
  'priya@[192.168.0.1]',
  'Priya <priya@company.com',
  'Priya <priya@company.com> trailing',
  'priya@company.com, raj@company.com',
  'priya\uFF20company.com', // fullwidth ＠ is not @
  'mailto:priya@company.com',
  'priya@company.com (Priya)',
  '<>',
  // Several angle addresses, or one nested in another: which one is meant would be a guess.
  '<priya@company.com>, <raj@company.com>',
  '<priya@company.com> <attacker@evil.tld>',
  '"Priya" <attacker@evil.tld<priya@company.com>',
  'Priya <<priya@company.com>>',
  '"Unterminated <attacker@evil.tld> <priya@company.com>',
];

describe('asciiLower: A\u2013Z only, by table', () => {
  it.each(ASCII_LOWER_ROWS)('%j \u2192 %j', (input, expected) => {
    expect(asciiLower(input)).toBe(expected);
  });
});

describe('email(): extraction and flags', () => {
  it.each(EMAIL_ROWS)('%j', (raw, address, baseLocal, domain, plusTag, confusable) => {
    const result = parsed(raw);
    expect(result.address).toBe(address);
    expect(result.baseLocal).toBe(baseLocal);
    expect(result.domain).toBe(domain);
    expect(result.local).toBe(address.slice(0, address.lastIndexOf('@')));
    expect(result.plusTag).toBe(plusTag);
    expect('plusTag' in result).toBe(plusTag !== undefined);
    expect(result.confusable).toBe(confusable);
  });

  it.each(NOT_ADDRESSES)('%j is not an address', (raw) => {
    expect(email(raw)).toBeNull();
  });
});

const NONE: AddressComparison = {
  exact: false,
  plusTagOnly: false,
  confusablePair: false,
  nonAscii: false,
  sameDomain: false,
};
const EXACT: AddressComparison = { ...NONE, exact: true, sameDomain: true };
const PLUS_TAG: AddressComparison = { ...NONE, plusTagOnly: true, sameDomain: true };
const CONFUSABLE: AddressComparison = { ...NONE, confusablePair: true, sameDomain: true };
const CONFUSABLE_DOMAIN: AddressComparison = { ...NONE, confusablePair: true };

const COMPARISON_ROWS: [string, string, AddressComparison][] = [
  ['priya@company.com', 'priya@company.com', EXACT],
  ['Priya@Company.COM', 'priya@company.com', EXACT],
  ['"Priya" <priya@company.com>', 'priya@company.com', EXACT],
  ['priya+x@company.com', 'priya@company.com', PLUS_TAG],
  ['priya+x@company.com', 'priya+y@company.com', PLUS_TAG],
  ['PRIYA+x@company.com', 'priya@COMPANY.com', PLUS_TAG],
  ['Priya+X@company.com', 'priya+x@company.com', EXACT],
  ['+x@company.com', '+y@company.com', { ...NONE, sameDomain: true }], // no base mailbox: not a +tag pair
  // Done-when: the dotless-i address is flagged, not equated.
  [`pr${DOTLESS_I}ya@company.com`, 'priya@company.com', CONFUSABLE],
  [`priy${CYRILLIC_A}@company.com`, 'priya@company.com', CONFUSABLE],
  ['p\u0435ter@company.com', 'peter@company.com', CONFUSABLE], // Cyrillic е
  ['j\u043Ehn@company.com', 'john@company.com', CONFUSABLE], // Cyrillic о
  ['\u0455ales@company.com', 'sales@company.com', CONFUSABLE], // Cyrillic ѕ
  ['pri\u03BFya@company.com', 'prioya@company.com', CONFUSABLE], // Greek ο
  [`${BOLD_P}riya@company.com`, 'priya@company.com', CONFUSABLE],
  ['\u{1D699}riya@company.com', 'priya@company.com', CONFUSABLE], // mathematical monospace 𝚙
  [`${FULLWIDTH_P}riya@company.com`, 'priya@company.com', CONFUSABLE],
  [`${KELVIN}elly@company.com`, 'kelly@company.com', CONFUSABLE],
  [`${KELVIN}elly@company.com`, 'Kelly@company.com', CONFUSABLE],
  ['\u0130lker@company.com', 'ilker@company.com', CONFUSABLE],
  ['\u00C9mile@company.com', '\u00E9mile@company.com', CONFUSABLE], // no Unicode case folding
  [`pri${ZWSP}ya@company.com`, 'priya@company.com', CONFUSABLE],
  ['\uFB01ona@company.com', 'fiona@company.com', CONFUSABLE], // NFKC-only equivalent
  ['priya\u00B2@company.com', 'priya2@company.com', CONFUSABLE], // NFKC-only equivalent
  // NFC would equate these pairs: canonical equivalents are still different addresses.
  ['prie\u0301ya@company.com', 'pri\u00E9ya@company.com', CONFUSABLE],
  [`${OHM}mega@company.com`, '\u03A9mega@company.com', CONFUSABLE],
  [`${ANGSTROM}ngstrom@company.com`, '\u00C5ngstrom@company.com', CONFUSABLE],
  [`pr${DOTLESS_I}ya+x@company.com`, `pr${DOTLESS_I}ya@company.com`, { ...CONFUSABLE, plusTagOnly: true }],
  // Confusable domains never share a domain with the ASCII look-alike.
  ['priya@compan\u0443.com', 'priya@company.com', CONFUSABLE_DOMAIN],
  ['priya@\u0130stanbul.com', 'priya@istanbul.com', CONFUSABLE_DOMAIN],
  [`kelly@${KELVIN}ompany.com`, 'kelly@kompany.com', CONFUSABLE_DOMAIN],
  ['priya@company.com', 'priya@company.c\u03BFm', CONFUSABLE_DOMAIN],
  ['priya@xn--pple-43d.com', 'priya@apple.com', CONFUSABLE_DOMAIN],
  // Identical non-ASCII addresses are equal (cp.non_ascii); identical ACE addresses are equal and ASCII.
  [`pr${DOTLESS_I}ya@company.com`, `pr${DOTLESS_I}ya@company.com`, { ...EXACT, nonAscii: true }],
  [`${OHM}@company.com`, `${OHM}@company.com`, { ...EXACT, nonAscii: true }],
  ['priya@xn--pple-43d.com', 'priya@XN--PPLE-43D.com', EXACT],
  ['raj@company.com', 'priya@company.com', { ...NONE, sameDomain: true }],
  ['priya@company.com', 'priya@company.co', NONE],
  ['priya@company.com', 'priya@sub.company.com', NONE],
];

describe('sameAddress(): the \u00A75.1 comparison', () => {
  it.each(COMPARISON_ROWS)('%j vs %j', (a, b, expected) => {
    expect(sameAddress(parsed(a), parsed(b))).toEqual(expected);
    expect(sameAddress(parsed(b), parsed(a))).toEqual(expected);
  });
});

const COUNTERPARTY_ROWS: [string, object][] = [
  ['priya@company.com', { kind: 'address', address: 'priya@company.com' }],
  ['"Priya" <attacker@evil.tld>', { kind: 'address', address: 'attacker@evil.tld' }],
  [`priya@company.com${RLO}`, { kind: 'address', confusable: true }], // an override in an address: confusable
  ['Priya', { kind: 'name', tokens: ['priya'] }],
  ['Priya Shah', { kind: 'name', tokens: ['priya', 'shah'] }],
  [`\u200FPri${ZWSP}y\u00E1\u200E`, { kind: 'name', tokens: ['priya'] }], // RLM/LRM and ZWSP are stripped
  ['\u2067Priya\u2069', { kind: 'name', tokens: ['priya'] }], // an isolate does not reorder letters
  [ZWSP, { kind: 'name', tokens: [] }],
  ['!!!', { kind: 'name', tokens: [] }],
];

const NO_COUNTERPARTY: (string | undefined)[] = [
  undefined,
  '',
  '   ',
  'priya@',
  'Priya <bad>',
  'priya\uFF20company.com',
  'a@b',
  '<priya@company.com>, <raj@company.com>',
  // A bidi override shows one name and stores another ("ayirp" displays as "priya"): not read.
  `${RLO}ayirp${PDF}`,
  `${LRO}Priya${PDF}`,
  `${RLO}Pri${ZWSP}y\u00E1`,
];

describe('counterparty(): address, name, or nothing', () => {
  it.each(COUNTERPARTY_ROWS)('%j', (raw, expected) => {
    expect(counterparty(raw)).toMatchObject(expected);
  });

  it.each(NO_COUNTERPARTY)(
    '%j has no counterparty (empty, a broken address, or a name displayed out of order)',
    (raw) => {
      expect(counterparty(raw)).toBeNull();
    },
  );
});
