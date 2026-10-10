/**
 * Domains, for what leaves the browser in a share (sprint_4 4.7, 4.8; Hard Rule 2: a share shows a counterparty by its
 * domain only; sprint_4 close, security review SEC-1). One shape for every domain Attest writes or checks: the grant
 * form's recipient list, a digest's notable receipt and each share.
 *
 * A person's counterparty gives a domain only when it is an address: "A.Kumar" or "Dr.Who" looks like a domain and is
 * a name, so anything without an `@` gives none. A merchant is a business, never a person, so a merchant written as a
 * domain ("Amazon.com") keeps it. A share's subject hint keeps its words, with any address in it written as its domain
 * and any other `@` word left out, so no share holds an address. Pure: imported by the digest builder (./digest.ts),
 * the pages' shares (src/ui/receipt-share.ts, src/ui/digest-share.ts) and the grant form (src/ui/grant-form.ts).
 */
import { z } from 'zod';

/** One label of a domain: letters, digits and hyphens, never a hyphen at either end, at most 63 characters. */
export const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

/** A domain: two labels or more, lower case, the last of letters only (a top-level domain). */
export const DOMAIN = new RegExp(`^(?:${DOMAIN_LABEL}\\.)+[a-z]{2,63}$`, 'u');

/** The longest a domain may be (RFC 1035). */
export const DOMAIN_MAX = 253;

/** A domain, as Attest stores and shows one. */
export const Domain = z.string().max(DOMAIN_MAX).regex(DOMAIN);

/** `text` as a domain when it is one (case aside), else undefined. */
function asDomain(text: string): string | undefined {
  const host = text.trim().toLowerCase();
  return host.length <= DOMAIN_MAX && DOMAIN.test(host) ? host : undefined;
}

/** The domain of an address: what follows its last `@`, when it is a domain. Anything that is not an address gives none. */
export function addressDomain(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const at = value.lastIndexOf('@');
  return at <= 0 ? undefined : asDomain(value.slice(at + 1));
}

/** A merchant's domain: an address's, or the merchant itself when it is written as a domain. */
export function merchantDomain(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return addressDomain(value) ?? asDomain(value);
}

/** Leading and trailing punctuation around an address in running text. */
const AROUND = /^[\p{P}\p{S}]*(.*?)[\p{P}\p{S}]*$/su;

/**
 * `text` with every word that holds an `@` written as its address's domain, or left out when it is no address: what a
 * share shows of a subject hint ("Lunch with priya@company.example" gives "Lunch with company.example").
 */
export function withoutAddresses(text: string): string {
  return text
    .split(/(\s+)/u)
    .map((word) => {
      if (!word.includes('@')) return word;
      const bare = AROUND.exec(word)?.[1] ?? word;
      return addressDomain(bare) ?? '…';
    })
    .join('');
}
