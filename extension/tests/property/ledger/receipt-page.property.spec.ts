import 'fake-indexeddb/auto';
/**
 * The UI's pages of receipts against an oracle (sprint_4 4.0, 4.3; src/ledger/views.ts `receiptPage`; Sprint 4 QA
 * review, qa_tester priority 6). tests/unit/ledger/views.spec.ts walks one ledger whose page boundary falls inside one
 * batch instant; here the ledgers are random: 8 to 40 receipts of any agent and grade, graded at six instants so most
 * share one with others, and any choice of agents, grades, range and page size. Walking every page with the cursor
 * each page returns gives exactly the oracle's list, newest first by grading instant then by the greater id, with no
 * receipt lost or shown twice, every page but the last full, the last one saying there is no next, and an empty range
 * one empty page. A receipt is read under the grade Attest computed, so a person's mark never hides it from a filter.
 * Every value is invented.
 */
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareText } from '../../../src/core/order';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt } from '../../../src/ledger/repo';
import { AgentId, Grade, type ReceiptInput } from '../../../src/ledger/types';
import { type ReceiptPage, receiptPage, type ReceiptQuery } from '../../../src/ledger/views';
import {
  claimId,
  makeReceipt,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from '../../unit/ledger/fixtures';

const RUNS = { numRuns: 150 };
const T0 = Date.parse('2026-10-01T12:00:00Z');
const MINUTE = 60_000;
const at = (minute: number): number => T0 + minute * MINUTE;

interface Spec {
  readonly agent: AgentId;
  readonly grade: Grade;
  readonly minute: number;
  readonly marked: boolean;
}

/** Receipt `n` as stored: its grade the computed one, a person's mark beside it when `marked`. */
function receiptOf(n: number, { agent, grade, minute, marked }: Spec): ReceiptInput {
  const base = makeReceipt({
    id: ulid(n),
    agent,
    claimId: claimId(n),
    grade,
    inputsHash: sha(n),
    computedAt: new Date(at(minute)).toISOString(),
    state: 'FINAL',
    finalAt: new Date(at(minute)).toISOString(),
  });
  const graded = grade === 'UNASKED' ? { ...omit(base, 'claimId'), attribution: 'likely' as const } : base;
  if (!marked || grade === 'UNASKED') return graded;
  return {
    ...graded,
    state: 'USER_OVERRIDDEN',
    reasons: [...graded.reasons, { code: 'override.user', params: { grade: 'NOT_FOUND' } }],
    override: {
      grade: 'NOT_FOUND',
      reason: 'Not mine',
      at: new Date(at(minute) + MINUTE).toISOString(),
      previousState: 'FINAL',
    },
  };
}

const spec = fc.record({
  agent: fc.constantFrom(...AgentId.options),
  grade: fc.constantFrom(...Grade.options),
  minute: fc.integer({ min: 0, max: 5 }),
  marked: fc.boolean(),
});

/** Most queries ask for several agents over most of the instants; some ask for none, or an empty range. */
const queryOf = fc.record({
  agents: fc.oneof(
    { arbitrary: fc.subarray([...AgentId.options], { minLength: 2 }), weight: 8 },
    { arbitrary: fc.subarray([...AgentId.options], { maxLength: 1 }), weight: 2 },
  ),
  grades: fc.option(fc.subarray([...Grade.options], { minLength: 3 }), { nil: undefined, freq: 2 }),
  from: fc.integer({ min: -1, max: 3 }),
  span: fc.oneof(
    { arbitrary: fc.integer({ min: 3, max: 7 }), weight: 9 },
    { arbitrary: fc.constant(-1), weight: 1 },
  ),
  limit: fc.integer({ min: 1, max: 5 }),
});

/** Between 8 and 40 receipts. */
const ledgerOf = fc
  .integer({ min: 8, max: 40 })
  .chain((size) => fc.array(spec, { minLength: size, maxLength: size }));

let db: LedgerDb;

beforeAll(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('receipt-page-property'));
});

afterAll(() => {
  db.close();
  releaseClock();
});

const idsOf = (page: ReceiptPage): string[] => page.items.map(({ receipt: { id } }) => id);

describe('receiptPage over random ledgers', () => {
  it('walks every page to exactly the oracle: newest first, none lost or shown twice', async () => {
    // Not vacuous: many runs page more than once, with a page boundary inside one grading instant.
    let paged = 0;
    let boundaryInTie = 0;
    await fc.assert(
      fc.asyncProperty(ledgerOf, queryOf, async (specs, asked) => {
        await db.receipts.clear();
        for (const [index, one] of specs.entries()) await putReceipt(db, receiptOf(index + 1, one));
        const query: ReceiptQuery = {
          agents: asked.agents,
          ...(asked.grades === undefined ? {} : { grades: asked.grades }),
          fromMs: at(asked.from),
          toMs: at(asked.from + asked.span),
          limit: asked.limit,
        };
        const expected = specs
          .map((one, index) => ({ ...one, id: ulid(index + 1), ms: at(one.minute) }))
          .filter(({ agent }) => asked.agents.includes(agent))
          .filter(({ grade }) => asked.grades === undefined || asked.grades.includes(grade))
          .filter(({ ms }) => ms >= query.fromMs && ms <= query.toMs)
          .sort((a, b) => b.ms - a.ms || compareText(b.id, a.id))
          .map(({ id }) => id);

        const pages: string[][] = [];
        let page = await receiptPage(db, query);
        pages.push(idsOf(page));
        while (page.next !== null) {
          expect(pages.length).toBeLessThanOrEqual(expected.length);
          page = await receiptPage(db, { ...query, after: page.next });
          pages.push(idsOf(page));
        }
        expect(pages.flat()).toEqual(expected);
        expect(pages).toHaveLength(Math.max(1, Math.ceil(expected.length / query.limit)));
        for (const shown of pages.slice(0, -1)) expect(shown).toHaveLength(query.limit);
        if (pages.length > 1) paged += 1;
        const minuteOf = new Map(specs.map((one, index) => [ulid(index + 1), one.minute]));
        const tie = pages
          .slice(0, -1)
          .some(
            (shown, index) => minuteOf.get(shown.at(-1) ?? '') === minuteOf.get(pages[index + 1]?.[0] ?? ''),
          );
        if (tie) boundaryInTie += 1;
      }),
      RUNS,
    );
    expect(paged).toBeGreaterThan(75);
    expect(boundaryInTie).toBeGreaterThan(40);
  }, 300_000);
});
