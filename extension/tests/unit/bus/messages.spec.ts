/**
 * Schema-level contract of the bus (sprint 0.7): one discriminated union on `type`, strict members,
 * payload items from the canonical core schemas (task 1.0).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AdapterClaimsMessage,
  AdapterHealthMessage,
  BUS_MESSAGE_TYPES,
  BusMessage,
  type BusMessageType,
  isBusMessageType,
  LedgerTable,
  ObserverObservationsMessage,
  type UiQuery,
  type UiQueryKind,
  UiQueryKind as UiQueryKindSchema,
  UiResultMessage,
  uiFailure,
} from '../../../src/bus/messages';
import { Claim, HealthReport, Observation, Request } from '../../../src/core/schema';
import { CLAIM, HASH, MALFORMED, OBSERVATION, REQUEST, SECRET, TS, VALID } from './harness';

describe('BusMessage', () => {
  it('has exactly the seven message types of sprint 0.7', () => {
    expect([...BUS_MESSAGE_TYPES].sort()).toEqual(
      [
        'adapter.claims',
        'adapter.health',
        'coverage.ping',
        'ledger.changed',
        'observer.observations',
        'ui.query',
        'ui.result',
      ].sort(),
    );
    expectTypeOf<BusMessage['type']>().toEqualTypeOf<BusMessageType>();
    expectTypeOf<UiQuery['kind']>().toEqualTypeOf<UiQueryKind>();
  });

  it('BUS_MESSAGE_TYPES is frozen, so no consumer can reorder or extend it', () => {
    expect(Object.isFrozen(BUS_MESSAGE_TYPES)).toBe(true);
    expect(() => Reflect.apply(Array.prototype.push, BUS_MESSAGE_TYPES, ['ledger.wipe'])).toThrow(TypeError);
    expect(BUS_MESSAGE_TYPES).toHaveLength(7);
  });

  it.each(BUS_MESSAGE_TYPES)('accepts a valid %s', (type) => {
    const parsed = BusMessage.safeParse(VALID[type]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(VALID[type]);
  });

  it.each(BUS_MESSAGE_TYPES)('rejects a malformed %s', (type) => {
    expect(BusMessage.safeParse(MALFORMED[type]).success).toBe(false);
  });

  it('rejects unknown types and non-objects', () => {
    for (const raw of [
      { type: 'ledger.wipe' },
      { type: 'adapter.act', selector: '#send' },
      {},
      null,
      undefined,
      'adapter.health',
      42,
      [VALID['adapter.health']],
    ]) {
      expect(BusMessage.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });

  it('rejects an extra field at the top level of every type (strict objects)', () => {
    for (const type of BUS_MESSAGE_TYPES) {
      expect(BusMessage.safeParse({ ...VALID[type], extra: SECRET }).success, type).toBe(false);
    }
  });
});

describe('BusMessage payload items', () => {
  it('rejects raw content smuggled into payload items (Hard Rule 2)', () => {
    const cases: unknown[] = [
      { ...VALID['adapter.claims'], requests: [{ ...REQUEST, transcript: SECRET }] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, extractor: { ...CLAIM.extractor, html: SECRET } }] },
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, html: SECRET }] },
      { ...VALID['adapter.health'], health: { ...VALID['adapter.health'].health, dom: SECRET } },
      { ...VALID['ui.query'], query: { kind: 'ledger.export', filter: SECRET } },
    ];
    for (const raw of cases) expect(BusMessage.safeParse(raw).success).toBe(false);
  });

  it('enforces the ledger field formats inside payloads', () => {
    const cases: unknown[] = [
      { ...VALID['adapter.claims'], requests: [{ ...REQUEST, textHint: 'x'.repeat(201) }] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, rawHash: HASH.toUpperCase() }] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, claimedAt: '2026-10-01 09:30' }] },
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, amountCents: 12.5 }] },
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, id: 'not-a-ulid' }] },
      { ...VALID['coverage.ping'], ping: { ...VALID['coverage.ping'].ping, accountHash: 'me@example.com' } },
      { ...VALID['adapter.claims'], adapterId: '' },
      { ...VALID['observer.observations'], version: '' },
    ];
    for (const raw of cases) expect(BusMessage.safeParse(raw).success).toBe(false);
  });

  it('carries the canonical core schemas, so the bus and grading agree on every field', () => {
    expect(AdapterClaimsMessage.shape.claims.element).toBe(Claim);
    expect(AdapterClaimsMessage.shape.requests.element).toBe(Request);
    expect(ObserverObservationsMessage.shape.observations.element).toBe(Observation);
    expect(AdapterHealthMessage.shape.health).toBe(HealthReport);
  });
});

describe('BusMessage payload items: the Sprint 1 fields', () => {
  it('rejects payloads missing the Sprint 1 fields or breaking their formats', () => {
    const noPrecision = Object.fromEntries(
      Object.entries(CLAIM).filter(([key]) => key !== 'claimedAtPrecision'),
    );
    const cases: unknown[] = [
      { ...VALID['adapter.claims'], claims: [noPrecision] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, claimedAtPrecision: 'second' }] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, targetAt: 'next Tuesday' }] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, amountCents: -1 }] },
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, rowKeyHash: 'row-17' }] },
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, currency: 'usd' }] },
      // v1.3: an observation's id must be idFromHash(contentHash); claimedAtEnd only on a day claim.
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, id: CLAIM.id }] },
      { ...VALID['observer.observations'], observations: [{ ...OBSERVATION, contentHash: 'cd'.repeat(32) }] },
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, claimedAtEnd: '2026-10-01T09:31:00Z' }] },
    ];
    for (const raw of cases) expect(BusMessage.safeParse(raw).success).toBe(false);
    const withRowKey = { ...OBSERVATION, rowKeyHash: HASH, amountCents: 0, currency: 'USD' };
    expect(
      BusMessage.safeParse({ ...VALID['observer.observations'], observations: [withRowKey] }).success,
    ).toBe(true);
  });

  it('accepts empty extraction batches (an adapter that found nothing still reports)', () => {
    const empty = { ...VALID['adapter.claims'], requests: [], claims: [] };
    expect(BusMessage.safeParse(empty).success).toBe(true);
    const none = { ...VALID['observer.observations'], observations: [] };
    expect(BusMessage.safeParse(none).success).toBe(true);
  });
});

describe('ledger.changed', () => {
  it('names only the eight ledger tables', () => {
    expect([...LedgerTable.options].sort()).toEqual(
      [
        'adapterHealth',
        'claims',
        'coverage',
        'grants',
        'meta',
        'observations',
        'receipts',
        'requests',
      ].sort(),
    );
    for (const table of LedgerTable.options) {
      const message = { type: 'ledger.changed', tables: [table], at: TS };
      expect(BusMessage.safeParse(message).success, table).toBe(true);
    }
  });

  it('rejects an unknown table and an empty change set', () => {
    expect(BusMessage.safeParse({ ...VALID['ledger.changed'], tables: ['secrets'] }).success).toBe(false);
    expect(BusMessage.safeParse({ ...VALID['ledger.changed'], tables: [] }).success).toBe(false);
  });
});

describe('ui.query / ui.result', () => {
  it('query kinds and result kinds are the same set', () => {
    for (const kind of UiQueryKindSchema.options) {
      expect(BusMessage.safeParse({ type: 'ui.query', query: { kind } }).success, kind).toBe(true);
      expect(UiResultMessage.safeParse({ type: 'ui.result', kind, ok: true, data: null }).success).toBe(true);
    }
  });

  it('an ok result carries data, a failed result carries a known error code and nothing else', () => {
    const ok = { type: 'ui.result', kind: 'ledger.export', ok: true, data: { receipts: [] } };
    expect(UiResultMessage.safeParse(ok).success).toBe(true);
    for (const error of ['unknown_query', 'handler_failed', 'unavailable'] as const) {
      expect(UiResultMessage.safeParse(uiFailure('ledger.export', error)).success, error).toBe(true);
    }
    expect(UiResultMessage.safeParse({ ...ok, error: 'unavailable' }).success).toBe(false);
    expect(UiResultMessage.safeParse({ ...uiFailure('ledger.export', 'unavailable'), data: 1 }).success).toBe(
      false,
    );
    expect(UiResultMessage.safeParse({ ...ok, ok: 'yes' }).success).toBe(false);
  });

  it('refuses data that would not survive the JSON wire (undefined or missing)', () => {
    expect(UiResultMessage.safeParse({ type: 'ui.result', kind: 'health.list', ok: true }).success).toBe(
      false,
    );
    expect(
      UiResultMessage.safeParse({ type: 'ui.result', kind: 'health.list', ok: true, data: undefined })
        .success,
    ).toBe(false);
  });

  it('uiFailure builds the failed result for a kind', () => {
    expect(uiFailure('health.list', 'unknown_query')).toEqual({
      type: 'ui.result',
      kind: 'health.list',
      ok: false,
      error: 'unknown_query',
    });
  });
});

describe('isBusMessageType', () => {
  it('is true only for the seven type strings', () => {
    for (const type of BUS_MESSAGE_TYPES) expect(isBusMessageType(type)).toBe(true);
    for (const value of ['ui.Query', 'ledger.wipe', '', 'adapter.health ', 7, null, undefined, {}]) {
      expect(isBusMessageType(value)).toBe(false);
    }
  });
});
