/**
 * Keeping the service worker running while the ledger is unlocked (sprint_6 6.5): the keys live in its memory only
 * (./crypto.ts), and Chrome stops a worker idle for 30 seconds, which would lock the ledger every half minute. Every
 * KEEP_AWAKE_MS it calls `runtime.getPlatformInfo`, a cheap extension API whose every call restarts that idle timer
 * (Chrome 110 and later), until the ledger is locked again or encryption turned off. It reads nothing and sends
 * nothing; a worker Chrome stops for any other reason (an update, a crash, the browser closing) loses the keys, and
 * the ledger stays locked until the passphrase is typed again.
 */
import { browser } from 'wxt/browser';

import { KEEP_AWAKE_MS } from '../config-crypto';
import { log } from '../log';

let timer: ReturnType<typeof setInterval> | undefined;

/** The call that restarts the idle timer. */
export type Ping = () => Promise<unknown>;

const platformInfo: Ping = () => browser.runtime.getPlatformInfo();

/** Starts keeping the worker running, if it is not already. */
export function keepAwake(ping: Ping = platformInfo): void {
  if (timer !== undefined) return;
  timer = setInterval(() => {
    ping().catch((error: unknown) => {
      log.warn('crypto.keep_awake_failed', { error });
    });
  }, KEEP_AWAKE_MS);
}

/** Lets the worker stop when idle again. */
export function letSleep(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

/** Whether the worker is being kept running. */
export const keptAwake = (): boolean => timer !== undefined;
