/**
 * The observers' selectors.json loaders (Sprint 2 close, TECH-3). A malformed file stops its content script with a
 * typed error whose name and code the logger prints (`ObserverError invalid_selectors`, `ReceiptError
 * invalid_selectors`), never a bare ZodError the logger can only call `Error`, and never half-loads.
 */
import { describe, expect, it } from 'vitest';

import { loadCalendarSelectors, GCAL_SELECTORS } from '../../../src/observers/gcal/selectors';
import gcalRaw from '../../../src/observers/gcal/selectors.json' with { type: 'json' };
import { loadReceiptSelectors } from '../../../src/observers/gmail/receipts/selectors';
import receiptRaw from '../../../src/observers/gmail/receipts/selectors.json' with { type: 'json' };
import { loadSentSelectors, SENT_SELECTORS } from '../../../src/observers/gmail/selectors';
import sentRaw from '../../../src/observers/gmail/selectors.json' with { type: 'json' };
import { type LogRecord, log, setLogSink } from '../../../src/log';

/** The error `load(value)` throws, or null. */
function thrown(load: (value: unknown) => unknown, value: unknown): unknown {
  try {
    load(value);
    return null;
  } catch (error) {
    return error;
  }
}

/** What the logger prints for `error`. */
function logged(error: unknown): LogRecord['fields'] | undefined {
  const records: LogRecord[] = [];
  const restore = setLogSink((record) => records.push(record));
  try {
    log.error('bus.handler_failed', { error });
  } finally {
    restore();
  }
  return records[0]?.fields;
}

const LOADERS = [
  ['gmail.sent', loadSentSelectors, sentRaw, 'ObserverError'],
  ['gcal.event', loadCalendarSelectors, gcalRaw, 'ObserverError'],
  ['gmail.receipt', loadReceiptSelectors, receiptRaw, 'ReceiptError'],
] as const;

describe('selectors.json loaders throw typed errors (TECH-3)', () => {
  it('the shipped files load as the observers use them', () => {
    expect(loadSentSelectors(sentRaw)).toEqual(SENT_SELECTORS);
    expect(loadCalendarSelectors(gcalRaw)).toEqual(GCAL_SELECTORS);
  });

  it.each(LOADERS)(
    '%s: a malformed document throws %s invalid_selectors, logged by name and code',
    (...row) => {
      const [, load, raw, name] = row;
      const broken: readonly (readonly [string, unknown])[] = [
        ['null', null],
        ['empty', {}],
        ['a version that is not a token', { ...raw, version: 7 }],
        ['an unknown key', { ...raw, unexpected: true }],
        ['no observer', { ...raw, observer: undefined }],
      ];
      for (const [label, value] of broken) {
        const error = thrown(load, value);
        expect(error, label).toMatchObject({ name, code: 'invalid_selectors' });
        expect(String(logged(error)?.error), label).toContain(`${name} code=invalid_selectors`);
      }
    },
  );
});
