/**
 * Task 1.4: the counterparty features (docs/grading.md §5.1, §11). Addresses are compared code point by code
 * point after ASCII-only lowercasing; confusables never match unless identical; +tags are reported; free mail
 * alone says nothing; names match only the address local part, never the display name.
 * Every non-ASCII input is a \u escape (no raw bidi or confusable glyphs in source, Decisions [1.1]).
 */
import { describe, expect, it } from 'vitest';

import { features } from '../../../src/core/features';
import {
  addressFeatures,
  localPartTokens,
  nameFeature,
  observedAddress,
} from '../../../src/core/features-counterparty';
import { email, type EmailAddress, nameTokens } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { Ratio } from '../../../src/core/ratio';

const text = (value: Ratio): string => `${value.num}/${value.den}`;
const COMMON = DEFAULT_POLICY.commonDomains;

function address(raw: string): EmailAddress {
  const parsed = email(raw);
  if (parsed === null) throw new Error(`not an address: ${raw}`);
  return parsed;
}

/** [label, claim address, observation counterparty, exact, domain, reason]. */
const ADDRESS_ROWS: readonly (readonly [
  string,
  string,
  string | undefined,
  string,
  string,
  string | null,
])[] = [
  ['identical', 'priya@company.com', 'priya@company.com', '1/1', '1/1', null],
  ['ASCII case only', 'Priya@Company.com', 'priya@company.COM', '1/1', '1/1', null],
  ['same company domain', 'priya@company.com', 'raj@company.com', '0/1', '1/1', null],
  ['same free-mail domain alone', 'priya@gmail.com', 'raj@gmail.com', '0/1', '0/1', null],
  ['free-mail exact match', 'priya@gmail.com', 'priya@gmail.com', '1/1', '1/1', null],
  ['free-mail, ASCII case only', 'Priya@GMAIL.com', 'priya@gmail.com', '1/1', '1/1', null],
  ['+tag on a company domain', 'priya@company.com', 'priya+agent@company.com', '0/1', '1/1', 'cp.plus_tag'],
  ['+tag on free mail', 'priya@gmail.com', 'priya+x@gmail.com', '0/1', '1/1', 'cp.plus_tag'],
  ['+tag on the claim side', 'priya+x@company.com', 'priya@company.com', '0/1', '1/1', 'cp.plus_tag'],
  ['different domain', 'priya@company.com', 'priya@other.com', '0/1', '0/1', null],
  ['dotless i (U+0131)', 'priya@company.com', 'pr\u0131ya@company.com', '0/1', '0/1', 'cp.confusable'],
  ['Cyrillic a on the claim', 'priy\u0430@company.com', 'priya@company.com', '0/1', '0/1', 'cp.confusable'],
  ['Kelvin sign (U+212A)', 'kate@company.com', '\u212Aate@company.com', '0/1', '0/1', 'cp.confusable'],
  ['math bold p (U+1D429)', 'priya@company.com', '\u{1D429}riya@company.com', '0/1', '0/1', 'cp.confusable'],
  ['fullwidth p (U+FF50)', 'priya@company.com', '\uFF50riya@company.com', '0/1', '0/1', 'cp.confusable'],
  ['xn-- domain vs ASCII', 'priya@company.com', 'priya@xn--cmpany-u2a.com', '0/1', '0/1', 'cp.confusable'],
  [
    'NFC vs NFD (never normalised)',
    'jos\u00E9@company.com',
    'jose\u0301@company.com',
    '0/1',
    '0/1',
    'cp.confusable',
  ],
  ['identical non-ASCII', 'jos\u00E9@company.com', 'jos\u00E9@company.com', '1/1', '1/1', 'cp.non_ascii'],
  [
    'identical xn-- address',
    'priya@xn--mnchen-3ya.de',
    'priya@xn--mnchen-3ya.de',
    '1/1',
    '1/1',
    'cp.non_ascii',
  ],
  [
    'identical xn--, ASCII case only',
    'priya@XN--mnchen-3ya.de',
    'priya@xn--mnchen-3ya.de',
    '1/1',
    '1/1',
    'cp.non_ascii',
  ],
  [
    'confusable and +tag: confusable wins',
    'jos\u00E9@company.com',
    'jos\u00E9+x@company.com',
    '0/1',
    '0/1',
    'cp.confusable',
  ],
  ['display-name spoof (name)', 'priya@company.com', '"Priya" <attacker@evil.example>', '0/1', '0/1', null],
  [
    'display-name spoof (address)',
    'priya@company.com',
    '"priya@company.com" <attacker@evil.example>',
    '0/1',
    '0/1',
    null,
  ],
  [
    'display name dropped, address kept',
    'priya@company.com',
    'Priya Kumar <priya@company.com>',
    '1/1',
    '1/1',
    null,
  ],
  ['observation has no counterparty', 'priya@company.com', undefined, '0/1', '0/1', null],
  ['observation counterparty is a name', 'priya@company.com', 'Priya', '0/1', '0/1', null],
];

describe('counterpartyExact and counterpartyDomain (address claims)', () => {
  it.each(ADDRESS_ROWS)('%s', (_label, claimed, observed, exact, domain, reason) => {
    const result = addressFeatures(address(claimed), observedAddress(observed), COMMON);
    expect(text(result.counterpartyExact)).toBe(exact);
    expect(text(result.counterpartyDomain)).toBe(domain);
    expect(result.reason ?? null).toBe(reason);
  });

  it('reads the free-mail list from the policy, not from code', () => {
    const claimed = address('priya@company.com');
    const observed = address('raj@company.com');
    expect(text(addressFeatures(claimed, observed, COMMON).counterpartyDomain)).toBe('1/1');
    expect(text(addressFeatures(claimed, observed, ['company.com']).counterpartyDomain)).toBe('0/1');
  });

  it('is symmetric in score', () => {
    for (const [, claimed, observed] of ADDRESS_ROWS) {
      if (observed === undefined || email(observed) === null) continue;
      const forward = addressFeatures(address(claimed), address(observed), COMMON);
      const backward = addressFeatures(address(observed), address(claimed), COMMON);
      expect(backward).toEqual(forward);
    }
  });
});

