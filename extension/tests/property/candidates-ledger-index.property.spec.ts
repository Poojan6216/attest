/**
 * The ledger's Dexie ObservationIndex (src/ledger/index.ts) against the memory index (docs/grading.md §4.2), read for
 * read: for random honest ledgers (every action type, rows in three offsets over four days, addresses and merchants)
 * and random bounded queries, each Dexie read equals the memory index's read trimmed to the exact range (the memory
 * index over-returns whole buckets; the Dexie index never does), in the same (instant, id) order. Token reads use the
 * §4.2 tokens of the stored rows (addresses, domains, local-part tokens, merchant name tokens) and tokens no row has.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { counterpartyTokens, createMemoryIndex, type ObservationIndex } from '../../src/core/candidates';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { project } from '../../src/core/redact';
import { ActionType, type Observation } from '../../src/core/schema';
import type { LedgerDb } from '../../src/ledger/db';
import { toObservationRow } from '../../src/ledger/index-fields';
import { createLedgerIndex } from '../../src/ledger/index';
import { openLedger } from '../../src/ledger/migrations';
import { isoAt, MS_PER_MINUTE } from '../tools/attest-world';
import { uniqueDbName } from '../unit/ledger/fixtures';

const RUNS = 300;
const BASE_MS = Date.parse('2026-10-06T00:00:00Z');
const SPAN_MINUTES = 4 * 24 * 60;
const SOURCE_OF = {
  'gmail.sent': 'gmail.sent',
  'gmail.receipt': 'gmail.receipt',
  'gcal.event': 'gcal.event',
} as const;
const COUNTERPARTIES = ['priya.shah@company.com', 'raj+news@company.com', 'ops@vendor.io'];
const MERCHANTS = ['Blue Bottle Café', 'Acme Store', 'Blue Apron'];

/** Mostly three types (so reads find rows), sometimes any of the nine. */
const typeArb = fc.oneof(
  { arbitrary: fc.constantFrom<ActionType>('email.sent', 'calendar.created', 'purchase.made'), weight: 4 },
  { arbitrary: fc.constantFrom(...ActionType.options), weight: 1 },
);

const rowArb = fc.record({
  type: typeArb,
  source: fc.constantFrom(...(Object.keys(SOURCE_OF) as (keyof typeof SOURCE_OF)[])),
  minutes: fc.integer({ min: 0, max: SPAN_MINUTES }),
  ms: fc.constantFrom(0, 1, 59_999),
  offset: fc.constantFrom(-240, 0, 330),
  who: fc.nat({ max: 2 }),
});

const queryArb = fc.record({
  type: typeArb,
  fromMinutes: fc.integer({ min: -60, max: SPAN_MINUTES + 60 }),
  lengthMinutes: fc.integer({ min: -5, max: 3 * 24 * 60 }),
  ms: fc.constantFrom(0, 1, 59_999),
  token: fc.nat({ max: 20 }),
  bucket: fc.constantFrom(1, 15, 60, 1440),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

function toRow(r: Generated<typeof rowArb>, i: number): Observation {
  const occurredAt = isoAt(BASE_MS + r.minutes * MS_PER_MINUTE + r.ms, r.offset);
  const raw =
    r.source === 'gmail.receipt'
      ? { merchant: MERCHANTS[r.who], amountCents: 1200, currency: 'USD', occurredAt }
      : { counterparty: COUNTERPARTIES[r.who], subjectHint: 'Q3', occurredAt };
  return project(
    SOURCE_OF[r.source],
    raw,
    { type: r.type, observedAt: occurredAt, rowKey: `row-${String(i)}` },
    DEFAULT_POLICY,
  );
}

/** The memory index's read trimmed to `[fromMs, toMs]`: what the Dexie index must return. */
async function trimmed(read: Promise<readonly Observation[]>, fromMs: number, toMs: number) {
  return (await read).filter((o) => Date.parse(o.occurredAt) >= fromMs && Date.parse(o.occurredAt) <= toMs);
}

let db: LedgerDb;
beforeAll(async () => {
  db = await openLedger(uniqueDbName('ledger-index-property'));
});
afterAll(() => {
  db.close();
});

const tally = { typeRows: 0, tokenRows: 0, empty: 0 };

describe('Dexie index reads equal the memory index trimmed to the range (property)', () => {
  it('byTypeAndBucket and byCounterpartyToken, for any rows, range and bucket width', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { minLength: 8, maxLength: 40 }),
        fc.array(queryArb, { minLength: 1, maxLength: 4 }),
        async (rows, queries) => {
          const observations = rows.map(toRow);
          await db.observations.clear();
          await db.observations.bulkAdd(observations.map(toObservationRow));
          const dexie: ObservationIndex = createLedgerIndex(db);
          const tokens = [
            ...new Set(observations.flatMap((o) => counterpartyTokens(o))),
            'nobody',
            'company',
          ];
          for (const q of queries) {
            const memory = createMemoryIndex(observations, q.bucket);
            const fromMs = BASE_MS + q.fromMinutes * MS_PER_MINUTE + q.ms;
            const toMs = fromMs + q.lengthMinutes * MS_PER_MINUTE;
            const byType = await dexie.byTypeAndBucket(q.type, fromMs, toMs);
            expect(byType).toEqual(await trimmed(memory.byTypeAndBucket(q.type, fromMs, toMs), fromMs, toMs));
            const token = tokens[q.token % tokens.length] ?? 'nobody';
            const byToken = await dexie.byCounterpartyToken(token, fromMs, toMs);
            expect(byToken).toEqual(
              await trimmed(memory.byCounterpartyToken(token, fromMs, toMs), fromMs, toMs),
            );
            tally.typeRows += byType.length;
            tally.tokenRows += byToken.length;
            if (byType.length === 0 && byToken.length === 0) tally.empty += 1;
          }
        },
      ),
      { numRuns: RUNS },
    );
    console.log(`ledger index property tally: ${JSON.stringify(tally)}`);
    expect(tally.typeRows).toBeGreaterThan(RUNS);
    expect(tally.tokenRows).toBeGreaterThan(RUNS);
    expect(tally.empty).toBeGreaterThan(RUNS / 20);
  }, 120_000);
});
