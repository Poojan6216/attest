/**
 * Task 1.2 adversarial cases (Hard Rule 2; docs/grading.md §10): ways a raw row might try to smuggle content
 * through project() that the table and property tests do not reach. Prototype keys (`__proto__` as an own
 * key from JSON.parse, `__proto__` as a literal prototype, `constructor`), proxies whose `get` lies, values
 * that coerce to a valid string (boxed primitives, toString, toJSON, Symbol.toPrimitive), arrays and
 * functions as rows, non-enumerable and symbol keys, and code points at every cap.
 *
 * Each case names a secret that must never appear in JSON.stringify(output), and pins the exact output.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { clampSubjectHint, project, type ProjectContext, RedactError } from '../../../src/core/redact';
import { Observation, SCHEMA_LIMITS } from '../../../src/core/schema';

const OCCURRED = '2026-10-06T14:02:00-04:00';
const SECRET = 'vault code 7731-QUOKKA';
const SENT: ProjectContext = { type: 'email.sent', observedAt: '2026-10-06T14:40:00-04:00' };
const RECEIPT: ProjectContext = { type: 'purchase.made', observedAt: '2026-10-06T14:40:00-04:00' };
const SMILE = '\u{1F600}';

const sent = (raw: unknown) => project('gmail.sent', raw, SENT, DEFAULT_POLICY);
const receipt = (raw: unknown) => project('gmail.receipt', raw, RECEIPT, DEFAULT_POLICY);
const MINIMAL_SENT = () => sent({ occurredAt: OCCURRED });
const MINIMAL_RECEIPT = () => receipt({ occurredAt: OCCURRED });
/** A boxed primitive (`new String(x)`, `new Number(x)`), typed as unknown. */
const boxed = (value: string | number): unknown => Object(value);

function expectClean(out: Observation): void {
  const text = JSON.stringify(out);
  expect(text).not.toContain('7731');
  expect(text).not.toContain('QUOKKA');
  expect(Observation.safeParse(out).success).toBe(true);
}

describe('prototype keys never carry content', () => {
  it('an own "__proto__" key from JSON.parse is not a content field and pollutes nothing', () => {
    const raw: unknown = JSON.parse(
      `{"__proto__":{"subjectHint":"${SECRET}","counterparty":"${SECRET}"},"occurredAt":"${OCCURRED}"}`,
    );
    const out = sent(raw);
    expect(out).toStrictEqual(MINIMAL_SENT());
    expectClean(out);
    expect(Object.prototype).not.toHaveProperty('subjectHint');
  });

  it('a literal __proto__ (a real prototype) is inherited, so it is never read', () => {
    const out = sent({ __proto__: { subjectHint: SECRET, occurredAt: OCCURRED }, occurredAt: OCCURRED });
    expect(out).toStrictEqual(MINIMAL_SENT());
    expectClean(out);
  });

  it('a constructor key holding content is dropped', () => {
    const out = sent({ constructor: { subjectHint: SECRET }, occurredAt: OCCURRED });
    expect(out).toStrictEqual(MINIMAL_SENT());
    expectClean(out);
  });
});

describe('a proxy whose get trap lies is read through its own-property descriptors only', () => {
  it('get returns a secret for every key, but no own property exists → nothing is read', () => {
    const raw = new Proxy({}, { get: () => SECRET, has: () => true });
    expect(() => sent(raw)).toThrow(RedactError);
  });

  it('get lies about an own property; the descriptor value is what is kept', () => {
    const raw = new Proxy({ subjectHint: 'Q3 deck', occurredAt: OCCURRED }, { get: () => SECRET });
    const out = sent(raw);
    expect(out.subjectHint).toBe('Q3 deck');
    expectClean(out);
  });
});

describe('a value that only coerces to a valid one is dropped, never coerced', () => {
  const coercing: readonly (readonly [string, unknown])[] = [
    ['a boxed string', boxed(SECRET)],
    ['an object with toString', { toString: () => SECRET }],
    ['an object with toJSON', { toJSON: () => SECRET }],
    ['an object with Symbol.toPrimitive', { [Symbol.toPrimitive]: () => SECRET }],
    ['a function', () => SECRET],
    ['a symbol', Symbol(SECRET)],
  ];

  it.each(coercing)('subjectHint and counterparty as %s', (_label, value) => {
    const out = sent({ subjectHint: value, counterparty: value, occurredAt: OCCURRED });
    expect(out).toStrictEqual(MINIMAL_SENT());
    expectClean(out);
  });

  it.each(coercing)('merchant as %s', (_label, value) => {
    const out = receipt({ merchant: value, occurredAt: OCCURRED });
    expect(out).toStrictEqual(MINIMAL_RECEIPT());
    expectClean(out);
  });

  it.each<readonly [string, unknown]>([
    ['a boxed number', boxed(7731)],
    ['a numeric string', '7731'],
    ['an object with valueOf', { valueOf: () => 7731 }],
    ['a Date', new Date(7731)],
  ])('amountCents as %s', (_label, value) => {
    const out = receipt({ amountCents: value, occurredAt: OCCURRED });
    expect(out).toStrictEqual(MINIMAL_RECEIPT());
    expect(JSON.stringify(out)).not.toContain('7731');
  });

  it.each<readonly [string, unknown]>([
    ['a Date', new Date(OCCURRED)],
    ['a boxed string', boxed(OCCURRED)],
    ['an object with toJSON', { toJSON: () => OCCURRED }],
  ])('occurredAt as %s is missing', (_label, value) => {
    expect(() => sent({ occurredAt: value })).toThrow('redact: missing_occurred_at');
  });
});

