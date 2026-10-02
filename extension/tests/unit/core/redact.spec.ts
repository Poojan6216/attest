/**
 * Task 1.2, redact.ts (docs/grading.md §10, §12, §13; Hard Rule 2): one table row per observer source, and
 * the identity rules of §10 (same row twice → one observation; created vs deleted differ; identical sends with
 * different row ids differ; a raw row never supplies its own id, source, type, observedAt or hashes).
 *
 * Expected content hashes are computed here from hand-written canonical JSON with Node's crypto, not with
 * src/core/hash, so a broken projection or a broken hash input cannot agree with itself.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import {
  CONTENT_FIELDS,
  DERIVED_FIELDS,
  hashText,
  project,
  type ProjectContext,
} from '../../../src/core/redact';
import { type ActionType, Observation, type ObservationSource, Sha256 } from '../../../src/core/schema';

const nodeSha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const OCCURRED = '2026-10-06T14:02:00-04:00';
const OBSERVED = '2026-10-06T14:40:00-04:00';
const SECRET = 'vault code 7731-QUOKKA';

/** A raw row with every content field plus content that must never survive. */
const RAW = Object.freeze({
  counterparty: 'priya@company.com',
  merchant: 'Acme Books',
  amountCents: 1250,
  currency: 'USD',
  subjectHint: 'Q3 deck',
  occurredAt: OCCURRED,
  body: `Hi Priya, ${SECRET}`,
  snippet: SECRET,
  html: `<div>${SECRET}</div>`,
  threadId: 'thread-17',
  labels: ['SENT', SECRET],
  nested: { deep: { secret: SECRET } },
});

interface Row {
  readonly source: ObservationSource;
  readonly type: ActionType;
  readonly kept: Readonly<Record<string, string | number>>;
  readonly canonical: string;
}

const ROWS: readonly Row[] = [
  {
    source: 'gmail.sent',
    type: 'email.sent',
    kept: { counterparty: 'priya@company.com', subjectHint: 'Q3 deck', occurredAt: OCCURRED },
    canonical: `{"counterparty":"priya@company.com","occurredAt":"${OCCURRED}","source":"gmail.sent","subjectHint":"Q3 deck","type":"email.sent"}`,
  },
  {
    source: 'gmail.receipt',
    type: 'purchase.made',
    kept: {
      merchant: 'Acme Books',
      amountCents: 1250,
      currency: 'USD',
      subjectHint: 'Q3 deck',
      occurredAt: OCCURRED,
    },
    canonical: `{"amountCents":1250,"currency":"USD","merchant":"Acme Books","occurredAt":"${OCCURRED}","source":"gmail.receipt","subjectHint":"Q3 deck","type":"purchase.made"}`,
  },
  {
    source: 'gcal.event',
    type: 'calendar.created',
    kept: { counterparty: 'priya@company.com', subjectHint: 'Q3 deck', occurredAt: OCCURRED },
    canonical: `{"counterparty":"priya@company.com","occurredAt":"${OCCURRED}","source":"gcal.event","subjectHint":"Q3 deck","type":"calendar.created"}`,
  },
];

const ctx = (type: ActionType, extra: Partial<ProjectContext> = {}): ProjectContext => ({
  type,
  observedAt: OBSERVED,
  ...extra,
});

describe('project: one row per observer source keeps exactly the allowlisted fields', () => {
  it.each(ROWS)('$source', ({ source, type, kept, canonical }) => {
    const hex = nodeSha(canonical);
    const out = project(source, RAW, ctx(type), DEFAULT_POLICY);
    expect(out).toStrictEqual({
      id: idFromHash(hex),
      source,
      type,
      ...kept,
      observedAt: OBSERVED,
      contentHash: hex,
    });
    expect(Observation.parse(out)).toStrictEqual(out);
    expect(JSON.stringify(out)).not.toContain('7731');
  });

  it.each(ROWS)('$source with a row key adds rowKeyHash to the record and to the hash', (row) => {
    const rowKeyHash = nodeSha('msg-17');
    const canonical = row.canonical.replace('"source"', `"rowKeyHash":"${rowKeyHash}","source"`);
    const out = project(row.source, RAW, ctx(row.type, { rowKey: 'msg-17' }), DEFAULT_POLICY);
    expect(out.rowKeyHash).toBe(rowKeyHash);
    expect(out.contentHash).toBe(nodeSha(canonical));
    expect(out.id).toBe(idFromHash(nodeSha(canonical)));
  });

  it('is deterministic and leaves the raw row untouched', () => {
    const raw = structuredClone(RAW);
    const first = project('gmail.sent', raw, ctx('email.sent'), DEFAULT_POLICY);
    expect(project('gmail.sent', raw, ctx('email.sent'), DEFAULT_POLICY)).toStrictEqual(first);
    expect(raw).toStrictEqual(RAW);
  });

  it('pins the content and derived field lists to the Observation schema', () => {
    expect(CONTENT_FIELDS).toStrictEqual([
      'counterparty',
      'merchant',
      'amountCents',
      'currency',
      'subjectHint',
      'occurredAt',
    ]);
    expect([...CONTENT_FIELDS, ...DERIVED_FIELDS].sort()).toStrictEqual(Observation.keyof().options.sort());
  });
});

