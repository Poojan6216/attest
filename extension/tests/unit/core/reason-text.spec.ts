/**
 * reason-text.ts (docs/grading.md §6.4, §15; Hard Rule 7; task 1.7 Done-when "the receipt text never states the
 * agent did it as fact"). Every ReasonCode renders one short English sentence from its params alone; every
 * `unasked.*` text says "likely"; no text, for any param value, contains a phrasing that states an agent acted.
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../src/core/hash';
import { AGENT_LABEL, reasonText, ReasonTextError } from '../../../src/core/reason-text';
import {
  ActionType,
  AgentId,
  ObservationSource,
  OverrideGrade,
  Reason,
  ReasonCode,
  type ReasonInput,
} from '../../../src/core/schema';
import { REASON_PARAM_KINDS, type ReasonParamKind } from '../../../src/core/schema-checks';

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SCOPE_HASH = sha256Hex('gmail.read');
const MAX_CENTS = 1_000_000_000_000;

/** Every value each param kind can take in a test: all enum values, plus the extremes of the numbers. */
const VALUES: Readonly<Record<ReasonParamKind, readonly (string | number | undefined)[]>> = {
  ulid: [ULID],
  sha256: [SCOPE_HASH],
  'source?': [...ObservationSource.options, undefined],
  actionType: ActionType.options,
  agent: AgentId.options,
  overrideGrade: OverrideGrade.options,
  cents: [0, 3_000, MAX_CENTS],
  priorSpend: [0, 5_000, Number.MAX_SAFE_INTEGER],
  currency: ['EUR', 'JPY'],
};

/** Every combination of param values for `code`, each parsed with the core Reason schema. */
function reasonsFor(code: ReasonCode): Reason[] {
  let combos: Record<string, string | number>[] = [{}];
  for (const [name, kind] of Object.entries(REASON_PARAM_KINDS[code])) {
    combos = combos.flatMap((params) =>
      VALUES[kind].map((value) => (value === undefined ? params : { ...params, [name]: value })),
    );
  }
  return combos.map((params) => Reason.parse({ code, params } satisfies ReasonInput));
}

const ALL = ReasonCode.options.flatMap((code) =>
  reasonsFor(code).map((reason) => [reason, reasonText(reason)] as const),
);
const UNASKED = ALL.filter(([reason]) => reason.code.startsWith('unasked.'));

const AGENT_NAMES = [
  ...AgentId.options,
  ...Object.values(AGENT_LABEL),
  'the agent',
  'this agent',
  'an agent',
  'agent',
];
const ACT_VERBS = [
  'sent',
  'did',
  'made',
  'created',
  'bought',
  'deleted',
  'changed',
  'posted',
  'emailed',
  'booked',
];
/** Phrasings that state as fact that an agent acted (Hard Rule 7). Case-insensitive, whole words. */
const BANNED: readonly RegExp[] = [
  /\bdid (this|it|that)\b/i,
  /\bwas done by\b/i,
  /\bis responsible\b/i,
  /\bcaused (this|it)\b/i,
  /\bthis was (?!likely\b)/i,
  ...AGENT_NAMES.flatMap((agent) => ACT_VERBS.map((verb) => new RegExp(`\\b${agent} ${verb}\\b`, 'i'))),
];

describe('every ReasonCode has a text', () => {
  it.each(ReasonCode.options)('%s renders for every valid params combination', (code) => {
    const reasons = reasonsFor(code);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      const text = reasonText(reason);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });

  it('the vocabulary covered here is exactly the schema enum (and so the §15 table)', () => {
    expect(new Set(ALL.map(([reason]) => reason.code))).toEqual(new Set(ReasonCode.options));
  });

  it.each(ALL.map(([reason, text]) => [reason.code, text] as const))(
    '%s → %j is one short sentence',
    (_code, text) => {
      expect(text).toMatch(/^[A-Z]/);
      expect(text).toMatch(/[.]$/);
      expect(text).not.toMatch(/[.!?]\s/);
      expect(text.length).toBeLessThanOrEqual(140);
    },
  );
});

