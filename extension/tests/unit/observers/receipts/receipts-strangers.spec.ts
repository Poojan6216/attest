/**
 * Mail anyone can send (sprint_2 close: SEC-6, SEC-V2, SEC-7). The generic parser reads senders outside the receipt
 * registry, so its input is written by strangers:
 *
 *  - a generic receipt is evidence for a claim, never coverage: it posts no coverage point, so its own pass never
 *    makes it an orphan, so never an UNASKED (docs/grading.md §3, §7; Hard Rule 7). A registry receipt keeps its
 *    point, unless a generic receipt of the same pass shares its minute (the point would hold the stranger's row);
 *  - its display name must be plain Latin text: a look-alike of a registry brand ("Аmazon" with a Cyrillic А, a
 *    Lisu "ꓮꓟꓮꓜꓳꓠ", a fullwidth "Ａmazon", a bidi override) is refused before the brand check (Hard Rule 5);
 *  - a name `redact.project` would refuse (over SCHEMA_LIMITS.MERCHANT characters, a control character) drops only
 *    that message: the pass stays OK and a real receipt beside it keeps its coverage (Hard Rule 6 never cries wolf);
 *    so does a subject or an amount project would refuse, or a date in an hour the clock repeats;
 *  - a long hostile subject is classified in linear time: Gmail's tab must never stall on it.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs, SCHEMA_LIMITS } from '../../../../src/core/schema';
import {
  RECEIPT_SELECTORS,
  receiptObserver,
  receiptVerdicts,
} from '../../../../src/observers/gmail/receipts';
import { plainMerchantName } from '../../../../src/observers/gmail/receipts/generic';
import { type PassPlan, planPass } from '../../../../src/observers/plan';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { type MessageSpec, onPage, type PageSpec, rows } from './message-page';

const ctx = { observedAt: IsoTs.parse('2026-10-03T10:30:00-04:00'), offsetAt: () => -240 };
const AT = '2026-10-02T16:17:00-04:00';
const TOTAL = rows([['Order total', '$499.00']]);

/** A stranger's order confirmation: a non-registry sender, a trigger subject, a total line. */
const stranger = (name: string, extra: Partial<MessageSpec> = {}): MessageSpec => ({
  from: 'orders@shop-deals.example',
  name,
  body: TOTAL,
  ...extra,
});
const UBER: MessageSpec = {
  from: 'noreply@uber.com',
  body: rows([['Total', '$23.84']]),
  key: '1a00000000000ub1',
};

const plan = (spec: PageSpec): PassPlan =>
  onPage(spec, (doc) => planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }));
const windows = (result: PassPlan): string[][] =>
  result.status === 'OK' ? result.coverage.map((c) => [c.windowStart, c.windowEnd]) : [];

describe('a generic receipt is evidence, never coverage (SEC-6)', () => {
  it("a stranger's order confirmation is read, and posts no coverage point", () => {
    const result = plan({ subject: 'Your order confirmation', messages: [stranger('Best Buy')] });
    expect(result.status).toBe('OK_NO_COVERAGE');
    expect(result.observations.map((o) => [o.merchant, o.amountCents, o.occurredAt])).toEqual([
      ['Best Buy', 49900, AT],
    ]);
  });

  it('a registry receipt still covers its own instant', () => {
    expect(windows(plan({ subject: 'Your Thursday evening trip with Uber', messages: [UBER] }))).toEqual([
      [AT, AT],
    ]);
  });

  it('a registry receipt in the same minute as a generic one of the pass posts no point either', () => {
    const together = plan({
      subject: 'Your order receipt: trip with Uber',
      messages: [UBER, stranger('Shop')],
    });
    expect(together.observations).toHaveLength(2);
    expect(together.status).toBe('OK_NO_COVERAGE');
    const apart = plan({
      subject: 'Your order receipt: trip with Uber',
      messages: [UBER, stranger('Shop', { title: 'Fri, Oct 2, 2026, 4:18 PM' })],
    });
    expect(windows(apart)).toEqual([[AT, AT]]);
  });
});

describe('the display name is plain Latin text, checked before the brand (SEC-6)', () => {
  it.each([
    ['a Cyrillic А in a Latin name', 'Аmazon'],
    ['a Lisu name that reads AMAZON', 'ꓮꓟꓮꓜꓳꓠ'],
    ['a whole Cyrillic name', 'Пекарня'],
    ['a Latin letter outside ASCII that can pass for an a', 'ɑmazon'],
    ['a dotless i', 'Strıpe Payments'],
    ['fullwidth letters', 'Ａmazon'],
    ['mathematical letters', '𝐁𝐞𝐬𝐭 𝐁𝐮𝐲'],
    ['a bidi override', '‮nozama'],
    ['a zero-width joiner', 'Ama‍zon'],
  ])('%s is refused: not a receipt, and the pass stays OK', (_case, name) => {
    expect(plainMerchantName(name)).toBe(false);
    const result = plan({ subject: 'Your order confirmation', messages: [stranger(name)] });
    expect(result).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
  });

  it.each(['Café Rouge', 'Müller & Söhne', 'Corner Shop #12', 'AT&T Store', ''])(
    'a plain name (%s) is still a receipt',
    (name) => {
      expect(plainMerchantName(name)).toBe(true);
      const [verdict] = onPage(
        { subject: 'Your order confirmation', messages: [stranger(name)] },
        receiptVerdicts,
      );
      expect(verdict?.verdict.kind).toBe('receipt');
    },
  );

  it('an ASCII brand name is still refused by the brand check', () => {
    expect(plan({ subject: 'Your order confirmation', messages: [stranger('Amazon')] }).observations).toEqual(
      [],
    );
  });
});

