/**
 * Bytes as base64 and back, and random ids, for the few encryption values the ledger keeps as text: the salt and the
 * key check in `meta`, and a key in `chrome.storage.session` (sprint_6 6.5).
 */

/** `bytes` as base64. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The bytes `text` holds as base64; throws on text that is not base64. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** `count` bytes from the browser's random source. */
export function randomBytes(count: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** `count` random bytes as lowercase hex. */
export function randomHex(count: number): string {
  return Array.from(randomBytes(count), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
