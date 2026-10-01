/**
 * Properties of src/log.ts (Hard Rule 10), >= 1,000 runs each (qa_tester rule 4). Added by the Sprint 0
 * QA review. Each property states exactly what the logger guarantees, so a weakened rule fails here.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildRecord, isSafeString, type LogLevel } from '../../src/log';

const RUNS = { numRuns: 2_000 };
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const CONTENT_KEYS = [
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
  'text',
  'textHint',
  'title',
  'url',
  'value',
] as const;

/** Strings shaped like user content: they hold whitespace or '@', which no plumbing value does. */
const contentLike = fc
  .tuple(fc.string({ maxLength: 40 }), fc.constantFrom(' ', '@', '\n', '\t'), fc.string({ maxLength: 40 }))
  .map(([a, sep, b]) => `${a}${sep}${b}`);

describe('log.buildRecord (property)', () => {
  it('is total: any event and any field values give a record of printable scalars', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LEVELS),
        fc.string(),
        fc.dictionary(fc.string({ maxLength: 12 }), fc.anything()),
        (level, event, fields) => {
          const record = buildRecord(level, event, fields);
          expect(record.level).toBe(level);
          for (const value of Object.values(record.fields)) {
            expect(['string', 'number', 'boolean'].includes(typeof value) || value === null).toBe(true);
          }
          expect(() => JSON.stringify(record)).not.toThrow();
        },
      ),
      RUNS,
    );
  });

  it('a string under a content key is always exactly [redacted len=N]', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONTENT_KEYS), fc.string(), (key, value) => {
        expect(buildRecord('info', 'e', { [key]: value }).fields[key]).toBe(
          `[redacted len=${String(value.length)}]`,
        );
      }),
      RUNS,
    );
  });

  it('content-like text under any key is redacted, and never counted as plumbing', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), contentLike, (key, value) => {
        expect(isSafeString(value)).toBe(false);
        const fields = Object.values(buildRecord('info', 'e', { [key]: value }).fields);
        expect(fields).toEqual([`[redacted len=${String(value.length)}]`]);
      }),
      RUNS,
    );
  });

  it('a string value prints only when it is plumbing, and then verbatim', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const printed = buildRecord('info', 'e', { reason: value }).fields.reason;
        expect(printed).toBe(isSafeString(value) ? value : `[redacted len=${String(value.length)}]`);
      }),
      RUNS,
    );
  });

  it('an error never prints its message: only name, safe code, and message length', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string(), { nil: undefined }), (message, code) => {
        const error = Object.assign(new Error(message), code === undefined ? {} : { code });
        const printed = buildRecord('error', 'e', { error }).fields.error;
        const codePart = code !== undefined && isSafeString(code) ? ` code=${code}` : '';
        expect(printed).toBe(`Error${codePart} messageLength=${String(message.length)}`);
      }),
      RUNS,
    );
  });

  it('an event name prints only when it is an identifier; otherwise its shape', () => {
    fc.assert(
      fc.property(contentLike, (event) => {
        expect(buildRecord('info', event).event).toBe(`[redacted len=${String(event.length)}]`);
      }),
      RUNS,
    );
  });
});
