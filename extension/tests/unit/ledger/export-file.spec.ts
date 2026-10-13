import 'fake-indexeddb/auto';
/**
 * The export file the options page builds (sprint_4 4.5; src/ledger/export-file.ts): the bytes of the single-message
 * export (`JSON.stringify(exportLedger(db), null, 2)` and a newline, src/ledger/export.ts) at every page size, for a
 * ledger with rows in every table and replay map, a row that fails its schema, and an empty ledger; and no read
 * returns more than one page of rows (no table is read whole). Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { onClaimsImport } from '../../../src/background/claims-import';
import { ClaimsImportMessage } from '../../../src/bus/messages';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { IsoTs, Receipt } from '../../../src/core/schema';
import { queueAlerts } from '../../../src/ledger/alerts';
import { buildDigest, saveDigest } from '../../../src/ledger/digest';
import { lastWeek } from '../../../src/ledger/digest-week';
import { putCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import { recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger, LedgerExport } from '../../../src/ledger/export';
import { exportLedgerBlob } from '../../../src/ledger/export-file';
import { answerAsk, claimAsk } from '../../../src/ledger/model-answers';
import { ModelAnswer, ModelScores } from '../../../src/ledger/types';
import { LEDGER_TABLE_NAMES } from '../../../src/ledger/index-fields';
import { openLedger } from '../../../src/ledger/migrations';
import {
  putAdapterHealth,
  putCoveragePing,
  putReceipt,
  putRequest,
  upsertObservation,
} from '../../../src/ledger/repo';
import { setLogSink } from '../../../src/log';
import { CalendarSnapshot } from '../../../src/observers/gcal/snapshot';
import {
  makeHealth,
  makeObservation,
  makePing,
  makeReceipt,
  makeRequest,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';
import { recordReads } from './read-recorder';

const NOW = '2026-10-08T17:00:00-04:00';
const EXPORTED_AT = '2026-10-08T18:00:00-04:00';

let db: LedgerDb;
let restore: () => void;

beforeEach(async () => {
  pinClock(NOW);
  restore = setLogSink(() => undefined);
  db = await openLedger(uniqueDbName('export-file'));
});

afterEach(() => {
  db.close();
  restore();
  releaseClock();
});

/** A pasted log of two sends: claims, their receipts and replay records, the agent's session pings, its grant. */
async function pasted(): Promise<void> {
  const read = readPastedLog(
    [
      'Today',
      'Sent an email to sam@example.com',
      '2:02 pm',
      'Sent an email to ana@example.com',
      '4:30 pm',
    ].join('\n'),
    { agent: 'muse', pastedAt: IsoTs.parse(NOW), offsetAt: () => -240 },
  );
  if (!read.ok) throw new Error(read.refusal);
  const message = ClaimsImportMessage.parse({
    type: 'claims.import',
    agent: 'muse',
    claims: read.log.claims,
    activeAt: read.log.activeAt,
  });
  const grading = {
    policy: DEFAULT_POLICY,
    policyDocument: DEFAULT_POLICY_DOCUMENT,
    nowMs: () => Date.now(),
  };
  await onClaimsImport({ db: () => Promise.resolve(db), grading, notify: () => undefined }, message);
}

