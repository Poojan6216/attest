/**
 * PII patterns and the scrubber for captured fixtures.
 *
 * One pass per string: every matcher proposes spans on the ORIGINAL text, overlaps are resolved
 * leftmost-longest, and the spans are replaced at once, so a fake is never re-scrubbed by a later pattern.
 * Any '@' left that does not start a fake domain becomes U+FF20 (＠), so a grep for '@' in a fixture finds
 * only example.com / example.org / example.net.
 */
import { BASE64_RUN, fakeBase64Run, fakePercentEmail, PERCENT_EMAIL } from './capture-encoded';
import { type Faker, matchCase } from './capture-fakes';

export type PiiKind = 'literal' | 'email' | 'address' | 'amount' | 'phone' | 'card' | 'name';

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

/** 16 digits in groups of 4 (+ up to 3 more), or Amex 4-6-5, with one consistent separator. */
const CARD = new RegExp(
  String.raw`(?<![\w+@.\-/])(?:\d{4}([ \-])\d{4}\1\d{4}\1\d{4}(?:\1\d{1,3})?|\d{4}([ \-])\d{6}\2\d{5})(?![\w@]|[.\-/]\d)`,
  'g',
);

const CURRENCY = String.raw`(?:US\$|CA\$|C\$|A\$|AU\$|NZ\$|HK\$|S\$|R\$|\$|€|£|¥|₹|₩|₽|₺|₪|₫|₱|฿|₦|₴|₡|USD|EUR|GBP|JPY|INR|CAD|AUD|NZD|CHF|CNY|HKD|SGD|SEK|NOK|DKK|PLN|CZK|HUF|MXN|BRL|ZAR|KRW|TRY|ILS|AED|SAR|THB|IDR|MYR|PHP|VND|RUB|UAH|NGN|KES|EGP|ARS|CLP|COP|PEN)`;
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
const FAKE_AT = /@example\.(?:com|org|net)(?![A-Za-z0-9-]|\.[A-Za-z0-9])/y;
const FULLWIDTH_AT = '\uFF20';

/** Words that appear next to addresses but are not names; never learned automatically. */
const NAME_STOPWORDS = new Set([
  'me',
  'to',
  'from',
  'cc',
  'bcc',
  're',
  'fw',
  'fwd',
  'reply',
  'sent',
  'dear',
  'hi',
  'hello',
  'hey',
  'the',
  'and',
  'or',
  'of',
  'via',
  'on',
  'behalf',
  'team',
  'support',
  'info',
  'noreply',
  'no-reply',
  'admin',
  'mr',
  'mrs',
  'ms',
  'mx',
  'dr',
  'prof',
  'jr',
  'sr',
  'inc',
  'llc',
  'ltd',
  'co',
  'corp',
  'mail',
  'email',
  'you',
  'your',
  'unknown',
  'sender',
  'notifications',
  'updates',
  'billing',
  'accounts',
  'service',
  'customer',
  'account',
  'contact',
  'help',
  'us',
  'our',
  'at',
]);

