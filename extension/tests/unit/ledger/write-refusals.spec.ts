import 'fake-indexeddb/auto';
/**
 * The writers Sprint 4 added refuse a row their schema refuses with `LedgerError('invalid_input')`, naming the table
 * and the paths at fault and never a value, and write nothing (sprint_4 close, tech review TECH-11: never a raw
 * ZodError). The clock repair's grant re-stamp parses too, but only ever from parsed rows: no input reaches it whole
 * that could fail. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queueAlerts, takeAlerts } from '../../../src/ledger/alerts';
import { recordAutoCheck } from '../../../src/ledger/auto-check-record';
import { noteHeldPending } from '../../../src/ledger/batch-instant';
import { saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { buildDigest, saveDigest } from '../../../src/ledger/digest';
import { lastWeek } from '../../../src/ledger/digest-week';
import { LedgerError } from '../../../src/ledger/errors';
import { openLedger } from '../../../src/ledger/migrations';
import { saveRetentionDays } from '../../../src/ledger/settings';
import { AgentId, IsoTs, Receipt } from '../../../src/ledger/types';
import { makeReceipt, ulid, uniqueDbName } from './fixtures';

const AT = IsoTs.parse('2026-10-01T11:00:00-04:00');
const NOT_AN_INSTANT = 'not an instant' as IsoTs;
/** The writers as a caller that skipped the types would call them (each signature widened, never a value cast). */
const saveAnyDays = saveRetentionDays as (db: LedgerDb, days: number) => Promise<void>;
const saveAnyFlag = saveFlag as (db: LedgerDb, flag: 'ATTEST_AUTO_CHECK_GMAIL', on: unknown) => Promise<void>;
let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('write-refusals'));
});

afterEach(() => {
  db.close();
});

/** Resolves the LedgerError `write` rejects with; fails when it resolves or rejects with anything else. */
async function refusal(write: Promise<unknown>): Promise<LedgerError> {
  const error: unknown = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(LedgerError);
  return error as LedgerError;
}

const notFound = (agent: string): Receipt =>
  ({
    ...Receipt.parse(
      makeReceipt({
        id: ulid(1),
        grade: 'NOT_FOUND',
        ruleId: 'not_found',
        reasons: [{ code: 'match.none', params: {} }],
        observationIds: [],
        state: 'FINAL',
        computedAt: AT,
        finalAt: AT,
      }),
    ),
    agent,
  }) as Receipt;

describe('a settings writer refuses what its reader would refuse, and writes nothing', () => {
  it('saveRetentionDays: a window that is not one of the choices', async () => {
    const error = await refusal(saveAnyDays(db, 45));
    expect(error.code).toBe('invalid_input');
    expect(error.context).toEqual({ table: 'meta', paths: 'value' });
    expect(await db.meta.toArray()).toEqual([]);
  });

  it('recordAutoCheck: an open at no instant writes none of its four keys', async () => {
    const record = { at: NOT_AN_INSTANT, until: AT, claims: 1, agents: [AgentId.parse('muse')] };
    const error = await refusal(recordAutoCheck(db, record));
    expect([error.code, error.context.table, error.context.paths]).toEqual([
      'invalid_input',
      'meta',
      'value',
    ]);
    expect(await db.meta.toArray()).toEqual([]);
  });

  it('saveFlag and noteHeldPending: a flag that is not on or off, a count below zero', async () => {
    const flag = await refusal(saveAnyFlag(db, 'ATTEST_AUTO_CHECK_GMAIL', 'yes'));
    const held = await refusal(noteHeldPending(db, -1));
    expect([flag.code, held.code]).toEqual(['invalid_input', 'invalid_input']);
    expect(await db.meta.toArray()).toEqual([]);
  });
});

describe('an alert writer refuses, and writes nothing', () => {
  it('queueAlerts: a receipt of an agent Attest does not know', async () => {
    const error = await refusal(queueAlerts(db, [notFound('nobody')]));
    expect([error.code, error.context.table, error.context.paths]).toEqual([
      'invalid_input',
      'alerts',
      'agent',
    ]);
    expect(await db.alerts.toArray()).toEqual([]);
  });

  it('takeAlerts: settled at no instant, the alert stays pending', async () => {
    expect(await queueAlerts(db, [notFound('muse')])).toBe(1);
    const error = await refusal(takeAlerts(db, NOT_AN_INSTANT));
    expect([error.code, error.context.table, error.context.paths]).toEqual([
      'invalid_input',
      'alerts',
      'handledAt',
    ]);
    expect((await db.alerts.toArray()).map(({ state }) => state)).toEqual(['pending']);
  });
});

describe('a digest writer refuses, and writes nothing', () => {
  it('buildDigest: made at no instant', async () => {
    const error = await refusal(buildDigest(db, lastWeek(Date.parse(AT)), NOT_AN_INSTANT));
    expect([error.code, error.context.table, error.context.paths]).toEqual([
      'invalid_input',
      'digests',
      'createdAt',
    ]);
  });

  it('saveDigest: a digest of no week', async () => {
    const digest = await buildDigest(db, lastWeek(Date.parse(AT)), AT);
    const error = await refusal(saveDigest(db, { ...digest, week: 'last week' }));
    expect([error.code, error.context.table, error.context.paths]).toEqual([
      'invalid_input',
      'digests',
      'week',
    ]);
    expect(await db.digests.toArray()).toEqual([]);
  });
});
