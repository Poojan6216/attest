/**
 * Property tests for the receipt state machine (docs/grading.md §8; task 1.6, contract v1.4), 1,000 runs each:
 *  - a random sequence of well-formed events, checked step by step against an independent model of the §8
 *    table and its v1.4 payload rules (regrade: computed no earlier, UNASKED stays UNASKED; override: at no
 *    earlier than computedAt): each legal event lands in the model's state, each illegal one throws the model's
 *    code and changes nothing,
 *    every receipt parses with the Receipt schema with its lifecycle reasons last and in §15 order, and no
 *    event but `regrade` changes the computed grade (or any other computed field);
 *  - the same with arbitrary, mostly invalid payloads and unknown event kinds: the only failure is an
 *    IllegalTransitionError, and nothing schema-invalid ever comes out;
 *  - override then revert restores the exact prior receipt, for any receipt and any valid override.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Grade, type Reason, Receipt, type ReceiptState } from '../../src/core/schema';
import {
  type IllegalTransitionCode,
  IllegalTransitionError,
  type ReceiptEvent,
  transition,
} from '../../src/core/state';

const RUNS = { numRuns: 1_000 };
const PROPERTY_TIMEOUT_MS = 30_000;

const ulid = (n: number): string => String(n).padStart(26, '0');
const HASHES = ['ab'.repeat(32), 'cd'.repeat(32)];
const CLAIM_SUBJECT = { id: ulid(1), claimId: ulid(2) };
const UNASKED_SUBJECT = { id: ulid(11), attribution: 'likely' };

const GRADED_REASONS = [
  { code: 'match.none', params: {} },
  { code: 'match.best', params: { observationId: ulid(12) } },
  { code: 'grace.waiting', params: { source: 'gmail.sent' } },
  { code: 'coverage.partial', params: { source: 'gcal.event' } },
  { code: 'cp.plus_tag', params: {} },
  { code: 'unasked.session', params: { agent: 'muse' } },
] as const;
const CLAIM_GRADES = Grade.options.filter((grade) => grade !== 'UNASKED');
const LIFECYCLE: ReadonlySet<string> = new Set(['override.user', 'superseded']);
const NOT_COMPUTED: ReadonlySet<string> = new Set(['state', 'override', 'supersededBy', 'reasons']);

type Kind = 'claim' | 'unasked';

const isoArb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z'), noInvalidDate: true })
  .map((date) => date.toISOString());
const ulidArb = fc.integer({ min: 100, max: 999_999 }).map(ulid);
const visibleReasonArb = fc
  .tuple(
    fc.string({ maxLength: 50 }),
    fc.constantFrom('a', 'Z', '9', 'é', '中'),
    fc.string({ maxLength: 50 }),
  )
  .map(([before, visible, after]) => `${before}${visible}${after}`);

/** The computed part of a receipt, as grade() would write it for `kind`'s subject. */
const computedArb = (kind: Kind) =>
  fc.record({
    state: fc.constantFrom<'PENDING' | 'FINAL'>('PENDING', 'FINAL'),
    grade: kind === 'claim' ? fc.constantFrom(...CLAIM_GRADES) : fc.constant('UNASKED' as const),
    confidence: fc.constantFrom(0, 0.5, 0.7, 1),
    reasons: fc.array(fc.constantFrom(...GRADED_REASONS), { maxLength: 6 }),
    computedAt: isoArb,
    inputsHash: fc.constantFrom(...HASHES),
  });

type Computed = ReturnType<typeof computedArb> extends fc.Arbitrary<infer T> ? T : never;

/** The orphan subject's id without attribution: a claim-less receipt of another grade for the same orphan. */
const ORPHAN_OTHER_SUBJECT = { id: UNASKED_SUBJECT.id };

function build(kind: Kind | 'orphanOther', computed: Computed, id?: string): Receipt {
  const subject =
    kind === 'claim' ? CLAIM_SUBJECT : kind === 'unasked' ? UNASKED_SUBJECT : ORPHAN_OTHER_SUBJECT;
  return Receipt.parse({
    ...subject,
    ...(id === undefined ? {} : { id }),
    agent: 'muse',
    observationIds: [],
    ruleId: 'some_rule',
    signals: {},
    policyHash: HASHES[0],
    ...computed,
    ...(computed.state === 'FINAL' ? { finalAt: computed.computedAt } : {}),
  });
}

