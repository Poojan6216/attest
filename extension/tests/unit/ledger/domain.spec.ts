/**
 * Domains for what a share shows (src/ledger/domain.ts; sprint_4 close, security review SEC-1, QA review GAP 1). A
 * person's counterparty gives a domain only from an address: a name written with a dot ("A.Kumar", "J.Smith") is no
 * domain. A merchant written as a domain keeps it. A share's hint keeps its words, with any address written as its
 * domain and any other word holding an `@` left out. The digest's notable receipt holds a domain's shape only. Every
 * value is invented.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addressDomain, Domain, merchantDomain, withoutAddresses } from '../../../src/ledger/domain';
import { NotableReceipt } from '../../../src/ledger/types';
import { ulid } from './fixtures';

describe('addressDomain', () => {
  it('gives the domain of an address, lower case', () => {
    expect(addressDomain('priya@Company.Example')).toBe('company.example');
    expect(addressDomain('Sam Lee <sam.lee@partner.example>'.slice(9, -1))).toBe('partner.example');
  });

  it.each([
    'A.Kumar',
    'J.Smith',
    'Mr.Smith',
    'Priya.S',
    'Dr.Who',
    'supplier.example',
    'Corner Shop',
    'Priya',
    '',
  ])('gives none for "%s": not an address', (value) => {
    expect(addressDomain(value)).toBeUndefined();
  });

  it.each([
    '@company.example',
    'priya@',
    'priya@company',
    'priya@-bad.example',
    'priya@1.2',
    'priya@a_b.example',
  ])('gives none for "%s": no domain after the @', (value) => {
    expect(addressDomain(value)).toBeUndefined();
  });

  it('gives none for nothing', () => {
    expect(addressDomain(undefined)).toBeUndefined();
  });
});

describe('merchantDomain', () => {
  it('keeps a merchant written as a domain, or an address’s domain, and nothing of a name', () => {
    expect(merchantDomain('Amazon.com')).toBe('amazon.com');
    expect(merchantDomain('receipts@shop.example')).toBe('shop.example');
    expect(merchantDomain('Corner Shop')).toBeUndefined();
    expect(merchantDomain(undefined)).toBeUndefined();
  });
});

describe('withoutAddresses', () => {
  it.each([
    ['Lunch with priya@company.example', 'Lunch with company.example'],
    ['Contract for sam.lee@partner.example.', 'Contract for partner.example'],
    ['RE: <ops@vendor.example>, invoice', 'RE: vendor.example invoice'],
    ['ping @priya about it', 'ping … about it'],
    ['mail me at priya@company', 'mail me at …'],
    ['Q3 deck - final', 'Q3 deck - final'],
  ])('writes "%s" as "%s"', (hint, shared) => {
    expect(withoutAddresses(hint)).toBe(shared);
  });

  it('never leaves an @, whatever the hint holds', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (hint) => {
        expect(withoutAddresses(hint)).not.toContain('@');
      }),
      { numRuns: 2000 },
    );
  });
});

describe('a digest’s notable receipt', () => {
  const notable = { receiptId: ulid(3), agent: 'muse', grade: 'NOT_FOUND' } as const;

  it.each(['priya@company.example', 'Priya Raman', 'a b.example', '-x.example'])(
    'refuses "%s" as a domain',
    (domain) => {
      expect(NotableReceipt.safeParse({ ...notable, domain }).success).toBe(false);
    },
  );

  it('keeps a domain', () => {
    expect(NotableReceipt.parse({ ...notable, domain: 'company.example' }).domain).toBe('company.example');
    expect(Domain.safeParse('company.example').success).toBe(true);
  });
});
