/**
 * Task 1.4: the content features (docs/grading.md §5.1, §11): subjectOverlap (Jaccard over §11 subject
 * tokens), amountExact (amount and both currencies), merchantMatch (normalised name, else token Jaccard).
 * Every non-ASCII input is a \u escape (Decisions [1.1]).
 */
import { describe, expect, it } from 'vitest';

import {
  amountExact,
  jaccard,
  merchantMatch,
  merchantName,
  type Money,
  subjectOverlap,
  subjectTokenSet,
} from '../../../src/core/features-content';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { Ratio } from '../../../src/core/ratio';

const text = (value: Ratio): string => `${value.num}/${value.den}`;
const STOP = DEFAULT_POLICY.normalize.stopWords;

describe('jaccard()', () => {
  it.each([
    [['q3', 'deck'], ['q3', 'budget'], '1/3'],
    [['q3', 'deck'], ['q3', 'deck'], '1/1'],
    [['q3', 'deck'], ['q3', 'budget', 'plan'], '1/4'],
    [['a'], ['b'], '0/1'],
    [['a'], [], '0/1'],
    [[], [], '0/1'],
    [['a', 'a', 'b'], ['b', 'b'], '1/2'],
  ] as const)('%j vs %j is %s', (a, b, expected) => {
    expect(text(jaccard(a, b))).toBe(expected);
    expect(text(jaccard(b, a))).toBe(expected);
  });
});

/** [label, claim subject, observation subject, value]. */
const SUBJECT_ROWS: readonly (readonly [string, string, string | undefined, string])[] = [
  ['identical', 'Q3 deck', 'Q3 deck', '1/1'],
  ['one shared of three (golden 02)', 'Q3 deck', 'Q3 budget', '1/3'],
  ['one shared of four (golden 30)', 'Q3 deck', 'Q3 budget plan', '1/4'],
  ['leading Re/Fwd stripped, stop word dropped', 'Invoice', 'RE: Fwd: The invoice', '1/1'],
  ['a non-leading re is a token (golden 60)', 'Invoice', 'Invoice re: Q3', '1/3'],
  ['fullwidth folded by NFKC', 'Q3 deck', '\uFF31\uFF13 deck', '1/1'],
  ['case and punctuation ignored', 'q3-deck!', 'Q3 DECK', '1/1'],
  ['nothing shared', 'Q3 deck', 'Lunch', '0/1'],
  ['observation has no subject', 'Q3 deck', undefined, '0/1'],
  ['observation subject has only stop words', 'Q3 deck', 'the and of', '0/1'],
  ['observation subject is empty', 'Q3 deck', '', '0/1'],
];

describe('subjectOverlap()', () => {
  it.each(SUBJECT_ROWS)('%s', (_label, claimed, observed, value) => {
    expect(text(subjectOverlap(subjectTokenSet(claimed, STOP), observed, STOP))).toBe(value);
  });

  it('a claim with no tokens scores 0 (features() also drops it as not applicable)', () => {
    expect(text(subjectOverlap([], 'Q3 deck', STOP))).toBe('0/1');
    expect(subjectTokenSet(undefined, STOP)).toEqual([]);
    expect(subjectTokenSet('Re: the', STOP)).toEqual([]);
  });

  it('reads the stop words from the policy', () => {
    const claimed = subjectTokenSet('deck', []);
    expect(text(subjectOverlap(claimed, 'the deck', STOP))).toBe('1/1');
    expect(text(subjectOverlap(claimed, 'the deck', []))).toBe('1/2');
  });
});

/** [label, claim money, observation money, value]. */
const AMOUNT_ROWS: readonly (readonly [string, Money, Money, string])[] = [
  [
    'equal amount and currency',
    { amountCents: 3000, currency: 'USD' },
    { amountCents: 3000, currency: 'USD' },
    '1/1',
  ],
  ['different amount', { amountCents: 3000, currency: 'USD' }, { amountCents: 3001, currency: 'USD' }, '0/1'],
  [
    'different currency (golden 63)',
    { amountCents: 3000, currency: 'USD' },
    { amountCents: 3000, currency: 'CAD' },
    '0/1',
  ],
  [
    'observation has no currency (golden 63)',
    { amountCents: 3000, currency: 'USD' },
    { amountCents: 3000 },
    '0/1',
  ],
  ['claim has no currency', { amountCents: 3000 }, { amountCents: 3000, currency: 'USD' }, '0/1'],
  ['neither has a currency', { amountCents: 3000 }, { amountCents: 3000 }, '0/1'],
  ['observation has no amount', { amountCents: 3000, currency: 'USD' }, { currency: 'USD' }, '0/1'],
  ['zero equals zero', { amountCents: 0, currency: 'JPY' }, { amountCents: 0, currency: 'JPY' }, '1/1'],
  ['claim has no amount', { currency: 'USD' }, { currency: 'USD' }, '0/1'],
];

describe('amountExact()', () => {
  it.each(AMOUNT_ROWS)('%s', (_label, claimed, observed, value) => {
    expect(text(amountExact(claimed, observed))).toBe(value);
  });
});

/** [label, claim counterparty, observation merchant, value]. */
const MERCHANT_ROWS: readonly (readonly [string, string, string | undefined, string])[] = [
  ['normalised names equal (golden 63)', 'acme store', 'Acme Store', '1/1'],
  ['token Jaccard (golden 63)', 'acme store', 'Acme', '1/2'],
  ['equal after NFKC, diacritics and whitespace', 'Caf\u00E9  Nero', 'cafe nero', '1/1'],
  ['nothing shared', 'acme', 'Globex', '0/1'],
  ['observation has no merchant', 'acme', undefined, '0/1'],
  ['observation merchant has no tokens', 'acme', '---', '0/1'],
  ['observation merchant is a broken address', 'acme', 'acme@', '0/1'],
  ['observation merchant holds a bidi override', 'acme', '\u202Eemca', '0/1'],
  ['token sets equal, names not', 'acme.com', 'acme com', '1/1'],
];

describe('merchantMatch()', () => {
  it.each(MERCHANT_ROWS)('%s', (_label, claimed, observed, value) => {
    const name = merchantName(claimed);
    if (name === null) throw new Error(`claim merchant has no tokens: ${claimed}`);
    expect(text(merchantMatch(name, observed))).toBe(value);
  });

  it.each([
    ['absent', undefined],
    ['blank', '   '],
    ['no tokens', '!!!'],
    ['a broken address', 'orders@'],
    ['a bidi override', '\u202Eemca'],
  ])('a claim counterparty that is %s is no merchant name', (_label, raw) => {
    expect(merchantName(raw)).toBeNull();
  });

  it('normalises like name(): NFKC, lowercase, diacritics folded', () => {
    expect(merchantName('  Caf\u00E9   NERO ')).toEqual({ name: 'cafe nero', tokens: ['cafe', 'nero'] });
  });
});
