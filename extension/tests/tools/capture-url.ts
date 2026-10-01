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
  // `?…` after a path: https://host/p?q, //host?q, /relative?q, a/b?q.
  new RegExp(String.raw`(?<=\/[^${END}?#]*)\?[^${END}#]+`, 'g'),
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
