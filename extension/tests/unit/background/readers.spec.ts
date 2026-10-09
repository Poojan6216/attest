/**
 * The page readers (sprint_4 4.5; src/background/readers.ts): every reader is registered until the person turns it
 * off; turning one off removes its registration (`chrome.scripting.unregisterContentScripts`) and turning it on
 * registers it again; a registration with other details is updated; a choice that cannot be read is no consent to
 * read; and the service worker answers what a reader that is off sends with `reader_off`, storing nothing.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  onReaderToggle,
  type ReaderDeps,
  readerOff,
  readersOff,
  scriptOf,
  syncReaders,
} from '../../../src/background/readers';
import { createHandlers } from '../../../src/background/router';
import { STORAGE_KEYS } from '../../../src/config';
import { closeLedger, getLedger } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { contentScript, VALID } from '../bus/harness';
import { type FakeScripting, fakeScripting } from './chrome-fakes';

let scripting: FakeScripting;
let deps: ReaderDeps;
let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  scripting = fakeScripting();
  deps = { scripting, storage: browser.storage.local };
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  restore();
  await closeLedger();
});

const registered = () => [...scripting.registered.keys()].sort();

describe('syncReaders', () => {
  it('registers every reader on a fresh install, each on exactly its hosts, once however often it runs', async () => {
    await Promise.all([syncReaders(deps), syncReaders(deps)]);
    expect(registered()).toEqual(['gcal', 'gmail']);
    expect(scripting.registered.get('gmail')).toEqual({
      id: 'gmail',
      matches: ['https://mail.google.com/*'],
      js: ['content-scripts/gmail.js'],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    });
    expect(scripting.registered.get('gcal')?.matches).toEqual(['https://calendar.google.com/*']);
    expect(records.filter(({ event }) => event === 'readers.synced')).toHaveLength(1);
  });

  it('updates a registration with other details (after an update), and leaves a current one alone', async () => {
    await scripting.registerContentScripts([{ ...scriptOf('gmail'), js: ['content-scripts/old.js'] }]);
    await syncReaders(deps);
    expect(scripting.registered.get('gmail')?.js).toEqual(['content-scripts/gmail.js']);
    expect(registered()).toEqual(['gcal', 'gmail']);
  });
});

describe('onReaderToggle', () => {
  it('turning a reader off unregisters it and keeps the choice; turning it on registers it again', async () => {
    await syncReaders(deps);
    const off = await onReaderToggle({ type: 'reader.toggle', reader: 'gcal', on: false }, deps);
    expect(off).toEqual({ ok: true });
    expect(registered()).toEqual(['gmail']);
    expect(await readersOff(browser.storage.local)).toEqual(new Set(['gcal']));
    // A restart keeps it off.
    await syncReaders(deps);
    expect(registered()).toEqual(['gmail']);
    expect(await onReaderToggle({ type: 'reader.toggle', reader: 'gcal', on: true }, deps)).toEqual({
      ok: true,
    });
    expect(registered()).toEqual(['gcal', 'gmail']);
    expect(await readersOff(browser.storage.local)).toEqual(new Set());
    expect(records.filter(({ event }) => event === 'readers.toggled').map(({ fields }) => fields)).toEqual([
      { reader: 'gcal', on: false },
      { reader: 'gcal', on: true },
    ]);
  });

  it('answers failed, logged, when Chrome refuses the change', async () => {
    const refusing: ReaderDeps = {
      storage: browser.storage.local,
      scripting: { ...scripting, registerContentScripts: () => Promise.reject(new Error('refused')) },
    };
    expect(await onReaderToggle({ type: 'reader.toggle', reader: 'gmail', on: true }, refusing)).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(records.some(({ event }) => event === 'readers.toggle_failed')).toBe(true);
  });
});

describe('readersOff', () => {
  it('reads a choice that is not a list of readers as every reader off, and says so', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.READERS_OFF]: 'gmail' });
    expect(await readersOff(browser.storage.local)).toEqual(new Set(['gmail', 'gcal']));
    await syncReaders(deps);
    expect(registered()).toEqual([]);
    expect(records.some(({ event, level }) => event === 'readers.choice_invalid' && level === 'error')).toBe(
      true,
    );
  });
});

describe('a reader that is off', () => {
  it("is answered reader_off for each of its observers' messages, and nothing is stored", async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.READERS_OFF]: ['gmail'] });
    expect(await readerOff('gmail.sent', deps)).toEqual({ ok: false, code: 'reader_off' });
    expect(await readerOff('gmail.receipt', deps)).toEqual({ ok: false, code: 'reader_off' });
    expect(await readerOff('gcal.event', deps)).toBeNull();
    // An agent adapter has no page reader here.
    expect(await readerOff('muse', deps)).toBeNull();
    const handlers = createHandlers(undefined, undefined, undefined, deps);
    const sent = VALID['observer.observations'];
    const answer = await handlers['observer.observations']?.(
      { ...sent, observerId: 'gmail.sent' },
      { ...contentScript(), url: 'https://mail.google.com/mail/u/0/#sent' },
    );
    expect(answer).toEqual({ ok: false, code: 'reader_off' });
    expect(await (await getLedger()).observations.count()).toBe(0);
  });
});
