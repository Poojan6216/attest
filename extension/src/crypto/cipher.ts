/**
 * The cipher the sealing middleware seals and opens rows with (./seal.ts: @noble/ciphers' AES-GCM), loaded only once a
 * ledger may hold sealed rows (src/ledger/crypto-state.ts `loadKeyring`): a ledger that was never encrypted never loads
 * it, so the popup's start does not carry it (Sprint 6 close, tech review TECH-1). Until it is loaded, a sealed row can
 * be neither read nor written: the middleware fails as locked, as it does with no key held.
 */
import type * as SealModule from './seal';

export type Cipher = Pick<typeof SealModule, 'seal' | 'open'>;

let loaded: Cipher | undefined;

/**
 * Gives this context the cipher it already holds: the service worker, at its start, from its own static import
 * (src/background/crypto.ts). Chrome refuses `import()` in a service worker, so `loadCipher` there would throw.
 */
export function provideCipher(given: Cipher): void {
  loaded = given;
}

/** Loads the cipher, once: a page's own `import()`; in the service worker, the one it provided at its start. */
export async function loadCipher(): Promise<void> {
  loaded ??= await import('./seal');
}

/** The cipher, once loaded. */
export const cipher = (): Cipher | undefined => loaded;
