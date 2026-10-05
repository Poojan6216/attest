/**
 * The signed-in Google account, from the account switcher in the page's banner (sprint_2 2.2, 2.3, 2.5; docs/grading.md
 * §6.1 grant `accounts`): the one reader `gmail.sent`, `gmail.receipt` and `gcal.event` share, each with the
 * selector and attribute its own selectors.json names.
 *
 * The switcher is a control in `role="banner"` whose label ends with the address in parentheses ("Google Account:
 * Avery Founder\n(avery@example.com)"). The words before it are localised; the parenthesised address is not, so the
 * rule reads no word of any language. An address inside the display name ("Avery (x@y.org)\n(avery@example.com)") is
 * not the one at the end. Two different addresses (compared as §5.1 compares them: ASCII-lowercased) are ambiguous,
 * as with an account chooser drawn open: coverage must belong to one account, so the caller refuses to guess (Hard
 * Rule 5). The address is returned only to the observer, which hashes it before anything leaves the content script
 * (./account.ts; Hard Rules 2, 10). Pure over the DOM (Hard Rule 3): it reads attributes only.
 */
import { asciiLower, email } from '../core/normalize';

/** Where an observer's page names its account: the labelled elements to read, and the label's attribute. */
export interface AccountSelectors {
  /** Every element whose label may name the account (`[role="banner"] [aria-label]`). */
  readonly selector: string;
  /** The attribute holding the label (`aria-label`). */
  readonly attribute: string;
}

/** Why no single account could be read: codes, never page text (Hard Rules 2, 10). */
export const ACCOUNT_REASONS = Object.freeze([
  'selector.missing.account',
  'selector.ambiguous.account',
] as const);

export type AccountReason = (typeof ACCOUNT_REASONS)[number];

export type AccountRead =
  { readonly ok: true; readonly address: string } | { readonly ok: false; readonly reason: AccountReason };

/**
 * The parenthesised address at the end of a label: one `@`, no parenthesis or space. No two quantified runs can
 * share a character, so it runs in linear time on any label.
 */
const ADDRESS_AT_END = /\(([^()\s@]+@[^()\s@]+)\)\s*$/u;

/** Every address a label of `selectors` ends with, one per account, as first read (case kept). */
function labelledAddresses(doc: Document, selectors: AccountSelectors): string[] {
  const byKey = new Map<string, string>();
  for (const labelled of Array.from(doc.querySelectorAll(selectors.selector))) {
    const found = ADDRESS_AT_END.exec(labelled.getAttribute(selectors.attribute) ?? '')?.[1];
    const parsed = found === undefined ? null : email(found);
    if (parsed !== null && !byKey.has(asciiLower(parsed.address))) {
      byKey.set(asciiLower(parsed.address), parsed.address);
    }
  }
  return [...byKey.values()];
}

/** The account the page is signed in to (the address as the page writes it), or why it cannot be read. */
export function readGoogleAccount(doc: Document, selectors: AccountSelectors): AccountRead {
  const [address, ...others] = labelledAddresses(doc, selectors);
  if (address === undefined) return { ok: false, reason: 'selector.missing.account' };
  if (others.length > 0) return { ok: false, reason: 'selector.ambiguous.account' };
  return { ok: true, address };
}
