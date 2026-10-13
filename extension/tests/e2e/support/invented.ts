/**
 * The address half of the launch pictures' invented-data check (Sprint 7 close, security review SEC-6, tech review
 * TECH-5, QA review QA-9, privacy review gap 16; ./launch-shots.ts `onlyInvented` runs it with the seeded-secret
 * search). Every email address a picture may show must be at a domain reserved for examples (RFC 2606, RFC 6761):
 * `example.com`, `example.net`, `example.org`, or a name under `.example`. Text is read as a person would read it
 * drawn: in NFKC, so a fullwidth or small at sign is an at sign, and with every zero-width or invisible character
 * removed, so `priya@gma\u200bil.com` is the `priya@gmail.com` it shows; and a domain may hold any letter, so an
 * internationalised one (`bücher.de`) is an address too. Pure: the unit tests hold it (tests/unit/harness/invented.spec.ts).
 */

/**
 * Characters drawn as nothing, which could split an address the eye still reads whole: Unicode's default-ignorable code
 * points (the soft hyphen, zero-width spaces and joiners, direction marks, variation selectors, fillers).
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/** An address as drawn: letters, digits and the usual marks, an at sign, and a domain of two labels or more. */
const ADDRESS = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/** A domain reserved for examples (header). */
const RESERVED = /(?:^|\.)(?:example\.(?:com|net|org)|[\p{L}\p{N}-]+\.example)$/u;

/** `text` as a person reads it drawn (header). */
export function asDrawn(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '');
}

/** Every email address `text` shows, as drawn. */
export function addressesIn(text: string): string[] {
  return asDrawn(text).match(ADDRESS) ?? [];
}

/** Whether `address` is at a domain reserved for examples. */
export function isReserved(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  return RESERVED.test(domain);
}

/** The addresses `text` shows that are not at a reserved domain: what a picture must never show. */
export function realAddresses(text: string): string[] {
  return addressesIn(text).filter((address) => !isReserved(address));
}
