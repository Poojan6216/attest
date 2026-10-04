/**
 * src/observers/account.ts and text.ts: the account leaves only as a hash, the same for the same address however
 * the page cases it (Hard Rules 2, 10); names and subjects are made one line before project() (Sprint 1 close, SEC-3).
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../src/core/hash';
import { accountHashOf } from '../../../src/observers/account';
import { oneLine } from '../../../src/observers/text';

describe('accountHashOf', () => {
  it('is the SHA-256 of the address, ASCII-lowercased', () => {
    expect(accountHashOf('priya@example.com')).toBe(sha256Hex('priya@example.com'));
  });

  it.each([
    'Priya@Example.COM',
    ' priya@example.com ',
    'Priya Raman <priya@example.com>',
    '"Raman, P" <PRIYA@example.com>',
  ])('%s hashes as priya@example.com', (raw) => {
    expect(accountHashOf(raw)).toBe(sha256Hex('priya@example.com'));
  });

  it('never contains the address', () => {
    expect(accountHashOf('priya@example.com')).not.toContain('priya');
  });

  it('a lookalike address is another account (nothing but ASCII case is folded)', () => {
    expect(accountHashOf('priya@exаmple.com')).not.toBe(accountHashOf('priya@example.com'));
  });

  it.each(['', 'Priya Raman', 'priya@', '@example.com', 'a@b@example.com', '<a@x.com>, <b@y.com>'])(
    '%j is not an address: null',
    (raw) => {
      expect(accountHashOf(raw)).toBeNull();
    },
  );
});

describe('oneLine', () => {
  it.each([
    ['Q3   deck\n  and plan', 'Q3 deck and plan'],
    ['\t Re:\r\ninvoice  ', 'Re: invoice'],
    ['line separator paragraph', 'line separator paragraph'],
    ['next\u0085line', 'next line'],
    ['already one line', 'already one line'],
    ['   ', ''],
  ])('%j → %j', (raw, expected) => {
    expect(oneLine(raw)).toBe(expected);
  });

  it('keeps other control characters, so project() still refuses the row', () => {
    expect(oneLine('bell\u0007here')).toBe('bell\u0007here');
  });
});
