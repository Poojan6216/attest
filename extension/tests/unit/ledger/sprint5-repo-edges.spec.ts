import 'fake-indexeddb/auto';
/**
 * Sprint 5 QA review, qa_tester rule 3 (two tests per repo method: happy, and conflict or duplicate) for the ledger's
 * Sprint 5 methods.
 *  - The telemetry's sent day (src/ledger/telemetry-sent.ts), which only ran inside send.spec.ts: none stored reads as
 *    null; a day recorded reads back; the same day twice is one row; a later day replaces it; what is stored but is not
 *    a day reads as null (so the day is sent again, never skipped for good); a value that is not a day is refused,
 *    and the day stored stays.
 *  - The model's answers (src/ledger/model-answers.ts): two runs asking about one claim at once (the grace alarm and
 *    an import) make one call between them, as the module promises; an answer for a row that no longer parses is not
 *    stored and the row is left as it was, logged by table and id alone; a batch's read skips such a row and reads
 *    the rest.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { answerAsk, askedClaims, claimAsk, modelScoresOf } from '../../../src/ledger/model-answers';
import {
  recordTelemetrySent,
  TELEMETRY_SENT_DAY,
  telemetrySentDay,
} from '../../../src/ledger/telemetry-sent';
import { IsoTs } from '../../../src/core/schema';
import { ModelAnswer, ModelScores, Ulid } from '../../../src/ledger/types';
import { type LogRecord, setLogSink } from '../../../src/log';
import { pinClock, releaseClock, sha, ulid, uniqueDbName } from './fixtures';

const AT = '2026-10-06T14:21:00-04:00';
let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;

beforeEach(async () => {
  pinClock(AT);
  db = await openLedger(uniqueDbName('sprint5-repo-edges'));
  records = [];
  restore = setLogSink((record) => records.push(record));
});

afterEach(() => {
  restore();
  db.close();
  releaseClock();
});

describe('telemetrySentDay and recordTelemetrySent', () => {
  it('reads null before any day is sent, then the day recorded', async () => {
    expect(await telemetrySentDay(db)).toBeNull();
    await recordTelemetrySent(db, '2026-10-09');
    expect(await telemetrySentDay(db)).toBe('2026-10-09');
  });

  it('keeps one row: the same day twice is one, and a later day replaces it', async () => {
    await recordTelemetrySent(db, '2026-10-09');
    await recordTelemetrySent(db, '2026-10-09');
    expect(await db.meta.where('key').equals(TELEMETRY_SENT_DAY).count()).toBe(1);
    await recordTelemetrySent(db, '2026-10-10');
    expect(await telemetrySentDay(db)).toBe('2026-10-10');
    expect(await db.meta.where('key').equals(TELEMETRY_SENT_DAY).count()).toBe(1);
  });

  it('reads null when what is stored is not a day, so the day goes again rather than never', async () => {
    for (const value of ['yesterday', 20_261_009, '2026-10-9', null]) {
      await db.meta.put({ key: TELEMETRY_SENT_DAY, value } as never);
      expect(await telemetrySentDay(db), String(value)).toBeNull();
    }
  });

  it('refuses to record what is not a day, and the day stored stays', async () => {
    await recordTelemetrySent(db, '2026-10-09');
    for (const value of ['2026-10-10T00:00:00Z', 'today', '']) {
      await expect(recordTelemetrySent(db, value), value).rejects.toThrow();
    }
    expect(await telemetrySentDay(db)).toBe('2026-10-09');
  });
});

const ask = (n: number, hash = sha(70)) =>
  ModelAnswer.parse({ claimId: ulid(n), inputsHash: hash, provider: 'byo', askedAt: AT });
const scores = (score: number, n = 900) => ModelScores.parse([{ observationId: ulid(n), score }]);

describe('claimAsk: two runs at once', () => {
  it('asks about a claim once between two runs that reach it together', async () => {
    const outcomes = await Promise.all([claimAsk(db, ask(1)), claimAsk(db, ask(1, sha(71)))]);
    expect([...outcomes].sort()).toEqual(['ask', 'asked']);
    expect(await db.modelAnswers.count()).toBe(1);
  });

  it('five runs at once over three claims ask about each exactly once', async () => {
    const asks = [ask(1), ask(2, sha(72)), ask(1), ask(3, sha(73)), ask(2, sha(72))];
    const outcomes = await Promise.all(asks.map((one) => claimAsk(db, one)));
    expect(outcomes.filter((outcome) => outcome === 'ask')).toHaveLength(3);
    expect((await db.modelAnswers.toArray()).map(({ claimId }) => claimId).sort()).toEqual([
      ulid(1),
      ulid(2),
      ulid(3),
    ]);
  });
});

describe('answerAsk and modelScoresOf: a row that no longer parses', () => {
  const corrupt = { claimId: ulid(1), inputsHash: sha(70), provider: 'nobody', askedAt: AT };

  it('stores no answer for it and leaves it as it was, logged by table and id alone', async () => {
    await db.modelAnswers.put(corrupt as never);
    expect(await answerAsk(db, Ulid.parse(ulid(1)), scores(9_000), IsoTs.parse(AT))).toBe(false);
    expect(await db.modelAnswers.get(ulid(1))).toEqual(corrupt);
    expect(records.map(({ event, fields }) => [event, fields.table, fields.id])).toEqual([
      ['ledger.row_invalid', 'model_answers', ulid(1)],
    ]);
    expect(JSON.stringify(records)).not.toContain('nobody');
  });

  it('a batch reads the rows that parse and skips the one that does not', async () => {
    await claimAsk(db, ask(2, sha(72)));
    await answerAsk(db, Ulid.parse(ulid(2)), scores(8_000), IsoTs.parse(AT));
    await db.modelAnswers.put({ ...corrupt, scores: [{ observationId: ulid(900), score: 1.5 }] } as never);
    const read = await modelScoresOf(db, [Ulid.parse(ulid(1)), Ulid.parse(ulid(2))]);
    expect([...read]).toEqual([[ulid(2), scores(8_000)]]);
    // Still asked: a corrupt row never gets its claim asked twice.
    expect([...(await askedClaims(db, [Ulid.parse(ulid(1)), Ulid.parse(ulid(3))]))]).toEqual([ulid(1)]);
  });
});
