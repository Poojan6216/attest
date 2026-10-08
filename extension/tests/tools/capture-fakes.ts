/**
 * Deterministic fakes for the fixture sanitiser.
 *
 * Every fake is derived from HMAC-SHA256(seed; kind, original), so the same capture with the same seed always
 * produces the same fixture, and one original value maps to one fake everywhere in a capture (labels stay
 * coherent). The seed is a key: a live capture's is the secret in the capture key file (./capture-key.ts), so a
 * committed fake says nothing about its original to anyone without it (security review, SEC-L2: with the public
 * seed every fake was an unkeyed hash of its original, and a card ending or an amount could be recovered). The
 * fixed seeds of the tool's own tests are public, and their pages hold only invented values. Fakes for emails, names, phrases and addresses are unique within a capture and never equal an
 * original the caller reserved, so two different people never collapse into one fake.
 */
import { createHmac } from 'node:crypto';

/** The only domains a sanitised fixture may contain after an '@' (RFC 2606 reserved). */
export const FAKE_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'] as const;

const NAME_HEADS = [
  'Ash',
  'Bel',
  'Cor',
  'Dal',
  'Ever',
  'Fal',
  'Har',
  'Ives',
  'Jen',
  'Kes',
  'Lor',
  'Mar',
  'Nor',
  'Os',
  'Pem',
  'Ros',
];
const NAME_TAILS = [
  'ley',
  'wick',
  'ton',
  'ford',
  'by',
  'dale',
  'more',
  'ett',
  'ard',
  'ian',
  'wyn',
  'ric',
  'sby',
  'mer',
  'low',
  'ing',
];
const STREET_NAMES = [
  'Alder',
  'Birch',
  'Cedar',
  'Dogwood',
  'Elm',
  'Foxglove',
  'Hawthorn',
  'Juniper',
  'Larch',
  'Maple',
  'Oak',
  'Poplar',
  'Rowan',
  'Spruce',
  'Willow',
  'Yew',
];
const CITY_NAMES = [
  'Brookfield',
  'Clearwater',
  'Fairview',
  'Glenwood',
  'Lakeside',
  'Millbrook',
  'Oakridge',
  'Riverton',
  'Springvale',
  'Westhaven',
];
const PHRASE_WORDS = [
  'amber',
  'basin',
  'cobalt',
  'delta',
  'ember',
  'fable',
  'garnet',
  'harbor',
  'island',
  'juniper',
  'kettle',
  'lantern',
  'meadow',
  'nectar',
  'orbit',
  'pepper',
  'quarry',
  'ripple',
  'saffron',
  'timber',
  'umber',
  'velvet',
  'willow',
  'yonder',
  'zephyr',
  'bramble',
  'cinder',
  'dapple',
  'echo',
  'fern',
  'glade',
  'hollow',
];

const MAX_ATTEMPTS = 10_000;
const MAX_PHRASE_WORDS = 12;

type FakeKind = 'email' | 'name' | 'phone' | 'card' | 'amount' | 'address' | 'phrase' | 'identifier' | 'uuid';

interface FakeOptions {
  /** Fakes of this kind must be distinct across originals (default true). */
  readonly unique?: boolean;
  /** True when a candidate is the original in disguise (default: case-insensitive equality with the key). */
  readonly sameAs?: (candidate: string) => boolean;
}

/** The parts of a street address the sanitiser matched; every part but `suffix` is replaced. */
export interface AddressParts {
  readonly number: string;
  readonly suffix: string;
  readonly unit: string;
  readonly cityLine: string;
}

