/**
 * R3-LEDGER-2 (Hard Rule 2): every id-like field is a token and every scope or allowlist entry is one line, so an
 * extractor that took a conversation's title or a settings page's paragraph for an id or a scope is refused at
 * the field's own path. A conversation id is the vendor's opaque id (`VENDOR_ID`: a UUID, `conv-1`), never text;
 * a scope (`Grant.declaredScopes`, `observedScopes`, `GradeContext.scope.observed`) and an allowlist entry are one
 * line (SEC-3). The verifier's probes r4 and r8 are reproduced here.
 */
import { describe, expect, it } from 'vitest';

import { GradeContext, Grant, Request, SCHEMA_LIMITS as L } from '../../../src/core/schema';
import { VENDOR_ID } from '../../../src/core/schema-text';

const HASH = 'ab'.repeat(32);
const T = '2026-10-01T10:00:00-04:00';
const REQUEST = {
  id: '01JA0000000000000000000201',
  agent: 'chatgpt',
  conversationId: 'conv-1',
  textHint: 'Email Priya',
  textHash: HASH,
  ts: T,
};
const GRANT = {
  agent: 'chatgpt',
  allowedTypes: [],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  updatedAt: T,
};
/** Probe r4: a conversation's opening lines, padded to the conversation id cap. */
const R4 = 'Hi Priya,\nthe door code is 4417.\nSSN 078-05-1120\nThanks, P'.padEnd(L.CONVERSATION_ID, '.');
/** Probe r8: a settings page's paragraph, padded to the scope cap. */
const R8 = 'Hi Priya,\nthe door code is 4417\nSSN 078-05-1120'.padEnd(L.ITEM, '.');

/** The path and message of each issue a parse raised; empty when it parsed. */
function issues(result: { error?: { issues: readonly { path: PropertyKey[]; message: string }[] } }) {
  return (result.error?.issues ?? []).map((issue) => [issue.path.map(String).join('.'), issue.message]);
}

const VENDOR_IDS = [
  '',
  'conv-1',
  '6710a2b4-0c3e-8001-9a7f-1c2d3e4f5a6b',
  'c_8f3a:2',
  'muse-conversation-q3',
  '01JA0000000000000000000201',
  'thread.42+b',
  'x'.repeat(L.CONVERSATION_ID),
];
const NOT_VENDOR_IDS = [
  R4,
  'Hi Priya',
  'a\nb',
  'a\tb',
  ' conv-1',
  'conv-1 ',
  '-conv',
  '.conv',
  ':conv',
  'José',
  'a/b',
  'priya@company.com',
  'q3 review thread',
];

describe('Request.conversationId is a vendor id (probe r4)', () => {
  it.each(VENDOR_IDS)('accepts %j', (conversationId) => {
    expect(VENDOR_ID.test(conversationId)).toBe(true);
    expect(Request.safeParse({ ...REQUEST, conversationId }).success).toBe(true);
  });

  it.each(NOT_VENDOR_IDS)('refuses %j at conversationId', (conversationId) => {
    expect(VENDOR_ID.test(conversationId)).toBe(false);
    expect(issues(Request.safeParse({ ...REQUEST, conversationId }))).toEqual([
      ['conversationId', 'expected a vendor id'],
    ]);
  });

  it('refuses a token one character over the cap', () => {
    const result = Request.safeParse({ ...REQUEST, conversationId: 'x'.repeat(L.CONVERSATION_ID + 1) });
    expect(issues(result).map(([path]) => path)).toEqual(['conversationId']);
  });
});

describe('a scope and an allowlist entry are one line (probe r8)', () => {
  it('refuses 200 multi-line observed scopes, each at its own path', () => {
    const result = Grant.safeParse({ ...GRANT, observedScopes: Array.from({ length: L.LIST }, () => R8) });
    expect(new Set(issues(result).map(([path]) => path)).size).toBe(L.LIST);
  });

  it.each([
    ['declaredScopes.1', { declaredScopes: ['gmail.send', 'Read your mail\nSSN 078-05-1120'] }],
    ['observedScopes.0', { observedScopes: ['gmail.read\r'] }],
    ['counterpartyAllowlist.0', { counterpartyAllowlist: ['example.com door code 4417'] }],
  ])('refuses a line break at %s', (path, fields) => {
    expect(issues(Grant.safeParse({ ...GRANT, ...fields })).map(([at]) => at)).toEqual([path]);
  });

  it('accepts one-line scopes and entries at the caps, spaces included', () => {
    const scope = 'Read, compose and send email'.padEnd(L.ITEM, '.');
    const entry = 'priya@company.com'.padStart(L.COUNTERPARTY, 'p');
    const grant = {
      ...GRANT,
      declaredScopes: [scope],
      observedScopes: [scope],
      counterpartyAllowlist: [entry],
    };
    expect(Grant.safeParse(grant).success).toBe(true);
  });

  it('GradeContext.scope.observed is one non-empty line', () => {
    expect(GradeContext.safeParse({ priorSpendCents: 0, scope: { observed: 'gmail.read' } }).success).toBe(
      true,
    );
    for (const observed of [R8, 'gmail.read\n', '']) {
      const result = GradeContext.safeParse({ priorSpendCents: 0, scope: { observed } });
      expect(issues(result).map(([path]) => path)).toEqual(['scope.observed']);
    }
  });
});
