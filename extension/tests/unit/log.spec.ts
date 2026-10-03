/**
 * src/log.ts, the only logger (Hard Rule 10: never log secrets or PII). Added by the Sprint 0 QA review:
 * every other suite swaps the sink and asserts on records, so the redaction rules themselves had no test.
 * Here: levels, the sink hook, the printed line, every redaction rule, and every seeded secret through
 * every input position. Properties (>= 1,000 runs each) live in tests/property/log.property.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRecord, isSafeString, log, type LogRecord, setLogLevel, setLogSink } from '../../src/log';
import { LOG_EVENTS } from '../../src/log-vocabulary';
import { loadSeeds, normalizeForSearch } from '../e2e/support/leaks';

const SEEDS = loadSeeds();
const ULID = '01J9ZQ3W8XK2M4N6P8R0S2T4V6';
const SHA = 'a'.repeat(64);

let records: LogRecord[] = [];
let restoreSink: () => void = () => undefined;

beforeEach(() => {
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
  setLogLevel('info');
});

afterEach(() => {
  restoreSink();
  setLogLevel('info');
});

describe('levels', () => {
  it('drops records below the current level and keeps the rest (default info)', () => {
    log.debug('install.skipped');
    log.info('background.started');
    log.warn('alarm.unknown');
    log.error('install.failed');
    expect(records.map((r) => `${r.level}:${r.event}`)).toEqual([
      'info:background.started',
      'warn:alarm.unknown',
      'error:install.failed',
    ]);
  });

  it('setLogLevel lowers and raises the threshold', () => {
    setLogLevel('debug');
    log.debug('install.skipped');
    setLogLevel('error');
    log.warn('alarm.unknown');
    log.error('install.failed');
    expect(records.map((r) => r.event)).toEqual(['install.skipped', 'install.failed']);
  });
});

describe('setLogSink', () => {
  it('returns a restore function that puts the previous sink back', () => {
    const inner: LogRecord[] = [];
    const restoreInner = setLogSink((record) => inner.push(record));
    log.info('install_id.created');
    restoreInner();
    log.info('install_id.reset');
    expect(inner.map((r) => r.event)).toEqual(['install_id.created']);
    expect(records.map((r) => r.event)).toEqual(['install_id.reset']);
  });
});

describe('the console sink', () => {
  it('prints one line per record, on the console method of its level, as "[attest] {json}"', () => {
    restoreSink();
    const spies = {
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    };
    log.info('bus.dropped', { reason: 'malformed', count: 2 });
    log.warn('ledger.row_replaced', { table: 'observations', id: ULID });
    log.error('install.failed', { error: new TypeError('secret detail') });
    expect(spies.info).toHaveBeenCalledExactlyOnceWith(
      '[attest] {"level":"info","event":"bus.dropped","reason":"malformed","count":2}',
    );
    expect(spies.warn).toHaveBeenCalledExactlyOnceWith(
      `[attest] {"level":"warn","event":"ledger.row_replaced","table":"observations","id":"${ULID}"}`,
    );
    expect(spies.error).toHaveBeenCalledExactlyOnceWith(
      '[attest] {"level":"error","event":"install.failed","error":"TypeError messageLength=13"}',
    );
  });
});

describe('buildRecord: event names', () => {
  it('keeps an event from the closed vocabulary and turns anything else into a shape', () => {
    expect(buildRecord('info', 'bus.dropped').event).toBe('bus.dropped');
    expect(buildRecord('info', 'Hello Marguerite').event).toBe('[redacted len=16]');
    expect(buildRecord('info', 'user@example.com').event).toBe('[redacted len=16]');
    expect(buildRecord('info', '').event).toBe('[redacted len=0]');
  });

  it('an identifier-shaped event that is not in the vocabulary is a shape (SECURITY-1, QA-6)', () => {
    expect(buildRecord('info', 'ottoline.vasquez').event).toBe('[redacted len=16]');
    expect(buildRecord('info', 'bus.dropped_extra').event).toBe('[redacted len=17]');
  });

  it('every vocabulary event prints as itself', () => {
    for (const event of LOG_EVENTS) expect(buildRecord('info', event).event).toBe(event);
  });
});

describe('buildRecord: values that print', () => {
  it.each([
    ['vocabulary word', 'no_receiver'],
    ['dotted vocabulary word', 'ledger.export'],
    ['vocabulary enum value', 'NOT_FOUND'],
    ['ULID', ULID],
    ['SHA-256 hex', SHA],
    ['ISO timestamp with offset', '2026-10-01T09:30:00-04:00'],
    ['ISO timestamp UTC with millis', '2026-10-01T13:30:00.123Z'],
    ['semver', '0.0.1'],
  ])('%s survives', (_label, value) => {
    expect(buildRecord('info', 'e', { reason: value }).fields).toEqual({ reason: value });
  });

  it('numbers and booleans print; null and undefined become null; non-finite numbers become strings', () => {
    const { fields } = buildRecord('info', 'e', {
      n: 3,
      f: 0.5,
      t: true,
      z: null,
      u: undefined,
      inf: Number.POSITIVE_INFINITY,
      nan: Number.NaN,
    });
    expect(fields).toEqual({ n: 3, f: 0.5, t: true, z: null, u: null, inf: 'Infinity', nan: 'NaN' });
  });
});

describe('buildRecord: values that never print', () => {
  it.each([
    ['free text', 'Q3 deck for Marguerite'],
    ['an email address', 'alex@example.com'],
    ['a capitalised name', 'Ottoline'],
    ['a long digit run', 'order 1234567'],
    ['an identifier over 64 chars', `a${'.b'.repeat(40)}`],
    ['an identifier with a segment over 20 chars', `ok.${'x'.repeat(21)}`],
    ['an enum value over 24 chars', `${'A'.repeat(20)}_${'B'.repeat(10)}`],
    ['a timestamp without an offset', '2026-10-01T09:30:00'],
    ['a SHA-like value in upper case', 'A'.repeat(64)],
    ['a lowercase name', 'ottoline'],
    ['a first.last local part', 'ottoline.vasquez'],
    ['a hyphenated passphrase', 'glacier-minnow-trumpet-velvet'],
    ['a lowercase token', 'zxq9vl2mp8rt4wy7nb5c'],
    ['a slug path', 'files.example.net/share/q3-deck'],
    ['an UPPER word', 'MARGUERITE'],
    ['an UPPER_SNAKE word that is not ours', 'OTTOLINE_VASQUEZ'],
    ['a ULID-shaped value whose first character overflows', `8${'0'.repeat(25)}`],
  ])('%s becomes [redacted len=N]', (_label, value) => {
    expect(buildRecord('info', 'e', { reason: value }).fields).toEqual({
      reason: `[redacted len=${String(value.length)}]`,
    });
  });

  it.each([
    'address',
    'body',
    'content',
    'counterparty',
    'email',
    'html',
    'merchant',
    'message',
    'name',
    'phone',
    'subject',
    'subjectHint',
    'SUBJECTHINT',
    'text',
    'textHint',
    'title',
    'url',
    'value',
  ])('a value under the content key %s is redacted even when it looks like plumbing', (key) => {
    // The value is redacted whatever the key prints as (SUBJECTHINT is not a lower-camel key: field0).
    expect(Object.values(buildRecord('info', 'e', { [key]: 'no_receiver' }).fields)).toEqual([
      '[redacted len=11]',
    ]);
  });
});

describe('buildRecord: values that never print under a content-word key, and long digit runs', () => {
  it.each([
    'senderEmail',
    'subject_line',
    'bodyText',
    'recipientName',
    'apiToken',
    'pageUrl',
    'Subject Hint',
  ])('a key that contains a content word (%s) is redacted, numbers and vocabulary words included', (key) => {
    const values = Object.values(buildRecord('info', 'e', { [key]: 'no_receiver' }).fields);
    expect(values).toEqual(['[redacted len=11]']);
    expect(Object.values(buildRecord('info', 'e', { [key]: 5415550187 }).fields)).toEqual(['[number]']);
  });

  it('numbers with a run of 5+ digits print only as a count (non-negative integer < 10^8, count key)', () => {
    const { fields } = buildRecord('info', 'e', {
      amount: 4000056655665556,
      cents: 99999,
      ratio: 0.123456,
      small: 1234,
      count: 120000,
      issues: 100000,
      durationMs: 300000,
      rowCount: 4000056655665556,
      ssnCount: 912447031,
      bigCount: 99_999_999,
      negativeCount: -100000,
    });
    expect(fields).toEqual({
      amount: '[number]',
      cents: '[number]',
      ratio: '[number]',
      small: 1234,
      count: 120000,
      issues: 100000,
      durationMs: 300000,
      rowCount: '[number]',
      ssnCount: '[number]',
      bigCount: 99_999_999,
      negativeCount: '[number]',
    });
  });
});

describe('buildRecord: errors that never print their message', () => {
  it('error names outside the allowlist print as Error', () => {
    const named = (name: string): Error => Object.assign(new Error('x'), { name });
    const { fields } = buildRecord('error', 'e', {
      a: named('Marguerite'),
      b: named('LedgerError'),
      c: named('QuotaExceededError'),
      d: named('ottoline.vasquez'),
    });
    expect(fields).toEqual({
      a: 'Error messageLength=1',
      b: 'LedgerError messageLength=1',
      c: 'QuotaExceededError messageLength=1',
      d: 'Error messageLength=1',
    });
  });

  it('errors print name, safe code and message length, never the message', () => {
    const coded = Object.assign(new Error('could not read alex@example.com'), { code: 'read_failed' });
    const hostileCode = Object.assign(new Error('x'), { code: 'Ottoline Vasquez' });
    const hostileName = Object.assign(new Error('x'), { name: 'Ottoline Vasquez-Brannigan' });
    const { fields } = buildRecord('error', 'e', {
      a: new RangeError('Marguerite'),
      b: coded,
      c: hostileCode,
      d: hostileName,
    });
    expect(fields).toEqual({
      a: 'RangeError messageLength=10',
      b: 'Error code=read_failed messageLength=31',
      c: 'Error messageLength=1',
      d: 'Error messageLength=1',
    });
  });
});

describe('buildRecord: objects, arrays and keys that never print their contents', () => {
  it('objects and arrays print only their shape, never their contents', () => {
    const { fields } = buildRecord('info', 'e', {
      row: { subject: 'Q3 deck', to: 'alex@example.com' },
      list: ['a', 'b', 'c'],
      fn: () => 'secret',
      sym: Symbol('secret'),
      big: 10n,
    });
    expect(fields).toEqual({
      row: '[object keys=2]',
      list: '[array len=3]',
      fn: '[function]',
      sym: '[symbol]',
      big: '[bigint]',
    });
  });

  it('a key that is not a short lower-camel word is replaced by its position', () => {
    const { fields } = buildRecord('info', 'e', {
      ok: 1,
      'alex@example.com': 2,
      'Ottoline Vasquez': 3,
      AKXQZ7QW3RT5YU8IOP2X: 4,
      zxq9vl2mp8rt4wy7nb5c: 5,
      'ottoline.vasquez': 6,
      [`a${'b'.repeat(32)}`]: 7,
    });
    expect(fields).toEqual({ ok: 1, field1: 2, field2: 3, field3: 4, field4: 5, field5: 6, field6: 7 });
  });
});

describe('every seeded secret is redacted in every input position (Hard Rule 10)', () => {
  function printed(record: LogRecord): string {
    return normalizeForSearch(JSON.stringify(record));
  }

  const SEED_CASES = SEEDS.map((seed) => [seed.id, [seed.value, ...seed.canaries]] as const);

  it.each(SEED_CASES)('%s: as event, value, content value, error message, nested', (_id, secrets) => {
    for (const secret of secrets) {
      expect(isSafeString(secret), 'a seed must never look like plumbing').toBe(false);
      const out = [
        buildRecord('info', secret),
        buildRecord('info', 'e', { reason: secret }),
        buildRecord('info', 'e', { subjectHint: secret }),
        buildRecord('info', 'e', { error: new Error(secret) }),
        buildRecord('info', 'e', { row: { counterparty: secret } }),
        buildRecord('info', 'e', { list: [secret] }),
      ].map(printed);
      for (const line of out) expect(line).not.toContain(normalizeForSearch(secret));
    }
  });

  // QA-2 (reviews/sprint_0/qa.md): keys print only as short lower-camel words, and the attest/log-call lint
  // rule makes every key a source literal, so a dynamic key cannot carry a seed.
  it.each(SEED_CASES)('%s: as a field key', (_id, secrets) => {
    for (const secret of secrets) {
      const line = printed(buildRecord('info', 'e', { [secret]: 1 }));
      expect(line).not.toContain(normalizeForSearch(secret));
    }
  });
});
