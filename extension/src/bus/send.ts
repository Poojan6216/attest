/**
 * Outgoing side of the bus.
 *
 * `send()` never sends an invalid message: it parses first and throws `BusError('invalid_outgoing')`
 * on failure. Transport failures (nobody listening, channel closed, orphaned context) are logged and
 * resolve `undefined`; a sender of a fire-and-forget message never has to catch.
 *
 * The callback form of `runtime.sendMessage` is used because it is the only form in which Chrome
 * reports errors through `runtime.lastError`, and reading `lastError` inside the callback is what
 * marks it as checked. A synchronous throw (e.g. "Extension context invalidated") is caught too.
 */
import { browser } from 'wxt/browser';

import { log } from '../log';
import { BusError, transportErrorCode } from './errors';
import {
  BusMessage,
  type BusMessageType,
  type UiQuery,
  type UiResult,
  UiResultMessage,
  uiFailure,
} from './messages';

/**
 * Notices sent to whoever is listening. With no UI page open nobody is, and Chrome reports no_receiver:
 * that is expected, so it is logged at debug instead of warn (every other failure stays a warning).
 */
export const BROADCAST_TYPES: ReadonlySet<BusMessageType> = new Set<BusMessageType>(['ledger.changed']);

/** Hands a validated message to Chrome. Rejects only with a `BusError` whose code names the failure. */
function transmit(message: BusMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    try {
      browser.runtime.sendMessage(message, (response: unknown) => {
        const lastError = browser.runtime.lastError;
        if (lastError !== undefined) {
          reject(new BusError(transportErrorCode(lastError.message)));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      const code = transportErrorCode(error instanceof Error ? error.message : undefined);
      reject(new BusError(code, { cause: error }));
    }
  });
}

/**
 * Validates and sends one message. Resolves the receiver's response, or `undefined` when the
 * transport failed (logged as `bus.send_failed`: warn, or debug for a broadcast nobody was listening to).
 * Rejects only with `BusError('invalid_outgoing')`.
 */
export async function send(message: BusMessage): Promise<unknown> {
  const parsed = BusMessage.safeParse(message);
  if (!parsed.success) throw new BusError('invalid_outgoing');
  const { type } = parsed.data;
  try {
    return await transmit(parsed.data);
  } catch (error) {
    const expected = BROADCAST_TYPES.has(type) && error instanceof BusError && error.code === 'no_receiver';
    if (expected) log.debug('bus.send_failed', { type, error });
    else log.warn('bus.send_failed', { type, error });
    return undefined;
  }
}

function unavailable(query: UiQuery, response: unknown, reason: string): UiResult {
  log.warn('bus.query_unavailable', {
    kind: query.kind,
    reason: response === undefined ? 'no_response' : reason,
  });
  return uiFailure(query.kind, 'unavailable');
}

/**
 * Asks the service worker a question. For a valid `query` it always resolves a `ui.result` for
 * `query.kind`: an absent, malformed, or mismatched answer becomes `{ ok: false, error: 'unavailable' }`.
 * An invalid `query` is never sent: like `send()`, it rejects with `BusError('invalid_outgoing')`.
 * The caller re-parses `data` with the schema owned by the module that answers that kind.
 */
export async function query(query: UiQuery): Promise<UiResult> {
  const response = await send({ type: 'ui.query', query });
  const parsed = UiResultMessage.safeParse(response);
  if (!parsed.success) return unavailable(query, response, 'malformed_result');
  if (parsed.data.kind !== query.kind) return unavailable(query, response, 'kind_mismatch');
  return parsed.data;
}
