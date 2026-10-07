/**
 * PII patterns and the scrubber for captured fixtures.
 *
 * One pass per string: every matcher proposes spans on the ORIGINAL text, overlaps are resolved
 * leftmost-longest, and the spans are replaced at once, so a fake is never re-scrubbed by a later pattern.
 * Any '@' left that does not start a fake domain becomes U+FF20 (＠), so a grep for '@' in a fixture finds
 * only example.com / example.org / example.net, and the receipt-sender domains the sanitiser keeps
 * (`keptDomains`: the receipt-parser registry, src/observers/gmail/receipts/selectors.json).
 */
import { inRegistry, RECEIPT_BRAND_TOKENS } from '../../src/observers/gmail/receipts/selectors';

import { BASE64_RUN, fakeBase64Run, fakePercentEmail, PERCENT_EMAIL } from './capture-encoded';
import { type Faker, matchCase } from './capture-fakes';
import { stripQueryParts } from './capture-url';
import { CARD, CARD_TAIL_DIGITS, isCardTail } from './capture-cards';

export type PiiKind = 'literal' | 'email' | 'address' | 'amount' | 'phone' | 'card' | 'name' | 'query';

/** Latin-script letters (accents included) and digits: `jöhn@exämple.de` is an address too. Needs the u flag. */
const EMAIL_CHAR = String.raw`\p{Script=Latin}\p{M}\d`;
const EMAIL_LABEL = String.raw`[\p{Script=Latin}\d](?:[${EMAIL_CHAR}\-]{0,61}[${EMAIL_CHAR}])?`;
export const EMAIL_SOURCE = String.raw`[${EMAIL_CHAR}._%+\-]+@${EMAIL_LABEL}(?:\.${EMAIL_LABEL})+`;
const EMAIL = new RegExp(EMAIL_SOURCE, 'gu');
/** An attribute value that IS an email address (optionally a mailto: link). */
export const EMAIL_VALUE = new RegExp(String.raw`^\s*(?:mailto:)?${EMAIL_SOURCE}\s*$`, 'iu');

const PHONE_INTL = String.raw`\+\d{1,3}(?:[ .\-]?\(?\d{1,5}\)?){1,6}`;
const PHONE_NATIONAL = String.raw`(?:\(\d{2,5}\)[ .\-]?|\d{2,5}[ .\-])\d{2,5}[ .\-]\d{2,5}`;
const PHONE = new RegExp(
  String.raw`(?<![\w+@.\-/])(?:${PHONE_INTL}|${PHONE_NATIONAL})(?![\w@]|[.\-/]\d)`,
  'g',
);

