/**
 * The Gmail receipt observer (sprint_2 2.3; source `gmail.receipt`): an opened message from a sender in the
 * receipt-parser registry (Stripe, Amazon, Facebook Marketplace, OpenTable, Instacart, Uber, Shopify), or a
 * generic order confirmation, becomes one purchase.made, subscription.changed or listing.posted Observation.
 *
 *   health() (./health.ts) → extract() (./extract.ts) → redact.project() (../../plan.ts) → bus (../../base.ts)
 *
 * Coverage: none, by design (`coverage: 'none'`). A `gmail.receipt` interval would assert that every message from
 * a registry sender in its span was parsed (docs/grading.md §3); an opened message is one message and says nothing
 * about the others, so this observer never posts a `coverage.ping` and never reads an account or a window. Its
 * receipts are positive evidence only: they can verify a purchase, never make Attest say NOT_FOUND (Hard Rule 5).
 *
 * Read-only and pure over the DOM (Hard Rule 3; `attest/no-act` lints src/observers/**). Landmarks, sender lists,
 * subject kinds and total labels are versioned in ./selectors.json; `version` is that file's version.
 */
import { OBSERVER_HOSTS } from '../../../config';
import type { Observer } from '../../types';
import { classify, parserFor } from './classify';
import { extractReceipts } from './extract';
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
  coverage: 'none',
  health: receiptHealth,
  extract: extractReceipts,
  // Never called: an observer with `coverage: 'none'` reports no window and no account (../../plan.ts).
  account: () => null,
  visibleWindow: () => null,
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
