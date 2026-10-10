/**
 * Chrome's `storage.<area>.setAccessLevel` (Chrome 102 and later), which wxt's fake browser lacks: a setup file of the
 * main run (vitest.config.ts) gives each storage area one that records the level it was given, so a test can read
 * which areas the extension closed to content scripts (src/background/byo.ts `closeStorage`; sprint_5 5.3). Set
 * before each test, since a test may reset the fake browser.
 */
import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/** The access level each storage area was last given, by area name. */
export const accessLevels = new Map<string, unknown>();

beforeEach(() => {
  accessLevels.clear();
  for (const name of ['local', 'session', 'sync'] as const) {
    Reflect.set(fakeBrowser.storage[name], 'setAccessLevel', (options: { accessLevel: unknown }) => {
      accessLevels.set(name, options.accessLevel);
      return Promise.resolve();
    });
  }
});
