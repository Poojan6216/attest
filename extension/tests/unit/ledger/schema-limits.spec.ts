/**
 * Every free-text string and every array at the storage and bus boundary has a length cap (SECURITY-4, Hard
 * Rule 2): a value at the cap parses, one over it is rejected, so a whole email body can never ride in
 * `counterparty` or a batch of unbounded size into the ledger.
 *
 * The core schemas' own caps are proven in tests/unit/core/schema-limits.spec.ts; this file proves that the
 * ledger re-exports exactly those schemas, and covers the ledger-only shapes and the bus batches.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { BusMessage } from '../../../src/bus/messages';
import * as core from '../../../src/core/schema';
import * as ledger from '../../../src/ledger/types';
import { VALID } from '../bus/harness';
import { makeObservation, makePing } from './fixtures';

const { CoveragePing, MetaEntry, Observation, SCHEMA_LIMITS: L } = ledger;

const text = (length: number): string => 'x'.repeat(length);

/** [label, schema, build(n) → a value whose capped field has size n, cap] */
type Case = readonly [string, z.ZodType, (n: number) => unknown, number];

const CASES: readonly Case[] = [
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
  [
    'adapter.health reasons',
    BusMessage,
    (n) => ({
      ...VALID['adapter.health'],
      health: { ...VALID['adapter.health'].health, reasons: Array(n).fill('r') },
    }),
    L.REASONS,
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

describe('src/ledger/types re-exports the canonical core schemas (docs/grading.md §13)', () => {
  it('every core export is the very same object in the ledger', () => {
    const coreExports = Object.entries(core);
    expect(coreExports.length).toBeGreaterThan(20);
    for (const [name, value] of coreExports) expect(Reflect.get(ledger, name), name).toBe(value);
  });

  it('AdapterHealth is the core HealthReport, and SCHEMA_LIMITS keeps every Sprint 0 cap', () => {
    expect(ledger.AdapterHealth).toBe(core.HealthReport);
    expect(L).toMatchObject({
      COUNTERPARTY: 320,
      MERCHANT: 120,
      CONVERSATION_ID: 128,
      ID: 64,
      ITEM: 120,
      REASONS: 32,
      LIST: 200,
      BATCH: 500,
      META_VALUE: 256,
    });
    expect(Object.isFrozen(L)).toBe(true);
  });
});
