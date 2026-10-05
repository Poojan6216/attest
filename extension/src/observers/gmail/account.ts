/**
 * The signed-in Gmail account for the Sent observer (sprint_2 2.2; docs/grading.md §6.1 grant `accounts`): the
 * shared Google-account reader (../google-account.ts) with this observer's own selectors (./selectors.json
 * `selectors.account`, `attributes.accountLabel`). Any display language reads; two different addresses are
 * ambiguous, and health reports DEGRADED rather than guess whose coverage it is (Hard Rule 5). The address is
 * returned only to the skeleton, which hashes it before anything leaves the content script (../account.ts, Hard
 * Rules 2, 10). Read once per pass (../pass-memo.ts): health and the coverage read the same answer.
 */
import { type AccountRead, readGoogleAccount } from '../google-account';
import { perPass } from '../pass-memo';
import { SENT_SELECTORS } from './selectors';

const ACCOUNT = Object.freeze({
  selector: SENT_SELECTORS.selectors.account,
  attribute: SENT_SELECTORS.attributes.accountLabel,
});

/** The account the page is signed in to, or why it cannot be read. */
export const readGmailAccount: (doc: Document) => AccountRead = perPass((doc) =>
  readGoogleAccount(doc, ACCOUNT),
);

/** `Observer.account`: the switcher's address, or null when the page shows none (health has said DEGRADED). */
export function gmailAccount(doc: Document): string | null {
  const read = readGmailAccount(doc);
  return read.ok ? read.address : null;
}
