/**
 * Sprint 5 QA review (Hard Rule 4: the model only proposes; docs/grading.md §5.4; qa_tester rule 4), through
 * `gradeBatch`, the path the service worker takes (src/background/grading.ts). ./monotonicity-batch.property.spec.ts
 * scores every claim's every candidate alike, which cannot move an observation between claims. Here each claim's
 * candidates are scored at random, one by one (none, any, or 1): a claim's best may be scored low and another's high.
 * Under the shipped policy, no observation moves from one claim to another, the rule changes only PARTIAL → VERIFIED, a
 * NOT_FOUND, an UNVERIFIABLE and a claim-less receipt never change, and each receipt's inputs carry exactly its own
 * claim's scores. The property also checks it was not proved over nothing. Every value is invented.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type BatchReceipt, gradeBatch } from '../../src/core/batch';
import { createMemoryIndex } from '../../src/core/candidates';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { Activity, type Claim, type ModelScores, type Observation, type Ulid } from '../../src/core/schema';
import { BASIS_POINTS } from '../../src/core/units';
import { buildCoverage, buildGrant } from '../golden/build';
import { at, claimArb, decided, rowArb } from './monotonicity-worlds';

const PROPERTY_TIMEOUT_MS = 300_000;
const BATCH_RUNS = 3_000;

/** A claim's score of one row: none, any, or 1 (a third each), so raises come often enough to be seen. */
const batchScore = fc.oneof(
  fc.constant(undefined),
  fc.integer({ min: 0, max: BASIS_POINTS }),
  fc.constant(BASIS_POINTS),
);

interface World {
  readonly claims: readonly Claim[];
  readonly rows: readonly Observation[];
  readonly evaluatedAt: string;
  /** Each claim's score of each row, by claim then row (in the order generated); none where undefined. */
  readonly scores: readonly (readonly (number | undefined)[])[];
}

const worldArb: fc.Arbitrary<World> = fc.constantFrom(at(150), at(6 * 60)).chain((evaluatedAt) =>
  fc
    .record({
      claims: fc
        .tuple(claimArb(1), claimArb(2), claimArb(3))
        .chain((claims) => fc.subarray(claims, { minLength: 2 })),
      rows: fc
        .tuple(rowArb(1, evaluatedAt), rowArb(2, evaluatedAt), rowArb(3, evaluatedAt), rowArb(4, evaluatedAt))
        .chain((rows) => fc.subarray(rows, { minLength: 1 })),
    })
    .chain(({ claims, rows }) =>
      fc.record({
        claims: fc.constant(claims),
        rows: fc.constant(rows),
        evaluatedAt: fc.constant(evaluatedAt),
        scores: fc.array(fc.array(batchScore, { minLength: rows.length, maxLength: rows.length }), {
          minLength: claims.length,
          maxLength: claims.length,
        }),
      }),
    ),
);

/** Each claim's own scores, one per observation (two rows may share an id), in id order, as the ledger hands them. */
function scoresOfWorld(world: World): Map<Ulid, ModelScores> {
  return new Map(
    world.claims.map((claim, c) => {
      const byId = new Map<Ulid, number>();
      world.rows.forEach((row, r) => {
        const score = world.scores[c]?.[r];
        if (score !== undefined && !byId.has(row.id)) byId.set(row.id, score);
      });
      const own = [...byId]
        .map(([observationId, score]) => ({ observationId, score }))
        .sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
      return [claim.id, own];
    }),
  );
}

async function graded(world: World, scores?: Map<Ulid, ModelScores>): Promise<Map<string, BatchReceipt>> {
  const { evaluatedAt } = world;
  const window = {
    lastSyncAt: evaluatedAt,
    windowStart: at(-24 * 60),
    windowEnd: evaluatedAt,
    accountHash: 'a',
  };
  const coverage = buildCoverage([{ source: 'gmail.sent', ...window }], evaluatedAt);
  const activity = Activity.parse({
    sessions: [],
    idle: [],
    entries: [],
    adapterSyncs: [],
    claims: world.claims,
  });
  const grants = [buildGrant({ agent: 'muse' }, evaluatedAt)];
  const index = createMemoryIndex(world.rows, 1);
  const out = await gradeBatch(world.claims, index, grants, DEFAULT_POLICY, coverage, activity, [], scores);
  return new Map(out.map((entry) => [entry.receipt.id, entry]));
}

describe('the model never grades a batch, candidate by candidate (Sprint 5 QA; Hard Rule 4)', () => {
  it(
    `${String(BATCH_RUNS)} random batches, each claim's candidates scored at random: no observation moves between claims, and each receipt carries its own claim's scores`,
    async () => {
      const seen = { contested: 0, raised: 0 };
      await fc.assert(
        fc.asyncProperty(worldArb, async (world) => {
          const floor = await graded(world);
          const scores = scoresOfWorld(world);
          const scored = await graded(world, scores);
          expect([...scored.keys()]).toEqual([...floor.keys()]);
          const taken = [...floor.values()].filter(({ receipt }) => receipt.observationIds.length > 0);
          if (taken.length > 1) seen.contested += 1;
          for (const [id, { receipt }] of floor) {
            const entry = scored.get(id);
            if (entry === undefined) throw new Error('a receipt went missing');
            expect(entry.receipt.observationIds).toEqual(receipt.observationIds);
            const own = receipt.claimId === undefined ? undefined : scores.get(receipt.claimId);
            expect(entry.inputs.context.modelScores).toEqual(own);
            if (entry.receipt.ruleId !== receipt.ruleId) {
              seen.raised += 1;
              expect([receipt.ruleId, entry.receipt.ruleId]).toEqual(['partial', 'verified']);
            }
            if (
              receipt.grade === 'NOT_FOUND' ||
              receipt.grade === 'UNVERIFIABLE' ||
              receipt.claimId === undefined
            ) {
              expect(decided(entry.receipt)).toEqual(decided(receipt));
            }
          }
        }),
        { numRuns: BATCH_RUNS },
      );
      // Not proved over nothing: batches where two claims each took an observation, and raises.
      expect(seen.contested).toBeGreaterThan(0);
      expect(seen.raised).toBeGreaterThan(0);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
