/**
 * Which page readers run (sprint_4 4.5, the options page's Adapters; Hard Rules 8, 11). Each reader is a content
 * script registered at runtime (entrypoints/content/<reader>.content.ts, WXT `registration: 'runtime'`; the `scripting`
 * permission): on, it is registered for its site's hosts (src/config.ts OBSERVER_HOSTS) and runs in each page of them
 * the person opens; off, its registration is removed (`chrome.scripting.unregisterContentScripts`), so no page opened
 * after that runs it. A tab already open keeps the script it has, but the service worker answers what that script
 * sends with `reader_off` (./router.ts): nothing of it is stored, and the script stops (src/observers/base.ts).
 *
 * The choice is kept in ledger meta (src/ledger/consent.ts; sprint_4 close, security review SEC-3), where no script on
 * a vendor page can write it. Every reader is on until the person turns it off; one turned off stays off across Delete
 * all data (./settings.ts). A stored value that cannot be read reads as that reader off (logged): a choice that cannot be
 * read is never taken as consent to read. The registrations follow the choice: after an install or update, at a browser
 * start, after each toggle and after a wipe (entrypoints/background.ts), `syncReaders` registers each reader that is on
 * and not registered (or registered with other details, after an update), and removes each that is off. One sync runs
 * at a time.
 */
import { browser, type Browser } from 'wxt/browser';

import {
  ackRefused,
  type BusAck,
  type LedgerTable,
  type ReaderToggleMessage,
  type SettingResult,
} from '../bus/messages';
import { OBSERVER_HOSTS, OBSERVER_SITES, type ReaderId, READERS } from '../config';
import { readersOff, saveReaderOff } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { getLedger } from '../ledger/shared';
import { log } from '../log';

type RegisteredScript = Browser.scripting.RegisteredContentScript;

/** The part of `chrome.scripting` the readers use. */
export interface ScriptingApi {
  getRegisteredContentScripts(): Promise<RegisteredScript[]>;
  registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
  updateContentScripts(scripts: RegisteredScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

export interface ReaderDeps {
  readonly scripting: ScriptingApi;
  /** The ledger, where the choice is kept. */
  readonly db: () => Promise<LedgerDb>;
}

/** Chrome's own, in the service worker, and the shared ledger. */
export const BROWSER_READERS: ReaderDeps = {
  get scripting(): ScriptingApi {
    return browser.scripting;
  },
  db: getLedger,
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
async function syncOnce({ scripting, db }: ReaderDeps): Promise<void> {
  const off = await readersOff(await db());
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

/**
 * Turns `reader` on or off: the choice is stored, then the registrations follow it, and open pages are told (`meta`).
 */
export async function onReaderToggle(
  message: ReaderToggleMessage,
  deps: ReaderDeps = BROWSER_READERS,
  notify: (tables: readonly LedgerTable[]) => void = () => undefined,
): Promise<SettingResult> {
  try {
    await saveReaderOff(await deps.db(), message.reader, !message.on);
  } catch (error) {
    log.error('readers.toggle_failed', { reader: message.reader, error });
    return { ok: false, code: 'failed' };
  }
  notify(['meta']);
  try {
    await syncReaders(deps);
  } catch (error) {
    log.error('readers.toggle_failed', { reader: message.reader, error });
    return { ok: false, code: 'failed' };
  }
  log.info('readers.toggled', { reader: message.reader, on: message.on });
  return { ok: true };
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
  if (!(await readersOff(await deps.db())).has(site)) return null;
  log.debug('observer.reader_off', { observer: observerId });
  return ackRefused('reader_off');
}
