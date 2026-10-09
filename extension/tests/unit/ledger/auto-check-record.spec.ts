import 'fake-indexeddb/auto';
/**
 * The Gmail auto-check's record (sprint_4 4.9; src/ledger/auto-check-record.ts): its four meta keys are written
 * together and read back whole; a record missing a key, or holding a value its schema refuses, reads as none (each bad
 * row logged by key, never by value); a record its reader would refuse is never written. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AUTO_CHECK_AGENTS,
  AUTO_CHECK_AT,
  AUTO_CHECK_CLAIMS,
  AUTO_CHECK_UNTIL,
  type AutoCheckRecord,
  readAutoCheck,
  recordAutoCheck,
} from '../../../src/ledger/auto-check-record';
import type { LedgerDb } from '../../../src/ledger/db';
import { META_KEYS } from '../../../src/ledger/meta-keys';
import { openLedger } from '../../../src/ledger/migrations';
import { IsoTs } from '../../../src/ledger/types';
import { captureLogs, pinClock, releaseClock, uniqueDbName } from './fixtures';

const RECORD: AutoCheckRecord = {
  at: IsoTs.parse('2026-10-09T17:15:00.000-04:00'),
  until: IsoTs.parse('2026-10-09T17:45:00.000-04:00'),
  claims: 2,
  agents: ['muse', 'claude'],
};

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('auto-check-record'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('the auto-check record', () => {
  it('is none until written, then reads back whole', async () => {
    expect(await readAutoCheck(db)).toBeNull();
    await recordAutoCheck(db, RECORD);
    expect(await readAutoCheck(db)).toEqual(RECORD);
    expect((await db.meta.get(AUTO_CHECK_AGENTS))?.value).toBe('muse,claude');
  });

  it('keeps only the latest open', async () => {
    await recordAutoCheck(db, RECORD);
    await recordAutoCheck(db, {
      at: IsoTs.parse('2026-10-09T18:00:00.000-04:00'),
      until: IsoTs.parse('2026-10-09T18:30:00.000-04:00'),
      claims: 1,
      agents: ['muse'],
    });
    expect(await readAutoCheck(db)).toMatchObject({ claims: 1, agents: ['muse'] });
  });

  it.each([
    ['a key is missing', AUTO_CHECK_CLAIMS, undefined],
    ['an instant has no offset', AUTO_CHECK_AT, '2026-10-09T17:15:00'],
    ['the count is not positive', AUTO_CHECK_CLAIMS, 0],
    ['an agent is not one of ours', AUTO_CHECK_AGENTS, 'muse,someone'],
    ['the agents are text of another shape', AUTO_CHECK_AGENTS, 'muse, claude'],
    ['the window end is a number', AUTO_CHECK_UNTIL, 1],
  ])('reads as none when %s, and logs the key only', async (_label, key, value) => {
    await recordAutoCheck(db, RECORD);
    if (value === undefined) await db.meta.delete(key);
    else await db.meta.put({ key, value });
    const logs = captureLogs();
    try {
      expect(await readAutoCheck(db)).toBeNull();
    } finally {
      logs.restore();
    }
    expect(logs.records.map(({ event }) => event)).toEqual(value === undefined ? [] : ['ledger.row_invalid']);
    expect(JSON.stringify(logs.records)).not.toContain('someone');
  });

  it('never writes a record its reader would refuse', async () => {
    await expect(recordAutoCheck(db, { ...RECORD, claims: 0 })).rejects.toThrow();
    await expect(recordAutoCheck(db, { ...RECORD, agents: [] })).rejects.toThrow();
    expect(await db.meta.count()).toBe(0);
  });

  it('is in the documented list of meta keys', () => {
    expect(META_KEYS).toEqual(
      expect.arrayContaining([AUTO_CHECK_AT, AUTO_CHECK_UNTIL, AUTO_CHECK_CLAIMS, AUTO_CHECK_AGENTS]),
    );
  });
});
