/**
 * Task 1.2 Done-when (Hard Rule 2; docs/grading.md §10, §12): random raw rows with arbitrary extra keys and
 * nesting, carrying every value and canary of tests/fixtures/secrets/seeded.json in keys that are not
 * allowlisted (as keys, as values, nested, in forged id/hash/rowKey fields, as the row key, in invalid,
 * boxed, coercible or overlong values of allowlisted fields, and past the subjectHint cap), under the default
 * policy or a random allowlist.
 *
 * Seeds also arrive as VALID values through every channel project() must not read: a content field the
 * source does not allowlist, an inherited property, a getter, an own `__proto__` key, and the elements of an
 * array row. A projection that read any of them would either keep a seed or project a row that must throw.
 *
 * For every example: the output's keys are a subset of the source's allowlist ∪ {id, source, type, observedAt,
 * rowKeyHash, contentHash}; no seed value or canary appears anywhere in JSON.stringify(output); every
 * allowlisted valid own value is kept exactly (subjectHint cut at SUBJECT_HINT code points) and nothing else
 * is; the derived fields are computed from the arguments only; no getter is ever invoked; the output parses;
 * and a row without a valid, allowlisted, own occurredAt throws RedactError('missing_occurred_at'). Valid
 * generated strings come from an alphabet that cannot spell any seed, so a seed in the output means a leak.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { canonicalJson, idFromHash } from '../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import {
  CONTENT_FIELDS,
  type ContentField,
  DERIVED_FIELDS,
  project,
  RedactError,
} from '../../src/core/redact';
import { ActionType, Observation, ObservationSource, SCHEMA_LIMITS } from '../../src/core/schema';
import { BaseSeed, SEEDS_PATH } from '../tools/seeds';

const SEEDS = z
  .object({ seeds: z.array(BaseSeed).min(1) })
  .parse(JSON.parse(readFileSync(SEEDS_PATH, 'utf8'))).seeds;
const SECRETS = [...new Set(SEEDS.flatMap((seed) => [seed.value, ...seed.canaries]))];
/** Seeds short enough to be a valid value of a field capped at `cap` code points. */
const fits = (cap: number) => SECRETS.filter((seed) => Array.from(seed).length <= cap);
/** Digit-only canaries (an SSN, a phone number) that are also a valid amountCents. */
const SECRET_AMOUNTS = SECRETS.filter((seed) => /^[0-9]+$/.test(seed))
  .map(Number)
  .filter((amount) => amount <= SCHEMA_LIMITS.AMOUNT_CENTS);

/** A generous budget: about 2 s alone, but the whole suite runs files in parallel. */
const PROPERTY_TIMEOUT_MS = 60_000;