function pick(list: readonly string[], n: number): string {
  const value = list[n % list.length];
  if (value === undefined) throw new RangeError('pick() from an empty list');
  return value;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Applies the letter case of `original` (ALL CAPS / all lower / as generated) to `fake`. */
export function matchCase(fake: string, original: string): string {
  const hasLetters = original.toLowerCase() !== original.toUpperCase();
  if (!hasLetters) return fake;
  if (original === original.toUpperCase()) return fake.toUpperCase();
  if (original === original.toLowerCase()) return fake.toLowerCase();
  return fake;
}

export class Faker {
  readonly #seed: string;
  readonly #cache = new Map<string, string>();
  readonly #taken = new Map<FakeKind, Set<string>>();
  readonly #reserved = new Set<string>();

  constructor(seed: string) {
    this.#seed = seed;
  }

  /** 32 bytes keyed by the seed (HMAC-SHA256); the only source of variation in every fake. */
  bytes(kind: string, key: string, attempt = 0): Buffer {
    return createHmac('sha256', this.#seed).update(`${kind}\u0000${key}\u0000${attempt}`).digest();
  }

  /** Every fake made so far: its kind, what it replaced and the fake (the re-fake tool's record, kept out of the repo). */
  made(): { kind: string; original: string; fake: string }[] {
    return Array.from(this.#cache, ([cacheKey, fake]) => {
      const at = cacheKey.indexOf('\u0000');
      const kind = cacheKey.slice(0, at);
      const key = cacheKey.slice(at + 1);
      // An amount's key is `currency|number`, and the number is what its fake replaced.
      return { kind, original: kind === 'amount' ? key.slice(key.indexOf('|') + 1) : key, fake };
    });
  }

  /** Originals a fake must never equal (case-insensitive), e.g. every real name token on the page. */
  reserve(values: Iterable<string>): void {
    for (const value of values) this.#reserved.add(value.toLowerCase());
  }

  email(original: string): string {
    const key = original.toLowerCase();
    const domain = key.slice(key.lastIndexOf('@') + 1);
    const fakeDomain = pick(FAKE_EMAIL_DOMAINS, this.bytes('email-domain', domain).readUInt8(0));
    return this.#fake('email', key, (bytes, attempt) => {
      const local = `${this.#nameWord(bytes, 0)}.${this.#nameWord(bytes, 2)}`.toLowerCase();
      return `${local}${attempt > 0 ? String(attempt) : ''}@${fakeDomain}`;
    });
  }

  /** A fake for one name token (a first name, a surname, a company word), Title Case. */
  nameToken(original: string): string {
    return this.#fake('name', original.toLowerCase(), (bytes, attempt) => {
      const word = this.#nameWord(bytes, 0);
      return attempt < 64 ? word : `${word}${this.#nameWord(bytes, 2).toLowerCase()}`;
    });
  }

  /** Same format (separators, length, leading +country code), different digits. */
  phone(original: string): string {
    const prefix = /^\+\d{1,3}(?=[ .-])/.exec(original)?.[0] ?? '';
    const digits = original.replace(/\D/g, '');
    return this.#fake(
      'phone',
      `${digits}|${original}`,
      (bytes) => prefix + this.#digits(original.slice(prefix.length), bytes, false),
      { unique: false, sameAs: (candidate) => candidate.replace(/\D/g, '') === digits },
    );
  }

  /** A payment card number: same grouping and separators, every digit different from the seed. */
  card(original: string): string {
    const digits = original.replace(/\D/g, '');
    return this.#fake('card', digits, (bytes) => this.#digits(original, bytes, true), {
      unique: false,
      sameAs: (candidate) => candidate.replace(/\D/g, '') === digits,
    });
  }

  /** An order, receipt or invoice number: its shape (letter case, digits, separators), other letters and digits. */
  identifier(original: string): string {
    return this.#fake(
      'identifier',
      original,
      (bytes) => {
        let index = 0;
        return original.replace(/[A-Za-z0-9]/g, (char) => {
          const byte = bytes.readUInt8(index % bytes.length);
          index += 1;
          if (/\d/.test(char)) return String(byte % 10);
          const letter = String.fromCharCode(97 + (byte % 26));
          return char === char.toUpperCase() ? letter.toUpperCase() : letter;
        });
      },
      { unique: false, sameAs: (candidate) => candidate === original },
    );
  }

  /** A UUID (or any hex token) in its shape: every hex digit another, in the token's case; separators kept. */
  uuid(original: string): string {
    return this.#fake(
      'uuid',
      original,
      (bytes) => {
        const upper = /[A-F]/.test(original) && !/[a-f]/.test(original);
        let index = 0;
        return original.replace(/[0-9a-f]/gi, () => {
          const digit = (bytes.readUInt8(index % bytes.length) % 16).toString(16);
          index += 1;
          return upper ? digit.toUpperCase() : digit;
        });
      },
      { unique: false, sameAs: (candidate) => candidate === original },
    );
  }

  /** Same separators and decimals as `numberText`, different digits; never a leading zero unless 0.xx. */
  amount(currency: string, numberText: string): string {
    const keepLeadingZero = /^0(?:[.,]\d{1,2})?$/.test(numberText);
    return this.#fake(
      'amount',
      `${currency}|${numberText}`,
      (bytes) => this.#digits(numberText, bytes, !keepLeadingZero),
      { unique: false, sameAs: (candidate) => candidate === numberText },
    );
  }

  address(original: string, parts: AddressParts): string {
    return this.#fake('address', original.replace(/\s+/g, ' '), (bytes, attempt) => {
      const number = this.#digits(parts.number, bytes, true);
      const street = pick(STREET_NAMES, bytes.readUInt8(8) + attempt);
      const unit = parts.unit === '' ? '' : this.#digits(parts.unit, bytes.subarray(16), false);
      const city = /^(,\s*).+?(,\s*[A-Z]{2}\s+)(\d{5}(?:-\d{4})?)$/.exec(parts.cityLine);
      const cityLine =
        city === null
          ? ''
          : `${city[1] ?? ', '}${pick(CITY_NAMES, bytes.readUInt8(12))}${city[2] ?? ', '}${this.#digits(city[3] ?? '', bytes.subarray(20), true)}`;
      return `${number} ${street} ${parts.suffix}${unit}${cityLine}`;
    });
  }

  /** A neutral phrase with the same word count (1–12) as `original`, first word capitalised. */
  phrase(original: string): string {
    const wordCount = Math.min(Math.max(original.split(/\s+/).filter(Boolean).length, 1), MAX_PHRASE_WORDS);
    return this.#fake('phrase', original, (bytes, attempt) => {
      const words: string[] = [];
      for (let i = 0; i < wordCount + Math.min(attempt, 4); i += 1) {
        words.push(pick(PHRASE_WORDS, bytes.readUInt8(i % bytes.length)));
      }
      return capitalise(words.join(' '));
    });
  }

  #nameWord(bytes: Buffer, offset: number): string {
    return pick(NAME_HEADS, bytes.readUInt8(offset)) + pick(NAME_TAILS, bytes.readUInt8(offset + 1));
  }

  /** Replaces every ASCII digit in `text` with a seed-derived digit; keeps every other character. */
  #digits(text: string, bytes: Buffer, nonZeroFirst: boolean): string {
    let index = 0;
    return text.replace(/\d/g, () => {
      const byte = bytes.readUInt8(index % bytes.length);
      const digit = index === 0 && nonZeroFirst ? 1 + (byte % 9) : byte % 10;
      index += 1;
      return String(digit);
    });
  }

  #fake(
    kind: FakeKind,
    key: string,
    make: (bytes: Buffer, attempt: number) => string,
    options: FakeOptions = {},
  ): string {
    const cacheKey = `${kind}\u0000${key}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const unique = options.unique ?? true;
    const sameAs = options.sameAs ?? ((candidate: string) => candidate.toLowerCase() === key.toLowerCase());
    const taken = this.#taken.get(kind) ?? new Set<string>();
    this.#taken.set(kind, taken);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidate = make(this.bytes(kind, key, attempt), attempt);
      const folded = candidate.toLowerCase();
      const clash = unique && (taken.has(folded) || this.#reserved.has(folded));
      if (!sameAs(candidate) && !clash) {
        taken.add(folded);
        this.#cache.set(cacheKey, candidate);
        return candidate;
      }
    }
    throw new RangeError(`no fake ${kind} found after ${MAX_ATTEMPTS} attempts`);
  }
}
