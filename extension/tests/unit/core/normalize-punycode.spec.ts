/**
 * Task 1.1 — punycode.ts: RFC 3492 decoding of IDN labels, for display only (docs/grading.md §11). Checked
 * against the RFC 3492 §7.1 sample strings and against Node's WHATWG `domainToUnicode`.
 */
import { domainToUnicode } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decodeLabel,
  decodePunycode,
  email,
  isAceLabel,
  PunycodeError,
  toUnicodeDomain,
} from '../../../src/core/normalize';

describe('decodePunycode: RFC 3492 \u00A77.1 sample strings', () => {
  it.each([
    [
      'egbpdaj6bu4bxfgehfvwxn',
      '\u0644\u064A\u0647\u0645\u0627\u0628\u062A\u0643\u0644\u0645\u0648\u0634\u0639\u0631\u0628\u064A\u061F',
    ],
    ['ihqwcrb4cv8a8dqg056pqjye', '\u4ED6\u4EEC\u4E3A\u4EC0\u4E48\u4E0D\u8BF4\u4E2D\u6587'],
    ['Proprostnemluvesky-uyb24dma41a', 'Pro\u010Dprost\u011Bnemluv\u00ED\u010Desky'],
    [
      '4dbcagdahymbxekheh6e0a7fei0b',
      '\u05DC\u05DE\u05D4\u05D4\u05DD\u05E4\u05E9\u05D5\u05D8\u05DC\u05D0\u05DE\u05D3\u05D1\u05E8\u05D9\u05DD\u05E2\u05D1\u05E8\u05D9\u05EA',
    ],
    [
      'b1abfaaepdrnnbgefbaDotcwatmq2g4l',
      '\u043F\u043E\u0447\u0435\u043C\u0443\u0436\u0435\u043E\u043D\u0438\u043D\u0435\u0433\u043E\u0432\u043E\u0440\u044F\u0442\u043F\u043E\u0440\u0443\u0441\u0441\u043A\u0438',
    ],
    ['PorqunopuedensimplementehablarenEspaol-fmd56a', 'Porqu\u00E9nopuedensimplementehablarenEspa\u00F1ol'],
    [
      'TisaohkhngthchnitingVit-kjcr8268qyxafd2f1b9g',
      'T\u1EA1isaoh\u1ECDkh\u00F4ngth\u1EC3ch\u1EC9n\u00F3iti\u1EBFngVi\u1EC7t',
    ],
    ['3B-ww4c5e180e575a65lsy2b', '3\u5E74B\u7D44\u91D1\u516B\u5148\u751F'],
    ['-with-SUPER-MONKEYS-pc58ag80a8qai00g7n9n', '\u5B89\u5BA4\u5948\u7F8E\u6075-with-SUPER-MONKEYS'],
    [
      'Hello-Another-Way--fc4qua05auwb3674vfr0b',
      'Hello-Another-Way-\u305D\u308C\u305E\u308C\u306E\u5834\u6240',
    ],
    ['2-u9tlzr9756bt3uc0v', '\u3072\u3068\u3064\u5C4B\u6839\u306E\u4E0B2'],
    ['MajiKoi5-783gue6qz075azm5e', 'Maji\u3067Koi\u3059\u308B5\u79D2\u524D'],
    ['de-jg4avhby1noc0d', '\u30D1\u30D5\u30A3\u30FCde\u30EB\u30F3\u30D0'],
    ['-> $1.00 <--', '-> $1.00 <-'],
    ['', ''],
  ])('%j', (encoded, decoded) => {
    expect(decodePunycode(encoded)).toBe(decoded);
  });
});

describe('decodePunycode: invalid input throws a typed error', () => {
  it.each([
    ['\u00E9-a', 'invalid_input'], // a non-basic code point before the delimiter
    ['!', 'invalid_input'], // not a base-36 digit
    ['b', 'invalid_input'], // a variable-length integer that never ends
    ['ib9b', 'invalid_input'], // decodes to the lone surrogate U+D800
    ['ab-ge4l', 'invalid_input'], // decodes to a\uDFFFb
    ['999999999999', 'overflow'],
  ])('%j \u2192 %s', (encoded, code) => {
    let caught: unknown;
    try {
      decodePunycode(encoded);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PunycodeError);
    expect((caught as PunycodeError).code).toBe(code);
  });
});

describe('ACE labels and display domains', () => {
  it.each([
    ['xn--pple-43d', true],
    ['XN--pple-43d', true],
    ['Xn--a', true],
    ['xn-pple', false],
    ['axn--pple', false],
    ['apple', false],
    ['', false],
  ])('isAceLabel(%j) = %s', (label, expected) => {
    expect(isAceLabel(label)).toBe(expected);
  });

  it.each([
    ['xn--pple-43d.com', '\u0430pple.com'], // Cyrillic а: looks like apple.com
    ['mail.xn--mnchen-3ya.de', 'mail.m\u00FCnchen.de'],
    ['xn--bcher-kva.example', 'b\u00FCcher.example'],
    ['company.com', 'company.com'],
    ['xn--!!.com', 'xn--!!.com'], // an invalid ACE label is shown exactly as read
    ['', ''],
  ])('toUnicodeDomain(%j) = %j (and agrees with WHATWG domainToUnicode)', (domain, expected) => {
    expect(toUnicodeDomain(domain)).toBe(expected);
    if (domain !== '' && !domain.includes('!')) expect(toUnicodeDomain(domain)).toBe(domainToUnicode(domain));
  });

  it('decodeLabel leaves non-ACE labels alone and throws on a broken ACE label', () => {
    expect(decodeLabel('example')).toBe('example');
    expect(decodeLabel('xn--pple-43d')).toBe('\u0430pple');
    expect(() => decodeLabel('xn--!!')).toThrow(PunycodeError);
  });

  it('decoding is display-only: the address keeps its ACE form and stays confusable', () => {
    const address = email('priya@xn--pple-43d.com');
    expect(address?.domain).toBe('xn--pple-43d.com');
    expect(address?.confusable).toBe(true);
  });
});
