import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '../../../src/config';
import {
  ensureInstallId,
  getInstallId,
  InstallIdError,
  onInstallIdChanged,
  readInstallId,
  resetInstallId,
} from '../../../src/ledger/install-id';
import { type LogRecord, setLogSink } from '../../../src/log';

/** RFC 9562 version 4, variant 10xx, lowercase. */
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

function events(level: LogRecord['level']): string[] {
  return records.filter((r) => r.level === level).map((r) => r.event);
}

describe('ensureInstallId', () => {
  it('generates a v4 UUID once on an empty store and persists it', async () => {
    const id = await ensureInstallId();

    expect(id).toMatch(UUID_V4);
    expect(await stored()).toBe(id);
    expect(events('info')).toContain('install_id.created');
    expect(events('warn')).toEqual([]);
  });

  it('is stable across calls and does not rewrite a valid id', async () => {
    const first = await ensureInstallId();
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    expect(await ensureInstallId()).toBe(first);
    expect(await getInstallId()).toBe(first);
    expect(await ensureInstallId()).toBe(first);
    expect(setSpy).not.toHaveBeenCalled();
    expect(await stored()).toBe(first);
  });

  it('keeps an id written by an earlier session', async () => {
    const existing = crypto.randomUUID();
    await browser.storage.local.set({ [KEY]: existing });

    expect(await ensureInstallId()).toBe(existing);
    expect(records).toEqual([]);
  });

  it('regenerates a corrupt id and warns with reason=corrupt', async () => {
    await browser.storage.local.set({ [KEY]: 'not-a-uuid' });

    const id = await ensureInstallId();

    expect(id).toMatch(UUID_V4);
    expect(await stored()).toBe(id);
    expect(records).toContainEqual({
      level: 'warn',
      event: 'install_id.regenerated',
      fields: { reason: 'corrupt' },
    });
  });

  it('returns the id that won when another context overwrites it right after this write', async () => {
    const winner = crypto.randomUUID();
    // Stands in for a second context (service worker vs options page) whose write lands between this
    // context's write and its read-back. The fake applies a write synchronously, so no await is needed.
    browser.storage.local.onChanged.addListener((changes) => {
      const next: unknown = changes[KEY]?.newValue;
      if (next !== undefined && next !== winner) void browser.storage.local.set({ [KEY]: winner });
    });

    expect(await ensureInstallId()).toBe(winner);
    expect(await stored()).toBe(winner);
  });
});

describe('getInstallId', () => {
  it.each([
    ['a non-UUID string', 'hello'],
    ['a number', 42],
    ['an object', { id: 'x' }],
    ['a v1 UUID', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    ['an uppercase v4 UUID', 'F47AC10B-58CC-4372-A567-0E02B2C3D479'],
    ['an empty string', ''],
    ['a boolean', true],
  ])('regenerates %s and logs install_id.regenerated reason=corrupt', async (_label, value) => {
    await browser.storage.local.set({ [KEY]: value });

    const id = await getInstallId();

    expect(id).toMatch(UUID_V4);
    expect(id).not.toBe(value);
    expect(await stored()).toBe(id);
    expect(records).toContainEqual({
      level: 'warn',
      event: 'install_id.regenerated',
      fields: { reason: 'corrupt' },
    });
  });

  it('regenerates a missing id and warns with reason=missing (install should have created it)', async () => {
    const id = await getInstallId();

    expect(id).toMatch(UUID_V4);
    expect(await stored()).toBe(id);
    expect(records).toContainEqual({
      level: 'warn',
      event: 'install_id.regenerated',
      fields: { reason: 'missing' },
    });
  });

  it('returns the stored id as-is when it is valid', async () => {
    const existing = await ensureInstallId();
    records = [];

    expect(await getInstallId()).toBe(existing);
    expect(records).toEqual([]);
  });
});

describe("readInstallId (a page's read: sprint_5 5.7, the telemetry preview)", () => {
  it('returns a valid stored id, and null for a missing or corrupt one, never writing', async () => {
    expect(await readInstallId()).toBeNull();
    expect(await stored()).toBeUndefined();
    await browser.storage.local.set({ [KEY]: 'hello' });
    expect(await readInstallId()).toBeNull();
    expect(await stored()).toBe('hello');
    const existing = await resetInstallId();
    records = [];
    expect(await readInstallId()).toBe(existing);
    expect(records).toEqual([]);
  });
});

describe('resetInstallId', () => {
  it('replaces the id with a new v4 UUID and persists it', async () => {
    const before = await ensureInstallId();

    const after = await resetInstallId();

    expect(after).toMatch(UUID_V4);
    expect(after).not.toBe(before);
    expect(await stored()).toBe(after);
    expect(await getInstallId()).toBe(after);
    expect(events('info')).toContain('install_id.reset');
  });

  it('gives a different id on every reset', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i += 1) ids.add(await resetInstallId());

    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('works when no id exists yet', async () => {
    const id = await resetInstallId();

    expect(id).toMatch(UUID_V4);
    expect(await stored()).toBe(id);
  });
});

describe('storage failures', () => {
  it('a failed read rejects with InstallIdError code=read_failed and writes nothing', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('disk on fire'));
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    const failure = getInstallId();

    await expect(failure).rejects.toBeInstanceOf(InstallIdError);
    await expect(failure).rejects.toMatchObject({ code: 'read_failed' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('a failed write rejects with InstallIdError code=write_failed', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));

    await expect(resetInstallId()).rejects.toMatchObject({ name: 'InstallIdError', code: 'write_failed' });
    expect(await stored()).toBeUndefined();
  });
});

describe('onInstallIdChanged', () => {
  it('reports a reset made anywhere, parsed', async () => {
    await ensureInstallId();
    const seen: (string | null)[] = [];
    const unsubscribe = onInstallIdChanged((id) => seen.push(id));

    const next = await resetInstallId();

    expect(seen).toEqual([next]);
    unsubscribe();
  });

  it('reports a corrupt value as null and ignores other keys', async () => {
    const seen: (string | null)[] = [];
    const unsubscribe = onInstallIdChanged((id) => seen.push(id));

    await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { anything: true } });
    await browser.storage.local.set({ [KEY]: 'garbage' });

    expect(seen).toEqual([null]);
    unsubscribe();
  });

  it('stops after unsubscribe', async () => {
    const seen: (string | null)[] = [];
    const unsubscribe = onInstallIdChanged((id) => seen.push(id));
    unsubscribe();

    await resetInstallId();

    expect(seen).toEqual([]);
  });
});

describe('privacy (Hard Rule 10)', () => {
  it('never logs the install id itself', async () => {
    await browser.storage.local.set({ [KEY]: 'corrupt-value' });
    const ids = [await getInstallId(), await resetInstallId(), await ensureInstallId()];

    const printed = JSON.stringify(records);
    expect(records.length).toBeGreaterThan(0);
    for (const id of ids) expect(printed).not.toContain(id);
    expect(printed).not.toContain('corrupt-value');
  });
});
