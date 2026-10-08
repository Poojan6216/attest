/**
 * Typed errors for the adapter skeleton, as ../observers/errors.ts is for observers: a closed `code`, and a message
 * built from that code only, so an uncaught one never prints page content (Hard Rule 10).
 *
 * These are developer errors, thrown when a content script starts: an adapter whose id, agent, version or hosts are
 * not what the contract allows. A pass never throws one; whatever goes wrong while reading a page becomes a DEGRADED
 * health report instead (Hard Rule 6). src/log.ts prints one as `AdapterError code=<code>` (src/log-vocabulary.ts).
 */

export const ADAPTER_ERROR_CODES = [
  /** The adapter's id, vendor or version is not a ComponentId, its agent is unknown, or a host is not its agent's. */
  'invalid_adapter',
] as const;

export type AdapterErrorCode = (typeof ADAPTER_ERROR_CODES)[number];

export class AdapterError extends Error {
  override readonly name = 'AdapterError';
  readonly code: AdapterErrorCode;

  constructor(code: AdapterErrorCode) {
    super(`adapter: ${code}`);
    this.code = code;
  }
}
