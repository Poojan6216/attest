/**
 * The Gmail receipt observer (sprint_2 2.3; source `gmail.receipt`): an opened message from a sender in the
 * receipt-parser registry (Stripe, Amazon, Facebook Marketplace, OpenTable, Instacart, Uber, Shopify), or a
 * generic order confirmation, becomes one purchase.made, subscription.changed or listing.posted Observation.
 *
 *   health() (./health.ts) → extract() (./extract.ts) → redact.project() (../../plan.ts) → bus (../../base.ts)
 *
 * Coverage (sprint_2 2.7; docs/grading.md §3; Hard Rule 5): a clean pass that parsed an opened receipt posts one
 * `coverage.ping` per parsed message, whose window is that message's own instant (`windowStart = windowEnd` = its
 * date, ./extract.ts `receiptWindows`). It asserts only that this message was read: an opened message says nothing
 * about the other mail around it. A list view, or an opened conversation with nothing parsed, posts no coverage
 * (OK, by design). The account is the switcher's address (./message.ts); only its hash leaves.
 *
 * Read-only and pure over the DOM (Hard Rule 3; `attest/no-act` lints src/observers/**). Landmarks, sender lists,
 * subject kinds and total labels are versioned in ./selectors.json; `version` is that file's version.
 */
import { OBSERVER_HOSTS } from '../../../config';
import type { Observer } from '../../types';
import { classify, parserFor } from './classify';
import { extractReceipts, receiptWindows } from './extract';
import { receiptHealth } from './health';
import { readPage } from './message';
import type { Verdict } from './parser';
import { type ParserId, RECEIPT_SELECTORS } from './selectors';

export { RECEIPT_PARSERS } from './classify';
export {
  inRegistry,
  RECEIPT_SELECTORS,
  RECEIPT_SENDER_DOMAINS,
  RECEIPT_SENDER_NAME_DOMAINS,
  type ParserId,
} from './selectors';
export type { ReceiptFacts, Verdict } from './parser';

export const receiptObserver: Observer = Object.freeze({
  id: 'gmail.receipt',
  vendor: 'gmail',
  version: RECEIPT_SELECTORS.version,
  hosts: OBSERVER_HOSTS.gmail,
  source: 'gmail.receipt',
  health: receiptHealth,
  extract: extractReceipts,
  account: (doc: Document) => readPage(doc).account,
  visibleWindows: receiptWindows,
});

/** One expanded message and what its parser said: for tests and the bench (never posted). */
export interface MessageVerdict {
  readonly key: string;
  readonly parser: ParserId | null;
  readonly verdict: Verdict;
}

/** Every expanded message of the opened conversation with the parser that may read it and its verdict. */
export function receiptVerdicts(doc: Document): MessageVerdict[] {
  const page = readPage(doc);
  return page.messages.map((message) => ({
    key: message.key,
    parser: parserFor(message, page.account)?.id ?? null,
    verdict: classify(message, page.account),
  }));
}
