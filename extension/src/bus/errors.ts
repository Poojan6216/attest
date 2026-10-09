/**
 * Typed errors for the message bus.
 *
 * A `BusError` carries a string-literal `code` and a fixed message built from that code only, so an
 * uncaught one never prints content (Hard Rule 10). `src/log.ts` prints `BusError code=<code>`.
 */

export const BUS_ERROR_CODES = [
  /** `send()` refused a message that does not match the bus schema. Nothing was sent. */
  'invalid_outgoing',
  /** Nobody was listening (Chrome: "Receiving end does not exist"). */
  'no_receiver',
  /** A receiver took the message but closed the channel without answering. */
  'port_closed',
  /** This context is orphaned: the extension was reloaded or updated under it. */
  'context_invalidated',
  /** Any other transport failure. */
  'send_failed',
  /** A `ui.query` handler answered with something that is not a `ui.result` for that kind. */
  'invalid_result',
  /** An acknowledged message (src/bus/messages.ts ACKED_TYPES) was answered with something that is not a BusAck. */
  'invalid_reply',
  /** The service worker answered an acknowledged message with `{ ok: false }`: it refused (part of) it. */
  'refused',
  /** It answered `reader_off`: the person turned this page's reader off (sprint_4 4.5); the observer stops. */
  'reader_off',
] as const;

export type BusErrorCode = (typeof BUS_ERROR_CODES)[number];

export class BusError extends Error {
  override readonly name = 'BusError';
  readonly code: BusErrorCode;

  /** `cause` keeps the underlying error for a debugger; the logger never prints it. */
  constructor(code: BusErrorCode, options?: { readonly cause?: unknown }) {
    super(`bus: ${code}`, options);
    this.code = code;
  }
}

/**
 * Chrome reports transport failures as English strings on `runtime.lastError` (or as the rejection
 * message). They are stable but never logged; this maps them to a code that is safe to log.
 */
export function transportErrorCode(message: string | undefined): BusErrorCode {
  if (message === undefined) return 'send_failed';
  if (message.includes('Receiving end does not exist')) return 'no_receiver';
  if (message.includes('message port closed') || message.includes('message channel closed')) {
    return 'port_closed';
  }
  if (message.includes('Extension context invalidated')) return 'context_invalidated';
  return 'send_failed';
}
