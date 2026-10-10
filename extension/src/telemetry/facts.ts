/**
 * What the telemetry payload holds that the ledger does not (sprint_5 5.7; ./aggregate.ts `TelemetryFacts`): the
 * install id (src/ledger/install-id.ts, a random UUID the person can reset), the extension's version from its manifest,
 * and Chrome's major version from the user agent, null when it names none. The service worker and the options page read
 * them alike, so the page shows the payload the worker would send; the page only reads the id, never makes one.
 */
import { browser } from 'wxt/browser';

import { getInstallId } from '../ledger/install-id';
import type { TelemetryFacts } from './aggregate';
import { chromeMajorOf } from './chrome-major';

export { chromeMajorOf } from './chrome-major';

/**
 * This browser's facts (header), the install id read by `installId`: the service worker's `getInstallId`, which makes a
 * new id when none is stored (src/ledger/install-id.ts), or a page's `readInstallId`, which never writes. None without
 * an id.
 */
export async function telemetryFacts(
  installId: () => Promise<string | null> = getInstallId,
): Promise<TelemetryFacts | null> {
  const id = await installId();
  if (id === null) return null;
  return {
    installId: id,
    extVersion: browser.runtime.getManifest().version,
    chromeMajor: chromeMajorOf(navigator.userAgent),
  };
}
