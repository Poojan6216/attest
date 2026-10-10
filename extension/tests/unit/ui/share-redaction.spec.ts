/**
 * What a share and the surfaces show of a claim (sprint_4 close: security review SEC-1, QA review GAPs 1 and 4; QA's red
 * tests, kept here green). A name written with a dot ("J.Smith") is never shared as a domain; an address inside a
 * subject hint is shared as its domain; and an amount read behind a bare "$" (hundredths, no currency) is shown in the
 * detail, the row and both shares, said to have no currency. Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { Claim, IsoTs, Receipt } from '../../../src/core/schema';
import { DigestRecord } from '../../../src/ledger/types';
import { claimFields } from '../../../src/ui/detail-labels';
import { digestMarkdown } from '../../../src/ui/digest-share';
import { claimWhat } from '../../../src/ui/paste-labels';
import { receiptMarkdown } from '../../../src/ui/receipt-share';
import { makeClaim, makeReceipt, ulid } from '../ledger/fixtures';

const NOW = Date.parse('2026-10-08T17:00:00-04:00');
const unescaped = (text: string): string => text.replace(/\\(.)/gu, '$1');

/** The claims of a pasted log in `agent`'s shape, pasted at 17:00 on 8 October in New York. */
function read(agent: 'chatgpt' | 'muse', ...rows: string[]): Claim[] {
  const result = readPastedLog(rows.join('\n'), {
    agent,
    pastedAt: IsoTs.parse('2026-10-08T17:00:00-04:00'),
    offsetAt: () => -240,
  });
  if (!result.ok) throw new Error(result.refusal);
  return [...result.log.claims];
}

/** A stored week with one notable receipt of ChatGPT's, NOT_FOUND, holding `notable`. */
const week = (notable: Record<string, unknown>): DigestRecord =>
  DigestRecord.parse({
    week: '2026-10-05',
    from: '2026-10-05T00:00:00.000-04:00',
    to: '2026-10-12T00:00:00.000-04:00',
    createdAt: '2026-10-12T09:00:00.000-04:00',
    agents: [],
    notable: [{ receiptId: ulid(3), agent: 'chatgpt', grade: 'NOT_FOUND', ...notable }],
    notableCount: 1,
    gaps: [],
    health: [],
  });

const noEvidence = (claim: Claim | undefined): Receipt =>
  Receipt.parse(
    makeReceipt({
      ...(claim === undefined ? {} : { claimId: claim.id, agent: claim.agent }),
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      reasons: [{ code: 'match.none', params: {} }],
      observationIds: [],
    }),
  );

describe('a name written with a dot', () => {
  it('is kept as the claim’s counterparty, and never shared, as a domain or at all', () => {
    const [claim] = read('muse', 'Today', '4:33 pm · Texted J.Smith that the deck is ready');
    expect(claim?.counterparty).toBe('J.Smith');
    const shared = unescaped(receiptMarkdown({ receipt: noEvidence(claim), claim, observations: [] }));
    expect(shared.toLowerCase()).not.toContain('j.smith');
  });
});

describe('an address inside a subject hint', () => {
  it('is shared as its domain, in a receipt’s share and in a week’s', () => {
    const claim = Claim.parse(makeClaim({ subjectHint: 'Lunch with priya@company.example' }));
    const receipt = Receipt.parse(makeReceipt({ observationIds: [] }));
    const shared = unescaped(receiptMarkdown({ receipt, claim, observations: [] }));
    expect(shared).not.toMatch(/@/u);
    expect(shared).toContain('“Lunch with company.example”');
    const digest = unescaped(digestMarkdown(week({ subjectHint: 'Lunch with priya@company.example' })));
    expect(digest).not.toMatch(/@/u);
    expect(digest).toContain('“Lunch with company.example”');
  });
});

describe('an amount read behind a bare $', () => {
  const [claim] = read(
    'chatgpt',
    'Today',
    '3:40 pm · Completed checkout for a pair of running shoes at $89.99.',
  );

  it('is read as hundredths with no currency (Hard Rule 5)', () => {
    expect([claim?.amountCents, claim?.currency]).toEqual([8999, undefined]);
  });

  it('is shown in the detail, the row and both shares, said to have no currency', () => {
    if (claim === undefined) throw new Error('no claim');
    expect(claimFields(claim, NOW)).toContainEqual(['Amount', '89.99 (currency not stated)']);
    expect(claimWhat(claim)).toContain('89.99 (currency not stated)');
    expect(unescaped(receiptMarkdown({ receipt: noEvidence(claim), claim, observations: [] }))).toContain(
      '89.99 (currency not stated)',
    );
    const digest = week({ type: 'purchase.made', at: '2026-10-08T15:40:00-04:00', amountCents: 8999 });
    expect(unescaped(digestMarkdown(digest))).toContain('89.99 (currency not stated)');
  });
});
