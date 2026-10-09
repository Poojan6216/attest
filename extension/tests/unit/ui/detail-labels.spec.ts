/**
 * What a receipt's detail says (sprint_4 4.3; src/ui/detail-labels.ts): the claim as extracted with every field it
 * has; how it was graded (grade, rule, confidence, score, each signal by name, its instants); every reason in the core's
 * words; each coverage entry the grading read, in one line; and the grant and context it used. Times are on the clock
 * of the zone the test runs in; every assertion holds in any zone.
 */
import { describe, expect, it } from 'vitest';

import { Claim, Coverage, Grant, IsoTs, Receipt, Sha256 } from '../../../src/ledger/types';
import { clockTime } from '../../../src/ui/format';
import {
  claimFields,
  coverageEntryLine,
  gradingFields,
  inputFields,
  reasonLines,
} from '../../../src/ui/detail-labels';
import { makeClaim, makeGrant, makeReceipt, sha } from '../ledger/fixtures';

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());
const at = (hours: number, minutes = 0) => iso(new Date(2026, 9, 1, hours, minutes).getTime());

describe('claimFields', () => {
  it('lists every field the claim has, the precision of its time and who read it', () => {
    const claim = Claim.parse(makeClaim({ claimedAt: at(10, 14), observedAt: at(10, 30) }));
    expect(claimFields(claim, NOW)).toEqual([
      ['What', 'Email sent'],
      ['To', 'alice@example.com'],
      ['Subject', 'Quarterly numbers'],
      ['When it says', '10:14, to the minute'],
      ['Read from', 'Activity log (Muse)'],
      ['Read at', '10:30'],
      ['Read by', 'muse.activity 1.0.0, confidence 0.9'],
    ]);
    const purchase = Claim.parse(
      makeClaim({
        type: 'purchase.made',
        counterparty: 'Blue Bottle',
        amountCents: 1250,
        currency: 'USD',
        claimedAt: at(9),
        observedAt: at(9, 5),
      }),
    );
    expect(claimFields(purchase, NOW)).toContainEqual(['Amount', '$12.50']);
    expect(claimFields(purchase, NOW)).toContainEqual(['With', 'Blue Bottle']);
  });
});

describe('gradingFields and reasonLines', () => {
  it('names the grade, rule, confidence, score, each signal and its instants, and every reason in words', () => {
    const receipt = Receipt.parse(
      makeReceipt({
        computedAt: at(10, 31),
        finalFrom: at(11, 4),
        signals: { score: 0.92, timeProximity: 0.9, counterpartyExact: 1 },
      }),
    );
    expect(gradingFields(receipt, NOW)).toEqual([
      ['Grade', 'Verified'],
      ['Rule', 'verified'],
      ['Confidence', '0.92'],
      ['Score', '0.92'],
      ['Signal: Time', '0.9'],
      ['Signal: Recipient, exact', '1'],
      ['Graded at', '10:31'],
      ['Final from', '11:04'],
    ]);
    expect(reasonLines(receipt)).toEqual([
      `The closest evidence Attest found is observation ${receipt.observationIds[0] ?? ''}.`,
    ]);
  });
});

describe('coverageEntryLine and inputFields', () => {
  it('writes each entry one line, and the grant and context the grading used', () => {
    const coverage = Coverage.parse({
      evaluatedAt: at(10, 31),
      observers: [
        {
          observerId: 'gmail.sent',
          source: 'gmail.sent',
          lastSyncAt: at(10, 30),
          windowStart: at(9),
          windowEnd: at(10, 30),
          accountHash: sha(900),
        },
        {
          observerId: 'gcal.event',
          source: 'gcal.event',
          lastSyncAt: at(10),
          windowStart: at(11),
          windowEnd: at(11),
          allCalendars: true,
          changesSince: at(9),
        },
      ],
    });
    const [sent, marker] = coverage.observers;
    if (sent === undefined || marker === undefined) throw new Error('no entries');
    expect(coverageEntryLine(sent, NOW)).toBe(
      `Gmail Sent: 09:00 to 10:30, last checked 10:30, account ${sha(900).slice(0, 8)}`,
    );
    expect(coverageEntryLine(marker, NOW)).toBe(
      'Calendar: at 11:00, last checked 10:00, every calendar shown, changes followed since 09:00',
    );
    const grant = Grant.parse(makeGrant({ spendCeilingCents: 5000, spendCurrency: 'USD', updatedAt: at(8) }));
    const fields = inputFields(
      { coverage, grant, context: { priorSpendCents: 1200 }, policyHash: Sha256.parse(sha(1)) },
      NOW,
    );
    expect(fields).toEqual([
      ['May do', 'Email sent, Event created'],
      ['May write to', 'example.com'],
      ['Spend ceiling', '$50.00'],
      ['Declared access', 'gmail.send'],
      ['Accounts', 'Not set'],
      ['Grant from', clockTime(at(8), NOW)],
      ['Spent before, in the window', '1200'],
      ['Coverage read at', '10:31'],
    ]);
  });
});
