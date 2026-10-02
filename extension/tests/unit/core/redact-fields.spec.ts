/**
 * Task 1.2, redact.ts field rules (docs/grading.md §10, §12; Hard Rule 2): subjectHint is cut at
 * SCHEMA_LIMITS.SUBJECT_HINT code points without splitting a surrogate pair; any other allowlisted value that
 * fails the Observation schema is dropped, never coerced; occurredAt is required; arguments are checked; and
 * only own data properties of the raw row are read.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import {
  clampSubjectHint,
  project,
  type ProjectContext,
  RedactError,
  type RedactErrorCode,
} from '../../../src/core/redact';
import {
  type ActionType,
  Observation,
  type ObservationSource,
  SCHEMA_LIMITS,
} from '../../../src/core/schema';

const OCCURRED = '2026-10-06T14:02:00-04:00';
const CTX: ProjectContext = { type: 'purchase.made', observedAt: '2026-10-06T14:40:00-04:00' };
const BASE = Object.freeze({
  merchant: 'Acme Books',
  amountCents: 1250,
  currency: 'USD',
  subjectHint: 'Your order',
  occurredAt: OCCURRED,
});
const SMILE = '\u{1F600}';
const SUBJECT = SCHEMA_LIMITS.SUBJECT_HINT;

const receipt = (raw: unknown, ctx: ProjectContext = CTX) =>
  project('gmail.receipt', raw, ctx, DEFAULT_POLICY);

/** BASE without one field. */
const without = (field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(BASE).filter(([key]) => key !== field));

function expectRedactError(run: () => unknown, code: RedactErrorCode): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RedactError);
  expect(caught).toMatchObject({ code, message: `redact: ${code}` });
}

describe('subjectHint is cut at SUBJECT_HINT code points, never inside a surrogate pair', () => {
  it.each([
    ['empty', '', ''],
    ['exactly the cap', 'a'.repeat(SUBJECT), 'a'.repeat(SUBJECT)],
    ['one over the cap', 'a'.repeat(SUBJECT + 1), 'a'.repeat(SUBJECT)],
    [
      'a pair as the last kept code point',
      `${'a'.repeat(SUBJECT - 1)}${SMILE}b`,
      `${'a'.repeat(SUBJECT - 1)}${SMILE}`,
    ],
    ['a pair just past the cap', `${'a'.repeat(SUBJECT)}${SMILE}`, 'a'.repeat(SUBJECT)],
    ['only pairs, one over', SMILE.repeat(SUBJECT + 1), SMILE.repeat(SUBJECT)],
    [
      'a lone high surrogate counts as one',
      `${'a'.repeat(SUBJECT - 1)}\uD800b`,
      `${'a'.repeat(SUBJECT - 1)}\uD800`,
    ],
    ['a lone low surrogate past the cap', `${'a'.repeat(SUBJECT)}\uDE00`, 'a'.repeat(SUBJECT)],
  ])('%s', (_label, input, expected) => {
    expect(clampSubjectHint(input)).toBe(expected);
    const out = receipt({ ...BASE, subjectHint: input });
    expect(out.subjectHint).toBe(expected);
    expect(Observation.safeParse(out).success).toBe(true);
  });

  it('a pair is never split: the kept text never ends in a high surrogate followed by a dropped low one', () => {
    const out = receipt({ ...BASE, subjectHint: `${'a'.repeat(SUBJECT - 1)}${SMILE.repeat(3)}` });
    expect(out.subjectHint).toBe(`${'a'.repeat(SUBJECT - 1)}${SMILE}`);
    expect(Array.from(out.subjectHint ?? '')).toHaveLength(SUBJECT);
  });

  it('the hash covers the stored (cut) text, so two rows that store the same text are one', () => {
    const cut = receipt({ ...BASE, subjectHint: `${'x'.repeat(SUBJECT)}first tail` });
    expect(receipt({ ...BASE, subjectHint: `${'x'.repeat(SUBJECT)}other tail` })).toStrictEqual(cut);
    expect(receipt({ ...BASE, subjectHint: 'x'.repeat(SUBJECT) })).toStrictEqual(cut);
  });
});