/** [label, claim name, observation counterparty, value]. */
const NAME_ROWS: readonly (readonly [string, string, string | undefined, string])[] = [
  ['every token in the local part', 'Priya Kumar', 'priya.kumar@company.com', '1/1'],
  ['a token missing', 'Priya Kumar', 'priya@company.com', '0/1'],
  ['diacritics folded on the name', 'Jos\u00E9', 'jose@company.com', '1/1'],
  ['the local part is never folded', 'Jos\u00E9', 'jos\u00E9@company.com', '0/1'],
  ['+tag removed before splitting', 'Priya', 'priya+agent@company.com', '1/1'],
  ['the +tag is not a token', 'Agent', 'priya+agent@company.com', '0/1'],
  ['ASCII-lowercased, split on underscore', 'priya', 'Priya_Kumar@company.com', '1/1'],
  ['split on hyphen', 'Kumar', 'priya-kumar@company.com', '1/1'],
  ['a prefix is not a token', 'Priya', 'priyakumar@company.com', '0/1'],
  ['the domain is not the local part', 'Company', 'priya@company.com', '0/1'],
  ['dotless i in the local part', 'Priya', 'pr\u0131ya@company.com', '0/1'],
  ['fullwidth p in the local part (never NFKC)', 'Priya', '\uFF50riya@company.com', '0/1'],
  ['display name never used', 'Priya', '"Priya" <attacker@evil.example>', '0/1'],
  ['observation has no counterparty', 'Priya', undefined, '0/1'],
  ['observation counterparty is not an address', 'Priya', 'Priya', '0/1'],
  ['token order does not matter', 'Kumar Priya', 'priya.kumar@company.com', '1/1'],
];

describe('counterpartyName (name claims)', () => {
  it.each(NAME_ROWS)('%s', (_label, claimed, observed, value) => {
    expect(text(nameFeature(nameTokens(claimed), observedAddress(observed)))).toBe(value);
  });

  it('a claim with no tokens never matches', () => {
    expect(text(nameFeature([], address('priya@company.com')))).toBe('0/1');
  });

  it('local-part tokens drop the +tag, lowercase ASCII only, and split on [._-]', () => {
    expect(localPartTokens(address('Priya.Kumar+x@company.com'))).toEqual(['priya', 'kumar']);
    expect(localPartTokens(address('a_b-c@company.com'))).toEqual(['a', 'b', 'c']);
    expect(localPartTokens(address('\u212Aate@company.com'))).toEqual(['\u212Aate']);
  });
});

describe('counterparty features through features()', () => {
  const at = '2026-10-06T14:02:00-04:00';
  const claimFor = (counterparty: string) =>
    ({
      type: 'email.sent',
      counterparty,
      subjectHint: 'Q3 deck',
      claimedAt: at,
      claimedAtPrecision: 'minute',
    }) as const;
  const observationFor = (counterparty: string) => ({ counterparty, subjectHint: 'Q3 deck', occurredAt: at });

  it('a confusable counterparty scores counterpartyExact = 0 with cp.confusable (golden 20)', () => {
    const result = features(
      claimFor('priya@company.com'),
      observationFor('pr\u0131ya@company.com'),
      DEFAULT_POLICY,
    );
    expect(result.signals.counterpartyExact).toBe(0);
    expect(result.signals.counterpartyDomain).toBe(0);
    expect(result.reasonCodes).toEqual(['cp.confusable']);
    expect(text(result.score)).toBe('4/9');
  });

  it('identical xn-- addresses score counterpartyExact = 1 with cp.non_ascii', () => {
    const idn = 'priya@xn--mnchen-3ya.de';
    const result = features(claimFor(idn), observationFor(idn), DEFAULT_POLICY);
    expect(result.signals.counterpartyExact).toBe(1);
    expect(result.reasonCodes).toEqual(['cp.non_ascii']);
    expect(text(result.score)).toBe('1/1');
  });

  it('a free-mail exact match scores 1 (golden 17)', () => {
    const result = features(claimFor('priya@gmail.com'), observationFor('priya@gmail.com'), DEFAULT_POLICY);
    expect(result.signals).toMatchObject({ counterpartyExact: 1, counterpartyDomain: 1 });
    expect(result.reasonCodes).toEqual([]);
    expect(text(result.score)).toBe('1/1');
  });

  it('a +tag difference is PARTIAL, never VERIFIED (golden 15: 11/18)', () => {
    const result = features(
      claimFor('priya@company.com'),
      observationFor('priya+x@company.com'),
      DEFAULT_POLICY,
    );
    expect(result.reasonCodes).toEqual(['cp.plus_tag']);
    expect(text(result.score)).toBe('11/18');
  });

  it('a name claim never reports cp.* reasons, even against a confusable address', () => {
    const result = features(claimFor('Priya'), observationFor('pr\u0131ya@company.com'), DEFAULT_POLICY);
    expect(result.signals.counterpartyName).toBe(0);
    expect(result.reasonCodes).toEqual([]);
    expect(text(result.score)).toBe('8/13');
  });
});
