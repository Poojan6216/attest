/**
 * A receipt shared (sprint_4 4.8; agents/ux_engineer.md rule 11: share is redacted): markdown made from the receipt,
 * its claim and its evidence, previewed in the side panel before the person copies it, as text or as an image
 * (./share-png.ts). It says:
 *  - the grade, and the agent ("Likely agent" on an UNASKED receipt, Hard Rule 7), and the state: final, checking, or
 *    marked by the person (their mark's grade, never its reason);
 *  - the claim: its type and when the agent said it acted, its counterparty's domain, its amount and its subject hint;
 *  - why, in Attest's own words (src/core/reason-text.ts: codes and numbers, nothing a page held);
 *  - each piece of evidence: its source, its time, its counterparty's or merchant's domain, its amount and its subject
 *    hint.
 * Never the request the person typed, an address, a name, a merchant that is no domain, or the reason of a mark. Times
 * are written as stored, on the clock they were read on. Text that came from a page is escaped, so it can never become a
 * link or a heading. Pure.
 */
import { reasonText } from '../core/reason-text';
import type { Claim, Observation, Receipt } from '../core/schema';
import { addressDomain, merchantDomain, withoutAddresses } from '../ledger/domain';
import { dateLabel, instantLabel } from './digest-labels';
import { escapeMarkdown } from './markdown';
import { formatAmount } from './format';
import { AGENT_NAMES, claimTypeLabel } from './labels';
import { gradeLabel, sourceName } from './receipt-labels';

export interface ShareInput {
  readonly receipt: Receipt;
  readonly claim: Claim | undefined;
  readonly observations: readonly Observation[];
}

type Facts = Pick<Observation, 'counterparty' | 'amountCents' | 'currency' | 'subjectHint'> & {
  readonly merchant?: string | undefined;
};

/**
 * The redacted facts of a claim or an observation: the counterparty's domain (from an address only) or the merchant's,
 * the amount, and the hint with any address in it written as its domain (../ledger/domain.ts), each when there is one.
 */
function facts({ counterparty, merchant, amountCents, currency, subjectHint }: Facts): string[] {
  const domain = addressDomain(counterparty) ?? merchantDomain(merchant);
  return [
    ...(domain === undefined ? [] : [escapeMarkdown(domain)]),
    ...(amountCents === undefined ? [] : [formatAmount(amountCents, currency)]),
    ...(subjectHint === undefined ? [] : [`“${escapeMarkdown(withoutAddresses(subjectHint))}”`]),
  ];
}

function stateLine(receipt: Receipt): string {
  if (receipt.override !== undefined) {
    return `- Marked by the person: ${gradeLabel(receipt.override.grade)}. Attest’s own grade stays ${gradeLabel(receipt.grade)}.`;
  }
  return receipt.state === 'FINAL' ? '- Final.' : '- Still checking.';
}

function claimLine(receipt: Receipt, claim: Claim | undefined): string {
  if (claim === undefined) {
    return receipt.claimId === undefined
      ? '- No claim: no agent reported this action.'
      : '- Its claim is no longer kept.';
  }
  const when =
    claim.claimedAtPrecision === 'day'
      ? dateLabel(claim.claimedAt.slice(0, 10))
      : instantLabel(claim.claimedAt);
  return `- Claimed: ${[claimTypeLabel(claim.type), when, ...facts(claim)].join(', ')}`;
}

const evidenceLine = (observation: Observation): string =>
  `- ${[sourceName(observation.source), instantLabel(observation.occurredAt), ...facts(observation)].join(', ')}`;

/** The receipt as markdown (header). */
export function receiptMarkdown({ receipt, claim, observations }: ShareInput): string {
  const agent = AGENT_NAMES[receipt.agent];
  const reasons = receipt.reasons.filter(({ code }) => code !== 'override.user');
  return [
    `# Attest receipt: ${gradeLabel(receipt.grade)}`,
    '',
    `- ${receipt.grade === 'UNASKED' ? `Likely agent: ${agent}` : `Agent: ${agent}`}`,
    stateLine(receipt),
    claimLine(receipt, claim),
    '',
    '## Why',
    '',
    ...(reasons.length === 0
      ? ['- No reason recorded.']
      : reasons.map((reason) => `- ${reasonText(reason)}`)),
    '',
    '## Evidence',
    '',
    ...(observations.length === 0 ? ['- None: nothing Attest saw matched.'] : observations.map(evidenceLine)),
    '',
    'Made by Attest from this browser’s own ledger. Counterparties are shown by domain only.',
    '',
  ].join('\n');
}
