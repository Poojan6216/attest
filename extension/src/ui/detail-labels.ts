/**
 * What a receipt's detail says (sprint_4 4.3 done-when: "detail shows every field that fed the score"; agents/
 * ux_engineer.md rule 5): the request hint, the claim as extracted, how it was graded (rule, score, each signal,
 * confidence, when, every reason in words), the coverage the grading read, and the grant and context it used. Every
 * value is a stored one, written out; nothing here grades or matches. Pure: the caller passes now.
 */
import { MATCH_FEATURES } from '../core/schema-checks';
import { reasonText } from '../core/reason-text';
import type { Claim, Coverage, Receipt, ReceiptInputs } from '../ledger/types';
import { clockTime, formatAmount } from './format';
import { AGENT_NAMES, claimTypeLabel } from './labels';
import { gradeLabel, sourceName } from './receipt-labels';

/** One labelled value of the detail. */
export type Field = readonly [label: string, value: string];

const SIGNAL_LABELS: Readonly<Record<(typeof MATCH_FEATURES)[number], string>> = Object.freeze({
  timeProximity: 'Time',
  counterpartyExact: 'Recipient, exact',
  counterpartyDomain: 'Recipient, domain',
  counterpartyName: 'Recipient, name',
  subjectOverlap: 'Subject',
  amountExact: 'Amount',
  merchantMatch: 'Merchant',
  modelScore: 'Model suggestion',
});

const PRECISION: Readonly<Record<Claim['claimedAtPrecision'], string>> = Object.freeze({
  minute: 'to the minute',
  hour: 'within the hour',
  day: 'on the day',
});

const SOURCE_KINDS: Readonly<Record<Claim['sourceKind'], string>> = Object.freeze({
  activity_view: 'Activity log',
  chat: 'Chat',
  notification: 'Notification',
  settings: 'Settings',
});

/** A number shown as stored, to two places at most. */
const number = (value: number): string => String(Math.round(value * 100) / 100);

/** The claim as extracted, every field it has. */
export function claimFields(claim: Claim, nowMs: number): Field[] {
  const fields: Field[] = [['What', claimTypeLabel(claim.type)]];
  if (claim.counterparty !== undefined)
    fields.push([claim.type === 'email.sent' ? 'To' : 'With', claim.counterparty]);
  if (claim.subjectHint !== undefined) fields.push(['Subject', claim.subjectHint]);
  if (claim.amountCents !== undefined)
    fields.push(['Amount', formatAmount(claim.amountCents, claim.currency)]);
  fields.push([
    'When it says',
    `${clockTime(claim.claimedAt, nowMs)}, ${PRECISION[claim.claimedAtPrecision]}`,
  ]);
  if (claim.claimedAtEnd !== undefined) fields.push(['Until', clockTime(claim.claimedAtEnd, nowMs)]);
  if (claim.targetAt !== undefined) fields.push(['Event starts', clockTime(claim.targetAt, nowMs)]);
  fields.push(['Read from', `${SOURCE_KINDS[claim.sourceKind]} (${AGENT_NAMES[claim.agent]})`]);
  fields.push(['Read at', clockTime(claim.observedAt, nowMs)]);
  const { id, version, confidence } = claim.extractor;
  fields.push(['Read by', `${id} ${version}, confidence ${number(confidence)}`]);
  return fields;
}

/** How the receipt was graded: its rule, state and instants, its confidence, its score and every signal. */
export function gradingFields(receipt: Receipt, nowMs: number): Field[] {
  const fields: Field[] = [
    ['Grade', gradeLabel(receipt.grade)],
    ['Rule', receipt.ruleId],
    ['Confidence', number(receipt.confidence)],
  ];
  const { score } = receipt.signals;
  if (score !== undefined) fields.push(['Score', number(score)]);
  for (const feature of MATCH_FEATURES) {
    const value = receipt.signals[feature];
    if (value !== undefined) fields.push([`Signal: ${SIGNAL_LABELS[feature]}`, number(value)]);
  }
  fields.push(['Graded at', clockTime(receipt.computedAt, nowMs)]);
  if (receipt.finalAt !== undefined) fields.push(['Final at', clockTime(receipt.finalAt, nowMs)]);
  if (receipt.finalFrom !== undefined) fields.push(['Final from', clockTime(receipt.finalFrom, nowMs)]);
  return fields;
}

/** Every reason the receipt holds, in words, in its order (§15). */
export const reasonLines = (receipt: Receipt): string[] =>
  receipt.reasons.map((reason) => reasonText(reason));

/** One entry of the coverage a grading read: which source, which window, when it was last seen, and how. */
export function coverageEntryLine(entry: Coverage['observers'][number], nowMs: number): string {
  const window =
    entry.windowStart === entry.windowEnd
      ? `at ${clockTime(entry.windowStart, nowMs)}`
      : `${clockTime(entry.windowStart, nowMs)} to ${clockTime(entry.windowEnd, nowMs)}`;
  const parts = [
    `${sourceName(entry.source)}: ${window}`,
    `last checked ${clockTime(entry.lastSyncAt, nowMs)}`,
  ];
  if (entry.accountHash !== undefined) parts.push(`account ${entry.accountHash.slice(0, 8)}`);
  if (entry.allCalendars !== undefined)
    parts.push(entry.allCalendars ? 'every calendar shown' : 'some calendars hidden');
  if (entry.changesSince !== undefined)
    parts.push(`changes followed since ${clockTime(entry.changesSince, nowMs)}`);
  return parts.join(', ');
}

/** The grant and the context the grading used. */
export function inputFields(inputs: ReceiptInputs, nowMs: number): Field[] {
  const { grant, context } = inputs;
  const fields: Field[] = [
    ['May do', grant.allowedTypes.map(claimTypeLabel).join(', ') || 'Nothing'],
    ['May write to', grant.counterpartyAllowlist.join(', ') || 'Anyone'],
  ];
  const ceiling = grant.spendCeilingCents;
  const currency = grant.spendCurrency;
  fields.push(['Spend ceiling', ceiling === null ? 'None' : formatAmount(ceiling, currency)]);
  fields.push(['Declared access', grant.declaredScopes.join(', ') || 'None declared']);
  const accounts = Object.entries(grant.accounts ?? {}).map(
    ([source, hashes]) =>
      `${sourceName(source as Coverage['observers'][number]['source'])}: ${hashes.map((hash) => hash.slice(0, 8)).join(', ')}`,
  );
  fields.push(['Accounts', accounts.join('; ') || 'Not set']);
  fields.push(['Grant from', clockTime(grant.updatedAt, nowMs)]);
  fields.push(['Spent before, in the window', formatAmount(context.priorSpendCents, grant.spendCurrency)]);
  if (context.attribution !== undefined) {
    const { agent, scoreBp, signals } = context.attribution;
    fields.push(['Likely agent', `${AGENT_NAMES[agent]}, ${String(scoreBp / 100)}%`]);
    fields.push(['Signals', signals.join(', ')]);
  }
  fields.push(['Coverage read at', clockTime(inputs.coverage.evaluatedAt, nowMs)]);
  return fields;
}
