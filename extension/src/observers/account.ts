/**
 * The account a page is signed in to, as a hash (sprint_2 2.0, 2.2; docs/grading.md §6.1 grant `accounts`).
 *
 * The address never leaves the content script: only `accountHashOf(address)` crosses the bus (Hard Rules 2, 10).
 * The hash is the §10 text hash (SHA-256 of the UTF-8) of the address read through `normalize.email` (display name
 * and angle brackets dropped) and ASCII-lowercased, the case-folding §5.1 compares addresses with, so the one Google
 * account shown as `Priya@Example.com` in Gmail and `priya@example.com` in Calendar hashes the same. Nothing else is
 * folded: a lookalike address hashes as a different account.
 */
import { asciiLower, email } from '../core/normalize';
import { hashText } from '../core/redact';
import type { Sha256 } from '../core/schema';

/** The account hash of `raw`, or null when `raw` is not one email address. */
export function accountHashOf(raw: string): Sha256 | null {
  const parsed = email(raw);
  return parsed === null ? null : hashText(asciiLower(parsed.address));
}
