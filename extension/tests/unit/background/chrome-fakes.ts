/**
 * What the fake browser (wxt/testing/fake-browser) leaves out of the APIs the background entry registers at start
 * (sprint_3 3.14): Chrome exposes `idle` only while its optional permission is held, so a fresh install has none, and
 * the fake leaves `permissions.onAdded` and `onRemoved` unimplemented. Nor has it `chrome.scripting`, with which the
 * service worker registers the page readers' content scripts (sprint_4 4.5). `asFreshInstall` makes the fake behave as
 * Chrome does on a fresh install: no `idle`, permission listeners accepted, and a `scripting` with nothing registered.
 */
import { vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { ScriptingApi } from '../../../src/background/readers';

type RegisteredScript = Browser.scripting.RegisteredContentScript;

/** A `chrome.scripting` that keeps the registered content scripts by id, as Chrome does. */
export interface FakeScripting extends ScriptingApi {
  readonly registered: Map<string, RegisteredScript>;
}

/**
 * A stand-in for `chrome.scripting`: like Chrome, it refuses to register an id it holds, or to update or unregister
 * one it does not, and changes nothing when it refuses.
 */
export function fakeScripting(): FakeScripting {
  const registered = new Map<string, RegisteredScript>();
  const holds = (ids: readonly string[], held: boolean): void => {
    const wrong = ids.find((id) => registered.has(id) !== held);
    if (wrong !== undefined) throw new Error(`${held ? 'Nonexistent' : 'Duplicate'} script ID '${wrong}'`);
  };
  return {
    registered,
    getRegisteredContentScripts: () =>
      Promise.resolve([...registered.values()].map((script) => ({ ...script }))),
    registerContentScripts: (scripts) => {
      holds(
        scripts.map(({ id }) => id),
        false,
      );
      for (const script of scripts) registered.set(script.id, { ...script });
      return Promise.resolve();
    },
    updateContentScripts: (scripts) => {
      holds(
        scripts.map(({ id }) => id),
        true,
      );
      for (const script of scripts) registered.set(script.id, { ...script });
      return Promise.resolve();
    },
    unregisterContentScripts: ({ ids }) => {
      holds(ids, true);
      for (const id of ids) registered.delete(id);
      return Promise.resolve();
    },
  };
}

/** Puts a fresh `fakeScripting` on the fake browser as `scripting`, and returns it. */
export function withScripting(): FakeScripting {
  const scripting = fakeScripting();
  Object.defineProperty(fakeBrowser, 'scripting', { value: scripting, configurable: true, writable: true });
  return scripting;
}

export function asFreshInstall(): FakeScripting {
  Object.defineProperty(fakeBrowser, 'idle', { value: undefined, configurable: true, writable: true });
  vi.spyOn(fakeBrowser.permissions.onAdded, 'addListener').mockImplementation(() => undefined);
  vi.spyOn(fakeBrowser.permissions.onRemoved, 'addListener').mockImplementation(() => undefined);
  return withScripting();
}
