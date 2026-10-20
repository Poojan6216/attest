/**
 * The weekly digest's words and its share (sprint_4 4.7; src/ui/digest-labels.ts, src/ui/digest-share.ts): weeks by
 * their Monday, days not checked as weekday runs, the notice that a digest is ready; and the shared markdown: each
 * agent's counts and verified-of-checked, the receipts to look at with "likely" on UNASKED ones, a counterparty by
 * domain only, amounts and stored times kept, a subject only as its hint and escaped, so text from a page can never
 * become a link. Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import { DigestRecord } from '../../../src/ledger/types';
import { dayRuns, digestReadyText, gapLine, instantLabel, weekLabel } from '../../../src/ui/digest-labels';
import { digestMarkdown } from '../../../src/ui/digest-share';
import { escapeMarkdown } from '../../../src/ui/markdown';

const ZERO = { VERIFIED: 0, PARTIAL: 0, NOT_FOUND: 0, UNASKED: 0, OVER_SCOPE: 0, UNVERIFIABLE: 0 };

const DIGEST = DigestRecord.parse({
  week: '2026-10-05',
  from: '2026-10-05T00:00:00.000-04:00',
  to: '2026-10-12T00:00:00.000-04:00',
  createdAt: '2026-10-12T09:00:00.000-04:00',
  agents: [
    {
      agent: 'muse',
      grades: { ...ZERO, VERIFIED: 4, NOT_FOUND: 1, UNASKED: 1 },
      checking: 1,
      marked: 0,
      checked: 5,
      verified: 4,
    },
  ],
  notable: [
    {
      receiptId: '01JA0000000000000000000003',
      agent: 'muse',
      grade: 'UNASKED',
      type: 'email.sent',
      at: '2026-10-06T14:03:00-04:00',
      domain: 'supplier.example',
      subjectHint: 'Re: invoice [click](https://evil.example)',
    },
    {
      receiptId: '01JA0000000000000000000002',
      agent: 'muse',
      grade: 'NOT_FOUND',
      type: 'purchase.made',
      at: '2026-10-06T14:00:00-04:00',
      amountCents: 12_000,
      currency: 'USD',
    },
  ],
  notableCount: 3,
  gaps: [{ source: 'gcal.event', days: ['2026-10-06', '2026-10-07', '2026-10-08'] }],
  health: [
    {
      adapterId: 'gmail.sent',
      version: '1.4.0',
      status: 'OK',
      reasons: [],
      checkedAt: '2026-10-11T18:00:00-04:00',
    },
  ],
});

describe('digest labels', () => {
  it('words weeks, stored instants and runs of days without a clock', () => {
    expect(weekLabel('2026-10-05')).toBe('Week of 5 Oct 2026');
    expect(instantLabel('2026-10-06T14:03:00-04:00')).toBe('6 Oct 2026, 14:03');
    expect(dayRuns(['2026-10-06', '2026-10-07', '2026-10-08'])).toBe('Tue–Thu');
    expect(dayRuns(['2026-10-05', '2026-10-07', '2026-10-08', '2026-10-09'])).toBe('Mon, Wed–Fri');
    expect(gapLine('gcal.event', ['2026-10-06', '2026-10-07', '2026-10-08'])).toBe(
      'Calendar was not checked Tue–Thu.',
    );
    const week = ['05', '06', '07', '08', '09', '10', '11'].map((day) => `2026-10-${day}`);
    expect(gapLine('gmail.sent', week)).toBe('Gmail Sent was not checked all week.');
    expect(digestReadyText(DIGEST)).toEqual({
      title: 'Your weekly digest',
      message: 'Week of 5 Oct 2026: 3 receipts to look at. Calendar was not checked Tue–Thu.',
    });
  });
});

describe('digestMarkdown', () => {
  it('shares the week by domain only, with stored times, amounts, "likely", and escaped hints', () => {
    const text = digestMarkdown(DIGEST);
    expect(text.split('\n')).toEqual(
      expect.arrayContaining([
        '# Attest weekly digest, week of 5 Oct 2026',
        '## Muse',
        '- Verified 4 · Partial 0 · Not found 1 · Unasked 1 · Over scope 0 · Unverifiable 0',
        '- 4 of 5 checked claims verified · 1 still checking · 0 you marked',
        '- Unasked: likely Muse (Email sent, 6 Oct 2026, 14:03, supplier\\.example, “Re: invoice \\[click\\]\\(https://evil\\.example\\)”)',
        '- Not found: Muse (Purchase, 6 Oct 2026, 14:00, $120.00)',
        '- And 1 more.',
        '- Calendar was not checked Tue–Thu.',
        '- Gmail Sent reader: working, version 1.4.0',
      ]),
    );
    expect(text).not.toMatch(/@/u);
    expect(text).not.toContain('](https');
    expect(text).not.toContain('!');
  });

  it('escapes every character markdown gives a meaning', () => {
    expect(escapeMarkdown('*a* _b_ [c](d) #e <f> `g` |h| ~i~')).toBe(
      '\\*a\\* \\_b\\_ \\[c\\]\\(d\\) \\#e \\<f\\> \\`g\\` \\|h\\| \\~i\\~',
    );
  });
});

describe('the notice that a digest is ready, never an all clear (security review SEC-4)', () => {
  const clean = DigestRecord.parse({ ...DIGEST, notable: [], notableCount: 0, gaps: [], health: [] });

  it('says what a week it could not check holds: unchecked claims, unseen sources, readers to repair, marks', () => {
    const week = DigestRecord.parse({
      ...clean,
      agents: [{ ...DIGEST.agents[0], grades: { ...ZERO, UNVERIFIABLE: 12 } }],
      gaps: [
        {
          source: 'gmail.sent',
          days: [
            '2026-10-05',
            '2026-10-06',
            '2026-10-07',
            '2026-10-08',
            '2026-10-09',
            '2026-10-10',
            '2026-10-11',
          ],
        },
      ],
      health: [
        {
          adapterId: 'gmail.sent',
          version: '1.4.0',
          status: 'DEGRADED',
          reasons: ['selector.missing'],
          checkedAt: '2026-10-09T09:00:00-04:00',
        },
      ],
      marksCount: 2,
    });
    expect(digestReadyText(week).message).toBe(
      'Week of 5 Oct 2026: 12 claims could not be checked. Gmail Sent was not checked all week. ' +
        'The Gmail Sent reader needs repair. You marked 2 receipts.',
    );
    expect(digestReadyText(week).message).not.toMatch(/nothing to look at/iu);
  });

  it('says only what ended, when there is nothing else to say', () => {
    expect(digestReadyText(clean).message).toBe(
      'Week of 5 Oct 2026: No receipt ended Not found, Unasked or Over scope.',
    );
  });
});
