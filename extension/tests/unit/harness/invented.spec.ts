/**
 * The launch pictures' address check (tests/e2e/support/invented.ts; Sprint 7 close, QA review QA-9): an address at a
 * domain reserved for examples passes; a real one is caught however it is written to be drawn the same, the three forms
 * QA found the old pattern let through among them (an internationalised domain, a zero-width character inside the
 * domain, a fullwidth at sign), and a small at sign, a soft hyphen and a word joiner too. Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import { addressesIn, asDrawn, isReserved, realAddresses } from '../../e2e/support/invented';

describe('the invented-address check', () => {
  it.each([
    'priya@example.com',
    'sam.ortiz+deck@example.org',
    'billing@mail.example.net',
    'vendor@shop.example',
    'Priya@EXAMPLE.COM',
  ])('passes %s, at a reserved domain', (address) => {
    expect(addressesIn(`Sent to ${address} at 4 pm.`)).toEqual([address]);
    expect(realAddresses(`Sent to ${address} at 4 pm.`)).toEqual([]);
  });

  it.each([
    ['an ordinary domain', 'priya@gmail.com', 'priya@gmail.com'],
    ['an internationalised domain', 'priya@bücher.de', 'priya@bücher.de'],
    ['a zero-width space inside the domain', 'priya@gma\u200bil.com', 'priya@gmail.com'],
    ['a fullwidth at sign', 'priya\uff20gmail.com', 'priya@gmail.com'],
    ['a small at sign', 'priya\ufe6bgmail.com', 'priya@gmail.com'],
    ['a soft hyphen', 'pri\u00adya@gmail.com', 'priya@gmail.com'],
    ['a word joiner before the dot', 'priya@gmail\u2060.com', 'priya@gmail.com'],
    [
      'a reserved name as a subdomain of a real one',
      'priya@example.com.evil.net',
      'priya@example.com.evil.net',
    ],
    ['a lookalike reserved domain', 'priya@examp1e.com', 'priya@examp1e.com'],
  ])('catches %s', (_why, written, drawn) => {
    expect(realAddresses(`To: ${written}, for the Q3 deck`)).toEqual([drawn]);
  });

  it('reads text as it is drawn, and judges the domain alone', () => {
    expect(asDrawn('a\u200b\u200cb\uff20c')).toBe('ab@c');
    expect(isReserved('example.com@gmail.com')).toBe(false);
    expect(isReserved('priya@EXAMPLE.org')).toBe(true);
    expect(addressesIn('no address here, nor @here, nor priya@localhost')).toEqual([]);
  });
});
