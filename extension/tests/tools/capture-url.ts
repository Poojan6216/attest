/**
 * Query strings and token-bearing fragments, wherever they appear in a captured page (SECURITY-2, Hard Rules 2
 * and 10). Tokens, session ids and signatures live there, and they hide in more places than `href`: data-*
 * attributes (Gmail's `data-saferedirecturl` carries the `usg` signature), `<meta content>`, visible text,
 * `#access_token=…` fragments and relative URLs. Every text node and attribute value goes through
 * stripQueryParts before the PII scrubber; link attributes go through trimUrl as well.
 */

/** Not a URL character: whitespace, quotes and angle brackets end a URL in text and attributes. */
const END = String.raw`\s"'<>`;

const PATTERNS: readonly RegExp[] = [
  // `?…` after a path: https://host/p?q, //host?q, /relative?q, a/b?q. The `?` is matched before the lookbehind,
  // which then runs only where a `?` is: first, it scanned back from every character, quadratic on a long run with
  // no `/` (a line of 100,000 bullets took 22 s; found with SEC-R14).
  new RegExp(String.raw`\?(?<=\/[^${END}?#]*\?)[^${END}#]+`, 'g'),
  // `?key=…` anywhere: share?token=…, a bare "?session=…" value, `#inbox?compose=…` inside a fragment.
  new RegExp(String.raw`\?[\w.%\[\]-]+=[^${END}#]*`, 'g'),
  // A percent-encoded query: https%3A%2F%2Fhost%2Fp%3Ftoken%3D…
  new RegExp(String.raw`%3F[^${END}#]*?%3D[^${END}#]*`, 'gi'),
  // A fragment that carries parameters: #access_token=…&state=…
  new RegExp(String.raw`#[^${END}#?]*[=&][^${END}]*`, 'g'),
];

/** Removes every query string and parameter-bearing fragment; returns the text and how many were removed. */
export function stripQueryParts(text: string): { readonly text: string; readonly removed: number } {
  let removed = 0;
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, () => {
      removed += 1;
      return '';
    });
  }
  return { text: out, removed };
}

/** A value that starts with a scheme, and one that starts with a scheme and `//`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const SCHEME_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//iu;

/** `value` as the URL parser reads it: no tab or newline anywhere, no control character or space at either end. */
function asParsed(value: string): string {
  const kept = Array.from(value)
    .filter((ch) => ch !== '\t' && ch !== '\n' && ch !== '\r')
    .join('');
  let start = 0;
  let end = kept.length;
  while (start < end && kept.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && kept.charCodeAt(end - 1) <= 0x20) end -= 1;
  return kept.slice(start, end);
}

/** The address a link is resolved against when the page's own is unknown: then no absolute link is the page's. */
const NO_PAGE_HOST = 'page.invalid';

/**
 * A link to anywhere but the captured page's own host keeps only its scheme and host. Another site's link carries
 * what it is about in its path: the capture of 2026-10-06 held the founder's address inside Uber's compressed click
 * links and two trip addresses inside Google Maps links. The value is read as Chrome reads it (WHATWG URL parsing:
 * backslashes, a single slash, tabs or newlines inside the scheme, leading controls), so no odd form keeps its path
 * (security re-review, SEC-R11); a link that does not parse is dropped. Any scheme but http(s) keeps only its scheme
 * (`tel:` and `sms:` numbers, `geo:` places, `data:` values), except `mailto:`, whose address the PII scrubber fakes
 * in every encoding (capture-pii.ts). Relative links and fragments are the page's own and stay as written.
 * `pageHost` null: no absolute link is the page's own (fail closed). Runs after `trimUrl`.
 */
export function trimForeignLink(value: string, pageHost: string | null): string {
  const own = (pageHost ?? NO_PAGE_HOST).toLowerCase();
  let url: URL;
  try {
    url = new URL(value, `https://${own}/`);
  } catch {
    return '';
  }
  if (url.protocol === 'mailto:') return value;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
  if (url.host !== own) {
    // Already only a host (`//www.google.com`): kept as written, since there is nothing to cut.
    const bare =
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';
    return bare ? value : `${url.protocol}//${url.host}/`;
  }
  // The page's own link is kept as written only in a plain form: relative, or `scheme://`. `https:/x/y` and
  // `https:x/y` resolve to the page's own host, but carry another site's address in their path.
  const plain = asParsed(value);
  return HAS_SCHEME.test(plain) && !SCHEME_SLASHES.test(plain) ? `${url.protocol}//${url.host}/` : value;
}

/**
 * A web address written as text: with a scheme and `//`, a bare `//` before a dotted host, starting `www.`, or a dotted
 * host with a path and no scheme (`meet.google.com/qrs-tuvw-xyz`: a Meet code is the key to a meeting; capture of
 * 2026-10-07) (a text has no link attribute to read). A `//` inside other text (`a//b`, `Q3 // plan`), a host inside an
 * address or a path, and `and/or` or `1.5/2` are not one.
 */
const TEXT_URL =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|(?<![\w:/])\/\/(?=[a-z0-9-]+\.[a-z0-9-])|\bwww\.|(?<![\w@./-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?=\/))[^\s"'<>]+/giu;
/** A text address written with a scheme or `//`; any other is read as `https://` and written back without it. */
const SCHEMED = /^(?:[a-z][a-z0-9+.-]*:)?\/\//iu;

/**
 * Every web address in a text or a non-link attribute cut as `trimForeignLink` cuts a link: the receipts printed
 * their referral links as text, and `data-*` attributes carry addresses too (security re-review, SEC-R12). Returns
 * the text and how many addresses it cut.
 */
export function trimForeignUrls(
  text: string,
  pageHost: string | null,
): { readonly text: string; readonly cut: number } {
  let cut = 0;
  const out = text.replace(TEXT_URL, (found) => {
    const bare = !SCHEMED.test(found);
    const trimmed = trimForeignLink(bare ? `https://${found}` : found, pageHost);
    const next = bare ? trimmed.replace(/^https:\/\//u, '') : trimmed;
    if (next !== found) cut += 1;
    return next;
  });
  return { text: out, cut };
}

/** The host links may keep their path to: the captured page's own (null when the address is unknown). */
export function pageHostOf(pageUrl: string | undefined): string | null {
  return pageUrl !== undefined && URL.canParse(pageUrl) ? new URL(pageUrl).host : null;
}
