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
 *  3. `ui.query` comes from an extension page, never a content script, else drop `untrusted_context`;
 *  4. a handler exists for its type, else drop `no_handler`.
 * A dropped message gets no response (the listener returns false) and one `bus.dropped` warning.
 *
 * A handled message is always answered (classic protocol: return true, call `sendResponse` once the
 * handler settles), so the sender never sees a closed port for a message that was processed.
 * `ui.query` handlers answer with a `ui.result`, which is validated before it leaves; every other
 * handler is acknowledged with `undefined`, because only `ui.result` has a response schema.
 * The listener never throws.
 */
import { type Browser, browser } from 'wxt/browser';

import { log } from '../log';
import { BusError } from './errors';
import {
  BusMessage,
  type BusMessageOf,
  type BusMessageType,
  isBusMessageType,
  type UiQueryMessage,
  type UiResult,
  UiResultMessage,
  uiFailure,
} from './messages';

export type MessageSender = Browser.runtime.MessageSender;

/**
 * What a handler for `T` returns. A `ui.query` handler answers with a `ui.result` (validated before it
 * is sent). Any other handler may be sync or async; its promise is awaited so a rejection is logged,
 * but its value is never forwarded: the sender only receives an acknowledgement (`undefined`).
 */
export type BusHandlerResult<T extends BusMessageType> = T extends 'ui.query'
  ? UiResult | Promise<UiResult>
  : unknown;

export type BusHandler<T extends BusMessageType> = (
  message: BusMessageOf<T>,
  sender: MessageSender,
) => BusHandlerResult<T>;

export type BusHandlers = { readonly [T in BusMessageType]?: BusHandler<T> };

type SendResponse = (response?: unknown) => void;

type DropReason = 'foreign_sender' | 'malformed' | 'untrusted_context' | 'no_handler';

/** Message types that only an extension page (popup, side panel, options) may send. */
const EXTENSION_PAGE_ONLY: ReadonlySet<BusMessageType> = new Set<BusMessageType>(['ui.query']);

function typeOf(raw: unknown): BusMessageType | undefined {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return undefined;
  return isBusMessageType(raw.type) ? raw.type : undefined;
}

/** Logs a drop. The type is logged only when it is one of ours; nothing else from the message is. */
function drop(reason: DropReason, raw: unknown): false {
  const type = typeOf(raw);
  log.warn('bus.dropped', type === undefined ? { reason } : { reason, type });
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

/** Runs the handler, then answers exactly once. Never rejects. */
async function deliver(message: BusMessage, run: () => unknown, sendResponse: SendResponse): Promise<void> {
  let response: unknown;
  try {
    const value: unknown = await run();
    response = message.type === 'ui.query' ? checkedResult(message, value) : undefined;
  } catch (error) {
    log.error('bus.handler_failed', { type: message.type, error });
    response = message.type === 'ui.query' ? uiFailure(message.query.kind, 'handler_failed') : undefined;
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