describe('a kept value is stored exactly as read (§11: never lowercased, NFKC-folded or trimmed)', () => {
  it.each([
    ['ASCII capitals', 'Priya@Company.COM'],
    ['a fullwidth p', '\uFF50riya@company.com'],
    ['a Kelvin sign', '\u212Aate@company.com'],
    ['a dotless i', 'pr\u0131ya@company.com'],
    ['surrounding spaces', '  priya@company.com  '],
  ])('counterparty with %s', (_label, counterparty) => {
    expect(sent({ counterparty, occurredAt: OCCURRED }).counterparty).toBe(counterparty);
  });

  it('subjectHint keeps spaces, case, compatibility forms and decomposed marks', () => {
    const subjectHint = '  Re: Q\u2462 Cafe\u0301 \uFB01le  ';
    expect(sent({ subjectHint, occurredAt: OCCURRED }).subjectHint).toBe(subjectHint);
  });
});

describe('unusual rows', () => {
  it('an array row reads only its own named properties, never its elements', () => {
    const raw = Object.assign([SECRET, { subjectHint: SECRET }], { occurredAt: OCCURRED });
    const out = sent(raw);
    expect(out).toStrictEqual(MINIMAL_SENT());
    expectClean(out);
  });

  it('a function row is not an object row: it has no fields', () => {
    const raw = Object.assign(() => SECRET, { occurredAt: OCCURRED, subjectHint: 'Q3 deck' });
    expect(() => sent(raw)).toThrow('redact: missing_occurred_at');
  });

  it('symbol keys are never read; a non-enumerable own data property is an own value like any other', () => {
    const raw: Record<string | symbol, unknown> = { occurredAt: OCCURRED, [Symbol('subjectHint')]: SECRET };
    Object.defineProperty(raw, 'counterparty', { value: 'priya@company.com', enumerable: false });
    const out = sent(raw);
    expect(out.counterparty).toBe('priya@company.com');
    expect(out).not.toHaveProperty('subjectHint');
    expectClean(out);
  });

  it('raw "rowKey" and "ref" keys are not a row key: only ctx.rowKey is hashed', () => {
    const out = sent({ occurredAt: OCCURRED, rowKey: SECRET, ref: SECRET });
    expect(out).toStrictEqual(MINIMAL_SENT());
    expectClean(out);
  });

  it('the row key itself never appears in the output, only its hash', () => {
    const out = project('gmail.sent', { occurredAt: OCCURRED }, { ...SENT, rowKey: SECRET }, DEFAULT_POLICY);
    expect(out.rowKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expectClean(out);
  });
});

describe('every cap, at and beyond, in code points', () => {
  it('counterparty: exactly the cap in astral code points is kept; one more is dropped whole', () => {
    const at = SMILE.repeat(SCHEMA_LIMITS.COUNTERPARTY);
    expect(sent({ counterparty: at, occurredAt: OCCURRED }).counterparty).toBe(at);
    expect(sent({ counterparty: `${at}a`, occurredAt: OCCURRED })).toStrictEqual(MINIMAL_SENT());
  });

  it('merchant: exactly the cap is kept; one more is dropped whole, never cut', () => {
    const at = SMILE.repeat(SCHEMA_LIMITS.MERCHANT);
    expect(receipt({ merchant: at, occurredAt: OCCURRED }).merchant).toBe(at);
    const over = `${'m'.repeat(SCHEMA_LIMITS.MERCHANT)}${SECRET}`;
    const out = receipt({ merchant: over, occurredAt: OCCURRED });
    expect(out).toStrictEqual(MINIMAL_RECEIPT());
    expectClean(out);
  });

  it('subjectHint: a secret starting at the 81st code point never survives, whatever precedes it', () => {
    for (const unit of ['a', SMILE, '\uD800', 'e\u0301']) {
      const pad = Array.from({ length: SCHEMA_LIMITS.SUBJECT_HINT }, () => unit).join('');
      const prefix = Array.from(pad).slice(0, SCHEMA_LIMITS.SUBJECT_HINT).join('');
      const out = sent({ subjectHint: `${prefix}${SECRET}`, occurredAt: OCCURRED });
      expect(out.subjectHint).toBe(prefix);
      expectClean(out);
    }
  });

  it('subjectHint: a pair at the 80th code point is kept whole, a pair at the 81st is dropped whole', () => {
    const head = 'a'.repeat(SCHEMA_LIMITS.SUBJECT_HINT - 1);
    expect(clampSubjectHint(`${head}${SMILE}${SMILE}`)).toBe(`${head}${SMILE}`);
    const kept = sent({ subjectHint: `${head}${SMILE}${SMILE}`, occurredAt: OCCURRED }).subjectHint ?? '';
    expect(kept).toBe(`${head}${SMILE}`);
    expect(kept.length).toBe(SCHEMA_LIMITS.SUBJECT_HINT + 1);
    expect(kept.at(-1)).toBe('\uDE00');
  });

  it('occurredAt: a valid but over-long timestamp is missing, not cut', () => {
    expect(() => sent({ occurredAt: '2026-10-06T14:02:00.1234567890123+00:00' })).toThrow(
      'redact: missing_occurred_at',
    );
  });
});
