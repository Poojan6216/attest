import 'fake-indexeddb/auto';
/**
 * The §2 demo's own log, pasted (sprint_3 3.15; docs/claims-import.md; docs/grading.md §16.13): Muse's activity view
 * as a person copies it, read by the paste parser at 14:05. Its calendar claim gets its event's start, Thursday 14:00,
 * from its own words, and through the ledger, with the demo's Gmail and Calendar passes, the email claim is VERIFIED and
 * the calendar claim NOT_FOUND once grace has passed. The names and addresses are the demo's (invented).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { runGradingBatch } from '../../../src/background/grading';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { IsoTs, Receipt } from '../../../src/core/schema';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { AT } from '../core/demo-ledger';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { storeDemo } from './demo-store';

/** Muse's activity view on 6 October, as the person copies it at 14:05. */
const MUSE_LOG = [
  'Today',
  'Email Priya the Q3 deck',
  'Sent email to Priya with Q3 deck',
  '2:02 pm',
  'Put a review on the calendar',
  'Created calendar event "Q3 review" Thu 2pm',
  '2:02 pm',
].join('\n');

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-06T08:00:00-04:00');
  db = await openLedger(uniqueDbName('demo-paste'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

function pasted() {
  const read = readPastedLog(MUSE_LOG, {
    agent: 'muse',
    pastedAt: IsoTs.parse(AT.museRead),
    offsetAt: () => -240,
  });
  if (!read.ok) throw new Error(read.refusal);
  return read.log;
}

describe('the §2 demo’s log, pasted', () => {
  it('reads both claims, the calendar one with its event’s start, Thursday 14:00', () => {
    const { claims, activeAt } = pasted();
    // The title "Put a review on the calendar" reads as a claim too ("put" is past and present alike): one claim per
    // type in an entry, so the summary, which names the event and its start, is the one kept. The email's subject
    // ("with Q3 deck") is not a pattern's capture, so it matches on name and time alone.
    expect(
      claims.map((c) => [c.type, c.counterparty ?? null, c.subjectHint ?? null, c.targetAt ?? null]),
    ).toEqual([
      ['email.sent', 'Priya', null, null],
      ['calendar.created', null, 'Q3 review', '2026-10-08T14:00:00-04:00'],
    ]);
    expect(activeAt).toEqual([AT.claimed]);
  });

  it('grades VERIFIED and NOT_FOUND through the ledger, once grace has passed', async () => {
    const { claims } = pasted();
    await storeDemo(db, AT.evaluated, '', claims);
    pinClock(AT.evaluated);
    await runGradingBatch(db, {
      policy: DEFAULT_POLICY,
      policyDocument: DEFAULT_POLICY_DOCUMENT,
      nowMs: () => Date.now(),
    });
    const receipts = readRows('receipts', Receipt, await db.receipts.toArray());
    const byType = new Map(receipts.map((r) => [claims.find((c) => c.id === r.claimId)?.type, r]));
    expect([byType.get('email.sent')?.grade, byType.get('email.sent')?.state]).toEqual(['VERIFIED', 'FINAL']);
    expect([byType.get('calendar.created')?.grade, byType.get('calendar.created')?.state]).toEqual([
      'NOT_FOUND',
      'FINAL',
    ]);
  });
});
