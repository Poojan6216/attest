/**
 * The generators of tests/property/redact.property.spec.ts (Task 1.2, SEC-3): the seeded secrets, safe text no
 * seed can spell, and values of each kind a raw row may hold (kept, cut, dropped, or refusing the whole row).
 */
import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { z } from 'zod';

import { SCHEMA_LIMITS } from '../../src/core/schema';
import { BaseSeed, SEEDS_PATH } from '../tools/seeds';

export const SEEDS = z
  .object({ seeds: z.array(BaseSeed).min(1) })
  .parse(JSON.parse(readFileSync(SEEDS_PATH, 'utf8'))).seeds;
export const SECRETS = [...new Set(SEEDS.flatMap((seed) => [seed.value, ...seed.canaries]))];
/** Seeds short enough to be a valid value of a field capped at `cap` code points. */
export const fits = (cap: number) => SECRETS.filter((seed) => Array.from(seed).length <= cap);
/** Digit-only canaries (an SSN, a phone number) that are also a valid amountCents. */
export const SECRET_AMOUNTS = SECRETS.filter((seed) => /^[0-9]+$/.test(seed))
  .map(Number)
  .filter((amount) => amount <= SCHEMA_LIMITS.AMOUNT_CENTS);

export const SMILE = '\u{1F600}';
/** Valid generated strings use only these: letters and marks no seed is made of, plus surrogate edge cases. */
export const SAFE_CHARS = [
  'a',
  'b',
  'z',
  'Z',
  '.',
  '@',
  '-',
  ' ',
  '\u00E9',
  '\u0301',
  SMILE,
  '\uD800',
  '\uDC00',
  '\u200B',
];
export const PAD_CHARS = ['x', '\u00E9', SMILE];

export const firstCodePoints = (text: string, count: number): string =>
  Array.from(text).slice(0, count).join('');

/** One generated field: the raw value and what the output must store (undefined: dropped), or `refuse`. */
export interface Field {
  readonly value: unknown;
  readonly keep: unknown;
  readonly refuse?: true;
}
export const kept = (arb: fc.Arbitrary<unknown>): fc.Arbitrary<Field> =>
  arb.map((value) => ({ value, keep: value }));
export const dropped = (arb: fc.Arbitrary<unknown>): fc.Arbitrary<Field> =>
  arb.map((value) => ({ value, keep: undefined }));
/** An allowlisted value that is not a valid fact: the whole row must be refused. Rarer, so most rows project. */
export const refusedOr = (valid: fc.Arbitrary<Field>, invalid: fc.Arbitrary<unknown>): fc.Arbitrary<Field> =>
  fc.oneof(
    { weight: 6, arbitrary: valid },
    { weight: 1, arbitrary: invalid.map((value): Field => ({ value, keep: undefined, refuse: true })) },
  );

export const secret = fc.constantFrom(...SECRETS);
export const safeText = (maxLength: number) => fc.string({ unit: fc.constantFrom(...SAFE_CHARS), maxLength });
export const padding = (minLength: number) =>
  fc.string({ unit: fc.constantFrom(...PAD_CHARS), minLength, maxLength: minLength + 8 });
/** A secret that only fits past `cap` code points of padding. */
export const overCap = (cap: number) => fc.tuple(padding(cap + 1), secret).map(([pad, text]) => pad + text);
/** Line breaks and other control characters: never inside a one-line fact (SEC-3). */
export const BREAKS = ['\n', '\r\n', '\r', '\u2028', '\u2029', '\u0085', '\t', '\u0000', '\u001B'];
/** A secret on the second line of otherwise valid text: a message body passed off as a fact. */
export const multiLine = fc
  .tuple(safeText(8), fc.constantFrom(...BREAKS), secret)
  .map(([head, mark, text]) => `${head}${mark}${text}`);
/** Non-scalar, wrongly typed or merely coercible values hiding a secret. */
export const hidden = fc.oneof(
  secret.map((text) => [text]),
  secret.map((text) => ({ value: text })),
  secret.map((text) => ({ nested: [{ deep: text }] })),
  secret.map((text) => new Map([[text, text]])),
  secret.map((text) => new Set([text])),
  secret.map((text) => BigInt(text.length)),
  secret.map((text): unknown => Object(text)),
  secret.map((text) => ({ toString: () => text, toJSON: () => text, valueOf: () => text })),
  fc.constantFrom(...SECRET_AMOUNTS).map((amount): unknown => Object(amount)),
);

/** Valid ISO 8601 with an offset (Z or ±hh:mm), 1970–2100. */
export const isoTs = fc
  .tuple(fc.integer({ min: 0, max: 4_102_444_800_000 }), fc.integer({ min: -12 * 60, max: 14 * 60 }))
  .map(([ms, offset]) => {
    if (offset === 0) return new Date(ms).toISOString();
    const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    return `${local}${offset < 0 ? '-' : '+'}${hh}:${String(abs % 60).padStart(2, '0')}`;
  });
