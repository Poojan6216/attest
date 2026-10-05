/**
 * health() of the Gmail receipt observer (sprint_2 2.3; agents/adapter_engineer.md rule 2; Hard Rule 6).
 *
 *  - No conversation open (a list, settings, anything else; ./message.ts says how it is told): OK. There is nothing
 *    to read and nothing is wrong, and such a pass posts no coverage (./extract.ts `receiptWindows`), so OK here
 *    claims nothing about any message.
 *  - A conversation is open: every landmark the parsers need must be there, else DEGRADED
 *    `selector.missing.<main|subject|message|sender|date>`; and every message a parser recognises as a receipt
 *    must have a readable total line, else DEGRADED `receipt.amount_missing` / `receipt.amount_ambiguous`.
 * Reasons are codes, never page text (Hard Rules 2, 10).
 */
import type { HealthCheck } from '../../types';
import { classify } from './classify';
import { readPage } from './message';

export function receiptHealth(doc: Document): HealthCheck {
  const page = readPage(doc);
  const reasons = new Set<string>(page.missing.map((landmark) => `selector.missing.${landmark}`));
  for (const message of page.messages) {
    const verdict = classify(message, page.account);
    if (verdict.kind === 'unreadable') reasons.add(verdict.reason);
  }
  const [first, ...rest] = reasons;
  return first === undefined ? { status: 'OK' } : { status: 'DEGRADED', reasons: [first, ...rest] };
}
