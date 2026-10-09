/**
 * Which page readers run (sprint_4 4.5, the options page's Adapters; Hard Rules 8, 11). Each reader is a content
 * script registered at runtime (entrypoints/content/<reader>.content.ts, WXT `registration: 'runtime'`; the `scripting`
 * permission): on, it is registered for its site's hosts (src/config.ts OBSERVER_HOSTS) and runs in each page of them
 * the person opens; off, its registration is removed (`chrome.scripting.unregisterContentScripts`), so no page opened
 * after that runs it. A tab already open keeps the script it has, but the service worker answers what that script
 * sends with `reader_off` (./router.ts): nothing of it is stored, and the script stops (src/observers/base.ts).
 *
 * The choice is kept in `chrome.storage.local` (`STORAGE_KEYS.READERS_OFF`: the readers that are off). Every reader is
 * on until the person turns it off, and again after Delete all data. A stored value that is not a list of readers
 * reads as every reader off (logged): a choice that cannot be read is never taken as consent to read. The
 * registrations follow the choice: at every start of the service worker, after each toggle and after a wipe,
 * `syncReaders` registers each reader that is on and not registered (or registered with other details, after an
 * update), and removes each that is off. One sync runs at a time.
 */
import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';

import { ackRefused, type BusAck, type ReaderToggleMessage, type SettingResult } from '../bus/messages';
import { OBSERVER_HOSTS, OBSERVER_SITES, type ReaderId, READERS, STORAGE_KEYS } from '../config';
import { log } from '../log';

type RegisteredScript = Browser.scripting.RegisteredContentScript;

/** The part of `chrome.scripting` the readers use. */
export interface ScriptingApi {
  getRegisteredContentScripts(): Promise<RegisteredScript[]>;
  registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
  updateContentScripts(scripts: RegisteredScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

/** The part of `chrome.storage.local` the readers use. */
export interface ReaderStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ReaderDeps {
  readonly scripting: ScriptingApi;
  readonly storage: ReaderStorage;
}

/** Chrome's own, in the service worker. */
export const BROWSER_READERS: ReaderDeps = {
  get scripting(): ScriptingApi {
    return browser.scripting;
  },
  get storage(): ReaderStorage {
    return browser.storage.local;
  },
};

/** The registration of `reader`'s content script: WXT builds it at `content-scripts/<name>.js`. */
export function scriptOf(reader: ReaderId): RegisteredScript {
  return {
    id: reader,
    matches: [...OBSERVER_HOSTS[reader]],
    js: [`content-scripts/${reader}.js`],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  };
}

const ReadersOff = z.array(z.enum(READERS)).max(READERS.length);

/** The readers that are off (header): none when nothing is stored, every one when what is stored is not a list. */
export async function readersOff(storage: ReaderStorage): Promise<ReadonlySet<ReaderId>> {
  const stored = (await storage.get(STORAGE_KEYS.READERS_OFF))[STORAGE_KEYS.READERS_OFF];
  if (stored === undefined) return new Set();
  const parsed = ReadersOff.safeParse(stored);
  if (parsed.success) return new Set(parsed.data);
  log.error('readers.choice_invalid');
  return new Set(READERS);
}

/** Whether `script` is registered as `scriptOf` would register it. */
function current(script: RegisteredScript, reader: ReaderId): boolean {
  const wanted = scriptOf(reader);
  return (
    JSON.stringify(script.matches) === JSON.stringify(wanted.matches) &&
    JSON.stringify(script.js) === JSON.stringify(wanted.js) &&
    script.runAt === wanted.runAt &&
    script.allFrames !== true
  );
}

/** One sync (header). */
async function syncOnce({ scripting, storage }: ReaderDeps): Promise<void> {
  const off = await readersOff(storage);
  const registered = new Map(
    (await scripting.getRegisteredContentScripts()).map((script) => [script.id, script]),
  );
  const remove = READERS.filter((reader) => off.has(reader) && registered.has(reader));
  const add = READERS.filter((reader) => !off.has(reader) && !registered.has(reader));
  const stale = READERS.filter((reader) => {
    const script = registered.get(reader);
    return !off.has(reader) && script !== undefined && !current(script, reader);
  });
  if (remove.length > 0) await scripting.unregisterContentScripts({ ids: [...remove] });
  if (add.length > 0) await scripting.registerContentScripts(add.map(scriptOf));
  if (stale.length > 0) await scripting.updateContentScripts(stale.map(scriptOf));
  if (remove.length + add.length + stale.length > 0) {
    log.info('readers.synced', { registered: add.length, removed: remove.length, updated: stale.length });
  }
}

let queue: Promise<void> = Promise.resolve();

/** Brings the registrations in line with the choice (header); one at a time, in call order. Rejects when it failed. */
export function syncReaders(deps: ReaderDeps = BROWSER_READERS): Promise<void> {
  const run = queue.then(() => syncOnce(deps));
  queue = run.catch(() => undefined);
  return run;
}

/** Turns `reader` on or off: the choice is stored, then the registrations follow it. */
export async function onReaderToggle(
  message: ReaderToggleMessage,
  deps: ReaderDeps = BROWSER_READERS,
): Promise<SettingResult> {
  try {
    const off = new Set(await readersOff(deps.storage));
    if (message.on) off.delete(message.reader);
    else off.add(message.reader);
    await deps.storage.set({ [STORAGE_KEYS.READERS_OFF]: READERS.filter((reader) => off.has(reader)) });
    await syncReaders(deps);
    log.info('readers.toggled', { reader: message.reader, on: message.on });
    return { ok: true };
  } catch (error) {
    log.error('readers.toggle_failed', { reader: message.reader, error });
    return { ok: false, code: 'failed' };
  }
}

/**
 * Null when the reader of `observerId` is on (or the id is no observer's: an agent adapter has no reader here);
 * otherwise the refusal `reader_off`, logged at debug with the observer id only. What ./router.ts asks of each
 * observer message, after its site is checked.
 */
export async function readerOff(
  observerId: string,
  deps: ReaderDeps = BROWSER_READERS,
): Promise<BusAck | null> {
  if (!Object.hasOwn(OBSERVER_SITES, observerId)) return null;
  const site = OBSERVER_SITES[observerId as keyof typeof OBSERVER_SITES];
  if (!(await readersOff(deps.storage)).has(site)) return null;
  log.debug('observer.reader_off', { observer: observerId });
  return ackRefused('reader_off');
}
