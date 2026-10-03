/**
 * Task 1.2 Done-when (Hard Rule 2; docs/grading.md §10, §12): random raw rows with arbitrary extra keys and
 * nesting, carrying every value and canary of tests/fixtures/secrets/seeded.json in keys that are not
 * allowlisted (as keys, as values, nested, in forged id/hash/rowKey fields, as the row key, and past the
 * subjectHint cap), and INSIDE allowlisted fields (invalid, boxed, coercible or overlong values, and a seed on
 * the second line of a counterparty, merchant or subject, SEC-3), under the default
 * policy or a random allowlist. A random allowlist the loader accepts (v1.3 §12: only content fields and the
 * derived markers, `occurredAt` required) is loaded; any other one must be rejected by the loader and is then
 * handed to project() as an unvalidated object, so redact.ts's own defences are tested without the loader's.
 *
 * Seeds also arrive as VALID values through every channel project() must not read: a content field the
 * source does not allowlist, an inherited property, a getter, an own `__proto__` key, and the elements of an
 * array row. A projection that read any of them would either keep a seed or project a row that must throw.
 *
 * For every example: the output's keys are a subset of the source's allowlist ∪ {id, source, type, observedAt,
 * rowKeyHash, contentHash}; no seed value or canary appears anywhere in JSON.stringify(output); every
 * allowlisted valid own value is kept exactly (subjectHint cut at SUBJECT_HINT code points) and nothing else
 * is; the derived fields are computed from the arguments only; no getter is ever invoked; the output parses;
 * a row holding an allowlisted own value that is not a valid fact is refused whole with
 * RedactError('invalid_field'), whose message and fields name no seed (Hard Rules 5, 10: never stored without
 * a fact it carried); and any other row without a valid, allowlisted, own occurredAt throws
 * RedactError('missing_occurred_at'). Valid generated strings come from an alphabet that cannot spell any
 * seed, so a seed in the output means a leak.
 */
import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { canonicalJson, idFromHash } from '../../src/core/hash';
import {
  ALLOWLISTABLE_FIELDS,
  DEFAULT_POLICY,
  loadPolicy,
  type Policy,
  PolicyError,
} from '../../src/core/policy';
import {
  CONTENT_FIELDS,
  type ContentField,
  DERIVED_FIELDS,
  observationIntegrityProblems,
  project,
  RedactError,
} from '../../src/core/redact';
import { ActionType, Observation, ObservationSource, SCHEMA_LIMITS } from '../../src/core/schema';
import { ONE_LINE } from '../../src/core/schema-text';
import {
  dropped,
  type Field,
  firstCodePoints,
  fits,
  hidden,
  isoTs,
  kept,
  multiLine,
  overCap,
  PAD_CHARS,
  refusedOr,
  safeText,
  SAFE_CHARS,
  secret,
  SECRET_AMOUNTS,
  SECRETS,
  SEEDS,
} from './redact-arbitraries';