const sent = (raw: object, extra: Partial<ProjectContext> = {}) =>
  project('gmail.sent', raw, ctx('email.sent', extra), DEFAULT_POLICY);

describe('ids and content hashes (§10)', () => {
  it('the same row seen twice, at different times and in any key order, is one observation', () => {
    const first = sent(RAW);
    const again = sent(Object.fromEntries(Object.entries(RAW).reverse()), {
      observedAt: '2026-10-07T09:00:00Z',
    });
    expect(again.observedAt).toBe('2026-10-07T09:00:00Z');
    expect(again.contentHash).toBe(first.contentHash);
    expect(again.id).toBe(first.id);
  });

  it('a created and a deleted event with the same fields differ', () => {
    const created = project('gcal.event', RAW, ctx('calendar.created'), DEFAULT_POLICY);
    const deleted = project('gcal.event', RAW, ctx('calendar.deleted'), DEFAULT_POLICY);
    expect(deleted.contentHash).not.toBe(created.contentHash);
    expect(deleted.id).not.toBe(created.id);
  });

  it('two identical sends with different row keys stay two; the same row key is one', () => {
    const one = sent(RAW, { rowKey: 'send-1' });
    const two = sent(RAW, { rowKey: 'send-2' });
    expect(two.contentHash).not.toBe(one.contentHash);
    expect(two.id).not.toBe(one.id);
    expect(sent(RAW, { rowKey: 'send-1' })).toStrictEqual(one);
    expect(sent(RAW).contentHash).not.toBe(one.contentHash);
    expect(sent(RAW)).not.toHaveProperty('rowKeyHash');
    expect(sent(RAW, { rowKey: undefined })).toStrictEqual(sent(RAW));
  });
});

describe('which fields enter the content hash (§10)', () => {
  it.each([
    ['counterparty', 'arjun@company.com'],
    ['subjectHint', 'Q4 deck'],
    ['occurredAt', '2026-10-06T14:03:00-04:00'],
  ])('changing allowlisted %s changes the hash', (field, value) => {
    expect(sent({ ...RAW, [field]: value }).contentHash).not.toBe(sent(RAW).contentHash);
  });

  it.each([
    ['merchant', 'Other Books'],
    ['amountCents', 999],
    ['currency', 'EUR'],
    ['body', 'another body'],
  ])('changing %s, which gmail.sent does not allowlist, changes nothing', (field, value) => {
    expect(sent({ ...RAW, [field]: value })).toStrictEqual(sent(RAW));
  });

  it('rowKeyHash is kept and hashed even when a policy allowlist omits it (ids never depend on it)', () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      allowlistedFields: {
        ...defaultPolicyJson.allowlistedFields,
        'gmail.sent': ['counterparty', 'subjectHint', 'occurredAt', 'contentHash'],
      },
    });
    const out = project('gmail.sent', RAW, ctx('email.sent', { rowKey: 'send-1' }), policy);
    expect(out).toStrictEqual(sent(RAW, { rowKey: 'send-1' }));
  });
});

describe('a raw row never supplies its own identity', () => {
  const forged = {
    ...RAW,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    source: 'gcal.event',
    type: 'calendar.deleted',
    observedAt: '2020-01-01T00:00:00Z',
    rowKeyHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
  };

  it.each(ROWS)('$source ignores raw id, source, type, observedAt, rowKeyHash and contentHash', (row) => {
    const out = project(row.source, forged, ctx(row.type), DEFAULT_POLICY);
    expect(out).toStrictEqual(project(row.source, RAW, ctx(row.type), DEFAULT_POLICY));
    expect(out.contentHash).toBe(nodeSha(row.canonical));
  });

  it('a raw rowKeyHash never replaces the hash of ctx.rowKey', () => {
    const out = project('gmail.sent', forged, ctx('email.sent', { rowKey: 'send-1' }), DEFAULT_POLICY);
    expect(out.rowKeyHash).toBe(nodeSha('send-1'));
  });
});

describe('hashText', () => {
  it.each(['', 'abc', 'send-1', 'Pr\u0131ya \u{1F600}', 'x'.repeat(200), 'e\u0301', '\u212B', ' send-1 '])(
    '%j is Node sha256',
    (text) => {
      expect(hashText(text)).toBe(nodeSha(text));
      expect(Sha256.safeParse(hashText(text)).success).toBe(true);
    },
  );

  it('hashes the text exactly as given: no Unicode normalisation, no trimming', () => {
    expect(hashText('e\u0301')).not.toBe(hashText('\u00E9'));
    expect(hashText('\u212B')).not.toBe(hashText('\u00C5'));
    expect(hashText(' send-1 ')).not.toBe(hashText('send-1'));
  });
});
