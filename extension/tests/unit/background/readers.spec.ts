/**
 * The page readers (sprint_4 4.5; src/background/readers.ts): every reader is registered until the person turns it
 * off; turning one off removes its registration (`chrome.scripting.unregisterContentScripts`) and turning it on
 * registers it again, the choice kept in ledger meta (src/ledger/consent.ts; sprint_4 close, SEC-3) and announced; a
 * registration with other details is updated; a choice that cannot be read is no consent to read; and the service
 * worker answers what a reader that is off sends with `reader_off`, storing nothing.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  onReaderToggle,
  type ReaderDeps,
  readerOff,
  scriptOf,
  syncReaders,
} from '../../../src/background/readers';
import { createHandlers } from '../../../src/background/router';
import type { LedgerTable } from '../../../src/bus/messages';
import { readersOff, saveReaderOff } from '../../../src/ledger/consent';
import { deleteLedger, getLedger } from '../../../src/ledger/shared';
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
  deps = { scripting, db: getLedger };
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  restore();
  await deleteLedger();
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
    const announced: (readonly LedgerTable[])[] = [];
    const notify = (tables: readonly LedgerTable[]) => {
      announced.push(tables);
    };
    const off = await onReaderToggle({ type: 'reader.toggle', reader: 'gcal', on: false }, deps, notify);
    expect(off).toEqual({ ok: true });
    expect(registered()).toEqual(['gmail']);
    expect(await readersOff(await getLedger())).toEqual(new Set(['gcal']));
    expect(announced).toEqual([['meta']]);
    // A restart keeps it off.
    await syncReaders(deps);
    expect(registered()).toEqual(['gmail']);
    expect(await onReaderToggle({ type: 'reader.toggle', reader: 'gcal', on: true }, deps)).toEqual({
      ok: true,
    });
    expect(registered()).toEqual(['gcal', 'gmail']);
    expect(await readersOff(await getLedger())).toEqual(new Set());
    expect(records.filter(({ event }) => event === 'readers.toggled').map(({ fields }) => fields)).toEqual([
      { reader: 'gcal', on: false },
      { reader: 'gcal', on: true },
    ]);
  });

  it('answers failed, logged, when Chrome refuses the change', async () => {
    const refusing: ReaderDeps = {
      db: getLedger,
      scripting: { ...scripting, registerContentScripts: () => Promise.reject(new Error('refused')) },
    };
    expect(await onReaderToggle({ type: 'reader.toggle', reader: 'gmail', on: true }, refusing)).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(records.some(({ event }) => event === 'readers.toggle_failed')).toBe(true);
  });
});

describe('a choice that cannot be read', () => {
  it('reads as that reader off, never as consent to read, and says so by key', async () => {
    await (await getLedger()).meta.put({ key: 'readerOff.gmail', value: 'yes' });
    expect(await readersOff(await getLedger())).toEqual(new Set(['gmail']));
    await syncReaders(deps);
    expect(registered()).toEqual(['gcal']);
    expect(records.some(({ event }) => event === 'ledger.row_invalid')).toBe(true);
  });
});

describe('a reader that is off', () => {
  it("is answered reader_off for each of its observers' messages, and nothing is stored", async () => {
    await saveReaderOff(await getLedger(), 'gmail', true);
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