describe('an allowlisted value that fails the schema is dropped, never coerced', () => {
  const overCap = (cap: number): string => 'm'.repeat(cap + 1);

  it.each([
    ['merchant', 42],
    ['merchant', null],
    ['merchant', ['Acme Books']],
    ['merchant', { name: 'Acme Books' }],
    ['merchant', overCap(SCHEMA_LIMITS.MERCHANT)],
    ['amountCents', '1250'],
    ['amountCents', 12.5],
    ['amountCents', -1],
    ['amountCents', SCHEMA_LIMITS.AMOUNT_CENTS + 1],
    ['amountCents', Number.NaN],
    ['amountCents', Number.POSITIVE_INFINITY],
    ['amountCents', 1250n],
    ['amountCents', true],
    ['currency', 'usd'],
    ['currency', 'US'],
    ['currency', 'USDD'],
    ['currency', 840],
    ['subjectHint', 42],
    ['subjectHint', { text: 'Your order' }],
    ['subjectHint', ['Your order']],
  ])('%s = %s', (field, value) => {
    const out = receipt({ ...BASE, [field]: value });
    expect(out).not.toHaveProperty(field);
    expect(out).toStrictEqual(receipt(without(field)));
  });

  it.each([
    ['counterparty', 42],
    ['counterparty', ['priya@company.com']],
    ['counterparty', `${'p'.repeat(SCHEMA_LIMITS.COUNTERPARTY)}@company.com`],
  ])('gmail.sent %s = %j', (field, value) => {
    const raw = { counterparty: 'priya@company.com', occurredAt: OCCURRED, [field]: value };
    const out = project('gmail.sent', raw, { ...CTX, type: 'email.sent' }, DEFAULT_POLICY);
    expect(out).not.toHaveProperty(field);
  });

  it('keeps values exactly at each cap', () => {
    const merchant = 'm'.repeat(SCHEMA_LIMITS.MERCHANT);
    expect(receipt({ ...BASE, merchant, amountCents: SCHEMA_LIMITS.AMOUNT_CENTS })).toMatchObject({
      merchant,
      amountCents: SCHEMA_LIMITS.AMOUNT_CENTS,
    });
    expect(receipt({ ...BASE, amountCents: 0 }).amountCents).toBe(0);
    // -0 passes int().min(0) and is kept as given (never coerced); canonical JSON writes it as 0 (§10), so it
    // is the same observation as 0: one contentHash, one id.
    const negativeZero = receipt({ ...BASE, amountCents: -0 });
    expect(Object.is(negativeZero.amountCents, -0)).toBe(true);
    expect(negativeZero.contentHash).toBe(receipt({ ...BASE, amountCents: 0 }).contentHash);
    expect(negativeZero.id).toBe(receipt({ ...BASE, amountCents: 0 }).id);
    const counterparty = `${'p'.repeat(SCHEMA_LIMITS.COUNTERPARTY - '@x.co'.length)}@x.co`;
    const raw = { counterparty, occurredAt: OCCURRED };
    expect(project('gmail.sent', raw, { ...CTX, type: 'email.sent' }, DEFAULT_POLICY).counterparty).toBe(
      counterparty,
    );
  });
});

describe('occurredAt is required', () => {
  const noTime = without('occurredAt');

  it.each([
    ['missing', noTime],
    ['not a timestamp', { ...BASE, occurredAt: 'yesterday 7731-QUOKKA' }],
    ['no offset', { ...BASE, occurredAt: '2026-10-06T14:02:00' }],
    ['no seconds', { ...BASE, occurredAt: '2026-10-06T14:02-04:00' }],
    ['impossible date', { ...BASE, occurredAt: '2026-13-01T00:00:00Z' }],
    ['a number', { ...BASE, occurredAt: 1_791_000_000_000 }],
    ['null raw', null],
    ['a string raw', OCCURRED],
    ['a number raw', 42],
    ['an array raw', [OCCURRED]],
  ])('%s → missing_occurred_at, with no content in the message', (_label, raw) => {
    expectRedactError(() => receipt(raw), 'missing_occurred_at');
  });

  it('a valid occurredAt that the source allowlist omits is missing', () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      allowlistedFields: { ...defaultPolicyJson.allowlistedFields, 'gmail.receipt': ['merchant'] },
    });
    expectRedactError(() => project('gmail.receipt', BASE, CTX, policy), 'missing_occurred_at');
  });
});

describe('arguments are checked', () => {
  // z.custom<T>() accepts anything: it hands the runtime checks values the type system would refuse, as an
  // untyped caller could.
  it.each([
    ['source', z.custom<ObservationSource>().parse('gmail.inbox'), CTX],
    ['type', 'gmail.receipt', { ...CTX, type: z.custom<ActionType>().parse('email.received') }],
    ['observedAt without offset', 'gmail.receipt', { ...CTX, observedAt: '2026-10-06T14:40:00' }],
    ['observedAt not a time', 'gmail.receipt', { ...CTX, observedAt: 'now' }],
    ['rowKey not a string', 'gmail.receipt', { ...CTX, rowKey: z.custom<string>().parse(7) }],
    ['a misspelt rowKey', 'gmail.receipt', z.custom<ProjectContext>().parse({ ...CTX, rowkey: 'send-1' })],
  ] as const)('%s → invalid_argument', (_label, source, ctx) => {
    expectRedactError(() => project(source, BASE, ctx, DEFAULT_POLICY), 'invalid_argument');
  });
});

describe('only own data properties of the raw row are read', () => {
  it('inherited properties never become content', () => {
    const inherited = Object.create(BASE) as object;
    expectRedactError(() => receipt(inherited), 'missing_occurred_at');
    const mixed = Object.create({ merchant: 'Inherited Ltd' }) as Record<string, unknown>;
    mixed.occurredAt = OCCURRED;
    expect(receipt(mixed)).not.toHaveProperty('merchant');
  });

  it('getters are never invoked', () => {
    let reads = 0;
    const raw = { ...BASE };
    Object.defineProperty(raw, 'merchant', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'Getter Ltd';
      },
    });
    expect(receipt(raw)).not.toHaveProperty('merchant');
    expect(reads).toBe(0);
  });

  it('a frozen row with a null prototype is read without being written', () => {
    const raw = Object.freeze(Object.assign(Object.create(null) as object, BASE));
    expect(receipt(raw)).toStrictEqual(receipt(BASE));
  });
});