const SMILE = '\u{1F600}';
/** Valid generated strings use only these: letters and marks no seed is made of, plus surrogate edge cases. */
const SAFE_CHARS = [
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
const PAD_CHARS = ['x', '\u00E9', SMILE];

const nodeSha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const firstCodePoints = (text: string, count: number): string => Array.from(text).slice(0, count).join('');

/** One generated field: the raw value and what the output must store (undefined: dropped). */
interface Field {
  readonly value: unknown;
  readonly keep: unknown;
}
const kept = (arb: fc.Arbitrary<unknown>): fc.Arbitrary<Field> =>
  arb.map((value) => ({ value, keep: value }));
const dropped = (arb: fc.Arbitrary<unknown>): fc.Arbitrary<Field> =>
  arb.map((value) => ({ value, keep: undefined }));

const secret = fc.constantFrom(...SECRETS);
const safeText = (maxLength: number) => fc.string({ unit: fc.constantFrom(...SAFE_CHARS), maxLength });
const padding = (minLength: number) =>
  fc.string({ unit: fc.constantFrom(...PAD_CHARS), minLength, maxLength: minLength + 8 });
/** A secret that only fits past `cap` code points of padding. */
const overCap = (cap: number) => fc.tuple(padding(cap + 1), secret).map(([pad, text]) => pad + text);
/** Non-scalar, wrongly typed or merely coercible values hiding a secret. */
const hidden = fc.oneof(
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
const isoTs = fc
  .tuple(fc.integer({ min: 0, max: 4_102_444_800_000 }), fc.integer({ min: -12 * 60, max: 14 * 60 }))
  .map(([ms, offset]) => {
    if (offset === 0) return new Date(ms).toISOString();
    const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    return `${local}${offset < 0 ? '-' : '+'}${hh}:${String(abs % 60).padStart(2, '0')}`;
  });

const FIELDS: Readonly<Record<ContentField, fc.Arbitrary<Field>>> = {
  counterparty: fc.oneof(
    kept(safeText(40)),
    dropped(fc.oneof(overCap(SCHEMA_LIMITS.COUNTERPARTY), hidden, fc.integer(), fc.constant(null))),
  ),
  merchant: fc.oneof(
    kept(safeText(40)),
    dropped(fc.oneof(overCap(SCHEMA_LIMITS.MERCHANT), hidden, fc.boolean())),
  ),
  amountCents: fc.oneof(
    kept(fc.oneof(fc.nat(), fc.constantFrom(0, SCHEMA_LIMITS.AMOUNT_CENTS))),
    dropped(
      fc.oneof(
        secret,
        hidden,
        fc.double({ noInteger: true }),
        fc.integer({ max: -1 }),
        fc.constant(SCHEMA_LIMITS.AMOUNT_CENTS + 1),
        fc.constantFrom(...SECRET_AMOUNTS).map(String),
      ),
    ),
  ),
  currency: fc.oneof(
    kept(fc.stringMatching(/^[A-Z]{3}$/)),
    dropped(fc.oneof(secret, hidden, fc.stringMatching(/^[a-z]{3}$/))),
  ),
  subjectHint: fc.oneof(
    kept(safeText(SCHEMA_LIMITS.SUBJECT_HINT)),
    fc.oneof(safeText(SCHEMA_LIMITS.SUBJECT_HINT * 2), overCap(SCHEMA_LIMITS.SUBJECT_HINT)).map((value) => ({
      value,
      keep: firstCodePoints(value, SCHEMA_LIMITS.SUBJECT_HINT),
    })),
    dropped(fc.oneof(hidden, fc.integer())),
  ),
  occurredAt: fc.oneof(
    { weight: 4, arbitrary: kept(isoTs) },
    {
      weight: 1,
      arbitrary: dropped(
        fc.oneof(
          secret,
          hidden,
          fc.integer(),
          fc.constant('2026-10-06T14:02:00'),
          isoTs.map((text) => new Date(text)),
        ),
      ),
    },
  ),
};

/** Values that WOULD be valid for each content field, every one but currency carrying a seed. */
const SMUGGLED: Readonly<Record<ContentField, fc.Arbitrary<unknown>>> = {
  counterparty: fc.constantFrom(...fits(SCHEMA_LIMITS.COUNTERPARTY)),
  merchant: fc.constantFrom(...fits(SCHEMA_LIMITS.MERCHANT)),
  amountCents: fc.constantFrom(...SECRET_AMOUNTS),
  currency: fc.stringMatching(/^[A-Z]{3}$/),
  subjectHint: fc.constantFrom(...fits(SCHEMA_LIMITS.SUBJECT_HINT)),
  occurredAt: isoTs,
};

/** How the row reaches project(): plain, or with smuggled content where only a broken reader would look. */
const CHANNELS = ['plain', 'nullPrototype', 'inherited', 'getters', 'protoKey', 'array'] as const;
type Channel = (typeof CHANNELS)[number];

const junkKey = fc.oneof(
  fc.string(),
  secret,
  fc.constantFrom('body', 'html', 'snippet', '__proto__', 'constructor', 'ref', 'rowKey', ...DERIVED_FIELDS),
);
const junkValue = fc.anything({
  maxDepth: 3,
  key: junkKey,
  values: [fc.string(), secret, fc.integer(), fc.double(), fc.boolean(), fc.constant(null)],
  withBigInt: true,
  withBoxedValues: true,
  withDate: true,
  withMap: true,
  withNullPrototype: true,
  withSet: true,
  withSparseArray: true,
  withTypedArray: true,
});
const forged = fc.constantFrom(
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  'a'.repeat(64),
  'gcal.event',
  'other',
  '2020-01-01T00:00:00Z',
);

const example = fc.record({
  source: fc.constantFrom(...ObservationSource.options),
  type: fc.constantFrom(...ActionType.options),
  observedAt: isoTs,
  rowKey: fc.option(fc.oneof(fc.string(), secret), { nil: undefined }),
  allowlist: fc.option(fc.subarray([...Observation.keyof().options], { minLength: 1 }), { nil: undefined }),
  junk: fc.dictionary(junkKey, junkValue, { maxKeys: 6 }),
  derived: fc.dictionary(fc.constantFrom(...DERIVED_FIELDS, 'rowKey', 'ref'), fc.oneof(secret, forged)),
  fields: fc.record(
    Object.fromEntries(CONTENT_FIELDS.map((field) => [field, fc.option(FIELDS[field], { nil: undefined })])),
  ),
  smuggled: fc.record(SMUGGLED),
  offAllowlist: fc.boolean(),
  channel: fc.constantFrom(...CHANNELS),
});
type Example = typeof example extends fc.Arbitrary<infer T> ? T : never;

function policyFor({ source, allowlist }: Example): Policy {
  if (allowlist === undefined) return DEFAULT_POLICY;
  return loadPolicy({
    ...defaultPolicyJson,
    allowlistedFields: { ...defaultPolicyJson.allowlistedFields, [source]: allowlist },
  });
}

/** The row's own data properties; with offAllowlist, every content field the source does not allowlist holds a seed. */
function ownOf(input: Example, allowlist: readonly string[]): Record<string, unknown> {
  const content = Object.entries(input.fields).flatMap(([field, generated]) =>
    generated === undefined ? [] : [[field, generated.value] as const],
  );
  const off = input.offAllowlist
    ? Object.entries(input.smuggled).filter(([field]) => !allowlist.includes(field))
    : [];
  return { ...input.junk, ...input.derived, ...Object.fromEntries(content), ...Object.fromEntries(off) };
}

const reads = { getters: 0 };

/** Defines `props` on `target` as they are (own `__proto__` keys stay own keys; no setter runs). */
const withProps = <T extends object>(target: T, props: Record<string, unknown>): T =>
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(props));

/** Wraps the own row so the smuggled fields it lacks sit where only a broken reader would find them. */
function wrap(own: Record<string, unknown>, channel: Channel, smuggled: Record<string, unknown>): unknown {
  const extra = Object.fromEntries(Object.entries(smuggled).filter(([key]) => !Object.hasOwn(own, key)));
  const getter = (value: unknown) => ({
    enumerable: true,
    get: () => {
      reads.getters += 1;
      return value;
    },
  });
  switch (channel) {
    case 'plain':
      return own;
    case 'nullPrototype':
      return withProps(Object.create(null) as object, own);
    case 'inherited':
      return withProps(Object.create(extra) as object, own);
    case 'getters':
      return Object.defineProperties(
        withProps({}, own),
        Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, getter(value)])),
      );
    case 'protoKey':
      return withProps({}, { ...own, ['__proto__']: extra });
    case 'array': {
      const rest = Object.fromEntries(Object.entries(own).filter(([key]) => key !== 'length'));
      return withProps([extra, ...Object.values(extra)], rest);
    }
  }
}

