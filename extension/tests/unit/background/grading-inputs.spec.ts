import 'fake-indexeddb/auto';
/**
 * What the grading batch hands grading (src/background/grading.ts `batchActivity`; tech review TECH-9; Hard Rule 6):
 * every Activity list is read over the range that can change a grade, and one that still holds more than
 * SCHEMA_LIMITS.GRADING_INPUT items is cut to the newest with a warning that says how many, never silently.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGradingBatch } from '../../../src/background/grading';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';
import { putSessions } from '../../../src/ledger/activity';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { type LogRecord, setLogSink } from '../../../src/log';
import { AT } from '../core/demo-ledger';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { storeDemo } from './demo-store';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-06T08:00:00-04:00');
  db = await openLedger(uniqueDbName('grading-inputs'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('an Activity list over GRADING_INPUT items', () => {
  it('is cut to the newest, and the warning names the list and how many it held', async () => {
    await storeDemo(db, AT.evaluated);
    // One more session ping than a batch carries, 300 ms apart, inside the hour before the demo's grading.
    const startMs = Date.parse(AT.evaluated) - 3_600_000;
    const pings = Array.from({ length: SCHEMA_LIMITS.GRADING_INPUT + 1 }, (_, i) =>
      IsoTs.parse(new Date(startMs + i * 300).toISOString()),
    );
    await putSessions(db, 'muse', pings);
    const records: LogRecord[] = [];
    const restore = setLogSink((record) => records.push(record));
    try {
      const deps = {
        policy: DEFAULT_POLICY,
        policyDocument: DEFAULT_POLICY_DOCUMENT,
        nowMs: () => Date.parse(AT.evaluated),
      };
      pinClock(AT.evaluated);
      expect(await runGradingBatch(db, deps)).toMatchObject({ skipped: false });
    } finally {
      restore();
    }
    const capped = records.filter((record) => record.event === 'grading.input_capped');
    expect(capped.map((record) => record.fields)).toEqual([
      {
        list: 'sessions',
        itemCount: SCHEMA_LIMITS.GRADING_INPUT + 1,
        keptCount: SCHEMA_LIMITS.GRADING_INPUT,
      },
    ]);
  });
});