describe('Hard Rule 7: attribution is labelled "likely" and never stated as fact', () => {
  it('every unasked.* text says "likely", for every agent', () => {
    expect(UNASKED).toHaveLength(4 * AgentId.options.length);
    for (const [reason, text] of UNASKED) {
      expect(text).toMatch(/\blikely\b/);
      expect(text).toContain(AGENT_LABEL[AgentId.parse(reason.params.agent)]);
    }
  });

  it('"likely" comes before the agent is named', () => {
    for (const [reason, text] of UNASKED) {
      const label = AGENT_LABEL[AgentId.parse(reason.params.agent)];
      expect(text.indexOf('likely')).toBeLessThan(text.indexOf(label));
    }
  });

  it('no text, for any param value, contains a banned phrasing', () => {
    const offenders = ALL.flatMap(([reason, text]) =>
      BANNED.filter((banned) => banned.test(text)).map(
        (banned) => `${reason.code}: ${text} (${banned.source})`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the banned-phrase check catches the phrasings it is for', () => {
    const planted = [
      'Muse sent this email.',
      'The agent sent this email.',
      'ChatGPT did this.',
      'This was Muse: a session was active.',
      'Claude created the event.',
    ];
    for (const text of planted) expect(BANNED.some((banned) => banned.test(text))).toBe(true);
    expect(BANNED.some((banned) => banned.test('This was likely Muse: a Muse session was active.'))).toBe(
      false,
    );
  });
});

describe('params are rendered verbatim, never formatted for a locale', () => {
  it('ids and hashes appear exactly as stored', () => {
    expect(reasonText({ code: 'match.best', params: { observationId: ULID } })).toContain(ULID);
    expect(reasonText({ code: 'superseded', params: { claimId: ULID } })).toContain(ULID);
    expect(reasonText({ code: 'scope.observed_not_declared', params: { scopeHash: SCOPE_HASH } })).toContain(
      SCOPE_HASH,
    );
  });

  it('amounts are plain digits in minor units, with no separators and no guessed currency', () => {
    const text = reasonText({
      code: 'ceiling.cumulative_exceeded',
      params: { priorSpendCents: 1_234_567, amountCents: MAX_CENTS, ceilingCents: 5_000 },
    });
    expect(text).toContain('1234567');
    expect(text).toContain('1000000000000');
    expect(text).toContain('5000');
    expect(text).toContain('minor units');
    expect(text).not.toMatch(/\d[,.\u00A0\u202F ]\d|\$|USD/);
  });

  it('currencies, action types and grades are named', () => {
    expect(
      reasonText({ code: 'ceiling.currency_mismatch', params: { currency: 'EUR', spendCurrency: 'USD' } }),
    ).toBe('The amount is in EUR but the spend ceiling is in USD, so they cannot be compared.');
    expect(reasonText({ code: 'scope.type_not_allowed', params: { type: 'purchase.made' } })).toContain(
      '(purchase.made)',
    );
    expect(reasonText({ code: 'override.user', params: { grade: 'NOT_FOUND' } })).toBe(
      'You marked this receipt NOT FOUND.',
    );
  });

  it('a source is named when present and left out for a type with no sources', () => {
    expect(reasonText({ code: 'coverage.none', params: { source: 'gmail.sent' } })).toContain(
      'Gmail Sent mail',
    );
    expect(reasonText({ code: 'coverage.none', params: {} })).toBe(
      'No source Attest reads can show this kind of action.',
    );
  });

  it('is deterministic: the same reason always gives the same text', () => {
    for (const [reason, text] of ALL) expect(reasonText(structuredClone(reason))).toBe(text);
  });

  it('distinct agents give distinct unasked texts', () => {
    const texts = AgentId.options.map((agent) => reasonText({ code: 'unasked.session', params: { agent } }));
    expect(new Set(texts).size).toBe(AgentId.options.length);
  });
});

describe('a reason outside the closed vocabulary is never rendered as a guess', () => {
  it.each([
    ['a missing param', { code: 'match.best', params: {} }],
    ['a malformed id', { code: 'match.best', params: { observationId: 'not-a-ulid' } }],
    ['an unknown agent', { code: 'unasked.session', params: { agent: 'someone' } }],
    ['a negative amount', { code: 'ceiling.exceeded', params: { amountCents: -1, ceilingCents: 5_000 } }],
    [
      'an amount written as a string',
      { code: 'ceiling.exceeded', params: { amountCents: '30', ceilingCents: 5_000 } },
    ],
    [
      'a lowercase currency',
      { code: 'ceiling.currency_mismatch', params: { currency: 'eur', spendCurrency: 'USD' } },
    ],
    ['an unknown source', { code: 'coverage.partial', params: { source: 'outlook.sent' } }],
    ['an extra param', { code: 'match.none', params: { observationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } }],
    ['an override to a grade the user cannot set', { code: 'override.user', params: { grade: 'PARTIAL' } }],
  ] as const)('%s throws ReasonTextError(invalid_params)', (_label, reason) => {
    expect(() => reasonText(reason)).toThrow(ReasonTextError);
    expect(() => reasonText(reason)).toThrow(/invalid_params/);
  });

  it('an unknown code throws ReasonTextError(unknown_code)', () => {
    expect(() => reasonText({ code: 'made.up', params: {} })).toThrow(ReasonTextError);
    expect(() => reasonText({ code: 'made.up', params: {} })).toThrow(/unknown_code/);
  });
});
