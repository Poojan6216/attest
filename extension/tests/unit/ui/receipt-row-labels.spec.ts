/**
 * What a receipt row says (sprint_4 4.2; src/ui/receipt-row-labels.ts): the claim in one line, or what an UNASKED
 * receipt is about with its signal count; the status ("Checking: final from …" from the stored `finalFrom`, an
 * override and its reason, a superseded receipt, a PENDING receipt the batches no longer grade); the reason that
 * explains an UNVERIFIABLE, OVER_SCOPE or NOT_FOUND grade, in the core's words; and each UNASKED signal, saying
 * "likely". Times are on the clock of the zone the test runs in; every assertion holds in any zone.
 */
import { describe, expect, it } from 'vitest';

import { Claim, IsoTs, Observation, Receipt, type ReceiptInput } from '../../../src/ledger/types';
import type { ReceiptItem } from '../../../src/ledger/views';
import { clockTime } from '../../../src/ui/format';
import { reasonLine, receiptLine, signalLines, statusLine } from '../../../src/ui/receipt-row-labels';
import {
  claimId,
  makeClaim,
  makeObservation,
  makeReceipt,
  observationId,
  omit,
  sha,
} from '../ledger/fixtures';

/** A local noon, so the instants a few hours either side are today in every zone. */
const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const MINUTE = 60_000;
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());

function receipt(overrides: Partial<ReceiptInput> = {}): Receipt {
  return Receipt.parse(makeReceipt({ computedAt: iso(NOW - 5 * MINUTE), ...overrides }));
}

function unasked(reasons: ReceiptInput['reasons'], overrides: Partial<ReceiptInput> = {}): Receipt {
  const base = omit(makeReceipt({ grade: 'UNASKED', reasons, computedAt: iso(NOW - 5 * MINUTE) }), 'claimId');
  return Receipt.parse({ ...base, attribution: 'likely', ...overrides });
}

const item = (subject: Receipt, extra: Partial<ReceiptItem> = {}): ReceiptItem => ({
  receipt: subject,
  claim: undefined,
  orphan: undefined,
  ...extra,
});

const SIGNALS: ReceiptInput['reasons'] = [
  { code: 'unasked.session', params: { agent: 'muse' } },
  { code: 'unasked.idle', params: { agent: 'muse' } },
];

describe('receiptLine', () => {
  it('writes the claim as extracted, its type alone when it names nothing, and says when it is gone', () => {
    const claim = Claim.parse(makeClaim());
    expect(receiptLine(item(receipt(), { claim }), NOW)).toBe('Email sent: alice@example.com');
    const bare = Claim.parse(omit(omit(makeClaim(), 'counterparty'), 'subjectHint'));
    expect(receiptLine(item(receipt(), { claim: bare }), NOW)).toBe('Email sent');
    expect(receiptLine(item(receipt()), NOW)).toBe('A claim Attest no longer keeps');
  });

  it('says what an UNASKED receipt is about and how many signals it has', () => {
    const sent = makeObservation({
      occurredAt: iso(NOW - 2 * 60 * MINUTE),
      observedAt: iso(NOW - 119 * MINUTE),
    });
    const orphan = Observation.parse(sent);
    const line = receiptLine(item(unasked(SIGNALS), { orphan }), NOW);
    expect(line).toBe(
      `Sent-folder row, ${clockTime(sent.occurredAt, NOW)}, to alice@example.com, “Quarterly numbers” (2 signals)`,
    );
    expect(receiptLine(item(unasked(SIGNALS.slice(0, 1))), NOW)).toBe(
      'An action Attest no longer keeps (1 signal)',
    );
  });
});

describe('statusLine', () => {
  it('says from when a PENDING receipt can be final, and that it waits once that has passed', () => {
    const at = (ms: number) => receipt({ finalFrom: iso(ms) });
    expect(statusLine(at(NOW + 30 * MINUTE), NOW, NOW - 5 * MINUTE)).toBe(
      `Checking: final from ${clockTime(iso(NOW + 30 * MINUTE), NOW)}`,
    );
    expect(statusLine(at(NOW - MINUTE), NOW, NOW - 5 * MINUTE)).toBe(
      `Checking: waiting for a check after ${clockTime(iso(NOW - MINUTE), NOW)}`,
    );
    expect(statusLine(receipt(), NOW, NOW - 5 * MINUTE)).toBe('Checking');
  });

  it('says a PENDING receipt graded before the last batch is no longer checked, never "checking" forever', () => {
    const stale = receipt({ finalFrom: iso(NOW + 30 * MINUTE) });
    expect(statusLine(stale, NOW, NOW - MINUTE)).toBe(
      `No longer checked since ${clockTime(stale.computedAt, NOW)}`,
    );
    expect(statusLine(stale, NOW, null)).toMatch(/^Checking: final from /u);
  });

  it('gives an override with its reason, a superseded receipt in words, and nothing for a FINAL one', () => {
    const final = receipt({ state: 'FINAL', finalAt: iso(NOW - 5 * MINUTE) });
    expect(statusLine(final, NOW, null)).toBeNull();
    const overridden = Receipt.parse({
      ...makeReceipt({ computedAt: iso(NOW - 5 * MINUTE) }),
      state: 'USER_OVERRIDDEN',
      override: {
        grade: 'NOT_FOUND',
        reason: 'I sent it myself',
        at: iso(NOW - MINUTE),
        previousState: 'PENDING',
      },
      reasons: [...makeReceipt().reasons, { code: 'override.user', params: { grade: 'NOT_FOUND' } }],
    });
    expect(statusLine(overridden, NOW, null)).toBe('You marked it Not found: “I sent it myself”');
    const superseded = unasked([...SIGNALS, { code: 'superseded', params: { claimId: claimId(7) } }], {
      supersededBy: claimId(7),
    });
    expect(statusLine(superseded, NOW, null)).toBe(
      `A later claim (${claimId(7)}) explains this action, so it no longer counts as unasked.`,
    );
  });
});

describe('reasonLine and signalLines', () => {
  it('explains UNVERIFIABLE by its coverage, OVER_SCOPE by its scope, NOT_FOUND by no match, and nothing else', () => {
    const none = receipt({
      grade: 'UNVERIFIABLE',
      observationIds: [],
      reasons: [
        { code: 'coverage.none', params: { source: 'gcal.event' } },
        { code: 'match.none', params: {} },
      ],
    });
    expect(reasonLine(none)).toBe("Attest did not see Google Calendar during this claim's time window.");
    const scope = receipt({
      grade: 'OVER_SCOPE',
      reasons: [{ code: 'scope.type_not_allowed', params: { type: 'email.sent' } }],
    });
    expect(reasonLine(scope)).toBe(
      'This claim is for sending email (email.sent), which you did not allow this agent.',
    );
    const missing = receipt({
      grade: 'NOT_FOUND',
      observationIds: [],
      reasons: [{ code: 'match.none', params: {} }],
    });
    expect(reasonLine(missing)).toBe(
      "Attest found no evidence in this claim's time window to compare it with.",
    );
    expect(reasonLine(receipt())).toBeNull();
  });

  it("lists an UNASKED receipt's signals, each saying likely", () => {
    const lines = signalLines(unasked(SIGNALS, { observationIds: [observationId(1)], inputsHash: sha(9) }));
    expect(lines).toEqual([
      'This was likely Muse: a Muse session was active within minutes of it.',
      'This was likely Muse: Attest saw no input from you in the minutes before it.',
    ]);
    expect(signalLines(receipt())).toEqual([]);
  });
});
