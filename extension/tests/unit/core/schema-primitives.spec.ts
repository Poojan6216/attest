/**
 * Task 1.0: branded primitives and closed enums of src/core/schema.ts. Each has at least five valid and five
 * invalid cases (a value schema reports issues at the root, path []); an enum with fewer than five values
 * lists every value as a valid case. ReasonCode is pinned to the docs/grading.md §15 table, in order.
 */
import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { idFromHash, sha256Hex } from '../../../src/core/hash';
import {
  ActionType,
  AgentId,
  AmountCents,
  ClaimPrecision,
  Currency,
  Grade,
  IsoTs,
  ObservationSource,
  ReasonCode,
  ReceiptState,
  RuleId,
  Sha256,
  SourceKind,
  Ulid,
  UnaskedSignal,
} from '../../../src/core/schema';

interface Table {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly unknown[];
}

const TABLES: readonly Table[] = [
  {
    name: 'Ulid',
    schema: Ulid,
    valid: [
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      '00000000000000000000000000',
      '7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
      idFromHash(sha256Hex('claim')),
      '01JA0000000000000000000001',
    ],
    invalid: [
      '01arz3ndektsv4rrffq69g5fav',
      '01ARZ3NDEKTSV4RRFFQ69G5FA',
      '01ARZ3NDEKTSV4RRFFQ69G5FAVV',
      '81ARZ3NDEKTSV4RRFFQ69G5FAV',
      '01ARZ3NDEKTSV4RRFFQ69G5FAI',
      1,
    ],
  },
  {
    name: 'Sha256',
    schema: Sha256,
    valid: ['a'.repeat(64), '0'.repeat(64), sha256Hex('abc'), sha256Hex(''), '0123456789abcdef'.repeat(4)],
    invalid: [
      sha256Hex('abc').toUpperCase(),
      'a'.repeat(63),
      'a'.repeat(65),
      'g'.repeat(64),
      `0x${'a'.repeat(62)}`,
      7,
    ],
  },
  {
    name: 'IsoTs',
    schema: IsoTs,
    valid: [
      '2026-10-06T18:02:00Z',
      '2026-10-06T23:32:00+05:30',
      '2026-10-06T14:02:00-04:00',
      '2026-10-06T14:02:00.123-04:00',
      '2026-10-06T14:02:00.123456789+14:00',
      '2028-02-29T00:00:00Z',
    ],
    invalid: [
      '2026-10-06T14:02:00',
      '2026-10-06',
      '2026-10-06 14:02:00Z',
      '2026-10-06T14:02:00.1234567890+14:00',
      '2026-10-06T14:02:00+0530',
      '2026-02-30T00:00:00Z',
      '2026-10-06T24:00:00Z',
      '2026-10-06t14:02:00z',
      new Date('2026-10-06T18:02:00Z'),
    ],
  },
  {
    name: 'AmountCents',
    schema: AmountCents,
    valid: [0, 1, 199, 123_456_789, 1e12],
    invalid: [-1, 1.5, 1e12 + 1, Number.NaN, Number.POSITIVE_INFINITY, '100'],
  },
  {
    name: 'Currency',
    schema: Currency,
    valid: ['USD', 'EUR', 'JPY', 'KWD', 'CAD'],
    invalid: ['usd', 'US', 'USDT', '', 'U$D', 840],
  },
  {
    name: 'RuleId',
    schema: RuleId,
    valid: ['verified', 'over_scope_observed', 'default_unverifiable', 'no_target', 'a'.repeat(64)],
    invalid: ['Verified', 'over-scope', '_x', 'x_', 'a__b', 'not found', '', 'a'.repeat(65)],
  },
  {
    name: 'AgentId',
    schema: AgentId,
    valid: ['muse', 'chatgpt', 'dots', 'claude'],
    invalid: ['Muse', 'gemini', '', 'dots ', null],
  },
  {
    name: 'ActionType',
    schema: ActionType,
    valid: ['email.sent', 'calendar.created', 'calendar.deleted', 'purchase.made', 'other'],
    invalid: ['email.received', 'Email.sent', 'email', 'calendar', 9],
  },
  {
    name: 'ObservationSource',
    schema: ObservationSource,
    valid: ['gmail.sent', 'gmail.receipt', 'gcal.event'],
    invalid: ['gmail.inbox', 'outlook.sent', 'gcal', 'GMAIL.SENT', undefined],
  },
  {
    name: 'ClaimPrecision',
    schema: ClaimPrecision,
    valid: ['minute', 'hour', 'day'],
    invalid: ['second', 'week', 'Minute', 'min', 60],
  },
  {
    name: 'SourceKind',
    schema: SourceKind,
    valid: ['activity_view', 'chat', 'notification', 'settings'],
    invalid: ['email', 'activity-view', 'Chat', '', {}],
  },
  {
    name: 'Grade',
    schema: Grade,
    valid: ['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE'],
    invalid: ['PENDING', 'verified', 'NOT FOUND', 'OK', 'FAILED'],
  },
  {
    name: 'ReceiptState',
    schema: ReceiptState,
    valid: ['PENDING', 'FINAL', 'USER_OVERRIDDEN'],
    invalid: ['pending', 'DONE', 'OVERRIDDEN', 'SUPERSEDED', true],
  },
  {
    name: 'UnaskedSignal',
    schema: UnaskedSignal,
    valid: ['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent'],
    invalid: ['userActive', 'agent_signature', 'modelScore', '', 'likely'],
  },
  {
    name: 'ReasonCode',
    schema: ReasonCode,
    valid: ['match.best', 'cp.confusable', 'coverage.account_unbound', 'unasked.idle', 'superseded'],
    invalid: ['match.maybe', 'unasked', 'coverage', 'Sent email found within the window', 'claim.too-vague'],
  },
];

