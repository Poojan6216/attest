/**
 * The pages' Sprint 4 commands over the bus (src/bus/page-commands.ts, listen.ts, send.ts), each held to qa_tester rule
 * 3 through `send()` and `listen()`, not only by its schema (Sprint 4 QA review).
 *
 * The options page's four settings (sprint_4 4.5, 4.9: `retention.save`, `reader.toggle`, `flag.set`, `ledger.wipe`):
 *  - valid, from the options page: round-trips and resolves the handler's `SettingResult`;
 *  - from a content script: dropped as `untrusted_context`, the handler never runs. Only an extension page may delete
 *    every Attest datum, turn a reader off or turn the Gmail auto-check on; a Gmail or Calendar tab never may;
 *  - from another extension: dropped as `foreign_sender`;
 *  - malformed: dropped and logged with its type, nothing of it logged;
 *  - a handler that answers badly or throws, or no handler at all: `sendSetting` resolves `{ ok: false, code: 'failed' }`
 *    and says so in the log, never a value;
 *  - an invalid command is never sent: `sendSetting` rejects with `BusError('invalid_outgoing')`.
 * The side panel's mark (`receipt.event`, 4.3) and the options page's grant (`grant.save`, 4.4), whose round trips and
 * untrusted senders tests/unit/bus/round-trip.spec.ts holds: an invalid one is never sent (`sendReceiptEvent`,
 * `sendGrant` reject with `invalid_outgoing`, logged without the reason), and no answer resolves failed.
 * Every value is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { BusError } from '../../../src/bus/errors';
import { type BusHandler, listen } from '../../../src/bus/listen';
import type {
  FlagSetMessage,
  GrantChoices,
  LedgerWipeMessage,
  ReaderToggleMessage,
  RetentionSaveMessage,
  SettingResult,
} from '../../../src/bus/messages';
import { sendGrant, sendReceiptEvent, sendSetting } from '../../../src/bus/send';
import {
  captureLogs,
  connectAs,
  contentScript,
  eventsAt,
  extensionPage,
  foreignExtension,
  MALFORMED,
  SECRET,
  sendRaw,
  VALID,
} from './harness';

const records = captureLogs();

beforeEach(() => {
  fakeBrowser.reset();
});

const SETTINGS = ['retention.save', 'reader.toggle', 'flag.set', 'ledger.wipe'] as const;
type SettingType = (typeof SETTINGS)[number];
type SettingMessage = RetentionSaveMessage | ReaderToggleMessage | FlagSetMessage | LedgerWipeMessage;

const valid = (type: SettingType): SettingMessage => VALID[type];
const optionsPage = () => extensionPage('/options.html');

/** A handler of `type` that answers `answer`, counting its calls. */
function handlerOf(type: SettingType, answer: () => Promise<unknown>) {
  const handler = vi.fn(() => answer() as Promise<SettingResult>);
  listen({ [type]: handler as BusHandler<SettingType> });
  return handler;
}

describe.each(SETTINGS)('%s, from its sender and from others', (type) => {
  it('valid, from the options page: round-trips through sendSetting() to the handler and resolves its result', async () => {
    connectAs(optionsPage());
    const handler = handlerOf(type, () => Promise.resolve({ ok: true }));
    await expect(sendSetting(valid(type))).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]).toEqual([valid(type), optionsPage()]);
    expect(eventsAt(records, 'warn')).toEqual([]);
    expect(eventsAt(records, 'error')).toEqual([]);
  });

  it('from a content script: dropped as untrusted, never handled', async () => {
    connectAs(contentScript());
    const handler = handlerOf(type, () => Promise.resolve({ ok: true }));
    await expect(sendRaw(valid(type))).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'untrusted_context', type },
    });
  });

  it('from another extension: dropped as foreign, never handled', async () => {
    connectAs(foreignExtension());
    const handler = handlerOf(type, () => Promise.resolve({ ok: true }));
    await expect(sendRaw(valid(type))).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records.filter(({ event }) => event === 'bus.dropped').map(({ fields }) => fields)).toEqual([
      { reason: 'foreign_sender', type },
    ]);
  });
});

