/**
 * A receipt shared (sprint_4 4.8; src/ui/receipt-share.ts, src/ui/share-png.ts), held to the done-when "output for every
 * golden scenario passes the redaction assertions": every receipt of every golden scenario (tests/golden), as its
 * markdown, holds no `@`; a counterparty only as its domain, judged by a fixed rule (an address's domain, a merchant
 * written as a domain; security review SEC-1), and a name not at all; every amount and every time it has, as written; a
 * subject only as its hint, every word of it but an address; "Likely agent" on an UNASKED receipt; and never what a
 * request asked or why a mark was made. The image draws exactly those lines, escapes removed. Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import type { Claim, Observation, Receipt } from '../../../src/core/schema';
import { dateLabel, instantLabel } from '../../../src/ui/digest-labels';
import { formatMoney } from '../../../src/ui/format';
import { receiptMarkdown, type ShareInput } from '../../../src/ui/receipt-share';
import { shareLines } from '../../../src/ui/share-png';
import { loadScenario, scenarioFiles } from '../../golden/load';
import { runScenario } from '../../golden/runner';

const unescaped = (text: string): string => text.replace(/\\(.)/gu, '$1');

/**
 * The domain a share may show of `party`, by a fixed rule, never the code under test (security review SEC-1): the text
 * after the last `@` of an address, lower case; a merchant written as a domain, lower case; nothing else.
 */
function expectedDomain(party: string, merchant: boolean): string | undefined {
  const domainShape = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u;
  const at = party.lastIndexOf('@');
  const host = (at > 0 ? party.slice(at + 1) : merchant ? party : '').trim().toLowerCase();
  return domainShape.test(host) ? host : undefined;
}

/** The redaction assertions on one receipt's share: each failed one as a sentence. */
function redactionProblems({ receipt, claim, observations }: ShareInput, text: string): string[] {
  const plain = unescaped(text);
  const problems: string[] = [];
  if (plain.includes('@')) problems.push('holds an @');
  const hints = [claim?.subjectHint, ...observations.map((o) => o.subjectHint)].filter(
    (h) => h !== undefined,
  );
  const inHint = (value: string): boolean =>
    hints.some((hint) => hint.toLowerCase().includes(value.toLowerCase()));
  for (const item of [claim, ...observations]) {
    if (item === undefined) continue;
    const parties: [string | undefined, boolean][] = [
      [item.counterparty, false],
      ['merchant' in item ? item.merchant : undefined, true],
    ];
    for (const [party, merchant] of parties) {
      if (party === undefined) continue;
      const domain = expectedDomain(party, merchant);
      if (domain !== undefined && !plain.includes(domain)) problems.push(`drops the domain ${domain}`);
      if (domain === undefined && plain.toLowerCase().includes(party.toLowerCase()) && !inHint(party))
        problems.push(`names ${party}`);
    }
    if (item.amountCents !== undefined) {
      const amount =
        item.currency === undefined
          ? `${(item.amountCents / 100).toFixed(2)} (currency not stated)`
          : formatMoney(item.amountCents, item.currency);
      if (!plain.includes(amount)) problems.push(`drops the amount ${amount}`);
    }
    for (const word of (item.subjectHint ?? '').split(/\s+/u)) {
      if (word !== '' && !word.includes('@') && !plain.includes(word))
        problems.push('drops a word of a hint');
    }
  }
  if (claim !== undefined) {
    const when =
      claim.claimedAtPrecision === 'day'
        ? dateLabel(claim.claimedAt.slice(0, 10))
        : instantLabel(claim.claimedAt);
    if (!plain.includes(when)) problems.push('drops the claimed time');
  }
  for (const observation of observations) {
    if (!plain.includes(instantLabel(observation.occurredAt))) problems.push('drops an evidence time');
  }
  if (receipt.grade === 'UNASKED' && !plain.includes('Likely agent')) problems.push('says no "Likely agent"');
  if (receipt.override !== undefined && plain.includes(receipt.override.reason))
    problems.push('shows a mark’s reason');
  return problems;
}

/** Every receipt of every golden scenario, with its claim and its evidence. */
async function goldenShares(): Promise<{ file: string; input: ShareInput }[]> {
  const shares: { file: string; input: ShareInput }[] = [];
  for (const file of scenarioFiles()) {
    const loaded = loadScenario(file);
    const run = await runScenario(loaded);
    const claims = new Map<string, Claim>([...loaded.claims.values()].map((claim) => [claim.id, claim]));
    const observations = new Map<string, Observation>(
      [...loaded.observations.values()].map((o) => [o.id, o]),
    );
    for (const receipt of run.receipts as Receipt[]) {
      shares.push({
        file,
        input: {
          receipt,
          claim: receipt.claimId === undefined ? undefined : claims.get(receipt.claimId),
          observations: receipt.observationIds.flatMap((id) => {
            const observation = observations.get(id);
            return observation === undefined ? [] : [observation];
          }),
        },
      });
    }
  }
  return shares;
}

describe('a receipt shared, for every golden scenario', () => {
  it('passes the redaction assertions, and the image draws the same lines', async () => {
    const shares = await goldenShares();
    expect(shares.length).toBeGreaterThanOrEqual(226);
    const problems = shares.flatMap(({ file, input }) => {
      const text = receiptMarkdown(input);
      const drawn = shareLines(text)
        .map(({ text: line }) => line)
        .join('\n');
      const own = redactionProblems(input, text);
      if (drawn.includes('@') || drawn.includes('\\')) own.push('the image differs from the text');
      return own.map((problem) => `${file} ${input.receipt.id}: ${problem}`);
    });
    expect(problems).toEqual([]);
  }, 120_000);
});

describe('shareLines', () => {
  it('draws a title, headings and items, every escape removed', () => {
    expect(
      shareLines(
        '# Attest receipt: Not found\n\n## Why\n\n- To company\\.example, “Q3\\-review”\nMade by Attest.\n',
      ),
    ).toEqual([
      { kind: 'title', text: 'Attest receipt: Not found' },
      { kind: 'blank', text: '' },
      { kind: 'heading', text: 'Why' },
      { kind: 'blank', text: '' },
      { kind: 'item', text: '• To company.example, “Q3-review”' },
      { kind: 'text', text: 'Made by Attest.' },
    ]);
  });
});
