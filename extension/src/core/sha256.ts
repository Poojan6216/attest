/**
 * SHA-256 (FIPS 180-4) and UTF-8 encoding (RFC 3629), in plain TypeScript.
 *
 * src/core must be synchronous, pure, and runnable in Node and in the browser without DOM types, so it
 * can use neither WebCrypto (async) nor TextEncoder (a DOM/Node global). Verified against the NIST test
 * vectors and against Node's `crypto` in tests/unit/core/hash.spec.ts and the hash property test.
 * This file is exempt from the core no-literal rule: the numbers below are the algorithm's constants.
 *
 * Speed (the task 1.5 grading perf gate hashes every receipt's inputs): a `Sha256Writer` encodes text in one pass
 * straight into its 64-byte block, four ASCII code units to a word, and compresses each block as soon as it is
 * full, so no byte array or padded copy is ever allocated and a long message is never built as one string.
 * `sha256OfDigests` hashes a concatenation of 32-byte digests (§3 v1.5 `candidatesHash`) straight from a table of
 * digest words. The only shared buffers (the message schedule, the one-shot writer, the digest block) are filled
 * and consumed within one synchronous call that calls nothing that could re-enter it, so no hash ever sees
 * another's words. All arithmetic is 32-bit (`| 0`), exactly the modular arithmetic FIPS 180-4 specifies.
 */

/** FIPS 180-4 §4.2.2: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** FIPS 180-4 §5.3.3: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0 = Int32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const BLOCK_BYTES = 64;
/** A digest's 32 bytes as big-endian 32-bit words (`Sha256Writer.words()`). */
export const DIGEST_WORDS = 8;
/** The length field: the last 8 bytes (two words) of the final block (FIPS 180-4 §5.1.1). */
const LENGTH_WORD = (BLOCK_BYTES - 8) / 4;
const WORDS = 64;
const REPLACEMENT_CHARACTER = 0xfffd;
/** 2^32: the message bit length is written as two 32-bit words. */
const TWO_POW_32 = 0x100000000;

/** The message schedule: filled and consumed within one compression (see the file comment). */
const W = new Int32Array(WORDS);
const BLOCK_WORDS = 16;

/** The two lowercase hex digits of each byte value. */
const HEX: readonly string[] = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/**
 * One compression into `h` of the block held as 16 big-endian words in `block` (FIPS 180-4 §6.2.2): the block
 * and the rest of the message schedule into W, then the 64 rounds. `Ch(e,f,g) = g ^ (e & (f ^ g))` and `Maj(a,b,c) =
 * (a & b) ^ (c & (a ^ b))` are the standard equivalent forms of §4.1.2 (fewer operations, same bits).
 */
function rounds(h: Int32Array, block: Int32Array): void {
  const w = W;
  for (let t = 0; t < BLOCK_WORDS; t += 1) w[t] = block[t] ?? 0;
  for (let t = 16; t < WORDS; t += 1) {
    const w15 = w[t - 15] ?? 0;
    const w2 = w[t - 2] ?? 0;
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) | 0;
  }
  let a = h[0] ?? 0;
  let b = h[1] ?? 0;
  let c = h[2] ?? 0;
  let d = h[3] ?? 0;
  let e = h[4] ?? 0;
  let f = h[5] ?? 0;
  let g = h[6] ?? 0;
  let hh = h[7] ?? 0;
  for (let t = 0; t < WORDS; t += 1) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (hh + s1 + (g ^ (e & (f ^ g))) + (K[t] ?? 0) + (w[t] ?? 0)) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (c & (a ^ b)))) | 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] = ((h[0] ?? 0) + a) | 0;
  h[1] = ((h[1] ?? 0) + b) | 0;
  h[2] = ((h[2] ?? 0) + c) | 0;
  h[3] = ((h[3] ?? 0) + d) | 0;
  h[4] = ((h[4] ?? 0) + e) | 0;
  h[5] = ((h[5] ?? 0) + f) | 0;
  h[6] = ((h[6] ?? 0) + g) | 0;
  h[7] = ((h[7] ?? 0) + hh) | 0;
}