describe("a stranger's name never voids a real receipt (SEC-V2)", () => {
  const limit = SCHEMA_LIMITS.MERCHANT;

  it(`a name of ${String(limit)} characters is read; ${String(limit + 1)} is not a receipt, and the pass is OK`, () => {
    const at = plan({ subject: 'Your order confirmation', messages: [stranger('S'.repeat(limit))] });
    expect(at.observations.map((o) => o.merchant)).toEqual(['S'.repeat(limit)]);
    const over = plan({ subject: 'Your order confirmation', messages: [stranger('S'.repeat(limit + 1))] });
    expect(over).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
  });

  it('a name with a control character is not a receipt, and the pass is OK', () => {
    const result = plan({ subject: 'Your order confirmation', messages: [stranger('Shop\u0007')] });
    expect(result).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
  });

  it("a real receipt beside a stranger's 130-character name keeps its row and its coverage point", () => {
    const result = plan({
      subject: 'Your order receipt: trip with Uber',
      messages: [UBER, stranger('S'.repeat(130), { title: 'Fri, Oct 2, 2026, 4:18 PM' })],
    });
    expect(result.status).toBe('OK');
    expect(result.observations.map((o) => o.merchant)).toEqual(['Uber']);
    expect(windows(result)).toEqual([[AT, AT]]);
  });
});

describe("a stranger's subject, amount and arrival time never make the pass DEGRADED (SEC-V2)", () => {
  const AMOUNT_CAP = SCHEMA_LIMITS.AMOUNT_CENTS;
  const totalOf = (value: string): string => rows([['Order total', value]]);
  /** The November fall-back repeats 1:00-2:00 AM in New York, so 1:30 AM names no single minute. */
  const fallBack = {
    observedAt: IsoTs.parse('2026-11-01T09:00:00-05:00'),
    offsetAt: zoneOffset('America/New_York'),
  };

  it('a subject with a control character is not a receipt, and the pass is OK', () => {
    const result = plan({ subject: 'Your order confirmation\u0007', messages: [stranger('Corner Shop')] });
    expect(result).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
  });

  it(`an amount over ${String(AMOUNT_CAP)} cents is not a receipt; one at it is read`, () => {
    const over = stranger('Corner Shop', { body: totalOf('$99,999,999,999.99') });
    expect(plan({ subject: 'Your order confirmation', messages: [over] })).toEqual({
      status: 'OK_NO_COVERAGE',
      observations: [],
    });
    const at = stranger('Corner Shop', { body: totalOf('$10,000,000,000.00') });
    const read = plan({ subject: 'Your order confirmation', messages: [at] });
    expect(read.observations.map((o) => o.amountCents)).toEqual([AMOUNT_CAP]);
  });

  it('a generic receipt sent in an hour the clock repeats is dropped, never guessed: the pass is OK', () => {
    const late = stranger('Corner Shop', { title: 'Sun, Nov 1, 2026, 1:30 AM' });
    const result = onPage({ subject: 'Your order confirmation', messages: [late] }, (doc) =>
      planPass({ observer: receiptObserver, doc, ctx: fallBack, policy: DEFAULT_POLICY }),
    );
    expect(result).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
  });

  it("a real receipt beside a stranger's huge amount or repeated hour keeps its row and its point", () => {
    const strangers = [
      stranger('Corner Shop', { body: totalOf('$99,999,999,999.99'), title: 'Fri, Oct 2, 2026, 4:18 PM' }),
      stranger('Corner Shop', { title: 'Sun, Nov 1, 2026, 1:30 AM' }),
    ];
    for (const other of strangers) {
      const result = onPage(
        { subject: 'Your order receipt: trip with Uber', messages: [UBER, other] },
        (doc) => planPass({ observer: receiptObserver, doc, ctx: fallBack, policy: DEFAULT_POLICY }),
      );
      expect(result.status).toBe('OK');
      expect(result.observations.map((o) => o.merchant)).toEqual(['Uber']);
      expect(windows(result)).toEqual([[AT, AT]]);
    }
  });
});

// A quadratic pattern takes seconds on these subjects (13 s for 100,000 digits); a linear one a few milliseconds.
// The bounds sit far above the linear cost, so a busy machine or a garbage collection never fails them.
describe('a long hostile subject is classified in linear time (SEC-7)', () => {
  const elapsed = (run: () => unknown): number => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it('the refusal list on 100,000 digits with no "%" (quadratic before: tens of seconds)', () => {
    const subject = `Your order ${'1'.repeat(100_000)}`;
    expect(elapsed(() => RECEIPT_SELECTORS.generic.refuseSubject.test(subject))).toBeLessThan(250);
    expect(RECEIPT_SELECTORS.generic.refuseSubject.test('Order now: 40% off ends tonight')).toBe(true);
    expect(RECEIPT_SELECTORS.generic.refuseSubject.test('Save 15 % off today')).toBe(true);
  });

  it.each([
    ['digits', '7'.repeat(50_000)],
    ['spaces between digits', '1 '.repeat(25_000)],
    ['percent signs', '9%'.repeat(25_000)],
    ['repeated words', 'order receipt confirmation '.repeat(2_000)],
  ])('every subject pattern runs fast on %s', (_case, run) => {
    const subject = `Your order ${run}`;
    const patterns = [RECEIPT_SELECTORS.generic.subjectTrigger, RECEIPT_SELECTORS.generic.refuseSubject];
    for (const pattern of patterns) expect(elapsed(() => pattern.test(subject))).toBeLessThan(250);
  });

  it('a whole pass over a conversation whose subject is 100,000 digits', () => {
    const subject = `Your order ${'1'.repeat(100_000)}`;
    const took = elapsed(() => plan({ subject, messages: [stranger('Corner Shop')] }));
    expect(took).toBeLessThan(1_000);
  });
});
