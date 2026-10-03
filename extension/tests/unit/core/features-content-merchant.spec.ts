/**
 * QA-R9 (fast-check, 2,000 runs each): the batch path scores `merchantMatch` as the Jaccard of two
 * `prepareMerchant` token sets (features-parts.ts) and never compares the normalised names §5.1 names. This pins
 * that shortcut to §5.1's `merchantMatchName` (1 iff the normalised names are equal, else the Jaccard of the name
 * tokens): equal names always have equal, non-empty token sets. Every non-ASCII input is a \u escape
 * (Decisions [1.1]).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  jaccardOf,
  merchantMatchName,
  merchantName,
  prepareMerchant,
} from '../../../src/core/features-content';
import { type Ratio, ratioOf } from '../../../src/core/ratio';

const RUNS = { numRuns: 2_000 };
const text = (value: Ratio): string => `${value.num}/${value.den}`;

/** Words, case and diacritic variants, separators, invisible marks, and text `counterparty()` refuses. */
const PIECES = [
  ...'Acme|ACME|acme|Store|STORE|Nero|nero|Caf\u00E9|cafe|CAFE\u0301|the|&|-|.|,|1|2'.split('|'),
  ...' |  |\t|\u00A0|\u3000|\u200B|\u200D|\uFEFF|\u00AD|\uFF21cme|\u212A|\u0130|\u00B2|\u202E|\u202A'.split(
    '|',
  ),
  ...'@|<|>|p@x.com|"P" <p@x.com>|\u{1CCF1}|\u{2EBF0}|\u{1D400}|\''.split('|'),
];
const anyMerchant = fc.oneof(
  fc.array(fc.constantFrom(...PIECES), { maxLength: 6 }).map((parts) => parts.join('')),
  fc.string({ maxLength: 12 }),
  fc.constant(undefined),
);

/** Ways to write the same name differently: case, spacing, diacritics, width, invisible marks. */
const RESPELL: readonly ((word: string) => string)[] = [
  (word) => word.toUpperCase(),
  (word) => word.toLowerCase(),
  (word) => word.normalize('NFD'),
  (word) => `\u200B${word}`,
  (word) => word.replace('A', '\uFF21'),
  (word) => word.replace('\u00E9', 'e'),
];
const WORDS = ['Acme', 'Store', 'Caf\u00E9', 'Nero', 'the', 'Q3'];
/** A merchant and the same merchant written another way, or with a word added or dropped. */
const relatedPair = fc
  .tuple(
    fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 4 }),
    fc.array(fc.constantFrom(...RESPELL), { minLength: 4, maxLength: 4 }),
    fc.constantFrom(' ', '  ', '\u00A0', ' \t'),
    fc.constantFrom('', ' Ltd', ' Store'),
  )
  .map(([words, respell, gap, extra]): [string, string] => [
    words.join(' '),
    words.map((word, i) => (respell[i] ?? String)(word)).join(gap) + extra,
  ]);
const pair = fc.oneof(fc.tuple(anyMerchant, anyMerchant), relatedPair);

describe('merchantMatch over prepared merchants equals merchantMatchName, the grading.md 5.1 rule (property)', () => {
  it('prepares exactly the merchants merchantName reads, with the same tokens', () => {
    fc.assert(
      fc.property(anyMerchant, (raw) => {
        const named = merchantName(raw);
        const prepared = prepareMerchant(raw);
        expect(prepared === null).toBe(named === null);
        if (named !== null) expect(prepared?.tokens).toEqual(new Set(named.tokens));
      }),
      RUNS,
    );
  });

  it('gives the Jaccard of the prepared token sets as merchantMatchName gives the pair', () => {
    const seen = { sameNameOtherText: 0, partial: 0 };
    fc.assert(
      fc.property(pair, ([claimRaw, observedRaw]) => {
        const [claimed, observed] = [merchantName(claimRaw), merchantName(observedRaw)];
        const [a, b] = [prepareMerchant(claimRaw), prepareMerchant(observedRaw)];
        if (claimed === null || a === null) return;
        const shortcut = b === null ? '0/1' : text(ratioOf(jaccardOf(a.tokens, b.tokens)));
        const defined = text(merchantMatchName(claimed, observed));
        expect(shortcut).toBe(defined);
        if (claimRaw !== observedRaw && claimed.name === observed?.name) seen.sameNameOtherText += 1;
        if (defined !== '0/1' && defined !== '1/1') seen.partial += 1;
      }),
      RUNS,
    );
    // Both branches of §5.1 ran: equal names from different text, and a partial token overlap.
    expect(seen.sameNameOtherText).toBeGreaterThan(0);
    expect(seen.partial).toBeGreaterThan(0);
  });
});
