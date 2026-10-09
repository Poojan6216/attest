/**
 * A counterparty reduced to its domain (sprint_4 4.7, 4.8: a share shows a counterparty by domain only): an address
 * gives its domain, a domain stays, and anything else (a name, a merchant that is no domain) gives nothing, so a share
 * can never hold an address or a name. Pure: imported by the digest builder (./digest.ts) and the pages' shares
 * (src/ui/receipt-share.ts) alike.
 */

/** The domain of `counterparty`: an address's, or the counterparty itself when it is a domain; a name gives none. */
export function domainOf(counterparty: string | undefined): string | undefined {
  if (counterparty === undefined) return undefined;
  const host = counterparty
    .slice(counterparty.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase();
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(host) ? host : undefined;
}
