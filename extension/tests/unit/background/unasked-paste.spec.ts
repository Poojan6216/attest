import 'fake-indexeddb/auto';
/**
 * UNASKED on the paste path (sprint_3 3.14; docs/grading.md §7, §16.13): the §2 demo stored as the paste path stores
 * it. Muse's pasted log names 14:02, a session ping; away detection is on and Chrome reports the person away from 14:00
 * to 14:09; a second paste at 14:45 is Muse's last import. The vendor row nobody claimed is then UNASKED, likely Muse,
 * on the session and idle signals (0.4 + 0.3 ≥ 0.6), FINAL once the last import is past its grace; and replay of the
 * export reproduces all three receipts. Without the idle interval the same row is no receipt at all (one signal).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGradingBatch } from '../../../src/background/grading';
import { lastImportKey } from '../../../src/ledger/meta-keys';
import { recordIdleState } from '../../../src/background/idle';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { replay } from '../../../src/core/replay';
import { IsoTs, Receipt } from '../../../src/core/schema';
import { putSessions } from '../../../src/ledger/activity';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import { setMeta } from '../../../src/ledger/repo';
import { readSnapshot } from '../../tools/attest-snapshot';
import { AT } from '../core/demo-ledger';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { storeDemo } from './demo-store';

const DEPS = { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() };
let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-06T08:00:00-04:00');
  db = await openLedger(uniqueDbName('unasked-paste'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** A paste of Muse's log at `at`: its minutes become session pings, and `at` its last import. */
async function paste(at: string, minutes: readonly string[]): Promise<void> {
  pinClock(at);
  await putSessions(
    db,
    'muse',
    minutes.map((minute) => IsoTs.parse(minute)),
  );
  await setMeta(db, lastImportKey('muse'), at);
}

async function story(away: boolean, gradedAt: string = AT.evaluated): Promise<Receipt[]> {
  await storeDemo(db, '2026-10-06T14:01:00-04:00');
  if (away) await recordIdleState(db, 'idle', Date.parse('2026-10-06T14:01:00-04:00'));
  await storeDemo(db, AT.museRead, '2026-10-06T14:01:00-04:00');
  await paste(AT.museRead, [AT.claimed]);
  if (away) await recordIdleState(db, 'active', Date.parse(AT.idleEnd));
  await storeDemo(db, AT.museResync, AT.museRead);
  await paste(AT.museResync, [AT.claimed]);
  await storeDemo(db, AT.evaluated, AT.museResync);
  pinClock(gradedAt);
  await runGradingBatch(db, DEPS);
  return readRows('receipts', Receipt, await db.receipts.toArray());
}

describe('UNASKED on the paste path', () => {
  it('the vendor row is UNASKED, likely Muse, FINAL, beside VERIFIED and NOT_FOUND, and replay reproduces all three', async () => {
    const receipts = await story(true);
    expect(receipts.map((r) => [r.grade, r.state]).sort()).toEqual(
      [
        ['NOT_FOUND', 'FINAL'],
        ['UNASKED', 'FINAL'],
        ['VERIFIED', 'FINAL'],
      ].sort(),
    );
    const unasked = receipts.find((r) => r.grade === 'UNASKED');
    expect([unasked?.agent, unasked?.attribution, unasked?.claimId]).toEqual(['muse', 'likely', undefined]);
    const exported = await exportLedger(db, { exportedAt: '2026-10-06T16:00:00-04:00' });
    const report = await replay(readSnapshot(JSON.parse(JSON.stringify(exported))));
    expect(report).toMatchObject({ receipts: 3, reproduced: 3, mismatched: 0 });
  });

  it('graded days later, past the orphan horizon, the vendor row is still UNASKED: its signals are read where it is', async () => {
    const receipts = await story(true, '2026-10-09T09:00:00-04:00');
    expect(receipts.map((r) => r.grade).sort()).toEqual(['NOT_FOUND', 'UNASKED', 'VERIFIED']);
  });

  it('without the person’s idle time (away detection off), the session alone accuses no one', async () => {
    const receipts = await story(false);
    expect(receipts.map((r) => r.grade).sort()).toEqual(['NOT_FOUND', 'VERIFIED']);
  });
});
