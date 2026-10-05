/**
 * Typed errors for the observer skeleton. An `ObserverError` carries a closed `code` and a message built from that
 * code only, so an uncaught one never prints page content (Hard Rule 10).
 *
 * These are developer errors, thrown when a content script starts: an observer whose id, version, source or hosts
 * are not what the contract allows, timing options that cannot batch, or a shipped selectors.json that fails its
 * schema. A pass never throws one; whatever goes wrong while reading a page becomes a DEGRADED health report instead
 * (Hard Rule 6). src/log.ts prints one as `ObserverError code=<code>` (src/log-vocabulary.ts).
 */

export const OBSERVER_ERROR_CODES = [
  /** The observer's id, vendor or version is not a ComponentId, its source is unknown, or a host is not ours. */
  'invalid_observer',
  /** Batching options that are not positive integers with the debounce no longer than the max wait. */
  'invalid_options',
  /** An observer's shipped selectors.json fails its schema when the content script loads it (TECH-3). */
  'invalid_selectors',
] as const;

export type ObserverErrorCode = (typeof OBSERVER_ERROR_CODES)[number];

export class ObserverError extends Error {
  override readonly name = 'ObserverError';
  readonly code: ObserverErrorCode;

  constructor(code: ObserverErrorCode) {
    super(`observer: ${code}`);
    this.code = code;
  }
}
