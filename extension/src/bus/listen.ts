/**
 * Incoming side of the bus.
 *
 * MV3: call `listen()` synchronously while the context starts (top level of the service worker's
 * `main()`), never after an `await` or inside a callback; Chrome only wakes a restarted worker for
 * listeners registered in its first turn. `attest/top-level-listeners` lints `src/bus/**` and the
 * background entry for this.
 *
 * Order of checks for every message, cheapest and most suspicious first:
 *  1. sender is this extension (`sender.id === runtime.id`, both known), else drop `foreign_sender`;
 *     this runs before parsing, so a foreign message is never parsed (only `type` is read, for the log);
 *  2. it parses as a `BusMessage`, else drop `malformed` (unknown types land here too);
 *  3. `ui.query` and the pages' commands (`claims.import`, and ./page-commands.ts: `receipt.event`, `grant.save`,
 *     `retention.save`, `reader.toggle`, `ledger.wipe`) come from an extension page, never a content script, else drop
 *     `untrusted_context`;
 *  4. a handler exists for its type, else drop `no_handler`.
 * A dropped message gets no response (the listener returns false) and one `bus.dropped` record: a warning,
 * except `no_handler`, which is expected wherever several contexts listen (every open extension page sees
 * every message) and is logged at debug.
 *
 * A handled message is always answered (classic protocol: return true, call `sendResponse` once the
 * handler settles), so the sender never sees a closed port for a message that was processed.
 * `ui.query` handlers answer with a `ui.result`, each page command's handler with its own result (`ClaimsImportResult`,
 * `ReceiptEventResult`, `GrantSaveResult`, `SettingResult`), and the handlers of acknowledged messages (observer
 * health, rows, coverage and snapshots: messages.ts ACKED_TYPES) with a `BusAck`; each answer is validated before it leaves, and
 * a handler that throws or answers badly is answered `handler_failed` / `{ ok: false, code: 'failed' }` and logged
 * at error (fail loud). Every other handler is acknowledged with `undefined`. The listener never throws.
 */
import { type Browser, browser } from 'wxt/browser';

import { log } from '../log';
import { BusError } from './errors';
import {
  type AckedType,
  ackRefused,
  BusAck,
  BusMessage,
  type BusMessageOf,
  ClaimsImportResult,
  type BusMessageType,
  GrantSaveResult,
  ReceiptEventResult,
  SettingResult,
  isAckedType,
  isBusMessageType,
  type UiQueryMessage,
  type UiResult,
  UiResultMessage,
  uiFailure,
} from './messages';

export type MessageSender = Browser.runtime.MessageSender;

/**
 * What a handler for `T` returns. A `ui.query` handler answers with a `ui.result`, and the handler of an
 * acknowledged message with a `BusAck` (each validated before it is sent). Any other handler may be sync or async;
 * its promise is awaited so a rejection is logged, but its value is never forwarded: the sender only receives an
 * acknowledgement (`undefined`).
 */
export type BusHandlerResult<T extends BusMessageType> = T extends 'ui.query'
  ? UiResult | Promise<UiResult>
  : T extends 'claims.import'
    ? ClaimsImportResult | Promise<ClaimsImportResult>
    : T extends 'receipt.event'
      ? ReceiptEventResult | Promise<ReceiptEventResult>
      : T extends 'grant.save'
        ? GrantSaveResult | Promise<GrantSaveResult>
        : T extends SettingCommand
          ? SettingResult | Promise<SettingResult>
          : T extends AckedType
            ? BusAck | Promise<BusAck>
            : unknown;

/** The page commands that answer a `SettingResult`. */
type SettingCommand = 'retention.save' | 'reader.toggle' | 'ledger.wipe';

export type BusHandler<T extends BusMessageType> = (
  message: BusMessageOf<T>,
  sender: MessageSender,
) => BusHandlerResult<T>;

export type BusHandlers = { readonly [T in BusMessageType]?: BusHandler<T> };

type SendResponse = (response?: unknown) => void;

export const DROP_REASONS = ['foreign_sender', 'malformed', 'untrusted_context', 'no_handler'] as const;

type DropReason = (typeof DROP_REASONS)[number];

/** Message types that only an extension page (popup, side panel, options) may send. */
const EXTENSION_PAGE_ONLY: ReadonlySet<BusMessageType> = new Set<BusMessageType>([
  'ui.query',
  'claims.import',
  'receipt.event',
  'grant.save',
  'retention.save',
  'reader.toggle',
  'ledger.wipe',
]);

function typeOf(raw: unknown): BusMessageType | undefined {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return undefined;
  return isBusMessageType(raw.type) ? raw.type : undefined;
}

/**
 * Logs a drop. The type is logged only when it is one of ours; nothing else from the message is.
 * `no_handler` is routine (a page that does not handle `ledger.changed` still receives it), so it is debug.
 */
function drop(reason: DropReason, raw: unknown): false {
  const type = typeOf(raw);
  if (reason === 'no_handler') log.debug('bus.dropped', type === undefined ? { reason } : { reason, type });
  else log.warn('bus.dropped', type === undefined ? { reason } : { reason, type });
  return false;
}

