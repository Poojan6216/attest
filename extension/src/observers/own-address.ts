/**
 * Whether an address is the signed-in account's own mailbox, the one rule every observer keeps the account's
 * address out of what it stores with (docs/privacy-architecture.md §6; Hard Rule 2): the same address in any ASCII
 * case, with or without a `+tag`, and, at Gmail (`gmail.com`, `googlemail.com`), with or without dots in the local
 * part, since Gmail delivers every one of them to the account (security re-review of 2026-10-06, SEC-R7). An alias
 * a Google Workspace domain delivers to the account cannot be told from the page and is not caught. Pure: it reads
 * two strings.
 */
import { asciiLower, email } from '../core/normalize';

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/** The mailbox an address delivers to, as one comparable string, or null when it is not an address. */
function mailbox(raw: string): string | null {
  const parsed = email(raw);
  if (parsed === null) return null;
  const domain = asciiLower(parsed.domain);
  const base = asciiLower(parsed.baseLocal);
  return GMAIL_DOMAINS.has(domain) ? `${base.replaceAll('.', '')}@gmail.com` : `${base}@${domain}`;
}

/** True when `address` delivers to the account's own mailbox; never for an unknown account (null). */
export function isOwnAddress(address: string, account: string | null): boolean {
  if (account === null) return false;
  const own = mailbox(account);
  return own !== null && mailbox(address) === own;
}
