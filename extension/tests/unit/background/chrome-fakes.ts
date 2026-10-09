/**
 * What the fake browser (wxt/testing/fake-browser) leaves out of the APIs the background entry registers at start
 * (sprint_3 3.14): Chrome exposes `idle` only while its optional permission is held, so a fresh install has none, and
 * the fake leaves `permissions.onAdded` and `onRemoved` unimplemented. `asFreshInstall` makes the fake behave as
 * Chrome does on a fresh install: no `idle`, and permission listeners accepted.
 */
import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

export function asFreshInstall(): void {
  Object.defineProperty(fakeBrowser, 'idle', { value: undefined, configurable: true, writable: true });
  vi.spyOn(fakeBrowser.permissions.onAdded, 'addListener').mockImplementation(() => undefined);
  vi.spyOn(fakeBrowser.permissions.onRemoved, 'addListener').mockImplementation(() => undefined);
}
