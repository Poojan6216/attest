/**
 * Punycode (RFC 3492) decoding, for DISPLAY ONLY (docs/grading.md §11).
 *
 * An IDN domain arrives as ASCII labels starting with `xn--` ("ACE" labels). Attest never compares or
 * stores the decoded form: addresses are compared exactly as read (normalize.ts), and an `xn--` label makes
 * an address `confusable`. This module only turns `xn--pple-43d.com` into `аpple.com` (Cyrillic а) so a UI
 * can show the user what the label spells.
 *
 * Pure and synchronous. Exempt from the core no-literal rule: the numbers are the RFC 3492 §5 bootstring
 * parameters for Punycode, its §6.4 overflow bound, and the ASCII code points of its digit alphabet.
 */

/** RFC 3492 §5: base, tmin, tmax, skew, damp, initial_bias, initial_n. */
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 0x80;
const DELIMITER = '-';

/** §6.4: arithmetic never exceeds this (the RFC's maxint for 32-bit implementations). */
const MAX_INT = 0x7fffffff;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

/** Digit alphabet (§5): a–z / A–Z are 0–25, 0–9 are 26–35. */
const CODE_DIGIT_0 = 0x30;
const CODE_DIGIT_9 = 0x39;
const CODE_UPPER_A = 0x41;
const CODE_UPPER_Z = 0x5a;
const CODE_LOWER_A = 0x61;
const CODE_LOWER_Z = 0x7a;
const DIGIT_VALUE_OF_0 = 26;

/** RFC 5891 §5.1: the ACE prefix, matched ASCII-case-insensitively (a non-`u` regex never folds non-ASCII). */
const ACE_PREFIX = /^xn--/i;
const ACE_PREFIX_LENGTH = 4;

export type PunycodeErrorCode = 'invalid_input' | 'overflow';

export class PunycodeError extends Error {
  constructor(readonly code: PunycodeErrorCode) {
    super(`punycode: ${code}`);
    this.name = 'PunycodeError';
  }
}

function digitValue(codeUnit: number): number {
  if (codeUnit >= CODE_DIGIT_0 && codeUnit <= CODE_DIGIT_9) return codeUnit - CODE_DIGIT_0 + DIGIT_VALUE_OF_0;
  if (codeUnit >= CODE_UPPER_A && codeUnit <= CODE_UPPER_Z) return codeUnit - CODE_UPPER_A;
  if (codeUnit >= CODE_LOWER_A && codeUnit <= CODE_LOWER_Z) return codeUnit - CODE_LOWER_A;
  return BASE;
}

/** §6.1 bias adaptation. */
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let scaled = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  scaled += Math.floor(scaled / numPoints);
  let k = 0;
  while (scaled > Math.floor(((BASE - T_MIN) * T_MAX) / 2)) {
    scaled = Math.floor(scaled / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
}

function threshold(k: number, bias: number): number {
  if (k <= bias + T_MIN) return T_MIN;
  if (k >= bias + T_MAX) return T_MAX;
  return k - bias;
}

/** Reads one generalized variable-length integer (§3.3) starting at `start`; returns the new i and index. */
function readDelta(input: string, start: number, i: number, bias: number): { i: number; index: number } {
  let index = start;
  let value = i;
  let weight = 1;
  for (let k = BASE; ; k += BASE) {
    if (index >= input.length) throw new PunycodeError('invalid_input');
    const digit = digitValue(input.charCodeAt(index));
    index += 1;
    if (digit >= BASE) throw new PunycodeError('invalid_input');
    if (digit > Math.floor((MAX_INT - value) / weight)) throw new PunycodeError('overflow');
    value += digit * weight;
    const t = threshold(k, bias);
    if (digit < t) return { i: value, index };
    if (weight > Math.floor(MAX_INT / (BASE - t))) throw new PunycodeError('overflow');
    weight *= BASE - t;
  }
}

/**
 * RFC 3492 §6.2 decoding of the part after `xn--`. Throws `PunycodeError` for input that is not valid
 * Punycode, overflows, or decodes to a surrogate or a value beyond U+10FFFF.
 */
export function decodePunycode(input: string): string {
  const output: number[] = [];
  const basicLength = Math.max(input.lastIndexOf(DELIMITER), 0);
  for (let j = 0; j < basicLength; j += 1) {
    const codeUnit = input.charCodeAt(j);
    if (codeUnit >= INITIAL_N) throw new PunycodeError('invalid_input');
    output.push(codeUnit);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let index = basicLength > 0 ? basicLength + 1 : 0;
  while (index < input.length) {
    const previous = i;
    ({ i, index } = readDelta(input, index, i, bias));
    const length = output.length + 1;
    bias = adapt(i - previous, length, previous === 0);
    if (Math.floor(i / length) > MAX_INT - n) throw new PunycodeError('overflow');
    n += Math.floor(i / length);
    i %= length;
    if (n > MAX_CODE_POINT || (n >= SURROGATE_FIRST && n <= SURROGATE_LAST)) {
      throw new PunycodeError('invalid_input');
    }
    output.splice(i, 0, n);
    i += 1;
  }
  return output.map((codePoint) => String.fromCodePoint(codePoint)).join('');
}

/** True for an IDNA ACE label (`xn--…`, any ASCII case). Such a label makes an address confusable (§11). */
export function isAceLabel(label: string): boolean {
  return ACE_PREFIX.test(label);
}

/** One label for display: an ACE label decoded, any other label unchanged. Throws `PunycodeError`. */
export function decodeLabel(label: string): string {
  return isAceLabel(label) ? decodePunycode(label.slice(ACE_PREFIX_LENGTH)) : label;
}

/**
 * A domain for display: each valid ACE label decoded, every other label (including an invalid ACE label)
 * shown exactly as read. Never used for comparison.
 */
export function toUnicodeDomain(domain: string): string {
  return domain
    .split('.')
    .map((label) => {
      try {
        return decodeLabel(label);
      } catch (error) {
        if (error instanceof PunycodeError) return label;
        throw error;
      }
    })
    .join('.');
}
