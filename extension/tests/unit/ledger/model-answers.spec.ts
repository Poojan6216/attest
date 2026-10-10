import 'fake-indexeddb/auto';
/**
 * The advisory model's answers in the ledger (sprint_5 5.4; src/ledger/model-answers.ts): a claim is asked once, its
 * row written before the call; an input the same provider answered before is copied, never sent again (the cache by
 * `inputsHash`), and counts as a stored fact; an answer is added to its row, and lost with it when the row went
 * meanwhile; a batch reads only answered rows; a row holds exactly its schema's fields. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCount, STORED_WRITES } from '../../../src/ledger/clock-high-water';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  answerAsk,
  askedClaims,
  claimAsk,
  modelScoresOf,
  purgeModelAnswers,
} from '../../../src/ledger/model-answers';
import { putReceipt, upsertClaim } from '../../../src/ledger/repo';
import { purgeExpired } from '../../../src/ledger/retention';
import { ModelAnswer, ModelScores, Ulid } from '../../../src/ledger/types';
import { makeClaim, makeReceipt, pinClock, releaseClock, sha, ulid, uniqueDbName } from './fixtures';

const AT = '2026-10-06T14:21:00-04:00';
let db: LedgerDb;

beforeEach(async () => {
  pinClock(AT);
  db = await openLedger(uniqueDbName('model-answers'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const ask = (n: number, hash = sha(70), provider: 'builtin' | 'byo' = 'byo') =>
  ModelAnswer.parse({ claimId: ulid(n), inputsHash: hash, provider, askedAt: AT });
const scores = (score: number) => ModelScores.parse([{ observationId: ulid(900), score }]);

describe('claimAsk', () => {
  it('records a claim once: a second ask of it, whatever its input, is refused', async () => {
    expect(await claimAsk(db, ask(1))).toBe('ask');
    expect(await claimAsk(db, ask(1, sha(71)))).toBe('asked');
    expect(await db.modelAnswers.toArray()).toEqual([ask(1)]);
  });

  it('copies the answer the same provider gave the same input, as a stored fact, and sends nothing', async () => {
    await claimAsk(db, ask(1));
    await answerAsk(db, ask(1).claimId, scores(9_000), ask(1).askedAt);
    const writes = await readCount(db, STORED_WRITES);
    expect(await claimAsk(db, ask(2))).toBe('cached');
    expect(await db.modelAnswers.get(ulid(2))).toEqual({ ...ask(2), scores: scores(9_000) });
    expect(await readCount(db, STORED_WRITES)).toBe(writes + 1);
  });

  it('never copies another provider’s answer, an unanswered ask, or another input’s', async () => {
    await claimAsk(db, ask(1));
    expect(await claimAsk(db, ask(2))).toBe('ask');
    await answerAsk(db, ask(1).claimId, scores(9_000), ask(1).askedAt);
    expect(await claimAsk(db, ask(3, sha(70), 'builtin'))).toBe('ask');
    expect(await claimAsk(db, ask(4, sha(72)))).toBe('ask');
  });

  it('counts a row that no longer parses as asked: a corrupt row never gets a claim asked twice', async () => {
    await db.modelAnswers.put({ claimId: ulid(1), provider: 'nobody' } as never);
    expect(await claimAsk(db, ask(1))).toBe('asked');
    expect([...(await askedClaims(db, [Ulid.parse(ulid(1)), Ulid.parse(ulid(2))]))]).toEqual([ulid(1)]);
  });
});

describe('answerAsk and modelScoresOf', () => {
  it('adds the scores to the row; a batch reads only answered rows', async () => {
    await claimAsk(db, ask(1));
    await claimAsk(db, ask(2, sha(71)));
    expect(await answerAsk(db, ask(1).claimId, scores(10_000), ask(1).askedAt)).toBe(true);
    const read = await modelScoresOf(db, [ask(1).claimId, ask(2).claimId, Ulid.parse(ulid(3))]);
    expect([...read]).toEqual([[ulid(1), scores(10_000)]]);
  });

  it('stores nothing when the row went meanwhile (a purge, a wipe)', async () => {
    expect(await answerAsk(db, ask(1).claimId, scores(10_000), ask(1).askedAt)).toBe(false);
    expect(await db.modelAnswers.count()).toBe(0);
  });

  it('refuses a row with a field its schema does not name: never a hint, never an input', async () => {
    const stray = { ...ask(1), rationaleHint: 'Quarterly deck' };
    await expect(claimAsk(db, stray)).rejects.toThrow();
    expect(await db.modelAnswers.count()).toBe(0);
  });
});

describe('purgeModelAnswers', () => {
  it('deletes the rows of the claims given, and counts those it held', async () => {
    await claimAsk(db, ask(1));
    await claimAsk(db, ask(2, sha(71)));
    expect(await purgeModelAnswers(db, [ulid(1), ulid(3)])).toBe(1);
    expect((await db.modelAnswers.toArray()).map((row) => row.claimId)).toEqual([ulid(2)]);
  });

  it('goes with its claim in the retention purge, and stays with a kept one (src/ledger/retention.ts rule 12)', async () => {
    const claimed = { old: '2026-06-01T10:14:00-04:00', fresh: '2026-10-06T10:14:00-04:00' };
    for (const [n, at] of [
      [1, claimed.old],
      [2, claimed.fresh],
    ] as const) {
      const claim = makeClaim({ rawHash: sha(500 + n), claimedAt: at, observedAt: at });
      await upsertClaim(db, claim);
      await putReceipt(db, makeReceipt({ id: ulid(600 + n), claimId: claim.id, computedAt: at }));
      await claimAsk(
        db,
        ModelAnswer.parse({ claimId: claim.id, inputsHash: sha(70 + n), provider: 'byo', askedAt: at }),
      );
    }
    const report = await purgeExpired(db, { now: AT });
    expect(report.modelAnswers).toBe(1);
    expect((await db.modelAnswers.toArray()).map((row) => row.claimId)).toEqual([
      makeClaim({ rawHash: sha(502) }).id,
    ]);
  });
});
