/**
 * The signed-in Gmail account, from the account switcher (sprint_2 2.2; docs/grading.md §6.1 grant `accounts`).
 *
 * The switcher is a control in `role="banner"` whose `aria-label` ends with the address in parentheses
 * ("Google Account: Avery Founder\n(avery@example.com)"); the words before it are localised, the parenthesised
 * address is not. The address is returned only to the skeleton, which hashes it before anything leaves the
 * content script (../account.ts, Hard Rules 2, 10). Two different addresses in the banner (an open account
 * chooser) are ambiguous: coverage must belong to one account, so the pass is DEGRADED rather than guess.
 */
import { asciiLower, email } from '../../core/normalize';
import { SENT_SELECTORS } from './selectors';

const { selectors: S, attributes: A } = SENT_SELECTORS;

/** The parenthesised address at the end of an accessible label. */
const ADDRESS_AT_END = /\(([^()\s]+@[^()\s]+)\)\s*$/u;

export type AccountRead =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly reason: 'selector.missing.account' | 'selector.ambiguous.account' };

/** Every address the banner's labels end with, one per account (compared as §5.1 compares: ASCII-lowercased). */
function bannerAddresses(doc: Document): string[] {
  const byKey = new Map<string, string>();
  for (const banner of Array.from(doc.querySelectorAll(S.banner))) {
    for (const labelled of Array.from(banner.querySelectorAll(S.accountLabel))) {
      const found = ADDRESS_AT_END.exec(labelled.getAttribute(A.accountLabel) ?? '')?.[1];
      const parsed = found === undefined ? null : email(found);
      if (parsed !== null && !byKey.has(asciiLower(parsed.address))) {
        byKey.set(asciiLower(parsed.address), parsed.address);
      }
    }
  }
  return [...byKey.values()];
}

/** The account the page is signed in to, or why it cannot be read. */
export function readGmailAccount(doc: Document): AccountRead {
  const [address, ...others] = bannerAddresses(doc);
  if (address === undefined) return { ok: false, reason: 'selector.missing.account' };
  if (others.length > 0) return { ok: false, reason: 'selector.ambiguous.account' };
  return { ok: true, address };
}

/** `Observer.account`: the switcher's address, or null when the page shows none (health has said DEGRADED). */
export function gmailAccount(doc: Document): string | null {
  const read = readGmailAccount(doc);
  return read.ok ? read.address : null;
}