/**
 * The code point at `text[i]`. A surrogate pair gives its astral code point (≥ 0x10000, so the caller knows it
 * spans two code units); a lone surrogate gives U+FFFD, exactly as TextEncoder and Node's Buffer encode it.
 */
function codePointAt(text: string, i: number): number {
  const code = text.charCodeAt(i);
  if (code < 0xd800 || code > 0xdfff) return code;
  if (code <= 0xdbff) {
    // charCodeAt past the end is NaN, which fails both comparisons: a final high surrogate is lone.
    const next = text.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return combine(code, next);
  }
  return REPLACEMENT_CHARACTER;
}

function combine(high: number, low: number): number {
  return 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
}

/** The number of UTF-8 bytes of a code point. */
function utf8Length(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code < 0x10000 ? 3 : 4;
}

/** The lead-byte marks of 2-, 3- and 4-byte UTF-8 sequences, by length. */
const UTF8_LEAD = [0, 0, 0xc0, 0xe0, 0xf0];

/** Hands `put` the UTF-8 bytes of a code point (RFC 3629), lead byte first. */
function encodeCodePoint(code: number, put: (byte: number) => void): void {
  const length = utf8Length(code);
  if (length === 1) {
    put(code);
    return;
  }
  const lead = UTF8_LEAD[length] ?? 0;
  put(lead | (code >> (6 * (length - 1))));
  for (let shift = 6 * (length - 2); shift >= 0; shift -= 6) put(0x80 | ((code >> shift) & 0x3f));
}

/**
 * SHA-256 of the UTF-8 encoding of everything written, in order: `write(a); write(b)` hashes exactly what
 * `write(a + b)` hashes, a surrogate pair split between two writes included (a lone surrogate is U+FFFD). `hex()`
 * or `words()` finishes the hash (either may be read again); nothing may be written after it.
 *
 * The pending block is kept as the big-endian words of the writer's own message schedule, so four ASCII code
 * units (four UTF-8 bytes) are stored as one word wherever the block stands on a word boundary, and a long
 * message written piece by piece hashes as fast as one written whole.
 */
export class Sha256Writer {
  readonly #h = H0.slice();
  readonly #w = new Int32Array(BLOCK_WORDS);
  /** Bytes in the pending block (0–63). */
  #pos = 0;
  #bytes = 0;
  /** A high surrogate that ended the last write, waiting for the next code unit; -1 when there is none. */
  #high = -1;
  /** The message has been padded and its final block compressed: nothing more may be written. */
  #done = false;

