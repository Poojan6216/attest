/**
 * src/ui/paste-labels.ts (sprint_3 3.12): the words the Add agent activity preview uses. A claim's time is written
 * from its own wall clock, whatever zone the test runs in; amounts follow each currency's minor units; every skipped
 * outcome has its reason. Every value here is invented.
 */
import { describe, expect, it } from 'vitest';

import { type Claim, IsoTs } from '../../../src/core/schema';
import {
  AGENT_NAMES,
  AGENT_ORDER,
  claimTypeLabel,
  claimWhat,
  claimWhen,
  count,
  excerpt,
  skippedReason,
} from '../../../src/ui/paste-labels';

/** Only the fields the labels read; the rest of a claim does not matter here. */
const claim = (fields: Partial<Claim>): Claim =>
  ({
    type: 'email.sent',
    claimedAt: IsoTs.parse('2026-10-08T16:33:00-04:00'),
    claimedAtPrecision: 'minute',
    ...fields,
  }) as Claim;

describe('paste preview labels', () => {
  it('names every agent, in the picker’s order', () => {
    expect(AGENT_ORDER.map((agent) => AGENT_NAMES[agent])).toEqual(['Muse', 'ChatGPT', 'Dots', 'Claude']);
  });

  it('labels every action type, and counts in the singular and the plural', () => {
    expect(claimTypeLabel('email.sent')).toBe('Email sent');
    expect(claimTypeLabel('calendar.deleted')).toBe('Event cancelled');
    expect(claimTypeLabel('other')).toBe('Other: a proposal or an unclear report');
    expect([count(1, 'claim', 'claims'), count(2, 'claim', 'claims'), count(0, 'claim', 'claims')]).toEqual([
      '1 claim',
      '2 claims',
      '0 claims',
    ]);
  });

  it('names who or what a claim names, with its amount in its currency’s own units', () => {
    expect(claimWhat(claim({ counterparty: 'dana@example.com' }))).toBe('dana@example.com');
    expect(claimWhat(claim({ subjectHint: 'Team lunch' }))).toBe('Team lunch');
    expect(claimWhat(claim({ amountCents: 2450, currency: 'EUR' }))).toBe('€24.50');
    expect(claimWhat(claim({ amountCents: 1200, currency: 'JPY' }))).toBe('¥1,200');
    expect(claimWhat(claim({ counterparty: 'shop@example.com', amountCents: 3499, currency: 'USD' }))).toBe(
      'shop@example.com, $34.99',
    );
    expect(claimWhat(claim({}))).toBeNull();
  });

  it('writes a claim’s time from its own wall clock, and says when only the day or the hour is known', () => {
    expect(claimWhen(claim({}))).toBe('Thu 8 Oct, 4:33 pm');
    expect(claimWhen(claim({ claimedAt: IsoTs.parse('2026-10-05T00:05:00+05:30') }))).toBe(
      'Mon 5 Oct, 12:05 am',
    );
    expect(claimWhen(claim({ claimedAt: IsoTs.parse('2026-10-07T12:00:00-04:00') }))).toBe(
      'Wed 7 Oct, 12:00 pm',
    );
    expect(
      claimWhen(claim({ claimedAt: IsoTs.parse('2026-10-07T00:00:00-04:00'), claimedAtPrecision: 'day' })),
    ).toBe('Wed 7 Oct, time not shown');
    expect(
      claimWhen(claim({ claimedAt: IsoTs.parse('2026-10-08T15:00:00-04:00'), claimedAtPrecision: 'hour' })),
    ).toBe('Thu 8 Oct, the hour from 3:00 pm');
  });

  it('says why each kind of entry is not imported', () => {
    expect(skippedReason('no_day')).toContain('no day');
    expect(skippedReason('no_time')).toContain('no time');
    expect(skippedReason('no_claim')).toBe('Nothing Attest checks.');
    expect(skippedReason('invalid')).toContain('could not read');
  });

  it('shows an entry’s lines on one line, cut with an ellipsis', () => {
    expect(excerpt('Look up flights\n  Searched for flights  \n\n')).toBe(
      'Look up flights · Searched for flights',
    );
    expect(excerpt('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('excerpt and surrogate pairs', () => {
  it('cuts between characters, never inside a surrogate pair (QA review GAP 8)', () => {
    const cut = excerpt(`${'x'.repeat(118)}\u{1F600} and more`);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
    expect(cut).toBe(`${'x'.repeat(118)}\u{1F600}…`);
  });
});
