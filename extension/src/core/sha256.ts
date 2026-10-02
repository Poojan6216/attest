/**
 * SHA-256 (FIPS 180-4) and UTF-8 encoding (RFC 3629), in plain TypeScript.
 *
 * src/core must be synchronous, pure, and runnable in Node and in the browser without DOM types, so it
 * can use neither WebCrypto (async) nor TextEncoder (a DOM/Node global). Verified against the NIST test
 * vectors and against Node's `crypto` in tests/unit/core/hash.spec.ts and the hash property test.
 * This file is exempt from the core no-literal rule: the numbers below are the algorithm's constants.
 */

/** FIPS 180-4 §4.2.2: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

/** FIPS 180-4 §5.3.3: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const BLOCK_BYTES = 64;
const WORDS = 64;
const REPLACEMENT_CHARACTER = 0xfffd;

/**
 * UTF-8 bytes of a JavaScript string. A lone surrogate becomes U+FFFD, exactly as TextEncoder and Node's
 * Buffer do, so hashes match every other implementation.
 */
export function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        code = REPLACEMENT_CHARACTER;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = REPLACEMENT_CHARACTER;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** FIPS 180-4 §5.1.1 padding: 0x80, zeros, then the message length in bits as a 64-bit big-endian. */
function pad(message: Uint8Array): DataView {
  const blocks = Math.ceil((message.length + 9) / BLOCK_BYTES);
  const padded = new Uint8Array(blocks * BLOCK_BYTES);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  return view;
}

function word(values: readonly number[] | Uint32Array, index: number): number {
  return values[index] ?? 0;
}

/** Message schedule for one 64-byte block (FIPS 180-4 §6.2.2 step 1). */
function schedule(view: DataView, offset: number): Uint32Array {
  const w = new Uint32Array(WORDS);
  for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4);
  for (let t = 16; t < WORDS; t += 1) {
    const w15 = word(w, t - 15);
    const w2 = word(w, t - 2);
    const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
    w[t] = (word(w, t - 16) + s0 + word(w, t - 7) + s1) >>> 0;
  }
  return w;
}

/** One compression round over a block (FIPS 180-4 §6.2.2 steps 2–4); updates `h` in place. */
function compress(h: Uint32Array, w: Uint32Array): void {
  let a = word(h, 0);
  let b = word(h, 1);
  let c = word(h, 2);
  let d = word(h, 3);
  let e = word(h, 4);
  let f = word(h, 5);
  let g = word(h, 6);
  let hh = word(h, 7);
  for (let t = 0; t < WORDS; t += 1) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + s1 + ch + word(K, t) + word(w, t)) >>> 0;
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  [a, b, c, d, e, f, g, hh].forEach((value, i) => {
    h[i] = (word(h, i) + value) >>> 0;
  });
}

/** SHA-256 digest of raw bytes. */
export function sha256(message: Uint8Array): Uint8Array {
  const view = pad(message);
  const h = Uint32Array.from(H0);
  for (let offset = 0; offset < view.byteLength; offset += BLOCK_BYTES) {
    compress(h, schedule(view, offset));
  }
  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  h.forEach((value, i) => {
    out.setUint32(i * 4, value);
  });
  return digest;
}

/** Lowercase hex of bytes. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
