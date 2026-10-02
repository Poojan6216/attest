/**
 * Test harness for the bus over WXT's in-memory fake browser.
 *
 * The fake delivers `runtime.sendMessage` to `runtime.onMessage` listeners but always passes an empty
 * sender (`{}`), where Chrome passes `{ id, url, … }`. `connectAs(sender)` wraps listeners as they are
 * registered so they receive the sender a real Chrome would set, and JSON-round-trips the message and
 * the response the way Chrome's messaging does. Everything else (delivery, the classic
 * `return true` + `sendResponse` protocol, `runtime.lastError` on failure) is the fake's own.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  AdapterClaimsMessage,
  AdapterHealthMessage,
  type BusMessageOf,
  type BusMessageType,
  CoveragePingMessage,
  LedgerChangedMessage,
  ObserverObservationsMessage,
  UiQueryMessage,
  UiResultMessage,
} from '../../../src/bus/messages';
import type { MessageSender } from '../../../src/bus/listen';
import { idFromHash } from '../../../src/core/hash';
import { Claim, Observation, Request } from '../../../src/core/schema';
import { type LogLevel, type LogRecord, setLogLevel, setLogSink } from '../../../src/log';

/** A value a test seeds into a payload; it must never reach a log record (Hard Rule 10). */
export const SECRET = 'SSN 078-05-1120 card 4111 1111 1111 1111 pass hunter2';

export const HASH = 'ab'.repeat(32);
export const ULID_REQUEST = '01J9Z8K3M4N5P6Q7R8S9T0V1W2';
export const ULID_CLAIM = '01J9Z8K3M4N5P6Q7R8S9T0V1W3';
/** §10 (v1.3): an observation's id is idFromHash(contentHash), and the schema checks it. */
export const ULID_OBSERVATION = idFromHash(HASH);
export const TS = '2026-10-01T09:30:00Z';
export const TS_OFFSET = '2026-10-01T11:31:00+02:00';