describe.each(SETTINGS)('%s, malformed or badly answered', (type) => {
  it('malformed, from the options page: dropped and logged with its type; the handler never runs', async () => {
    connectAs(optionsPage());
    const handler = handlerOf(type, () => Promise.resolve({ ok: true }));
    await expect(sendRaw(MALFORMED[type])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'malformed', type },
    });
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('a handler that answers badly or throws is answered failed, and sendSetting() says so', async () => {
    connectAs(optionsPage());
    const answers: (() => Promise<unknown>)[] = [
      () => Promise.resolve({ ok: 'yes' }),
      () => Promise.resolve({ ok: false, code: 'refused' }),
      () => Promise.reject(new Error(SECRET)),
    ];
    handlerOf(type, () => (answers.shift() ?? (() => Promise.resolve(undefined)))());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(sendSetting(valid(type))).resolves.toEqual({ ok: false, code: 'failed' });
    }
    expect(eventsAt(records, 'error').map(({ event, fields }) => [event, fields.type])).toEqual([
      ['bus.handler_failed', type],
      ['bus.handler_failed', type],
      ['bus.handler_failed', type],
    ]);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });
});

describe('sendSetting(): no answer and invalid commands', () => {
  it('resolves failed, logged with the type, when nobody answers', async () => {
    await expect(sendSetting(valid('ledger.wipe'))).resolves.toEqual({ ok: false, code: 'failed' });
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.command_unavailable',
      fields: { type: 'ledger.wipe', reason: 'no_response' },
    });
  });

  it.each<[SettingType, SettingMessage]>([
    ['retention.save', { type: 'retention.save', days: 7 as 30 }],
    ['reader.toggle', { type: 'reader.toggle', reader: 'claude' as 'gmail', on: false }],
    ['flag.set', { type: 'flag.set', flag: 'ATTEST_MODEL' as 'ATTEST_AUTO_CHECK_GMAIL', on: true }],
    ['ledger.wipe', { type: 'ledger.wipe', ...{ everything: true } }],
  ])('never sends an invalid %s: it rejects with invalid_outgoing, logged', async (type, command) => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
    const attempt = sendSetting(command);
    await expect(attempt).rejects.toBeInstanceOf(BusError);
    await expect(attempt).rejects.toMatchObject({ code: 'invalid_outgoing' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      records.filter(({ event }) => event === 'bus.command_refused').map(({ fields }) => fields.type),
    ).toEqual([type]);
  });
});

describe('sendReceiptEvent() and sendGrant(): invalid commands and no answer', () => {
  it('never sends a mark with no visible reason: it rejects with invalid_outgoing, logged without the reason', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
    const blank = ' \u200b ';
    const attempt = sendReceiptEvent(VALID['receipt.event'].receiptId, {
      kind: 'override',
      grade: 'VERIFIED',
      reason: blank,
    });
    await expect(attempt).rejects.toMatchObject({ name: 'BusError', code: 'invalid_outgoing' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(records.map(({ event, fields }) => [event, fields.type])).toContainEqual([
      'bus.command_refused',
      'receipt.event',
    ]);
    expect(JSON.stringify(records)).not.toContain(blank);
  });

  it('never sends a grant with a ceiling and no currency: it rejects with invalid_outgoing, logged', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
    const noCurrency = Object.fromEntries(
      Object.entries(VALID['grant.save'].grant).filter(([key]) => key !== 'spendCurrency'),
    ) as GrantChoices;
    expect(noCurrency.spendCeilingCents).toBe(5000);
    await expect(sendGrant(noCurrency, false)).rejects.toMatchObject({ code: 'invalid_outgoing' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(records.map(({ event, fields }) => [event, fields.type])).toContainEqual([
      'bus.command_refused',
      'grant.save',
    ]);
  });

  it('resolves failed, logged, when nobody answers a mark or a grant', async () => {
    const { receiptId, event } = VALID['receipt.event'];
    await expect(sendReceiptEvent(receiptId, event)).resolves.toEqual({ ok: false, code: 'failed' });
    await expect(sendGrant(VALID['grant.save'].grant, true)).resolves.toEqual({ ok: false, code: 'failed' });
    expect(
      records
        .filter(({ event: name }) => name === 'bus.command_unavailable')
        .map(({ fields }) => [fields.type, fields.reason]),
    ).toEqual([
      ['receipt.event', 'no_response'],
      ['grant.save', 'no_response'],
    ]);
    const reason = event.kind === 'override' ? event.reason : '';
    expect(JSON.stringify(records)).not.toContain(reason);
  });
});