describe.each(TABLES)('$name', ({ name, schema, valid, invalid }) => {
  it('has at least five valid cases (or every enum value) and five invalid cases', () => {
    const raw: unknown = Reflect.get(schema, 'options');
    const options: readonly unknown[] = Array.isArray(raw) ? raw : [];
    if (options.length > 0 && options.length < 5) expect([...valid].sort()).toEqual([...options].sort());
    else expect(valid.length).toBeGreaterThanOrEqual(5);
    expect(invalid.length, name).toBeGreaterThanOrEqual(5);
  });

  it.each(valid.map((value, index) => ({ index, value })))(
    'parses valid case $index to exactly itself',
    ({ value }) => {
      expect(schema.parse(value)).toEqual(value);
    },
  );

  it.each(invalid.map((value, index) => ({ index, value })))(
    'rejects invalid case $index at the root',
    ({ value }) => {
      const result = schema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toSatisfy((paths: unknown[][]) =>
        paths.every((path) => path.length === 0),
      );
    },
  );
});

describe('ReasonCode', () => {
  it('is exactly the docs/grading.md §15 table, in table order', () => {
    expect(ReasonCode.options).toEqual([
      'match.best',
      'match.none',
      'cp.plus_tag',
      'cp.confusable',
      'cp.non_ascii',
      'claim.too_vague',
      'claim.no_target',
      'coverage.none',
      'coverage.partial',
      'coverage.account_unbound',
      'coverage.calendars_hidden',
      'coverage.multiple_accounts',
      'coverage.no_account',
      'coverage.never_completed',
      'grace.waiting',
      'scope.type_not_allowed',
      'scope.counterparty_not_allowed',
      'allowlist.unchecked',
      'ceiling.exceeded',
      'ceiling.cumulative_exceeded',
      'ceiling.currency_mismatch',
      'scope.observed_not_declared',
      'unasked.session',
      'unasked.idle',
      'unasked.signature',
      'unasked.adjacent',
      'override.user',
      'superseded',
    ]);
  });
});

describe('ids derived from hashes (docs/grading.md §10)', () => {
  it('idFromHash of any SHA-256 is a valid Ulid, and sha256Hex is a valid Sha256 (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const hex = sha256Hex(text);
        expect(Sha256.safeParse(hex).success).toBe(true);
        expect(Ulid.safeParse(idFromHash(hex)).success).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('brands', () => {
  it('a plain string is not a Ulid, Sha256 or IsoTs until it is parsed', () => {
    expectTypeOf<string>().not.toExtend<Ulid>();
    expectTypeOf<string>().not.toExtend<Sha256>();
    expectTypeOf<string>().not.toExtend<IsoTs>();
    expectTypeOf<Ulid>().toExtend<string>();
    expectTypeOf<Ulid>().not.toExtend<Sha256>();
    expectTypeOf(Ulid.parse('01JA0000000000000000000001')).toEqualTypeOf<Ulid>();
    expectTypeOf<z.input<typeof Ulid>>().toEqualTypeOf<string>();
  });
});
