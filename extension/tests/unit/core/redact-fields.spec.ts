/**
 * Task 1.2, redact.ts field rules (docs/grading.md §10, §12; Hard Rules 2, 5): subjectHint is cut at
 * SCHEMA_LIMITS.SUBJECT_HINT code points without splitting a surrogate pair; any other allowlisted own value that
 * fails the Observation schema refuses the whole row with `invalid_field` (SEC-3: never coerced, never cut, never
 * silently dropped, so no stored row lacks a fact its source carried); occurredAt is required; arguments are
 * checked; and only own data properties of the raw row are read, while an allowlisted field held by an accessor or
 * inherited refuses the row unread (OBS-3).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { DEFAULT_POLICY, loadPolicy, type Policy, PolicyError } from '../../../src/core/policy';
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

describe('an allowlisted value that fails the schema refuses the row, never coerced or dropped', () => {
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
    ['merchant', 'Acme\nBooks'],
    ['merchant', 'Acme\u2028Books'],
    ['subjectHint', 'Your order\r\nShipped'],
    ['subjectHint', 'Your\torder'],
    ['subjectHint', '\u0000'],
  ])('%s = %s → invalid_field', (field, value) => {
    expectRedactError(() => receipt({ ...BASE, [field]: value }), 'invalid_field');
    // The same row without the field is a valid row: refusing it was about the value, not the row.
    expect(receipt(without(field))).not.toHaveProperty(field);
  });

  it.each([
    ['counterparty', 42],
    ['counterparty', null],
    ['counterparty', ['priya@company.com']],
    ['counterparty', `${'p'.repeat(SCHEMA_LIMITS.COUNTERPARTY)}@company.com`],
    ['counterparty', 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120. Thanks'],
    ['counterparty', 'priya@company.com\u2029'],
    ['counterparty', '\u0085priya@company.com'],
  ])('gmail.sent %s = %j → invalid_field', (field, value) => {
    const raw = { counterparty: 'priya@company.com', occurredAt: OCCURRED, [field]: value };
    expectRedactError(
      () => project('gmail.sent', raw, { ...CTX, type: 'email.sent' }, DEFAULT_POLICY),
      'invalid_field',
    );
  });
});

describe('a refused row reports the code only, and only a present allowlisted value can refuse it', () => {
  it('a refused value never reaches the error: the message and fields carry the code only', () => {
    const body = 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120. Thanks';
    let caught: unknown;
    try {
      project(
        'gcal.event',
        { counterparty: body, occurredAt: OCCURRED },
        { ...CTX, type: 'calendar.created' },
        DEFAULT_POLICY,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RedactError);
    const shown = `${String(caught)} ${JSON.stringify(caught)} ${JSON.stringify(Object.entries(caught ?? {}))}`;
    for (const part of ['4417', '078-05-1120', 'Priya']) expect(shown).not.toContain(part);
  });

  it('an allowlisted field set to undefined is absent, not refused', () => {
    expect(receipt({ ...BASE, merchant: undefined })).toStrictEqual(receipt(without('merchant')));
  });

  it('an invalid value in a field the source does not allowlist is never read, so it refuses nothing', () => {
    const raw = { ...BASE, counterparty: 'Hi\nthere', snippet: 'a\u2028b' };
    expect(receipt(raw)).toStrictEqual(receipt(BASE));
  });

  it('an invalid allowlisted field is reported before a missing occurredAt', () => {
    expectRedactError(() => receipt({ merchant: 'Acme\nBooks' }), 'invalid_field');
    expectRedactError(() => receipt({ ...BASE, occurredAt: 'yesterday' }), 'missing_occurred_at');
  });
});

describe('an allowlisted value at its cap is valid', () => {
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
    // v1.3 §12: the loader rejects an allowlist without occurredAt, so only a hand-built policy gets here;
    // project() still fails loud on it rather than inventing a time.
    const document = {
      ...defaultPolicyJson,
      allowlistedFields: { ...defaultPolicyJson.allowlistedFields, 'gmail.receipt': ['merchant'] },
    };
    expect(() => loadPolicy(document)).toThrow(PolicyError);
    const handBuilt: Pick<Policy, 'allowlistedFields'> = {
      allowlistedFields: { ...DEFAULT_POLICY.allowlistedFields, 'gmail.receipt': ['merchant'] },
    };
    expectRedactError(() => project('gmail.receipt', BASE, CTX, handBuilt), 'missing_occurred_at');
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

/** A getter that counts its calls: project() must never invoke one. */
function counted(value: unknown): { reads: number; descriptor: PropertyDescriptor } {
  const probe = { reads: 0, descriptor: {} as PropertyDescriptor };
  probe.descriptor = {
    enumerable: true,
    get: () => {
      probe.reads += 1;
      return value;
    },
  };
  return probe;
}

