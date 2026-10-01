/**
 * Every free-text string and every array at the storage and bus boundary has a length cap (SECURITY-4, Hard
 * Rule 2): a value at the cap parses, one over it is rejected, so a whole email body can never ride in
 * `counterparty` or a batch of unbounded size into the ledger.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { BusMessage } from '../../../src/bus/messages';
import {
  AdapterHealth,
  Claim,
  CoveragePing,
  Grant,
  MetaEntry,
  Observation,
  Receipt,
  Request,
  SCHEMA_LIMITS as L,
} from '../../../src/ledger/types';
import { VALID } from '../bus/harness';
import {
  makeClaim,
  makeGrant,
  makeHealth,
  makeObservation,
  makePing,
  makeReceipt,
  makeRequest,
  ulid,
} from './fixtures';

const text = (length: number): string => 'x'.repeat(length);

/** [label, schema, build(n) → a value whose capped field has size n, cap] */
type Case = readonly [string, z.ZodType, (n: number) => unknown, number];

const CASES: readonly Case[] = [
  ['Request.conversationId', Request, (n) => makeRequest({ conversationId: text(n) }), L.CONVERSATION_ID],
  ['Claim.counterparty', Claim, (n) => makeClaim({ counterparty: text(n) }), L.COUNTERPARTY],
  [
    'Claim.extractor.id',
    Claim,
    (n) => makeClaim({ extractor: { id: text(n), version: '1', confidence: 1 } }),
    L.ID,
  ],
  [
    'Claim.extractor.version',
    Claim,
    (n) => makeClaim({ extractor: { id: 'muse', version: text(n), confidence: 1 } }),
    L.ID,
  ],
  [
    'Observation.counterparty',
    Observation,
    (n) => makeObservation({ counterparty: text(n) }),
    L.COUNTERPARTY,
  ],
  ['Observation.merchant', Observation, (n) => makeObservation({ merchant: text(n) }), L.MERCHANT],
  [
    'Grant.counterpartyAllowlist item',
    Grant,
    (n) => makeGrant({ counterpartyAllowlist: [text(n)] }),
    L.COUNTERPARTY,
  ],
  [
    'Grant.counterpartyAllowlist',
    Grant,
    (n) => makeGrant({ counterpartyAllowlist: Array.from({ length: n }, () => 'a.com') }),
    L.LIST,
  ],
  ['Grant.declaredScopes item', Grant, (n) => makeGrant({ declaredScopes: [text(n)] }), L.ITEM],
  [
    'Grant.declaredScopes',
    Grant,
    (n) => makeGrant({ declaredScopes: Array.from({ length: n }, () => 'mail') }),
    L.LIST,
  ],
  [
    'Grant.observedScopes',
    Grant,
    (n) => makeGrant({ observedScopes: Array.from({ length: n }, () => 'mail') }),
    L.LIST,
  ],
  ['Receipt.ruleId', Receipt, (n) => makeReceipt({ ruleId: text(n) }), L.ID],
  ['Receipt.reasons item', Receipt, (n) => makeReceipt({ reasons: [text(n)] }), L.ITEM],
  [
    'Receipt.reasons',
    Receipt,
    (n) => makeReceipt({ reasons: Array.from({ length: n }, () => 'r') }),
    L.REASONS,
  ],
  [
    'Receipt.signals',
    Receipt,
    (n) =>
      makeReceipt({ signals: Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${String(i)}`, 1])) }),
    L.REASONS,
  ],
  ['Receipt.signals key', Receipt, (n) => makeReceipt({ signals: { [text(n)]: 1 } }), L.ID],
  [
    'Receipt.observationIds',
    Receipt,
    (n) => makeReceipt({ observationIds: Array.from({ length: n }, (_, i) => ulid(i)) }),
    L.BATCH,
  ],
  ['AdapterHealth.adapterId', AdapterHealth, (n) => makeHealth({ adapterId: text(n) }), L.ID],
  ['AdapterHealth.version', AdapterHealth, (n) => makeHealth({ version: text(n) }), L.ID],
  ['AdapterHealth.reasons item', AdapterHealth, (n) => makeHealth({ reasons: [text(n)] }), L.ITEM],
  [
    'AdapterHealth.reasons',
    AdapterHealth,
    (n) => makeHealth({ reasons: Array.from({ length: n }, () => 'r') }),
    L.REASONS,
  ],
  ['CoveragePing.observerId', CoveragePing, (n) => makePing({ observerId: text(n) }), L.ID],
  ['MetaEntry.key', MetaEntry, (n) => ({ key: text(n), value: 1 }), L.ID],
  ['MetaEntry.value', MetaEntry, (n) => ({ key: 'k', value: text(n) }), L.META_VALUE],
  [
    'adapter.claims claims',
    BusMessage,
    (n) => ({ ...VALID['adapter.claims'], claims: Array(n).fill(VALID['adapter.claims'].claims[0]) }),
    L.BATCH,
  ],
  [
    'adapter.claims requests',
    BusMessage,
    (n) => ({ ...VALID['adapter.claims'], requests: Array(n).fill(VALID['adapter.claims'].requests[0]) }),
    L.BATCH,
  ],
  ['adapter.claims adapterId', BusMessage, (n) => ({ ...VALID['adapter.claims'], adapterId: text(n) }), L.ID],
  [
    'observer.observations observations',
    BusMessage,
    (n) => ({
      ...VALID['observer.observations'],
      observations: Array(n).fill(VALID['observer.observations'].observations[0]),
    }),
    L.BATCH,
  ],
  [
    'observer.observations version',
    BusMessage,
    (n) => ({ ...VALID['observer.observations'], version: text(n) }),
    L.ID,
  ],
];

describe('schema length caps (SECURITY-4)', () => {
  it.each(CASES)('%s: at the cap parses, one over is rejected', (_label, schema, build, cap) => {
    expect(schema.safeParse(build(cap)).success).toBe(true);
    expect(schema.safeParse(build(cap + 1)).success).toBe(false);
  });

  it('an email body cannot ride in counterparty', () => {
    const body = 'Hi Marguerite, the vault code for the Lisbon storage unit is 7731-QUOKKA. '.repeat(10);
    expect(Observation.safeParse(makeObservation({ counterparty: body })).success).toBe(false);
  });
});
