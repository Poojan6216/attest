/**
 * Email addresses hidden in encodings that a search for '@' cannot see, for the fixture sanitiser.
 *
 *  - Percent-encoded: `from%3Alena%40corp.io` in a Gmail search #fragment or a link path.
 *  - Base64 / base64url: Google Calendar's event ids (`eid=…`, `data-eventid="…"`) are base64 of
 *    "<event id> <calendar owner's email>", so a fixture would carry the owner's address in plain sight.
 * Both are rewritten in place with the same fake the plain address gets, re-encoded the same way, so ids stay
 * well-formed and every copy of one address still maps to one fake.
 */

const ASCII_DOMAIN = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}`;

/**
 * `local%40domain`. The local part starts after a non-address character or right after a complete `%XX` escape,
 * so `from%3Alena%40corp.io` yields `lena`, not `3Alena`. Group 1: local part, group 2: domain.
 */
export const PERCENT_EMAIL = new RegExp(
  String.raw`(?:(?<![A-Za-z0-9._+%-])|(?<=%[0-9A-Fa-f]{2}))([A-Za-z0-9._+-]+)%40(${ASCII_DOMAIN})(?![A-Za-z0-9-])`,
  'g',
);

/** Runs that may be base64 (standard or url-safe alphabet), 16+ characters, optionally padded. */
export const BASE64_RUN = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{16,}={0,2}(?![A-Za-z0-9+/_=-])/g;
const MIN_BASE64_LENGTH = 16;
/** An address inside decoded bytes (read as latin1, so only ASCII addresses are matched). */
const DECODED_EMAIL = new RegExp(String.raw`[A-Za-z0-9._%+-]+@${ASCII_DOMAIN}`, 'g');

/** The fake for a percent-encoded match, `%40` kept. `fakeEmail` maps a plain address to its fake. */
export function fakePercentEmail(match: RegExpExecArray, fakeEmail: (email: string) => string): string {
  const [, local = '', domain = ''] = match;
  return fakeEmail(`${local}@${domain}`).replace('@', '%40');
}

function decodeBase64(token: string): string | null {
  const body = token.replace(/=+$/, '');
  if (body.length % 4 === 1) return null;
  // Node's base64 decoder accepts both the standard and the url-safe alphabet.
  return Buffer.from(body, 'base64').toString('latin1');
}

/** Encodes `text` (latin1 bytes) in the alphabet and padding style of `original`. */
function encodeLike(original: string, text: string): string {
  const standard = /[+/]/.test(original);
  const encoded = Buffer.from(text, 'latin1')
    .toString(standard ? 'base64' : 'base64url')
    .replace(/=+$/, '');
  return original.endsWith('=') ? encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=') : encoded;
}

/** The token with every address inside it faked, or null when it decodes to no address. */
function fakeInside(token: string, fakeEmail: (email: string) => string): string | null {
  const decoded = decodeBase64(token);
  if (decoded?.includes('@') !== true) return null;
  // A fake never equals its original (Faker), so an unchanged string means no address was found.
  const replaced = decoded.replace(DECODED_EMAIL, (email) => fakeEmail(email));
  return replaced === decoded ? null : encodeLike(token, replaced);
}

/**
 * The run with every base64-hidden address faked, or null when it hides none. First each '/'-free segment
 * (a url-safe token, or a token in a path such as `calendar/r/eventedit/<token>`), keeping its own alphabet;
 * then, for a standard-alphabet token that itself contains '/', the run from its start or from after a '/'.
 */
export function fakeBase64Run(run: string, fakeEmail: (email: string) => string): string | null {
  const segments = run.split('/');
  const faked = segments.map((segment) =>
    segment.length < MIN_BASE64_LENGTH ? null : fakeInside(segment, fakeEmail),
  );
  if (faked.some((segment) => segment !== null)) {
    return segments.map((segment, index) => faked[index] ?? segment).join('/');
  }
  if (!run.includes('/')) return null;
  for (let start = 0; run.length - start >= MIN_BASE64_LENGTH;) {
    const tail = fakeInside(run.slice(start), fakeEmail);
    if (tail !== null) return run.slice(0, start) + tail;
    const slash = run.indexOf('/', start);
    if (slash === -1) break;
    start = slash + 1;
  }
  return null;
}
