/**
 * Task 1.5 perf-pass reference properties (fast-check, 5,000 runs each), split from normalize.property.spec.ts
 * (TECH-R7): the faster paths in normalize-text.ts equal the plain §11 definitions written out here.
 *  - name(), nameTokens() and subjectTokens(): the ASCII fast path equals the general folding.
 *  - email(): the dot-atom check equals splitting on dots.
 * The references read Unicode as the readers must (§11, Decisions [SEC-1]): Unicode 15.0's character classes
 * (`BASELINE_CLASS`), the engine's NFKC only on text `asBaseline` / `onBaseline` prepared, and `lowerBaseline`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { email, type EmailAddress, name, nameTokens, subjectTokens } from '../../src/core/normalize';
import { readsDifferently, stripInvisible } from '../../src/core/normalize-text';
import { isAceLabel } from '../../src/core/punycode';
import {
  asBaseline,
  BASELINE_CLASS,
  lowerBaseline,
  onBaseline,
  trimBaseline,
} from '../../src/core/unicode-baseline';

const NONSPACING_MARK = new RegExp(`[${BASELINE_CLASS.nonspacingMark}]`, 'gu');
const WHITESPACE_RUN = new RegExp(`[${BASELINE_CLASS.space}${BASELINE_CLASS.whiteSpace}]+`, 'gu');
const NOT_TOKEN = new RegExp(`[^${BASELINE_CLASS.token}]+`, 'u');
const ADDRESS_FORBIDDEN = new RegExp(`[${BASELINE_CLASS.space}\\p{Cc}()<>[\\]\\\\,;:"]`, 'u');

/**
 * name(), nameTokens() and subjectTokens() as §11 defines them for any text (the implementation before the ASCII
 * fast path): the reference both paths must equal.
 */
function referenceName(raw: string): string {
  return onBaseline(raw, (text) => {
    if (readsDifferently(text)) return '';
    const compatible = stripInvisible(stripInvisible(text).normalize('NFKC'));
    const folded = lowerBaseline(compatible).normalize('NFD').replace(NONSPACING_MARK, '').normalize('NFC');
    return trimBaseline(folded.replace(WHITESPACE_RUN, ' '));
  });
}
function referenceNameTokens(raw: string): string[] {
  return [
    ...new Set(
      referenceName(raw)
        .split(NOT_TOKEN)
        .filter((token) => token !== ''),
    ),
  ];
}
function referenceSubjectTokens(raw: string, stopWords: readonly string[]): string[] {
  if (/[\u202A\u202B\u202D\u202E]/u.test(raw)) return [];
  const tokens = lowerBaseline(stripInvisible(asBaseline(raw)).normalize('NFKC'))
    .split(NOT_TOKEN)
    .filter((token) => token !== '');
  const first = tokens.findIndex((token) => !['re', 'fw', 'fwd'].includes(token));
  const body = first < 0 ? [] : tokens.slice(first);
  const stop = new Set(stopWords.map((word) => lowerBaseline(asBaseline(word).normalize('NFKC'))));
  return [...new Set(body.filter((token) => !stop.has(token)))].sort();
}

describe('name(), nameTokens(), subjectTokens(): the ASCII path equals the general folding (property)', () => {
  const asciiText = fc.oneof(
    fc.string({ unit: 'binary-ascii', maxLength: 60 }),
    fc.string({
      unit: fc.constantFrom(...Array.from('Re: FW fwd Priya.SHAH_x-1 \t\n\u000b\f\r\u0000\u001f\u007f')),
      maxLength: 40,
    }),
  );
  const anyText = fc.oneof(asciiText, fc.string({ unit: 'binary', maxLength: 40 }));
  const stopWords = fc.array(fc.oneof(fc.constantFrom('the', 'RE', 'invoice'), fc.string({ maxLength: 6 })), {
    maxLength: 4,
  });

  it('gives the reference result for ASCII and for any other text', () => {
    fc.assert(
      fc.property(anyText, stopWords, (raw, stop) => {
        expect(name(raw)).toBe(referenceName(raw));
        expect(nameTokens(raw)).toEqual(referenceNameTokens(raw));
        expect(subjectTokens(raw, stop)).toEqual(referenceSubjectTokens(raw, stop));
      }),
      { numRuns: 5_000 },
    );
  });
});

/** email() as §11 defines it (dot-atom parts checked by splitting), the reference for the faster checks. */
function referenceEmail(raw: string): EmailAddress | null {
  const text = trimBaseline(raw);
  let address: string | null = text;
  if (text.endsWith('>')) {
    const open = text.lastIndexOf('<');
    const display = open < 0 ? '<' : text.slice(0, open).replace(/"(?:[^"\\]|\\.)*"/gu, '');
    address = /[<>]/.test(display) ? null : trimBaseline(text.slice(open + 1, -1));
  }
  if (address === null || ADDRESS_FORBIDDEN.test(address)) return null;
  const at = address.indexOf('@');
  if (at < 0 || at !== address.lastIndexOf('@')) return null;
  const [local, domain] = [address.slice(0, at), address.slice(at + 1)];
  const dotted = (part: string) => part.split('.').every((piece) => piece !== '');
  if (!dotted(local) || !dotted(domain) || !domain.includes('.')) return null;
  const confusable = /\P{ASCII}/u.test(address) || domain.split('.').some(isAceLabel);
  const plus = local.indexOf('+', 1);
  if (plus < 0) return { address, local, domain, baseLocal: local, confusable };
  return {
    address,
    local,
    domain,
    baseLocal: local.slice(0, plus),
    plusTag: local.slice(plus + 1),
    confusable,
  };
}

describe('email(): the dot-atom check equals splitting on dots (property)', () => {
  it('gives the reference result for address-shaped text', () => {
    const shaped = fc.string({ unit: fc.constantFrom(...Array.from('ab.@+x-<> "Z\u00E9')), maxLength: 24 });
    fc.assert(
      fc.property(fc.oneof(shaped, fc.string({ maxLength: 24 })), (raw) => {
        expect(email(raw)).toEqual(referenceEmail(raw));
      }),
      { numRuns: 5_000 },
    );
  });
});