describe('an allowlisted field held by a getter or a prototype refuses the row (OBS-3)', () => {
  it('an inherited allowlisted field refuses the row: never read, never silently dropped', () => {
    expectRedactError(() => receipt(Object.create(BASE) as object), 'invalid_field');
    const mixed = Object.create({ merchant: 'Inherited Ltd' }) as Record<string, unknown>;
    mixed.occurredAt = OCCURRED;
    expectRedactError(() => receipt(mixed), 'invalid_field');
    const inheritedTime = Object.create({ occurredAt: OCCURRED }) as Record<string, unknown>;
    inheritedTime.merchant = 'Acme Books';
    expectRedactError(() => receipt(inheritedTime), 'invalid_field');
    const deep = Object.create(Object.create({ merchant: 'Inherited Ltd' }) as object) as object;
    expectRedactError(() => receipt(Object.assign(deep, { occurredAt: OCCURRED })), 'invalid_field');
  });

  it('a setter-only allowlisted field refuses the row too: any accessor, never a silent absence', () => {
    const raw = Object.defineProperty({ ...BASE }, 'merchant', { enumerable: true, set: () => undefined });
    expectRedactError(() => receipt(raw), 'invalid_field');
  });

  it('an allowlisted field held by a getter refuses the row, and the getter is never invoked', () => {
    for (const field of ['merchant', 'amountCents', 'occurredAt'] as const) {
      const getter = counted(BASE[field]);
      const raw = Object.defineProperty({ ...BASE }, field, getter.descriptor);
      expectRedactError(() => receipt(raw), 'invalid_field');
      expect(getter.reads, field).toBe(0);
    }
  });

  it('a row class with lazy getters (probe p1) is refused, not stored without its counterparty', () => {
    const getter = counted('priya@company.com');
    class Row {
      constructor(readonly occurredAt: string) {}
    }
    Object.defineProperty(Row.prototype, 'counterparty', getter.descriptor);
    const run = () =>
      project('gmail.sent', new Row(OCCURRED), { ...CTX, type: 'email.sent' }, DEFAULT_POLICY);
    expectRedactError(run, 'invalid_field');
    expect(getter.reads).toBe(0);
  });
});

describe('only own data properties of the raw row are read', () => {
  it('a getter or an inherited value on a field the allowlist does not name is never looked at', () => {
    const getter = counted('priya@company.com');
    const raw = Object.defineProperty(
      Object.create({ counterparty: 'p@x.com' }) as object,
      'body',
      getter.descriptor,
    );
    Object.defineProperty(raw, 'subjectHint', { value: 'Your order', enumerable: true });
    Object.assign(raw, { occurredAt: OCCURRED });
    expect(receipt(raw)).toStrictEqual(receipt({ subjectHint: 'Your order', occurredAt: OCCURRED }));
    expect(getter.reads).toBe(0);
  });

  it('an own data property shadows an inherited one, and an own undefined is absent', () => {
    const shadowed = Object.assign(Object.create({ merchant: 'Inherited Ltd' }) as object, BASE);
    expect(receipt(shadowed)).toStrictEqual(receipt(BASE));
    const absent = Object.assign(Object.create({ merchant: 'Inherited Ltd' }) as object, {
      ...BASE,
      merchant: undefined,
    });
    expect(receipt(absent)).not.toHaveProperty('merchant');
  });

  it('a frozen row with a null prototype is read without being written', () => {
    const raw = Object.freeze(Object.assign(Object.create(null) as object, BASE));
    expect(receipt(raw)).toStrictEqual(receipt(BASE));
  });
});
