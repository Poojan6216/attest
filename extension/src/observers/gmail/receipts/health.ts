/**
 * health() of the Gmail receipt observer (sprint_2 2.3; agents/adapter_engineer.md rule 2; Hard Rule 6).
 *
 *  - No conversation open (a list, settings, anything else; ./message.ts says how it is told): IDLE `no_conversation`.
 *    There is nothing to read and nothing is wrong, so it is neither OK nor broken, and the ledger keeps the status
 *    an opened conversation gave: an Inbox tab never hides a receipt another tab could not read (sprint_2 2.11).
 *  - A conversation is open: every landmark the parsers need must be there, else DEGRADED
 *    `selector.missing.<main|subject|message|sender|date>`; the main landmark Gmail shows and the account must each
 *    be one, else DEGRADED `selector.ambiguous.<main|account>`; and every message a parser recognises as a receipt
 *    must have a readable total line, else DEGRADED `receipt.amount_missing` / `receipt.amount_ambiguous`.
 * Reasons are codes, never page text (Hard Rules 2, 10). It reads the pass's one read of the page (TECH-2).
 */
import type { HealthCheck } from '../../types';
import { verdictsOf } from './classify';
import { type Landmark, pageOf, type Twice } from './message';
import { UNREADABLE_REASONS, type UnreadableReason } from './parser';

export type ReceiptHealthReason =
  'no_conversation' | `selector.missing.${Landmark}` | `selector.ambiguous.${Twice}` | UnreadableReason;

/**
 * Every reason receipt health can give, in a closed list (Hard Rules 2, 10; docs/adapters.md §4.3). The type check
 * below fails when a landmark or reason is added without its entry here, so the list is always the whole set.
 */
export const RECEIPT_HEALTH_REASONS = Object.freeze([
  'no_conversation',
  'selector.missing.main',
  'selector.missing.subject',
  'selector.missing.message',
  'selector.missing.sender',
  'selector.missing.date',
  'selector.ambiguous.main',
  'selector.ambiguous.account',
  ...UNREADABLE_REASONS,
] as const satisfies readonly ReceiptHealthReason[]);

type Unlisted = Exclude<ReceiptHealthReason, (typeof RECEIPT_HEALTH_REASONS)[number]>;
/** True only while every reason is listed: an unlisted one makes this a type error. */
export const RECEIPT_HEALTH_REASONS_COMPLETE: [Unlisted] extends [never] ? true : never = true;

export function receiptHealth(doc: Document): HealthCheck {
  const page = pageOf(doc);
  if (!page.opened) return { status: 'IDLE', reasons: ['no_conversation'] };
  const reasons = new Set<ReceiptHealthReason>([
    ...page.missing.map((landmark) => `selector.missing.${landmark}` as const),
    ...page.ambiguous.map((twice) => `selector.ambiguous.${twice}` as const),
  ]);
  for (const verdict of verdictsOf(page)) {
    if (verdict.kind === 'unreadable') reasons.add(verdict.reason);
  }
  const [first, ...rest] = reasons;
  return first === undefined ? { status: 'OK' } : { status: 'DEGRADED', reasons: [first, ...rest] };
}