const CURRENCY = String.raw`(?:US\$|CA\$|C\$|A\$|AU\$|NZ\$|HK\$|S\$|R\$|\$|€|£|¥|₹|Rs\.?|₩|₽|₺|₪|₫|₱|฿|₦|₴|₡|USD|EUR|GBP|JPY|INR|CAD|AUD|NZD|CHF|CNY|HKD|SGD|SEK|NOK|DKK|PLN|CZK|HUF|MXN|BRL|ZAR|KRW|TRY|ILS|AED|SAR|THB|IDR|MYR|PHP|VND|RUB|UAH|NGN|KES|EGP|ARS|CLP|COP|PEN)`;
const AMOUNT = String.raw`\d{1,3}(?:[,.\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MONEY_PREFIX = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(-?)(${CURRENCY})(\s?-?)(${AMOUNT})(?!\d)`,
  'gu',
);
const MONEY_SUFFIX = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.,])(-?)(${AMOUNT})(\s?)(${CURRENCY})(?![\p{L}\p{N}_])`,
  'gu',
);

const STREET_SUFFIX = String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Square|Sq|Trail|Trl|Crescent|Close|Row|Alley|Plaza|Loop|Walk)`;
const STREET_WORD = String.raw`(?:\d{1,3}(?:st|nd|rd|th)|\p{Lu}[\p{L}'’\-]*\.?)`;
const ADDRESS = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(\d{1,6}[A-Za-z]?)\s+(?:${STREET_WORD}\s+){1,4}(${STREET_SUFFIX})\b\.?` +
    String.raw`((?:,?\s+(?:Apt|Apartment|Suite|Ste|Unit|Floor|Fl|#)\.?\s*#?[A-Za-z0-9\-]{1,6})?)` +
    String.raw`((?:,\s*\p{Lu}[\p{L}'’.\-]*(?:\s\p{Lu}[\p{L}'’.\-]*){0,3},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?)`,
  'gu',
);

const NAME_WORD = String.raw`\p{Lu}[\p{L}\p{M}'’\-]*\.?`;
/**
 * `Name <email>`, `"Last, First" <email>`, `Name (email)` (Gmail's "Google Account: Name (email)" label), the
 * bracket on the same or the next line: group 1/2 quoted name, group 3 bare name, group 4/5 the email.
 */
export const NAME_BEFORE_EMAIL = new RegExp(
  String.raw`(?:"([^"<>@\n]{1,80})"|'([^'<>@\n]{1,80})'|((?:${NAME_WORD}[ \t]+){0,3}${NAME_WORD}))\s*` +
    String.raw`(?:<[ \t]*(${EMAIL_SOURCE})[ \t]*>|\([ \t]*(${EMAIL_SOURCE})[ \t]*\))`,
  'gdu',
);
/** A value that looks like a display name: 1–4 capitalised words, or "Last, First". */
export const NAME_SHAPE = new RegExp(
  String.raw`^(?:${NAME_WORD}(?:[ \t]+${NAME_WORD}){0,3}|${NAME_WORD},[ \t]*${NAME_WORD})$`,
  'u',
);
/** A `name="…"` attribute next to an email: any 1–4 words of letters, any case. */
export const LOOSE_NAME_SHAPE = /^[\p{L}\p{M}'’.-]+(?:[ \t]+[\p{L}\p{M}'’.-]+){0,3}$/u;

const NAME_TOKEN = /[\p{L}\p{M}'’-]+/gu;
/** A name token and the digits glued after it (a handle such as `name0403`): `fakeName` fakes both. */
const NAME_WITH_DIGITS = /[\p{L}\p{M}'’-]+\d*/gu;
const FAKE_AT = /@example\.(?:com|org|net)(?![A-Za-z0-9-]|\.[A-Za-z0-9])/y;
const FULLWIDTH_AT = '\uFF20';

/** Words that appear next to addresses but are not names; never learned automatically. */
const NAME_STOPWORDS = new Set(
  [
    'me to from cc bcc re fw fwd reply sent dear hi hello hey the and or of via on behalf team support',
    'info noreply no-reply admin mr mrs ms mx dr prof jr sr inc llc ltd co corp mail email you your',
    'unknown sender notifications updates billing accounts service customer account contact help us our',
    'at',
  ]
    .join(' ')
    .split(' '),
);

/** Splits a display name into tokens of 2+ letters; drops stopwords unless `keepStopwords`. */
export function nameTokens(name: string, keepStopwords = false): string[] {
  const tokens = name.match(NAME_TOKEN) ?? [];
  return tokens
    .map((token) => token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((token) => token.length >= 2 && (keepStopwords || !NAME_STOPWORDS.has(token.toLowerCase())));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `@` + one of `domains` or a subdomain of one (ASCII, any case), ending where a domain ends. Sticky. */
function keptAtPattern(domains: readonly string[]): RegExp | null {
  if (domains.length === 0) return null;
  const alternatives = domains.map(escapeRegExp).join('|');
  return new RegExp(String.raw`@(?:[A-Za-z0-9-]+\.)*(?:${alternatives})(?![A-Za-z0-9-]|\.[A-Za-z0-9])`, 'iy');
}

/**
 * Offsets of every '@' in `text` that does not start a fake domain, or (`keptDomains`) a receipt-sender domain the
 * sanitiser keeps (a domain of the receipt-parser registry or a subdomain of it). Empty for a clean fixture.
 */
export function findForeignAts(text: string, keptDomains: readonly string[] = []): number[] {
  const kept = keptAtPattern(keptDomains);
  const offsets: number[] = [];
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    FAKE_AT.lastIndex = at;
    if (FAKE_AT.test(text)) continue;
    if (kept !== null) {
      kept.lastIndex = at;
      if (kept.test(text)) continue;
    }
    offsets.push(at);
  }
  return offsets;
}

/**
 * True when `address` is plain ASCII and its domain is one of `domains` or a subdomain of one: a receipt sender
 * whose domain the sanitiser keeps so a real receipt capture stays parseable (its local part is still faked: the
 * parsers read only the domain, and a registry domain is also where people work). A lookalike (any non-ASCII code
 * point) is never kept, so it is faked like any other address.
 */
export function isKeptAddress(address: string, domains: readonly string[]): boolean {
  return /^[\x21-\x7E]+$/.test(address) && inRegistry(address.slice(address.lastIndexOf('@') + 1), domains);
}

/**
 * True when `name`, the display name beside `address`, is kept: `address` is a kept address at one of
 * `nameDomains`, and the sender is a business, not a person: its address is a machine one with a `+tag`
 * (`receipts+acct_…@stripe.com`, `store+…@t.shopifyemail.com`: the merchant a parser reads), or the name holds a
 * registry brand token (`Amazon.com`, `Uber Receipts`: receipt subjects name the brand too). A person at a registry
 * domain (an employee, or the signed-in account) is faked like anyone else (Hard Rules 2, 10).
 */
export function isKeptName(name: string, address: string, nameDomains: readonly string[]): boolean {
  if (!isKeptAddress(address, nameDomains)) return false;
  if (/^[^@+]+\+[^@]*@/.test(address)) return true;
  return nameTokens(name, true).some((token) => RECEIPT_BRAND_TOKENS.has(token.toLowerCase()));
}

/** A word-bounded, case-insensitive matcher for names; inner whitespace matches any whitespace run. */
function termMatcher(terms: Iterable<string>): RegExp | null {
  const sources = [...new Set(terms)]
    .filter((term) => term.trim() !== '')
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .map((term) => escapeRegExp(term.trim()).replace(/\s+/g, String.raw`\s+`));
  if (sources.length === 0) return null;
  // Digits glued after a name are part of it (a handle such as `name0403`: SEC-R15); `fakeName` fakes them too.
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${sources.join('|')})\d*(?![\p{L}\p{N}_])`, 'giu');
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly kind: PiiKind;
}

export type ScrubStats = Record<PiiKind | 'strayAt', number>;

/** Every scrub counter at zero. */
export function emptyScrubStats(): ScrubStats {
  return { literal: 0, email: 0, address: 0, amount: 0, phone: 0, card: 0, name: 0, query: 0, strayAt: 0 };
}

export interface ScrubberOptions {
  /** Learned or founder-supplied names matched everywhere. */
  readonly globalNames: Iterable<string>;
  /** Every lowercased token a name fake may replace (global and element-local names). */
  readonly nameTokens: ReadonlySet<string>;
  /** Exact original text → fake phrase (from --redact-selector), replaced wherever it appears. */
  readonly literals: ReadonlyMap<string, string>;
  /** Receipt-sender domains whose addresses are kept as they are (none when absent). */
  readonly keptDomains?: readonly string[];
  /** Receipt-sender domains whose `Name <address>` display names are kept too (none when absent). */
  readonly keptNameDomains?: readonly string[];
}

export class Scrubber {
  readonly stats: ScrubStats = emptyScrubStats();
  readonly #faker: Faker;
  readonly #tokens: ReadonlySet<string>;
  readonly #literals: ReadonlyMap<string, string>;
  readonly #literalMatcher: RegExp | null;
  readonly #globalNames: RegExp | null;
  readonly #localMatchers = new WeakMap<ReadonlySet<string>, RegExp | null>();
  readonly #keptDomains: readonly string[];
  readonly #keptNameDomains: readonly string[];

  constructor(faker: Faker, options: ScrubberOptions) {
    this.#faker = faker;
    this.#tokens = options.nameTokens;
    this.#literals = options.literals;
    this.#keptDomains = options.keptDomains ?? [];
    this.#keptNameDomains = options.keptNameDomains ?? [];
    const literalSources = [...options.literals.keys()]
      .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
      .map(escapeRegExp);
    this.#literalMatcher = literalSources.length === 0 ? null : new RegExp(literalSources.join('|'), 'g');
    this.#globalNames = termMatcher(options.globalNames);
  }

  /**
   * Scrubs one text node or attribute value. `localNames` are tokens learned from a nearby email element.
   * Query strings and parameter fragments go first, whole, so no later span can keep part of a token.
   */
  scrub(original: string, localNames?: ReadonlySet<string>): string {
    const stripped = stripQueryParts(original);
    this.stats.query += stripped.removed;
    const text = stripped.text;
    if (text.trim().length < 2) return this.#strayAts(text);
    const spans: Span[] = [];
    this.#collectLiterals(text, spans);
    this.#collect(text, EMAIL, 'email', spans, (match) => this.#emailSpan(match[0]));
    this.#collectEncodedEmails(text, spans);
    this.#collectNameBeforeEmail(text, spans);
    this.#collect(text, ADDRESS, 'address', spans, (match) => this.#address(match));
    this.#collect(text, MONEY_PREFIX, 'amount', spans, (match) => this.#money(match, 'prefix'));
    this.#collect(text, MONEY_SUFFIX, 'amount', spans, (match) => this.#money(match, 'suffix'));
    this.#collect(text, CARD, 'card', spans, (match) => this.#faker.card(match[0]));
    this.#collect(text, CARD_TAIL_DIGITS, 'card', spans, (match) =>
      isCardTail(text, match.index) ? this.#faker.card(match[0]) : null,
    );
    this.#collect(text, PHONE, 'phone', spans, (match) => this.#phone(match[0]));
    this.#collect(text, this.#globalNames, 'name', spans, (match) => this.fakeName(match[0]));
    if (localNames !== undefined && localNames.size > 0) {
      this.#collect(text, this.#localMatcher(localNames), 'name', spans, (match) => this.fakeName(match[0]));
    }
    return this.#strayAts(this.#apply(text, spans));
  }

  /** CSS gets emails and stray '@' only: font names and numbers are not PII. */
  scrubCss(css: string): string {
    const spans: Span[] = [];
    this.#collect(css, EMAIL, 'email', spans, (match) => this.#emailSpan(match[0]));
    return this.#strayAts(this.#apply(css, spans));
  }

  /**
   * The replacement for an address: a fake, or for a kept receipt sender (tests/tools/sanitize.ts `keepSenders`)
   * a fake local part at the address's own domain (the parsers read only the domain; a local part can name a
   * person or carry a per-recipient token). The same mapping applies to encoded copies, so every copy of one
   * address stays one address.
   */
  #fakeEmail(address: string): string {
    const fake = this.#faker.email(address);
    if (!isKeptAddress(address, this.#keptDomains)) return fake;
    return `${fake.slice(0, fake.lastIndexOf('@'))}${address.slice(address.lastIndexOf('@'))}`;
  }

  /** The address's replacement, or null when it stays as it is (a kept sender with no `+tag`). */
  #emailSpan(address: string): string | null {
    const replacement = this.#fakeEmail(address);
    return replacement === address ? null : replacement;
  }

  /**
   * Replaces every learned name token inside `text`, keeping punctuation, spacing and letter case. Digits glued to a
   * learned name (a handle such as `name0403`) are part of it and are faked too (security re-review, SEC-R15).
   */
  fakeName(text: string): string {
    return text.replace(NAME_WITH_DIGITS, (word) => {
      const core = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (core.length < 2 || !this.#tokens.has(core.toLowerCase())) return word;
      const faked = word.replace(core, matchCase(this.#faker.nameToken(core), core));
      return faked.replace(/\d+/gu, (digits) => this.#faker.card(digits));
    });
  }

  #localMatcher(names: ReadonlySet<string>): RegExp | null {
    if (!this.#localMatchers.has(names)) this.#localMatchers.set(names, termMatcher(names));
    return this.#localMatchers.get(names) ?? null;
  }

  #collect(
    text: string,
    pattern: RegExp | null,
    kind: PiiKind,
    spans: Span[],
    replace: (match: RegExpExecArray) => string | null,
  ): void {
    if (pattern === null) return;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      if (match[0] === '') {
        pattern.lastIndex += 1;
        continue;
      }
      const replacement = replace(match);
      if (replacement !== null) {
        spans.push({ start: match.index, end: match.index + match[0].length, replacement, kind });
      }
    }
  }

  #collectLiterals(text: string, spans: Span[]): void {
    this.#collect(
      text,
      this.#literalMatcher,
      'literal',
      spans,
      (match) => this.#literals.get(match[0]) ?? null,
    );
  }

  /** Addresses a search for '@' cannot see: percent-encoded, or inside a base64 id (Calendar event ids). */
  #collectEncodedEmails(text: string, spans: Span[]): void {
    const fakeEmail = (email: string): string => this.#fakeEmail(email);
    this.#collect(text, PERCENT_EMAIL, 'email', spans, (match) => {
      const replacement = fakePercentEmail(match, fakeEmail);
      return replacement === match[0] ? null : replacement;
    });
    this.#collect(text, BASE64_RUN, 'email', spans, (match) => fakeBase64Run(match[0], fakeEmail));
  }

  /**
   * The display name in `Name <email>` is replaced in place even when it is not learned globally, unless the
   * address is a receipt sender whose display name is kept (a business's name, the merchant a parser reads).
   */
  #collectNameBeforeEmail(text: string, spans: Span[]): void {
    NAME_BEFORE_EMAIL.lastIndex = 0;
    for (let match = NAME_BEFORE_EMAIL.exec(text); match !== null; match = NAME_BEFORE_EMAIL.exec(text)) {
      if (
        isKeptName(match[1] ?? match[2] ?? match[3] ?? '', match[4] ?? match[5] ?? '', this.#keptNameDomains)
      )
        continue;
      const range = match.indices?.[1] ?? match.indices?.[2] ?? match.indices?.[3];
      if (range === undefined) continue;
      const [start, end] = range;
      const name = text.slice(start, end);
      const replacement = this.fakeName(name);
      if (replacement !== name) spans.push({ start, end, replacement, kind: 'name' });
    }
  }

  #address(match: RegExpExecArray): string {
    return this.#faker.address(match[0], {
      number: match[1] ?? '',
      suffix: match[2] ?? '',
      unit: match[3] ?? '',
      cityLine: match[4] ?? '',
    });
  }

  #money(match: RegExpExecArray, form: 'prefix' | 'suffix'): string {
    const [, sign = '', first = '', gap = '', second = ''] = match;
    if (form === 'prefix') return `${sign}${first}${gap}${this.#faker.amount(first, second)}`;
    return `${sign}${this.#faker.amount(second, first)}${gap}${second}`;
  }

  #phone(candidate: string): string | null {
    const digits = candidate.replace(/\D/g, '').length;
    const valid = candidate.startsWith('+') ? digits >= 8 && digits <= 15 : digits >= 10 && digits <= 12;
    return valid ? this.#faker.phone(candidate) : null;
  }

  #apply(text: string, spans: Span[]): string {
    if (spans.length === 0) return text;
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const parts: string[] = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start < cursor) continue;
      parts.push(text.slice(cursor, span.start), span.replacement);
      cursor = span.end;
      this.stats[span.kind] += 1;
    }
    parts.push(text.slice(cursor));
    return parts.join('');
  }

  #strayAts(text: string): string {
    if (!text.includes('@')) return text;
    const foreign = new Set(findForeignAts(text, this.#keptDomains));
    if (foreign.size === 0) return text;
    this.stats.strayAt += foreign.size;
    return text.replace(/@/g, (at: string, offset: number) => (foreign.has(offset) ? FULLWIDTH_AT : at));
  }
}
