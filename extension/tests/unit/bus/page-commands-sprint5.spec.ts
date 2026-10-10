/**
 * The pages' Sprint 5 commands over the bus (src/bus/page-commands.ts, listen.ts, send.ts; qa_tester rule 3), through
 * `send()` and `listen()`, not only by their schemas (Sprint 5 QA review): the person's own model key (`byo.save`,
 * `byo.forget`, 5.3) and the telemetry's test send (`telemetry.send`, 5.7). tests/unit/bus/round-trip.spec.ts names
 * their senders but runs none of them, and page-commands.spec.ts runs only Sprint 4's four settings.
 *  - valid, from the options page: round-trips and resolves the handler's answer;
 *  - from a content script: dropped as `untrusted_context`, the handler never runs. A Gmail or Calendar tab's script
 *    may never put its own key in place of the person's (which would send their claims' facts to that key's account),
 *    forget the person's key, or make the extension post telemetry;
 *  - from another extension: dropped as `foreign_sender`;
 *  - malformed: dropped and logged with its type, nothing of it logged; a `byo.save` refused for its vendor, or for a
 *    field no schema names, never logs the key it carried (Hard Rule 10);
 *  - a handler that answers badly or throws: resolves failed, and says so in the log, never a value;
 *  - an invalid command is never sent, and its key is never logged.
 * Every value is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { BusError } from '../../../src/bus/errors';
import { type BusHandler, listen } from '../../../src/bus/listen';
import type {
  ByoForgetMessage,
  ByoSaveMessage,
  SettingResult,
  TelemetrySendResult,
} from '../../../src/bus/messages';
import { sendSetting, sendTelemetryNow } from '../../../src/bus/send';
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

/** An invented key in a vendor's shape (src/bus/page-commands.ts ByoKey), searched for in every log. */
const KEY = 'sk-ant-qa-invented-Zq81Lm4Np7Rs2Tv9';
const SAVE: ByoSaveMessage = { type: 'byo.save', vendor: 'anthropic', key: KEY };
const FORGET: ByoForgetMessage = { type: 'byo.forget' };
const SENT: TelemetrySendResult = { ok: true, outcome: 'sent', day: '2026-10-09' };

const optionsPage = () => extensionPage('/options.html');

type KeyCommand = 'byo.save' | 'byo.forget';
const KEY_COMMANDS = [
  ['byo.save', SAVE],
  ['byo.forget', FORGET],
] as const;

/** A handler of `type` that answers `answer`, counting its calls. */
function keyHandler(type: KeyCommand, answer: () => Promise<unknown>) {
  const handler = vi.fn(() => answer() as Promise<SettingResult>);
  listen({ [type]: handler as BusHandler<KeyCommand> });
  return handler;
}

function telemetryHandler(answer: () => Promise<unknown>) {
  const handler = vi.fn(() => answer() as Promise<TelemetrySendResult>);
  listen({ 'telemetry.send': handler });
  return handler;
}

const noKeyLogged = () => {
  expect(JSON.stringify(records)).not.toContain(KEY);
  expect(JSON.stringify(records)).not.toContain('Zq81Lm4Np7Rs2Tv9');
};

describe.each(KEY_COMMANDS)('%s, from its sender and from others', (type, message) => {
  it('valid, from the options page: round-trips through sendSetting() to the handler and resolves its result', async () => {
    connectAs(optionsPage());
    const handler = keyHandler(type, () => Promise.resolve({ ok: true }));
    await expect(sendSetting(message)).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]).toEqual([message, optionsPage()]);
    expect(eventsAt(records, 'warn')).toEqual([]);
    expect(eventsAt(records, 'error')).toEqual([]);
    noKeyLogged();
  });

  it('from a content script: dropped as untrusted, never handled, the key never logged', async () => {
    connectAs(contentScript());
    const handler = keyHandler(type, () => Promise.resolve({ ok: true }));
    await expect(sendRaw(message)).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'untrusted_context', type },
    });
    noKeyLogged();
  });

  it('from another extension: dropped as foreign, never handled', async () => {
    connectAs(foreignExtension());
    const handler = keyHandler(type, () => Promise.resolve({ ok: true }));
    await expect(sendRaw(message)).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records.filter(({ event }) => event === 'bus.dropped').map(({ fields }) => fields)).toEqual([
      { reason: 'foreign_sender', type },
    ]);
    noKeyLogged();
  });
});