const overrideArb = fc.record({
  event: fc.constant('override' as const),
  grade: fc.constantFrom<'VERIFIED' | 'NOT_FOUND'>('VERIFIED', 'NOT_FOUND'),
  reason: visibleReasonArb,
  at: isoArb,
});

/**
 * Well-formed events for `kind`'s subject: the (state, event) pair and the v1.4 payload rules decide. For an
 * UNASKED subject, a regrade may carry the same orphan re-evaluated to another grade (refused, §8).
 */
const eventArb = (kind: Kind): fc.Arbitrary<ReceiptEvent> =>
  fc.oneof(
    computedArb(kind).map((computed): ReceiptEvent => ({ event: 'regrade', next: build(kind, computed) })),
    computedArb('claim').map((computed): ReceiptEvent => ({
      event: 'regrade',
      next: build(kind === 'claim' ? 'claim' : 'orphanOther', computed),
    })),
    overrideArb,
    fc.constant({ event: 'revert' as const }),
    ulidArb.map((claimId): ReceiptEvent => ({ event: 'supersede', claimId })),
  );

const scenarioArb = fc.constantFrom<Kind>('claim', 'unasked').chain((kind) =>
  fc.record({
    kind: fc.constant(kind),
    start: computedArb(kind).map((computed) => build(kind, computed)),
    events: fc.array(eventArb(kind), { minLength: 1, maxLength: 12 }),
  }),
);

const instant = (iso: string): number => Date.parse(iso);

/** §8 regrade from PENDING (v1.4): computed no earlier, and an UNASKED receipt only to an UNASKED one. */
function regradeModel(current: Receipt, next: Receipt): ReceiptState | IllegalTransitionCode {
  if (instant(next.computedAt) < instant(current.computedAt)) return 'regrade_stale';
  if (current.grade === 'UNASKED' && next.grade !== 'UNASKED') return 'regrade_not_unasked';
  return next.state;
}

/** The §8 table, independently: the state a legal event leads to, or the code an illegal one throws. */
function model(current: Receipt, event: ReceiptEvent): ReceiptState | IllegalTransitionCode {
  switch (event.event) {
    case 'regrade':
      if (current.state === 'FINAL') return 'regrade_final';
      if (current.state === 'USER_OVERRIDDEN') return 'regrade_overridden';
      return current.supersededBy === undefined ? regradeModel(current, event.next) : 'regrade_superseded';
    case 'override':
      if (current.state === 'USER_OVERRIDDEN') return 'already_overridden';
      return instant(event.at) < instant(current.computedAt) ? 'invalid_event' : 'USER_OVERRIDDEN';
    case 'revert':
      return current.override?.previousState ?? 'not_overridden';
    case 'supersede':
      return current.grade === 'UNASKED' ? current.state : 'not_unasked';
  }
}

/** Graded reasons, then override.user, then superseded (§15). */
function lifecycleOrdered(receipt: Receipt): Reason[] {
  const tail: Reason[] = [];
  if (receipt.override) tail.push({ code: 'override.user', params: { grade: receipt.override.grade } });
  if (receipt.supersededBy) tail.push({ code: 'superseded', params: { claimId: receipt.supersededBy } });
  return [...receipt.reasons.filter((reason) => !LIFECYCLE.has(reason.code)), ...tail];
}

/** Every field grade() computed: all but state, override, supersededBy and the lifecycle reasons. */
function computedFields(receipt: Receipt): Record<string, unknown> {
  const rest = Object.entries(receipt).filter(([key]) => !NOT_COMPUTED.has(key));
  return {
    ...Object.fromEntries(rest),
    reasons: receipt.reasons.filter((reason) => !LIFECYCLE.has(reason.code)),
  };
}

function invariantsHold(receipt: Receipt): void {
  expect(Receipt.safeParse(receipt).success).toBe(true);
  expect(receipt.reasons).toEqual(lifecycleOrdered(receipt));
}

/** One step: the result, or the IllegalTransitionError it threw (anything else fails the property). */
function step(current: Receipt, event: unknown): Receipt | IllegalTransitionError {
  try {
    return Receipt.parse(Reflect.apply(transition, undefined, [current, event]));
  } catch (error) {
    if (error instanceof IllegalTransitionError) return error;
    throw error;
  }
}