  /** Writes `text` from code unit `start` on. */
  write(text: string, start = 0): void {
    if (this.#done) throw new RangeError('sha256: write after hex()');
    let i = this.#resume(text, start);
    while (i < text.length) {
      i = this.#ascii(text, i);
      if (i < text.length && text.charCodeAt(i) >= 0x80) i = this.#nonAscii(text, i);
    }
  }

  /**
   * Writes `count` 32-bit words of `words` from index `from` on as raw bytes, each word as its four big-endian
   * bytes (a digest from `words()` is its 32 bytes): straight into the block's words while the block stands on a
   * word boundary, byte by byte otherwise. A high surrogate left by the last `write` is lone: U+FFFD first.
   */
  writeWords(words: Int32Array, from: number, count: number): void {
    if (this.#done) throw new RangeError('sha256: write after hex()');
    if (this.#high >= 0) this.#putCodePoint(REPLACEMENT_CHARACTER);
    this.#high = -1;
    const end = from + count;
    if ((this.#pos & 3) === 0) {
      const [w, h] = [this.#w, this.#h];
      let pos = this.#pos;
      for (let i = from; i < end; i += 1) {
        w[pos >> 2] = words[i] ?? 0;
        pos += 4;
        if (pos === BLOCK_BYTES) {
          rounds(h, w);
          pos = 0;
        }
      }
      this.#pos = pos;
    } else {
      for (let i = from; i < end; i += 1) {
        const word = words[i] ?? 0;
        for (let shift = 24; shift >= 0; shift -= 8) this.#put((word >>> shift) & 0xff);
      }
    }
    this.#bytes += count * 4;
  }

  /** Starts a new message: the writer as freshly made. */
  reset(): this {
    this.#h.set(H0);
    [this.#pos, this.#bytes, this.#high, this.#done] = [0, 0, -1, false];
    return this;
  }

  /** The digest in lowercase hex. */
  hex(): string {
    return hexOf(this.#finish());
  }

  /** The digest as its 32 raw bytes, held as 8 big-endian 32-bit words (a fresh array on every call). */
  words(): Int32Array {
    return this.#finish().slice();
  }

  /** Writes the digest's 8 words into `out` from index `at`. */
  wordsInto(out: Int32Array, at: number): void {
    out.set(this.#finish(), at);
  }

  /**
   * Ends the message once (FIPS 180-4 §5.1.1 padding: 0x80, zeros up to the length field, then the length in bits
   * as a 64-bit big-endian, here two words); returns the final chaining state, the digest's words. The word that
   * holds the 0x80 has zeros after it (the first byte written into a word clears it), so padding is whole words.
   */
  #finish(): Int32Array {
    if (this.#done) return this.#h;
    if (this.#high >= 0) this.#putCodePoint(REPLACEMENT_CHARACTER);
    this.#high = -1;
    const bits = this.#bytes * 8;
    this.#put(0x80);
    const w = this.#w;
    let next = (this.#pos + 3) >> 2;
    if (next > LENGTH_WORD) {
      w.fill(0, next);
      rounds(this.#h, w);
      next = 0;
    }
    w.fill(0, next, LENGTH_WORD);
    w[LENGTH_WORD] = Math.floor(bits / TWO_POW_32);
    w[LENGTH_WORD + 1] = bits >>> 0;
    rounds(this.#h, w);
    this.#done = true;
    return this.#h;
  }

  /** Completes a high surrogate left by the last write, if any; returns where this write continues. */
  #resume(text: string, start: number): number {
    if (this.#high < 0 || start >= text.length) return start;
    const high = this.#high;
    this.#high = -1;
    const next = text.charCodeAt(start);
    if (!(next >= 0xdc00 && next <= 0xdfff)) {
      this.#putCodePoint(REPLACEMENT_CHARACTER);
      return start;
    }
    this.#putCodePoint(combine(high, next));
    return start + 1;
  }

  /**
   * Writes the ASCII code units from `from` on, up to the first non-ASCII one or the end: four at a time as one
   * word while the block stands on a word boundary, one byte at a time otherwise. Returns where it stopped.
   */
  #ascii(text: string, from: number): number {
    const w = this.#w;
    const length = text.length;
    let pos = this.#pos;
    let i = from;
    while (i < length) {
      if ((pos & 3) === 0 && length - i >= 4) {
        const c0 = text.charCodeAt(i);
        const c1 = text.charCodeAt(i + 1);
        const c2 = text.charCodeAt(i + 2);
        const c3 = text.charCodeAt(i + 3);
        if ((c0 | c1 | c2 | c3) < 0x80) {
          w[pos >> 2] = (c0 << 24) | (c1 << 16) | (c2 << 8) | c3;
          i += 4;
          pos += 4;
          if (pos === BLOCK_BYTES) {
            rounds(this.#h, w);
            pos = 0;
          }
          continue;
        }
      }
      if (text.charCodeAt(i) >= 0x80) break;
      this.#pos = pos;
      pos = this.#put(text.charCodeAt(i));
      i += 1;
    }
    this.#pos = pos;
    this.#bytes += i - from;
    return i;
  }

  /** Writes the code point at a non-ASCII code unit (a final high surrogate waits for the next write). */
  #nonAscii(text: string, i: number): number {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 === text.length) {
      this.#high = unit;
      return i + 1;
    }
    const code = codePointAt(text, i);
    this.#putCodePoint(code);
    return i + (code >= 0x10000 ? 2 : 1);
  }

  #putCodePoint(code: number): void {
    this.#bytes += utf8Length(code);
    encodeCodePoint(code, (byte) => this.#put(byte));
  }

  /**
   * Writes one byte into its word of the pending block (not counted in the length), compressing a full block;
   * returns the next position. The first byte of a word overwrites the word, so no block is ever cleared.
   */
  #put(byte: number): number {
    const pos = this.#pos;
    const shift = 24 - ((pos & 3) << 3);
    const k = pos >> 2;
    this.#w[k] = (pos & 3) === 0 ? byte << shift : (this.#w[k] ?? 0) | (byte << shift);
    if (pos + 1 < BLOCK_BYTES) {
      this.#pos = pos + 1;
    } else {
      rounds(this.#h, this.#w);
      this.#pos = 0;
    }
    return this.#pos;
  }
}

/** The lowercase hex of a digest's 8 words. */
function hexOf(words: Int32Array): string {
  let hex = '';
  for (const word of words) {
    hex += `${HEX[(word >>> 24) & 0xff] ?? ''}${HEX[(word >>> 16) & 0xff] ?? ''}`;
    hex += `${HEX[(word >>> 8) & 0xff] ?? ''}${HEX[word & 0xff] ?? ''}`;
  }
  return hex;
}

/** The block `sha256OfDigests` fills; `rounds` reads it before returning. */
const DIGEST_BLOCK = new Int32Array(BLOCK_WORDS);

/**
 * Lowercase hex SHA-256 of the concatenation of `count` digests, the i-th being the DIGEST_WORDS words of `table`
 * from `rows[i] * DIGEST_WORDS` (each word four big-endian bytes): exactly what writing them through a
 * `Sha256Writer` gives, two digests to a block and then the FIPS 180-4 padding block.
 */
export function sha256OfDigests(table: Int32Array, rows: ArrayLike<number>, count: number): string {
  const h = H0.slice();
  const block = DIGEST_BLOCK;
  let filled = 0;
  for (let i = 0; i < count; i += 1) {
    const from = (rows[i] ?? 0) * DIGEST_WORDS;
    for (let j = 0; j < DIGEST_WORDS; j += 1) block[filled + j] = table[from + j] ?? 0;
    filled += DIGEST_WORDS;
    if (filled === BLOCK_WORDS) {
      rounds(h, block);
      filled = 0;
    }
  }
  const bits = count * DIGEST_WORDS * 32;
  block[filled] = 0x80000000 | 0;
  block.fill(0, filled + 1, LENGTH_WORD);
  block[LENGTH_WORD] = Math.floor(bits / TWO_POW_32);
  block[LENGTH_WORD + 1] = bits >>> 0;
  rounds(h, block);
  return hexOf(h);
}

/** The writer of one-shot hashes, reset before each (all synchronous: no hash ever sees another's state). */
const ONE_SHOT = new Sha256Writer();

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text` (lone surrogates as U+FFFD). */
export function sha256Utf8Hex(text: string): string {
  const writer = ONE_SHOT.reset();
  writer.write(text);
  return writer.hex();
}

/**
 * UTF-8 bytes of a JavaScript string. A lone surrogate becomes U+FFFD, exactly as TextEncoder and Node's
 * Buffer do, so hashes match every other implementation.
 */
export function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = codePointAt(text, i);
    if (code >= 0x10000) i += 1;
    encodeCodePoint(code, (byte) => bytes.push(byte));
  }
  return Uint8Array.from(bytes);
}
