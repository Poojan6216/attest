import 'fake-indexeddb/auto';
/**
 * The person's choices about what Attest may read or open (src/ledger/consent.ts; sprint_4 close, security review
 * SEC-3): every reader on and every flag off until set; each kept in ledger meta, where no script on a vendor page can
 * write it; a stored value that cannot be read reads as that reader off or that flag off, logged by key; and a flag no
 * page may set reads as its default whatever is stored, so a stored `ATTEST_TELEMETRY: true` never turns telemetry on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FEATURE_FLAG_DEFAULTS, READERS, SETTABLE_FLAGS } from '../../../src/config';
import {
  FLAG_PREFIX,
  flagKey,
  READER_OFF_PREFIX,
  readerOffKey,
  readersOff,
  readFlags,
  saveFlag,
  saveReaderOff,
} from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { META_KEYS } from '../../../src/ledger/meta-keys';
import { openLedger } from '../../../src/ledger/migrations';
import { captureLogs, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('consent'));
});

afterEach(() => {
  db.close();
});

describe('the readers that are off', () => {
  it('are none until turned off, and follow each choice', async () => {
    expect(await readersOff(db)).toEqual(new Set());
    await saveReaderOff(db, 'gcal', true);
    expect(await readersOff(db)).toEqual(new Set(['gcal']));
    await saveReaderOff(db, 'gcal', false);
    expect(await readersOff(db)).toEqual(new Set());
    expect(await db.meta.get(readerOffKey('gcal'))).toBeUndefined();
  });

  it.each([['yes'], [1], [null]])(
    'read a stored %j as that reader off, logged by key only',
    async (value) => {
      await db.meta.put({ key: readerOffKey('gmail'), value } as never);
      const logs = captureLogs();
      try {
        expect(await readersOff(db)).toEqual(new Set(['gmail']));
      } finally {
        logs.restore();
      }
      expect(logs.records.map(({ event }) => event)).toEqual(['ledger.row_invalid']);
      expect(JSON.stringify(logs.records)).not.toContain('yes');
    },
  );
});

describe('the flags', () => {
  it('are every one at its default (off) until set, and follow each choice', async () => {
    expect(await readFlags(db)).toEqual(FEATURE_FLAG_DEFAULTS);
    expect(Object.values(FEATURE_FLAG_DEFAULTS).every((on) => !on)).toBe(true);
    await saveFlag(db, 'ATTEST_AUTO_CHECK_GMAIL', true);
    expect((await readFlags(db)).ATTEST_AUTO_CHECK_GMAIL).toBe(true);
    await saveFlag(db, 'ATTEST_AUTO_CHECK_GMAIL', false);
    expect((await readFlags(db)).ATTEST_AUTO_CHECK_GMAIL).toBe(false);
  });

  it('read a flag no page may set as its default, whatever is stored (SEC-3: no telemetry by a stray write)', async () => {
    for (const flag of ['ATTEST_TELEMETRY', 'ATTEST_DOTS']) {
      await db.meta.put({ key: `${FLAG_PREFIX}${flag}`, value: true });
    }
    expect(await readFlags(db)).toEqual(FEATURE_FLAG_DEFAULTS);
  });

  it('read a stored value that is not true or false as off', async () => {
    await db.meta.put({ key: flagKey('ATTEST_AUTO_CHECK_GMAIL'), value: 'true' });
    const logs = captureLogs();
    try {
      expect((await readFlags(db)).ATTEST_AUTO_CHECK_GMAIL).toBe(false);
    } finally {
      logs.restore();
    }
  });
});

describe('the keys', () => {
  it('are one per reader and per settable flag, each in the documented list of meta keys', () => {
    expect(READERS.map(readerOffKey)).toEqual(['readerOff.gmail', 'readerOff.gcal']);
    expect(SETTABLE_FLAGS.map(flagKey)).toEqual([
      'flag.ATTEST_AUTO_CHECK_GMAIL',
      'flag.ATTEST_MODEL',
      'flag.ATTEST_MODEL_BYO',
    ]);
    expect(META_KEYS).toEqual(expect.arrayContaining([READER_OFF_PREFIX, FLAG_PREFIX]));
  });
});