describe('state machine: random valid event sequences follow the §8 table', () => {
  it(
    'never a schema-invalid receipt, never a changed computed grade, every refusal the table code',
    () => {
      fc.assert(
        fc.property(scenarioArb, ({ start, events }) => {
          let current = start;
          for (const event of events) {
            const expected = model(current, event);
            const outcome = step(current, event);
            if (outcome instanceof IllegalTransitionError) {
              expect(outcome.code).toBe(expected);
              expect(outcome.from).toBe(current.state);
              continue;
            }
            expect(outcome.state).toBe(expected);
            invariantsHold(outcome);
            if (event.event === 'regrade') expect(outcome).toStrictEqual(event.next);
            else expect(computedFields(outcome)).toStrictEqual(computedFields(current));
            current = outcome;
          }
        }),
        RUNS,
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});

/** Events with arbitrary payloads: wrong grades, blank or binary reasons, bad timestamps and ids, other ids. */
const fuzzEventArb = (kind: Kind): fc.Arbitrary<unknown> =>
  fc.oneof(
    eventArb(kind),
    fc.record({
      event: fc.constant('override'),
      grade: fc.oneof(fc.constantFrom(...Grade.options), fc.string()),
      reason: fc.oneof(fc.string({ unit: 'binary', maxLength: 130 }), fc.constantFrom('', ' ', '​')),
      at: fc.oneof(isoArb, fc.string(), fc.constant('2026-10-06T15:05:00')),
    }),
    fc.record({ event: fc.constant('supersede'), claimId: fc.oneof(fc.string(), ulidArb) }),
    fc
      .tuple(computedArb(kind), fc.oneof(ulidArb, fc.constant(undefined)))
      .map(([computed, id]) => ({ event: 'regrade', next: build(kind, computed, id) })),
    fc.record({ event: fc.string() }),
    fc.object(),
  );

const fuzzScenarioArb = fc.constantFrom<Kind>('claim', 'unasked').chain((kind) =>
  fc.record({
    start: computedArb(kind).map((computed) => build(kind, computed)),
    events: fc.array(fuzzEventArb(kind), { minLength: 1, maxLength: 12 }),
  }),
);

const isRegrade = (event: unknown): boolean =>
  typeof event === 'object' && event !== null && 'event' in event && event.event === 'regrade';

describe('state machine: arbitrary payloads', () => {
  it(
    'only IllegalTransitionError, never an invalid receipt, the grade changes only by regrade',
    () => {
      fc.assert(
        fc.property(fuzzScenarioArb, ({ start, events }) => {
          let current = start;
          for (const event of events) {
            const before = JSON.stringify(current);
            const outcome = step(current, event);
            expect(JSON.stringify(current)).toBe(before);
            if (outcome instanceof IllegalTransitionError) continue;
            invariantsHold(outcome);
            expect(outcome.id).toBe(current.id);
            if (!isRegrade(event)) expect(computedFields(outcome)).toStrictEqual(computedFields(current));
            current = outcome;
          }
        }),
        RUNS,
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});

describe('state machine: override then revert', () => {
  it(
    'restores the exact prior receipt, superseded or not',
    () => {
      const receiptArb = fc
        .constantFrom<Kind>('claim', 'unasked')
        .chain((kind) =>
          fc.tuple(fc.constant(kind), computedArb(kind), fc.oneof(ulidArb, fc.constant(undefined))),
        )
        .map(([kind, computed, supersededBy]) => {
          const receipt = build(kind, computed);
          return kind === 'unasked' && supersededBy !== undefined
            ? transition(receipt, { event: 'supersede', claimId: supersededBy })
            : receipt;
        });
      // §8 (v1.4): an override is never before the receipt was computed; `after` ms later, as a Z timestamp.
      const after = fc.integer({ min: 0, max: 400 * 24 * 3_600_000 });
      fc.assert(
        fc.property(receiptArb, overrideArb, after, (receipt, override, delay) => {
          const at = new Date(Date.parse(receipt.computedAt) + delay).toISOString();
          const event = { ...override, at };
          const overridden = transition(receipt, event);
          expect(overridden.state).toBe('USER_OVERRIDDEN');
          expect(overridden.grade).toBe(receipt.grade);
          expect(transition(overridden, { event: 'revert' })).toStrictEqual(receipt);
        }),
        RUNS,
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
