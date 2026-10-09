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
  CoveragePingMessage,
  isBusMessageType,
  LedgerTable,
  ObserverObservationsMessage,
  type UiQuery,
  type UiQueryKind,
  UiQueryKind as UiQueryKindSchema,
  UiResultMessage,
  uiFailure,
} from '../../../src/bus/messages';
import { Claim, ComponentId, HealthReport, Observation, Request } from '../../../src/core/schema';
import { CLAIM, HASH, MALFORMED, OBSERVATION, REQUEST, SECRET, TS, VALID } from './harness';

describe('BusMessage', () => {
  it('has exactly the seven message types of sprint 0.7, the Calendar snapshot of 2.7, the scope snapshot of 3.0, the import of 3.13 and the receipt event of 4.3', () => {
    expect([...BUS_MESSAGE_TYPES].sort()).toEqual(
      [
        'adapter.claims',
        'adapter.health',
        'adapter.scope',
        'calendar.snapshot',
        'claims.import',
        'coverage.ping',
        'ledger.changed',
        'observer.observations',
        'receipt.event',
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
    expect(BUS_MESSAGE_TYPES).toHaveLength(11);
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
      // §10 (v1.4): a claim whose id is not idFromHash(rawHash) never crosses the bus.
      { ...VALID['adapter.claims'], claims: [{ ...CLAIM, rawHash: HASH }] },
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

describe('ids, versions and health reasons are tokens, never page text (OBS-1, Hard Rule 2)', () => {
  /** Probe p8: a message body padded to the old 120-character reason cap. */
  const BODY = 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120.\nThanks, P'.padEnd(120, '.');
  /** Probe p9: an id that quotes the page. */
  const QUOTED = 'door code\n4417 SSN 078-05-1120';
  const health = VALID['adapter.health'].health;
  const extractor = CLAIM.extractor;

  it('refuses probe p8: a health report whose reasons are message bodies or sentences', () => {
    const bodies = { ...health, reasons: Array.from({ length: 32 }, () => BODY) };
    expect(BusMessage.safeParse({ type: 'adapter.health', health: bodies }).success).toBe(false);
    for (const reason of [BODY.slice(0, 40), 'Selector missing', 'selector.missing\n', 'Hi Priya']) {
      const one = { ...health, reasons: ['selector.missing', reason] };
      expect(BusMessage.safeParse({ type: 'adapter.health', health: one }).success, reason).toBe(false);
    }
  });

  it('refuses probe p9: an id or version that quotes the page, in every message that carries one', () => {
    const builds: readonly ((id: string) => unknown)[] = [
      (id) => ({ ...VALID['adapter.health'], health: { ...health, adapterId: id } }),
      (id) => ({ ...VALID['adapter.health'], health: { ...health, version: id } }),
      (id) => ({ ...VALID['adapter.claims'], adapterId: id }),
      (id) => ({ ...VALID['adapter.claims'], version: id }),
      (id) => ({ ...VALID['adapter.claims'], claims: [{ ...CLAIM, extractor: { ...extractor, id } }] }),
      (id) => ({
        ...VALID['adapter.claims'],
        claims: [{ ...CLAIM, extractor: { ...extractor, version: id } }],
      }),
      (id) => ({ ...VALID['observer.observations'], observerId: id }),
      (id) => ({ ...VALID['observer.observations'], version: id }),
      (id) => ({ ...VALID['coverage.ping'], ping: { ...VALID['coverage.ping'].ping, observerId: id } }),
    ];
    for (const build of builds) {
      expect(BusMessage.safeParse(build('muse.activity')).success).toBe(true);
      for (const id of [QUOTED, 'door code 4417', 'priya@company.com', '']) {
        expect(BusMessage.safeParse(build(id)).success, id).toBe(false);
      }
    }
  });

  it('every id and version of the bus is the core ComponentId', () => {
    expect(AdapterClaimsMessage.shape.adapterId).toBe(ComponentId);
    expect(AdapterClaimsMessage.shape.version).toBe(ComponentId);
    expect(ObserverObservationsMessage.shape.observerId).toBe(ComponentId);
    expect(ObserverObservationsMessage.shape.version).toBe(ComponentId);
    expect(CoveragePingMessage.shape.ping.shape.observerId).toBe(ComponentId);
  });
});

describe("a vendor's conversation id is a token, never page text (R3-LEDGER-2, probe r4)", () => {
  /** Probe r4: a conversation's opening lines taken for its id, padded to the 128-character cap. */
  const QUOTE = 'Hi Priya,\nthe door code is 4417.\nSSN 078-05-1120\nThanks, P'.padEnd(128, '.');
  const withId = (conversationId: string, count = 1) => ({
    ...VALID['adapter.claims'],
    requests: Array.from({ length: count }, () => ({ ...REQUEST, conversationId })),
  });

  it('refuses 500 requests whose conversationId quotes the page, each at its own path', () => {
    const result = BusMessage.safeParse(withId(QUOTE, 500));
    expect(result.success).toBe(false);
    const paths = (result.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
    expect(new Set(paths)).toEqual(
      new Set(Array.from({ length: 500 }, (_, i) => `requests.${String(i)}.conversationId`)),
    );
  });

  it.each([QUOTE, 'Hi Priya', 'q3 review thread', 'a\nb', 'priya@company.com', ' conv-7', 'x'.repeat(129)])(
    'refuses %j',
    (id) => {
      expect(BusMessage.safeParse(withId(id)).success).toBe(false);
    },
  );

  it.each(['conv-7', '6710a2b4-0c3e-8001-9a7f-1c2d3e4f5a6b', 'c_8f3a:2', 'x'.repeat(128), ''])(
    'accepts %j',
    (id) => {
      expect(BusMessage.safeParse(withId(id)).success).toBe(true);
    },
  );
});

describe('ledger.changed', () => {
  it('names only the ledger tables', () => {
    expect([...LedgerTable.options].sort()).toEqual(
      [
        'activity',
        'adapterHealth',
        'calendarSnapshots',
        'claims',
        'coverage',
        'coverageIntervals',
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
