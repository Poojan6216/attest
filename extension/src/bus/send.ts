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
 *
 * Acknowledged messages (observer health, rows, coverage and snapshots: messages.ts ACKED_TYPES) go through
 * `sendChecked`, which never resolves `undefined`: it resolves the service worker's `BusAck` and rejects on a
 * transport failure or a malformed answer, so a content script knows whether what it posted was stored (sprint_2
 * 2.7 interface 6). `postAcked` is the observer skeleton's `post`: it also rejects on `{ ok: false }`.
 */
import { browser } from 'wxt/browser';
import type { z } from 'zod';

import type { AgentId, Claim, IsoTs } from '../core/schema';
import { log } from '../log';
import { BusError, transportErrorCode } from './errors';
import {
  BusAck,
  BusMessage,
  type BusMessageType,
  type ByoForgetMessage,
  type ByoSaveMessage,
  type TelemetrySendResult,
  type ClaimsImportResult,
  type FlagSetMessage,
  type GrantSaveMessage,
  type GrantSaveResult,
  isAckedType,
  type LedgerWipeMessage,
  PAGE_COMMAND_RESULTS,
  type PageCommand,
  type PageCommandResult,
  type ReaderToggleMessage,
  type ReceiptEventMessage,
  type ReceiptEventResult,
  type RetentionSaveMessage,
  type SettingResult,
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

/** The table of answers, each command's schema typed by its own result, so the one sender reads it with no cast. */
const ANSWERS: { readonly [K in PageCommand]: z.ZodType<PageCommandResult<K>> } = PAGE_COMMAND_RESULTS;

/**
 * Sends one of a person's commands from an extension page (messages.ts `PAGE_COMMAND_RESULTS`) and resolves its
 * answer: for a valid message it always resolves, an absent or malformed answer becoming `{ ok: false, code: 'failed' }`
 * (logged as `bus.command_unavailable`, with the type and why). An invalid message is never sent: it is logged
 * (`bus.command_refused`, with the type) and rejects with `BusError('invalid_outgoing')`. Nothing a person wrote is
 * logged (a mark's reason, a grant's domains). One sender for every command (sprint_4 close, tech review TECH-8).
 */
async function sendCommand<T extends PageCommand>(
  message: BusMessage & { readonly type: T },
): Promise<PageCommandResult<T>> {
  let response: unknown;
  try {
    response = await send(message);
  } catch (error) {
    log.warn('bus.command_refused', { type: message.type, error });
    throw error;
  }
  const answers = ANSWERS[message.type];
  const parsed = answers.safeParse(response);
  if (parsed.success) return parsed.data;
  const reason = response === undefined ? 'no_response' : 'malformed_result';
  log.warn('bus.command_unavailable', { type: message.type, reason });
  return answers.parse({ ok: false, code: 'failed' });
}

/** Sends claims the person pasted (sprint_3 3.13), with the minutes the log's timed entries name (`sendCommand`). */
export async function importClaims(
  agent: AgentId,
  claims: readonly Claim[],
  activeAt: readonly IsoTs[],
): Promise<ClaimsImportResult> {
  return sendCommand({ type: 'claims.import', agent, claims: [...claims], activeAt: [...activeAt] });
}

/** Sends a person's override or revert of one receipt (sprint_4 4.3; `sendCommand`: the reason is never logged). */
export async function sendReceiptEvent(
  receiptId: ReceiptEventMessage['receiptId'],
  event: ReceiptEventMessage['event'],
): Promise<ReceiptEventResult> {
  return sendCommand({ type: 'receipt.event', receiptId, event });
}

/** Sends a person's grant for one agent, and whether its alerts are muted (sprint_4 4.4; `sendCommand`). */
export async function sendGrant(
  grant: GrantSaveMessage['grant'],
  alertsMuted: boolean,
): Promise<GrantSaveResult> {
  return sendCommand({ type: 'grant.save', grant, alertsMuted });
}

/** Sends one of a person's settings (sprint_4 4.5: retention, a reader, Delete all data; 4.9: a flag; `sendCommand`). */
export async function sendSetting(
  message:
    | RetentionSaveMessage
    | ReaderToggleMessage
    | FlagSetMessage
    | ByoSaveMessage
    | ByoForgetMessage
    | LedgerWipeMessage,
): Promise<SettingResult> {
  return sendCommand(message);
}

/** Asks the service worker to send the opt-in telemetry's last whole day now, if it is due (sprint_5 5.7; `sendCommand`). */
export async function sendTelemetryNow(): Promise<TelemetrySendResult> {
  return sendCommand({ type: 'telemetry.send' });
}

/**
 * Sends one acknowledged message (messages.ts ACKED_TYPES) and resolves the service worker's `BusAck`, whether it
 * says `ok` or not. Rejects with a `BusError`: `invalid_outgoing` (an invalid or unacknowledged message, never
 * sent), the transport's code (`no_receiver`, `port_closed`, `context_invalidated`, `send_failed`), or
 * `invalid_reply` (the answer is not a `BusAck`). Each failure is logged as `bus.send_failed` (warn).
 */
export async function sendChecked(message: BusMessage): Promise<BusAck> {
  const parsed = BusMessage.safeParse(message);
  if (!parsed.success || !isAckedType(parsed.data.type)) throw new BusError('invalid_outgoing');
  const { type } = parsed.data;
  let response: unknown;
  try {
    response = await transmit(parsed.data);
  } catch (error) {
    log.warn('bus.send_failed', { type, error });
    throw error;
  }
  const ack = BusAck.safeParse(response);
  if (ack.success) return ack.data;
  const invalid = new BusError('invalid_reply');
  log.warn('bus.send_failed', { type, error: invalid });
  throw invalid;
}

/**
 * Whether this context can still reach the extension (Decisions [2.close] S5, SEC-3). Chrome clears `runtime.id` in a
 * content script whose extension was reloaded, updated or removed under the page; every message it posts then fails
 * with `context_invalidated`. The observer skeleton stops only on this, or on that failure, never on a signal the page
 * can send (WXT's start-up event). Never throws: a runtime that cannot be read is gone.
 */
export function extensionContextAlive(): boolean {
  try {
    const runtime: unknown = Reflect.get(browser, 'runtime');
    return typeof runtime === 'object' && runtime !== null && typeof Reflect.get(runtime, 'id') === 'string';
  } catch {
    return false;
  }
}

/**
 * The `post` a content script gives the observer skeleton (src/observers/base.ts `Post`): resolves once the service
 * worker stored the message, and rejects with a `BusError` when it refused any of it (`refused`, or `reader_off` when
 * the person turned this page's reader off; the refusal's code is logged at debug as `bus.refused`) or the message
 * never arrived. The skeleton then stops the pass, so no coverage follows a row that was not stored (Hard Rule 5), and
 * on `reader_off` it stops the observer.
 */
export async function postAcked(message: BusMessage): Promise<void> {
  const ack = await sendChecked(message);
  if (ack.ok) return;
  log.debug('bus.refused', { type: message.type, code: ack.code });
  throw new BusError(ack.code === 'reader_off' ? 'reader_off' : 'refused');
}