/** Splits a display name into tokens of 2+ letters; drops stopwords unless `keepStopwords`. */
export function nameTokens(name: string, keepStopwords = false): string[] {
  const tokens = name.match(NAME_TOKEN) ?? [];
  return tokens
    .map((token) => token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((token) => token.length >= 2 && (keepStopwords || !NAME_STOPWORDS.has(token.toLowerCase())));
}

/** Offsets of every '@' in `text` that does not start a fake domain. Empty for a clean fixture. */
export function findForeignAts(text: string): number[] {
  const offsets: number[] = [];
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    FAKE_AT.lastIndex = at;
    if (!FAKE_AT.test(text)) offsets.push(at);
  }
  return offsets;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A word-bounded, case-insensitive matcher for names; inner whitespace matches any whitespace run. */
function termMatcher(terms: Iterable<string>): RegExp | null {
  const sources = [...new Set(terms)]
    .filter((term) => term.trim() !== '')
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .map((term) => escapeRegExp(term.trim()).replace(/\s+/g, String.raw`\s+`));
  if (sources.length === 0) return null;
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${sources.join('|')})(?![\p{L}\p{N}_])`, 'giu');
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly kind: PiiKind;
}

export type ScrubStats = Record<PiiKind | 'strayAt', number>;

export interface ScrubberOptions {
  /** Learned or founder-supplied names matched everywhere. */
  readonly globalNames: Iterable<string>;
  /** Every lowercased token a name fake may replace (global and element-local names). */
  readonly nameTokens: ReadonlySet<string>;
  /** Exact original text → fake phrase (from --redact-selector), replaced wherever it appears. */
  readonly literals: ReadonlyMap<string, string>;
}

export class Scrubber {
  readonly stats: ScrubStats = {
    literal: 0,
    email: 0,
    address: 0,
    amount: 0,
    phone: 0,
    card: 0,
    name: 0,
    strayAt: 0,
  };
  readonly #faker: Faker;
  readonly #tokens: ReadonlySet<string>;
  readonly #literals: ReadonlyMap<string, string>;
  readonly #literalMatcher: RegExp | null;
  readonly #globalNames: RegExp | null;
  readonly #localMatchers = new WeakMap<ReadonlySet<string>, RegExp | null>();

  constructor(faker: Faker, options: ScrubberOptions) {
    this.#faker = faker;
    this.#tokens = options.nameTokens;
    this.#literals = options.literals;
    const literalSources = [...options.literals.keys()]
      .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
      .map(escapeRegExp);
    this.#literalMatcher = literalSources.length === 0 ? null : new RegExp(literalSources.join('|'), 'g');
    this.#globalNames = termMatcher(options.globalNames);
  }

  /** Scrubs one text node or attribute value. `localNames` are tokens learned from a nearby email element. */
  scrub(text: string, localNames?: ReadonlySet<string>): string {
    if (text.trim().length < 2) return this.#strayAts(text);
    const spans: Span[] = [];
    this.#collectLiterals(text, spans);
    this.#collect(text, EMAIL, 'email', spans, (match) => this.#faker.email(match[0]));
    this.#collectEncodedEmails(text, spans);
    this.#collectNameBeforeEmail(text, spans);
    this.#collect(text, ADDRESS, 'address', spans, (match) => this.#address(match));
    this.#collect(text, MONEY_PREFIX, 'amount', spans, (match) => this.#money(match, 'prefix'));
    this.#collect(text, MONEY_SUFFIX, 'amount', spans, (match) => this.#money(match, 'suffix'));
    this.#collect(text, CARD, 'card', spans, (match) => this.#faker.card(match[0]));
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
    this.#collect(css, EMAIL, 'email', spans, (match) => this.#faker.email(match[0]));
    return this.#strayAts(this.#apply(css, spans));
  }

  /** Replaces every learned name token inside `text`, keeping punctuation, spacing and letter case. */
  fakeName(text: string): string {
    return text.replace(NAME_TOKEN, (word) => {
      const core = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (core.length < 2 || !this.#tokens.has(core.toLowerCase())) return word;
      return word.replace(core, matchCase(this.#faker.nameToken(core), core));
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
    const fakeEmail = (email: string): string => this.#faker.email(email);
    this.#collect(text, PERCENT_EMAIL, 'email', spans, (match) => fakePercentEmail(match, fakeEmail));
    this.#collect(text, BASE64_RUN, 'email', spans, (match) => fakeBase64Run(match[0], fakeEmail));
  }

  /** The display name in `Name <email>` is replaced in place even when it is not learned globally. */
  #collectNameBeforeEmail(text: string, spans: Span[]): void {
    NAME_BEFORE_EMAIL.lastIndex = 0;
    for (let match = NAME_BEFORE_EMAIL.exec(text); match !== null; match = NAME_BEFORE_EMAIL.exec(text)) {
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
    const foreign = new Set(findForeignAts(text));
    if (foreign.size === 0) return text;
    this.stats.strayAt += foreign.size;
    return text.replace(/@/g, (at: string, offset: number) => (foreign.has(offset) ? FULLWIDTH_AT : at));
  }
}