describe.each(KEY_COMMANDS)('%s, malformed or badly answered', (type, message) => {
  it('malformed, from the options page: dropped and logged with its type; the handler never runs', async () => {
    connectAs(optionsPage());
    const handler = keyHandler(type, () => Promise.resolve({ ok: true }));
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
      () => Promise.reject(new Error(`refused ${KEY}`)),
    ];
    keyHandler(type, () => (answers.shift() ?? (() => Promise.resolve(undefined)))());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(sendSetting(message)).resolves.toEqual({ ok: false, code: 'failed' });
    }
    expect(eventsAt(records, 'error').map(({ event, fields }) => [event, fields.type])).toEqual([
      ['bus.handler_failed', type],
      ['bus.handler_failed', type],
      ['bus.handler_failed', type],
    ]);
    noKeyLogged();
  });
});

describe('byo.save: a key refused never reaches a log', () => {
  it.each([
    ['a vendor Attest does not call', { ...SAVE, vendor: 'mistral' }],
    ['a field no schema names', { ...SAVE, endpoint: 'https://collector.example/v1' }],
    ['a key with a space in it', { ...SAVE, key: `${KEY} ` }],
  ])('dropped as malformed (%s), and the key it carried is logged nowhere', async (_why, raw) => {
    connectAs(optionsPage());
    const handler = keyHandler('byo.save', () => Promise.resolve({ ok: true }));
    await expect(sendRaw(raw)).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'malformed', type: 'byo.save' },
    });
    noKeyLogged();
  });

  it.each([
    ['too short a key', { ...SAVE, key: 'sk-short' }],
    ['a vendor Attest does not call', { ...SAVE, vendor: 'mistral' as 'anthropic' }],
    ['a field no schema names', { ...SAVE, ...{ endpoint: 'https://collector.example/v1' } }],
  ])(
    'is never sent with %s: sendSetting() rejects with invalid_outgoing, logged without the key',
    async (_why, command) => {
      const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
      const attempt = sendSetting(command);
      await expect(attempt).rejects.toBeInstanceOf(BusError);
      await expect(attempt).rejects.toMatchObject({ code: 'invalid_outgoing' });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(
        records.filter(({ event }) => event === 'bus.command_refused').map(({ fields }) => fields.type),
      ).toEqual(['byo.save']);
      noKeyLogged();
    },
  );
});

describe('telemetry.send, from its sender and from others', () => {
  it('valid, from the options page: sendTelemetryNow() resolves what the handler did', async () => {
    connectAs(optionsPage());
    const handler = telemetryHandler(() => Promise.resolve(SENT));
    await expect(sendTelemetryNow()).resolves.toEqual(SENT);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]).toEqual([VALID['telemetry.send'], optionsPage()]);
    expect(eventsAt(records, 'warn')).toEqual([]);
  });

  it('from a content script: dropped as untrusted, never handled (no page may make Attest post)', async () => {
    connectAs(contentScript());
    const handler = telemetryHandler(() => Promise.resolve(SENT));
    await expect(sendRaw(VALID['telemetry.send'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'untrusted_context', type: 'telemetry.send' },
    });
  });

  it('from another extension: dropped as foreign, never handled', async () => {
    connectAs(foreignExtension());
    const handler = telemetryHandler(() => Promise.resolve(SENT));
    await expect(sendRaw(VALID['telemetry.send'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records.filter(({ event }) => event === 'bus.dropped').map(({ fields }) => fields)).toEqual([
      { reason: 'foreign_sender', type: 'telemetry.send' },
    ]);
  });
});

describe('telemetry.send, malformed or badly answered', () => {
  it('malformed (a payload smuggled in): dropped and logged with its type, nothing of it logged', async () => {
    connectAs(optionsPage());
    const handler = telemetryHandler(() => Promise.resolve(SENT));
    await expect(sendRaw(MALFORMED['telemetry.send'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'malformed', type: 'telemetry.send' },
    });
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('an answer outside its schema, or a throw, resolves failed: never an outcome or a day it did not say', async () => {
    connectAs(optionsPage());
    const answers: (() => Promise<unknown>)[] = [
      () => Promise.resolve({ ok: true, outcome: 'queued', day: '2026-10-09' }),
      () => Promise.resolve({ ok: true, outcome: 'sent', day: 'yesterday' }),
      () => Promise.resolve({ ok: true, outcome: 'sent', day: '2026-10-09', payload: SECRET }),
      () => Promise.reject(new Error(SECRET)),
    ];
    telemetryHandler(() => (answers.shift() ?? (() => Promise.resolve(undefined)))());
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(sendTelemetryNow()).resolves.toEqual({ ok: false, code: 'failed' });
    }
    expect(eventsAt(records, 'error').map(({ event, fields }) => [event, fields.type])).toEqual(
      Array.from({ length: 4 }, () => ['bus.handler_failed', 'telemetry.send']),
    );
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('resolves failed, logged with the type, when nobody answers', async () => {
    await expect(sendTelemetryNow()).resolves.toEqual({ ok: false, code: 'failed' });
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.command_unavailable',
      fields: { type: 'telemetry.send', reason: 'no_response' },
    });
  });
});