/** Rows in every table and every replay map, and one stored row that fails its schema. */
async function populate(): Promise<void> {
  for (const n of [3, 1, 2]) {
    await upsertObservation(db, makeObservation({ rowKeyHash: sha(n) }), DEFAULT_POLICY);
    await putRequest(db, makeRequest({ id: ulid(200 + n) }));
  }
  await putAdapterHealth(db, makeHealth({ adapterId: 'gmail.sent' }));
  await putCoveragePing(db, makePing());
  for (const day of ['04', '05']) {
    await recordCoverage(db, {
      observerId: 'gcal.event',
      source: 'gcal.event',
      accountHash: sha(9),
      lastSyncAt: `2026-10-${day}T09:00:00-04:00`,
      windowStart: `2026-10-${day}T00:00:00-04:00`,
      windowEnd: `2026-10-${day}T23:59:00-04:00`,
      allCalendars: true,
    });
  }
  const range = '2026-10-04/2026-10-04';
  const readAt = '2026-10-04T09:00:00-04:00';
  const snapshot = CalendarSnapshot.parse({
    ...{ format: 1, observer: 'gcal.event', version: '1.2.0', range, readAt, baselineAt: readAt },
    ...{
      days: [{ date: '2026-10-04', complete: true }],
      calendars: [{ key: sha(3), shown: true }],
      events: [],
    },
  });
  await putCalendarRecord(db, {
    observerId: 'gcal.event',
    accountHash: sha(9),
    range,
    snapshot,
    pending: [],
  });
  await putReceipt(db, makeReceipt({ id: ulid(301), signals: { timeProximity: 0.5, counterpartyExact: 1 } }));
  // A receipt that alerted (sprint_4 4.6).
  const alerted = Receipt.parse(
    makeReceipt({
      ...{ id: ulid(302), grade: 'NOT_FOUND', ruleId: 'not_found', observationIds: [], state: 'FINAL' },
      ...{ reasons: [{ code: 'match.none', params: {} }], finalAt: '2026-10-08T16:00:00-04:00' },
    }),
  );
  await putReceipt(db, alerted);
  await queueAlerts(db, [alerted]);
  // A weekly digest (sprint_4 4.7).
  await saveDigest(db, await buildDigest(db, lastWeek(Date.now()), IsoTs.parse(NOW)));
  // A claim the advisory model was asked about, and its answer (sprint_5 5.4).
  const asked = ModelAnswer.parse({ claimId: ulid(401), inputsHash: sha(7), provider: 'byo', askedAt: NOW });
  await claimAsk(db, asked);
  const scores = ModelScores.parse([{ observationId: ulid(402), score: 9_000 }]);
  await answerAsk(db, asked.claimId, scores, asked.askedAt);
  await pasted();
  // A row no reader accepts: both exports skip it, logged by id.
  await db.requests.put({ id: ulid(299), agent: 'nobody' } as never);
}

const singleMessage = async (): Promise<string> =>
  `${JSON.stringify(await exportLedger(db, { exportedAt: EXPORTED_AT }), null, 2)}\n`;

describe('exportLedgerBlob', () => {
  it('writes the bytes of the single-message export at every page size', async () => {
    await populate();
    const expected = await singleMessage();
    const parsed = LedgerExport.parse(JSON.parse(expected));
    // The page that saved the single-message export parsed it first: the same bytes.
    expect(`${JSON.stringify(parsed, null, 2)}\n`).toBe(expected);
    for (const name of LEDGER_TABLE_NAMES) expect(parsed.tables[name].length, name).toBeGreaterThan(0);
    for (const map of [parsed.receiptInputs, parsed.batchCoverages, parsed.policies]) {
      expect(Object.keys(map).length).toBeGreaterThan(0);
    }
    for (const size of [1, 2, 3, 500]) {
      const blob = await exportLedgerBlob(db, { exportedAt: EXPORTED_AT }, size);
      expect(blob.type).toBe('application/json');
      expect(await blob.text(), `page size ${String(size)}`).toBe(expected);
    }
  });

  it('writes an empty ledger as the single-message export does', async () => {
    const blob = await exportLedgerBlob(db, { exportedAt: EXPORTED_AT }, 2);
    expect(await blob.text()).toBe(await singleMessage());
  });

  it('reads no table whole: every read returns one page of rows at most', async () => {
    await populate();
    const recorder = await recordReads(db);
    await exportLedgerBlob(db, { exportedAt: EXPORTED_AT }, 2);
    expect(recorder.reads.length).toBeGreaterThan(LEDGER_TABLE_NAMES.length);
    for (const read of recorder.reads) {
      expect(read.limit, `${read.table} ${read.op}`).not.toBeNull();
      expect(read.limit ?? Infinity, `${read.table} ${read.op}`).toBeLessThanOrEqual(2);
    }
  });

  it('leaves the encryption state out of both exports, its other settings kept (SEC-4)', async () => {
    await db.meta.bulkPut([
      { key: 'crypto.sealing', value: true },
      { key: 'crypto.keyId', value: 'aaaaaaaaaaaa' },
      { key: 'crypto.salt', value: 'AAAAAAAAAAAAAAAAAAAAAA==' },
      { key: 'crypto.iterations', value: 600_000 },
      { key: 'crypto.check', value: 'invented-check-nonce.invented-check-ciphertext' },
      { key: 'retentionDays', value: 30 },
    ]);
    const expected = await singleMessage();
    const parsed = LedgerExport.parse(JSON.parse(expected));
    expect(parsed.tables.meta).toEqual([{ key: 'retentionDays', value: 30 }]);
    expect(expected).not.toContain('crypto.');
    expect(expected).not.toContain('invented-check');
    expect(await (await exportLedgerBlob(db, { exportedAt: EXPORTED_AT }, 2)).text()).toBe(expected);
  });

  it('refuses an export instant without an offset, as the single-message export does', async () => {
    await expect(exportLedgerBlob(db, { exportedAt: '2026-10-08T18:00:00' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
