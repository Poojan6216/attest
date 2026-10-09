import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleInstalled, onInstalled } from '../../../src/background/install';
import { ALARM_NAMES, STORAGE_KEYS } from '../../../src/config';
import { InstallIdError } from '../../../src/ledger/install-id';
import { type LogRecord, setLogSink } from '../../../src/log';
import { asFreshInstall } from './chrome-fakes';

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
  asFreshInstall();
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
});

describe('handleInstalled: other reasons, malformed details and failures', () => {
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

describe('onInstalled: the install id and the alarms are independent (QA-3, TECH-8)', () => {
  const errors = (): string[] => records.filter((r) => r.level === 'error').map((r) => r.event);

  it('install: creates the id and the purge alarm, and logs nothing at error', async () => {
    await onInstalled({ reason: 'install' });

    expect(await stored()).toMatch(UUID_V4);
    expect(await browser.alarms.get(ALARM_NAMES.PURGE)).toBeDefined();
    expect(errors()).toEqual([]);
  });

  it('an install-id storage failure is logged as install.failed and the alarms are still scheduled', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('io'));

    await expect(onInstalled({ reason: 'install' })).resolves.toBeUndefined();

    expect(errors()).toEqual(['install.failed']);
    expect(await browser.alarms.get(ALARM_NAMES.PURGE)).toBeDefined();
  });

  it('an alarm failure is logged as alarm.reset_failed, not install.failed, and the id is still created', async () => {
    vi.spyOn(fakeBrowser.alarms, 'create').mockRejectedValue(new Error('alarms down'));

    await expect(onInstalled({ reason: 'install' })).resolves.toBeUndefined();

    expect(errors()).toEqual(['alarm.reset_failed']);
    expect(await stored()).toMatch(UUID_V4);
    expect(records.map((r) => r.event)).toContain('install.handled');
  });

  it.each([
    ['chrome_update', { reason: 'chrome_update' }],
    ['shared_module_update', { reason: 'shared_module_update' }],
    ['malformed details', { reason: 'reinstall' }],
  ])('%s does not reset the alarms (their countdown keeps running)', async (_label, details) => {
    await browser.alarms.create(ALARM_NAMES.PURGE, { delayInMinutes: 5 });
    const before = await browser.alarms.get(ALARM_NAMES.PURGE);
    const create = vi.spyOn(fakeBrowser.alarms, 'create');

    await onInstalled(details);

    expect(create).not.toHaveBeenCalled();
    expect(await browser.alarms.get(ALARM_NAMES.PURGE)).toEqual(before);
    expect(errors()).toEqual([]);
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