/** Simulates Chrome's JSON serialisation of runtime messages. */
export function wire(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

export function extensionPage(path = '/popup.html'): MessageSender {
  return { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL(path) };
}

export function serviceWorker(): MessageSender {
  return extensionPage('/background.js');
}

export function contentScript(): MessageSender {
  return { id: fakeBrowser.runtime.id, url: 'https://mail.google.com/mail/u/0/#sent', frameId: 0 };
}

export function foreignExtension(): MessageSender {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  return { id, url: `chrome-extension://${id}/page.html` };
}

/** An `onMessage` listener as the bus sees it: it returns `true` when it will answer later. */
export type RawListener = (
  message: unknown,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void,
) => unknown;

/** Make every listener registered from now on in this test receive `sender`, as Chrome would. */
export function connectAs(sender: MessageSender): void {
  const onMessage = fakeBrowser.runtime.onMessage;
  const register = onMessage.addListener.bind(onMessage);
  vi.spyOn(onMessage, 'addListener').mockImplementation((registered) => {
    const listener: RawListener = registered;
    register((message, _emptySender, sendResponse) => {
      const keepOpen = listener(wire(message), sender, (response) => {
        sendResponse(wire(response));
      });
      return keepOpen === true ? true : undefined;
    });
  });
}

/** Calls `listen()` and returns the one listener it registered, for driving it directly. */
export function listenerOf(register: () => unknown): RawListener {
  const addListener = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
  register();
  const registered = addListener.mock.calls[0]?.[0];
  if (registered === undefined) throw new Error('listen() registered no listener');
  const listener: RawListener = registered;
  return listener;
}

/** Sends a raw value straight through the fake browser, bypassing `send()`'s validation. */
export async function sendRaw(raw: unknown): Promise<unknown> {
  const response: unknown = await fakeBrowser.runtime.sendMessage(raw);
  return response;
}

/** Routes log records into an array for the current test; restores the sink afterwards. */
export function captureLogs(): LogRecord[] {
  const records: LogRecord[] = [];
  let restore: () => void = () => undefined;
  beforeEach(() => {
    records.length = 0;
    // Debug too: routine drops and broadcasts nobody hears are logged at debug (Decisions [0.close]).
    setLogLevel('debug');
    restore = setLogSink((record) => {
      records.push(record);
    });
  });
  afterEach(() => {
    restore();
    setLogLevel('info');
  });
  return records;
}

export function eventsAt(records: readonly LogRecord[], level: LogLevel): LogRecord[] {
  return records.filter((record) => record.level === level);
}

/** Payloads are parsed, so they carry the schemas' brands exactly as a real sender's would. */
export const REQUEST: Request = Request.parse({
  id: ULID_REQUEST,
  agent: 'muse',
  conversationId: 'conv-7',
  textHint: 'Email Sam that dinner moved to 8',
  textHash: HASH,
  ts: TS,
});

export const CLAIM: Claim = Claim.parse({
  id: ULID_CLAIM,
  agent: 'muse',
  requestId: ULID_REQUEST,
  type: 'email.sent',
  counterparty: 'sam@example.com',
  subjectHint: 'Dinner moved to 8',
  claimedAt: TS,
  claimedAtPrecision: 'minute',
  observedAt: TS_OFFSET,
  sourceKind: 'activity_view',
  extractor: { id: 'muse.activity', version: '1.0.0', confidence: 0.92 },
  rawHash: HASH,
});

export const OBSERVATION: Observation = Observation.parse({
  id: ULID_OBSERVATION,
  source: 'gmail.sent',
  type: 'email.sent',
  counterparty: 'sam@example.com',
  subjectHint: 'Dinner moved to 8',
  occurredAt: TS,
  observedAt: TS_OFFSET,
  contentHash: HASH,
});

/** One valid message per type. The mapped type makes the compiler demand all seven. */
export const VALID: { readonly [T in BusMessageType]: BusMessageOf<T> } = {
  'adapter.health': AdapterHealthMessage.parse({
    type: 'adapter.health',
    health: {
      adapterId: 'muse',
      version: '1.0.0',
      status: 'DEGRADED',
      reasons: ['selector.missing'],
      checkedAt: TS,
    },
  }),
  'adapter.claims': AdapterClaimsMessage.parse({
    type: 'adapter.claims',
    adapterId: 'muse',
    version: '1.0.0',
    requests: [REQUEST],
    claims: [CLAIM],
  }),
  'observer.observations': ObserverObservationsMessage.parse({
    type: 'observer.observations',
    observerId: 'gmail',
    version: '1.0.0',
    observations: [OBSERVATION],
  }),
  'coverage.ping': CoveragePingMessage.parse({
    type: 'coverage.ping',
    ping: {
      observerId: 'gmail',
      accountHash: HASH,
      lastSyncAt: TS,
      windowStart: '2026-10-01T08:00:00Z',
      windowEnd: TS,
      userActive: true,
    },
  }),
  'ui.query': UiQueryMessage.parse({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  'ui.result': UiResultMessage.parse({
    type: 'ui.result',
    kind: 'health.list',
    ok: true,
    data: [{ adapterId: 'muse' }],
  }),
  'ledger.changed': LedgerChangedMessage.parse({
    type: 'ledger.changed',
    tables: ['claims', 'receipts'],
    at: TS_OFFSET,
  }),
};

/**
 * One near-miss per type: right `type`, wrong payload. Several smuggle `SECRET` in a field the
 * schema does not name, which is exactly what strict objects exist to stop (Hard Rule 2).
 */
export const MALFORMED: Readonly<Record<BusMessageType, unknown>> = {
  'adapter.health': {
    ...VALID['adapter.health'],
    health: { ...VALID['adapter.health'].health, status: 'BROKEN' },
  },
  'adapter.claims': { ...VALID['adapter.claims'], claims: [{ ...CLAIM, body: SECRET }] },
  'observer.observations': {
    ...VALID['observer.observations'],
    observations: [{ ...OBSERVATION, body: SECRET }],
  },
  'coverage.ping': { type: 'coverage.ping', ping: { ...VALID['coverage.ping'].ping, account: SECRET } },
  'ui.query': { type: 'ui.query', query: { kind: 'ledger.wipe' } },
  'ui.result': { type: 'ui.result', kind: 'health.list', ok: false, error: SECRET },
  'ledger.changed': { type: 'ledger.changed', tables: ['claims'], at: '2026-10-01T09:30:00' },
};
