import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleInstalled } from '../../../src/background/install';
import { STORAGE_KEYS } from '../../../src/config';
import { InstallIdError } from '../../../src/ledger/install-id';
import { type LogRecord, setLogSink } from '../../../src/log';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = STORAGE_KEYS.INSTALL_ID;

async function stored(): Promise<unknown> {
  const items = await browser.storage.local.get(KEY);
  return items[KEY];
}

let records: LogRecord[] = [];
let restoreSink: () => void = () => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(() => {
  restoreSink();
});

describe('handleInstalled', () => {
  it('reason=install creates and stores the install id', async () => {
    expect(await stored()).toBeUndefined();

    expect(await handleInstalled({ reason: 'install' })).toBe('ensured');

    expect(await stored()).toMatch(UUID_V4);
    expect(records).toContainEqual({
      level: 'info',
      event: 'install.handled',
      fields: { reason: 'install' },
    });
    // A missing id on first install is expected: it is created, not "regenerated" with a warning.
    expect(records.filter((r) => r.level === 'warn' || r.level === 'error')).toEqual([]);
  });

  it('reason=update keeps an existing id unchanged', async () => {
    const existing = crypto.randomUUID();
    await browser.storage.local.set({ [KEY]: existing });

    expect(await handleInstalled({ reason: 'update', previousVersion: '0.0.0' })).toBe('ensured');

    expect(await stored()).toBe(existing);
  });

  it('reason=update creates the id when an older version never had one', async () => {
    expect(await handleInstalled({ reason: 'update', previousVersion: '0.0.0' })).toBe('ensured');

    expect(await stored()).toMatch(UUID_V4);
  });

  it('reason=update repairs a corrupt id and warns', async () => {
    await browser.storage.local.set({ [KEY]: 'broken' });

    await handleInstalled({ reason: 'update', previousVersion: '0.0.0' });

    expect(await stored()).toMatch(UUID_V4);
    expect(records).toContainEqual({
      level: 'warn',
      event: 'install_id.regenerated',
      fields: { reason: 'corrupt' },
    });
  });

  it.each(['chrome_update', 'shared_module_update'])('reason=%s touches nothing', async (reason) => {
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    expect(await handleInstalled({ reason, id: 'abc' })).toBe('skipped');

    expect(setSpy).not.toHaveBeenCalled();
    expect(await stored()).toBeUndefined();
  });

  it.each([
    ['an unknown reason', { reason: 'reinstall' }],
    ['no reason', {}],
    ['null', null],
    ['a string', 'install'],
  ])('malformed details (%s) are logged and ignored', async (_label, details) => {
    expect(await handleInstalled(details)).toBe('ignored');

    expect(await stored()).toBeUndefined();
    expect(records.map((r) => r.event)).toContain('install.details_invalid');
  });

  it('a storage failure rejects with InstallIdError for the caller to log', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('io'));

    await expect(handleInstalled({ reason: 'install' })).rejects.toBeInstanceOf(InstallIdError);
  });
});

describe('background wiring', () => {
  it('runtime.onInstalled reaches handleInstalled and stores the id', async () => {
    const { default: background } = await import('../../../entrypoints/background');
    background.main();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    await vi.waitFor(async () => {
      expect(await stored()).toMatch(UUID_V4);
    });
  });

  it('a failing install handler is caught and logged, never thrown into the event', async () => {
    const { default: background } = await import('../../../entrypoints/background');
    background.main();
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('io'));

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    await vi.waitFor(() => {
      expect(records).toContainEqual({
        level: 'error',
        event: 'install.failed',
        fields: { error: expect.stringMatching(/^InstallIdError code=read_failed\b/) as unknown },
      });
    });
  });
});