/** What the output must store for each content field, given the source's allowlist. */
function expectedContent({ fields }: Example, allowlist: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of CONTENT_FIELDS) {
    const keep = fields[field]?.keep;
    if (allowlist.includes(field) && keep !== undefined) out[field] = keep;
  }
  return out;
}

const counts = {
  projected: 0,
  rejected: 0,
  channels: Object.fromEntries(CHANNELS.map((channel) => [channel, 0])),
};

function check(input: Example): void {
  const policy = policyFor(input);
  const allowlist = policy.allowlistedFields[input.source];
  const own = ownOf(input, allowlist);
  const raw = wrap(own, input.channel, input.smuggled);
  const ctx = { type: input.type, observedAt: input.observedAt, rowKey: input.rowKey };
  const content = expectedContent(input, allowlist);
  const run = () => project(input.source, raw, ctx, policy);
  if (content.occurredAt === undefined) {
    counts.rejected += 1;
    expect(run).toThrow(RedactError);
    expect(run).toThrow('redact: missing_occurred_at');
    return;
  }
  counts.projected += 1;
  counts.channels[input.channel] = (counts.channels[input.channel] ?? 0) + 1;
  const out = run();
  const allowed = new Set<string>([...allowlist, ...DERIVED_FIELDS]);
  expect(Object.keys(out).filter((key) => !allowed.has(key))).toStrictEqual([]);
  const text = JSON.stringify(out);
  expect(SECRETS.filter((seed) => text.includes(seed))).toStrictEqual([]);
  const rowKeyHash = input.rowKey === undefined ? {} : { rowKeyHash: nodeSha(input.rowKey) };
  const hashed = { source: input.source, type: input.type, ...content, ...rowKeyHash };
  const contentHash = nodeSha(canonicalJson(hashed));
  const expected = { ...hashed, id: idFromHash(contentHash), observedAt: input.observedAt, contentHash };
  expect(out).toStrictEqual(Observation.parse(expected));
  expect(project(input.source, Object.fromEntries(Object.entries(own).reverse()), ctx, policy)).toStrictEqual(
    out,
  );
}

describe('redact (property)', () => {
  it('the generators are meaningful: seeds survive JSON escaping and no safe string can spell one', () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(15);
    expect(SECRET_AMOUNTS.length).toBeGreaterThan(0);
    expect(fits(SCHEMA_LIMITS.SUBJECT_HINT).length).toBeGreaterThan(0);
    for (const seed of SECRETS) {
      expect(JSON.stringify(seed)).toBe(`"${seed}"`);
      expect(Array.from(seed).every((char) => SAFE_CHARS.includes(char) || PAD_CHARS.includes(char))).toBe(
        false,
      );
    }
  });

  it(
    'only allowlisted own fields survive and no seeded secret ever reaches the output (1,000 examples)',
    () => {
      fc.assert(fc.property(example, check), { numRuns: 1000 });
      expect(counts.projected).toBeGreaterThan(300);
      expect(counts.rejected).toBeGreaterThan(50);
      for (const channel of CHANNELS) expect(counts.channels[channel], channel).toBeGreaterThan(20);
      expect(reads.getters).toBe(0);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