/**
 * Only this extension's own contexts may use the bus. Fails closed: when either id is unknown (an
 * orphaned context reports `runtime.id` as undefined), `undefined === undefined` must not let a
 * message through.
 */
function fromThisExtension(sender: MessageSender): boolean {
  return sender.id !== undefined && sender.id === browser.runtime.id;
}

/** An extension page (popup, side panel, options) sits under our origin; a content script never does. */
function fromExtensionPage(sender: MessageSender): boolean {
  return sender.url?.startsWith(browser.runtime.getURL('')) === true;
}

function handlerFor<T extends BusMessageType>(handlers: BusHandlers, type: T): BusHandler<T> | undefined {
  return handlers[type];
}

/** The validated answer to a query, or a `handler_failed` result if the handler answered badly. */
function checkedResult(message: UiQueryMessage, value: unknown): UiResult {
  const parsed = UiResultMessage.safeParse(value);
  if (parsed.success && parsed.data.kind === message.query.kind) return parsed.data;
  log.error('bus.handler_failed', { type: message.type, error: new BusError('invalid_result') });
  return uiFailure(message.query.kind, 'handler_failed');
}

/** The validated acknowledgement, or `{ ok: false, code: 'failed' }` if the handler answered badly. */
function checkedAck(message: BusMessage, value: unknown): BusAck {
  const parsed = BusAck.safeParse(value);
  if (parsed.success) return parsed.data;
  log.error('bus.handler_failed', { type: message.type, error: new BusError('invalid_reply') });
  return ackRefused('failed');
}

/** The answer schema of each command an extension page sends, each answering `{ ok: false, code: 'failed' }` on failure. */
const PAGE_RESULTS = {
  'claims.import': ClaimsImportResult,
  'receipt.event': ReceiptEventResult,
  'grant.save': GrantSaveResult,
  'retention.save': SettingResult,
  'reader.toggle': SettingResult,
  'ledger.wipe': SettingResult,
} as const satisfies Record<SettingCommand | 'claims.import' | 'receipt.event' | 'grant.save', unknown>;

type PageCommand = keyof typeof PAGE_RESULTS;

const isPageCommand = (type: string): type is PageCommand => Object.hasOwn(PAGE_RESULTS, type);

/** The validated answer to a page's command, or `{ ok: false, code: 'failed' }` if the handler answered badly. */
function checkedCommand(message: BusMessage, type: PageCommand, value: unknown): unknown {
  const parsed = PAGE_RESULTS[type].safeParse(value);
  if (parsed.success) return parsed.data;
  log.error('bus.handler_failed', { type: message.type, error: new BusError('invalid_reply') });
  return { ok: false, code: 'failed' };
}

/** The answer to a message whose handler settled with `value`. */
function answerOf(message: BusMessage, value: unknown): unknown {
  if (message.type === 'ui.query') return checkedResult(message, value);
  if (isPageCommand(message.type)) return checkedCommand(message, message.type, value);
  return isAckedType(message.type) ? checkedAck(message, value) : undefined;
}

/** The answer to a message whose handler threw. */
function failureOf(message: BusMessage): unknown {
  if (message.type === 'ui.query') return uiFailure(message.query.kind, 'handler_failed');
  if (isPageCommand(message.type)) return { ok: false, code: 'failed' };
  return isAckedType(message.type) ? ackRefused('failed') : undefined;
}

/** Runs the handler, then answers exactly once. Never rejects. */
async function deliver(message: BusMessage, run: () => unknown, sendResponse: SendResponse): Promise<void> {
  let response: unknown;
  try {
    response = answerOf(message, await run());
  } catch (error) {
    log.error('bus.handler_failed', { type: message.type, error });
    response = failureOf(message);
  }
  try {
    sendResponse(response);
  } catch (error) {
    log.warn('bus.respond_failed', { type: message.type, error });
  }
}

function receive(
  handlers: BusHandlers,
  raw: unknown,
  sender: MessageSender,
  sendResponse: SendResponse,
): boolean {
  if (!fromThisExtension(sender)) return drop('foreign_sender', raw);
  const parsed = BusMessage.safeParse(raw);
  if (!parsed.success) return drop('malformed', raw);
  const message = parsed.data;
  if (EXTENSION_PAGE_ONLY.has(message.type) && !fromExtensionPage(sender)) {
    return drop('untrusted_context', message);
  }
  const handler = handlerFor(handlers, message.type);
  if (handler === undefined) return drop('no_handler', message);
  void deliver(message, () => handler(message, sender), sendResponse);
  return true;
}

/**
 * Registers exactly one `runtime.onMessage` listener, synchronously, and returns a function that
 * removes it. Call it once per context, at startup.
 */
export function listen(handlers: BusHandlers): () => void {
  const listener = (raw: unknown, sender: MessageSender, sendResponse: SendResponse): boolean => {
    try {
      return receive(handlers, raw, sender, sendResponse);
    } catch (error) {
      // Touch nothing on `raw` or `sender` here: whatever threw may throw again.
      log.error('bus.listener_failed', { error });
      return false;
    }
  };
  browser.runtime.onMessage.addListener(listener);
  return () => {
    browser.runtime.onMessage.removeListener(listener);
  };
}