const nodeSha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const FIELDS: Readonly<Record<ContentField, fc.Arbitrary<Field>>> = {
  counterparty: refusedOr(
    kept(safeText(40)),
    fc.oneof(overCap(SCHEMA_LIMITS.COUNTERPARTY), hidden, fc.integer(), fc.constant(null), multiLine),
  ),
  merchant: refusedOr(
    kept(safeText(40)),
    fc.oneof(overCap(SCHEMA_LIMITS.MERCHANT), hidden, fc.boolean(), multiLine),
  ),
  amountCents: refusedOr(
    kept(fc.oneof(fc.nat(), fc.constantFrom(0, SCHEMA_LIMITS.AMOUNT_CENTS))),
    fc.oneof(
      secret,
      hidden,
      fc.double({ noInteger: true }),
      fc.integer({ max: -1 }),
      fc.constant(SCHEMA_LIMITS.AMOUNT_CENTS + 1),
      fc.constantFrom(...SECRET_AMOUNTS).map(String),
    ),
  ),
  currency: refusedOr(
    kept(fc.stringMatching(/^[A-Z]{3}$/)),
    fc.oneof(secret, hidden, fc.stringMatching(/^[a-z]{3}$/)),
  ),
  subjectHint: refusedOr(
    fc.oneof(
      kept(safeText(SCHEMA_LIMITS.SUBJECT_HINT)),
      fc
        .oneof(safeText(SCHEMA_LIMITS.SUBJECT_HINT * 2), overCap(SCHEMA_LIMITS.SUBJECT_HINT))
        .map((value) => ({
          value,
          keep: firstCodePoints(value, SCHEMA_LIMITS.SUBJECT_HINT),
        })),
    ),
    fc.oneof(hidden, fc.integer(), multiLine),
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
  allowlist: fc.option(
    fc.oneof(
      // Any Observation keys: mostly lists the v1.3 loader rejects (a derived field, or no occurredAt).
      fc.subarray([...Observation.keyof().options], { minLength: 1 }),
      // A list the loader accepts: allowlistable fields only, occurredAt included.
      fc
        .subarray(ALLOWLISTABLE_FIELDS.filter((field) => field !== 'occurredAt'))
        .chain((fields) => fc.shuffledSubarray([...fields, 'occurredAt'], { minLength: fields.length + 1 })),
    ),
    { nil: undefined },
  ),
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

const counts = {
  projected: 0,
  rejected: 0,
  refused: 0,
  /** Rows refused for a seed on the second line of an allowlisted text fact (SEC-3). */
  multiLine: 0,
  loaded: 0,
  handBuilt: 0,
  channels: Object.fromEntries(CHANNELS.map((channel) => [channel, 0])),
};

type AllowlistPolicy = Pick<Policy, 'allowlistedFields'>;
const ALLOWLISTABLE: ReadonlySet<string> = new Set(ALLOWLISTABLE_FIELDS);

/** Whether the v1.3 loader accepts `allowlist` (§12): allowlistable fields only, occurredAt included. */
const loadable = (allowlist: readonly string[]): boolean =>
  allowlist.includes('occurredAt') && allowlist.every((field) => ALLOWLISTABLE.has(field));

function policyFor({ source, allowlist }: Example): AllowlistPolicy {
  if (allowlist === undefined) return DEFAULT_POLICY;
  const allowlistedFields = { ...defaultPolicyJson.allowlistedFields, [source]: allowlist };
  const document = { ...defaultPolicyJson, allowlistedFields };
  if (loadable(allowlist)) {
    counts.loaded += 1;
    return loadPolicy(document);
  }
  expect(() => loadPolicy(document)).toThrow(PolicyError);
  counts.handBuilt += 1;
  return z.custom<AllowlistPolicy>().parse({ allowlistedFields });
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

/** The allowlisted own fields (occurredAt aside, which is only ever missing) whose value refuses the row. */
function refusedFields({ fields }: Example, allowlist: readonly string[]): unknown[] {
  return CONTENT_FIELDS.filter((field) => field !== 'occurredAt' && allowlist.includes(field))
    .map((field) => fields[field])
    .filter((field) => field?.refuse === true)
    .map((field) => field?.value);
}

/** `run` refuses the row with `invalid_field`, and nothing it throws names a seed (Hard Rule 10). */
function expectRefused(run: () => unknown, values: readonly unknown[]): void {
  counts.refused += 1;
  if (values.some((value) => typeof value === 'string' && !ONE_LINE.test(value))) counts.multiLine += 1;
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RedactError);
  expect(caught).toMatchObject({ code: 'invalid_field', message: 'redact: invalid_field' });
  const shown = `${String(caught)} ${JSON.stringify(caught)}`;
  expect(SECRETS.filter((seed) => shown.includes(seed))).toStrictEqual([]);
}

function check(input: Example): void {
  const policy = policyFor(input);
  const allowlist: readonly string[] = policy.allowlistedFields[input.source];
  const own = ownOf(input, allowlist);
  const raw = wrap(own, input.channel, input.smuggled);
  const ctx = { type: input.type, observedAt: input.observedAt, rowKey: input.rowKey };
  const content = expectedContent(input, allowlist);
  const run = () => project(input.source, raw, ctx, policy);
  const refused = refusedFields(input, allowlist);
  if (refused.length > 0) {
    expectRefused(run, refused);
    return;
  }
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
  // §10 v1.3: rowKeyHash = sha256Hex(canonicalJson(rowKey)); for a string that is Node's JSON.stringify.
  const rowKeyHash = input.rowKey === undefined ? {} : { rowKeyHash: nodeSha(JSON.stringify(input.rowKey)) };
  const hashed = { source: input.source, type: input.type, ...content, ...rowKeyHash };
  const contentHash = nodeSha(canonicalJson(hashed));
  const expected = { ...hashed, id: idFromHash(contentHash), observedAt: input.observedAt, contentHash };
  expect(out).toStrictEqual(Observation.parse(expected));
  expect(observationIntegrityProblems(out, policy)).toStrictEqual([]);
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

  it('only allowlisted own fields survive and no seeded secret ever reaches the output (1,000 examples)', () => {
    fc.assert(fc.property(example, check), { numRuns: 1000 });
    expect(counts.projected).toBeGreaterThan(300);
    expect(counts.rejected).toBeGreaterThan(50);
    expect(counts.refused).toBeGreaterThan(100);
    expect(counts.multiLine).toBeGreaterThan(20);
    expect(counts.loaded).toBeGreaterThan(20);
    expect(counts.handBuilt).toBeGreaterThan(20);
    for (const channel of CHANNELS) expect(counts.channels[channel], channel).toBeGreaterThan(20);
    expect(reads.getters).toBe(0);
  });
});
