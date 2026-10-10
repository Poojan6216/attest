// @vitest-environment happy-dom
/**
 * The options page's Model section when something fails (Sprint 5 QA review; entrypoints/options/components/
 * ModelSection.tsx, BuiltinModelToggle.tsx, ByoModel.tsx; Hard Rule 6: fail loud). model-section.spec.ts runs every
 * path that works; here each failure is said, in one line a screen reader hears (`role="alert"`), and never silently:
 *  - Chrome refuses to download its model: the section says so, and asks Chrome again what it has;
 *  - the on-device switch is not changed (answered failed, or the command rejected): "Not changed. Try again.";
 *  - the person's own key is not saved: the same line, and the key stays typed in its field, so nothing is lost;
 *    rejected, it is logged without the key;
 *  - forgetting the key, or turning it on, is not done: the same line;
 *  - the settings cannot be read: the section says to reload, and offers no switch.
 * Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelSection } from '../../../entrypoints/options/components/ModelSection';
import type {
  SettingCommand,
  SettingsSources,
  SettingsView,
} from '../../../entrypoints/options/use-settings';
import { BusError } from '../../../src/bus/errors';
import type { SettingResult } from '../../../src/bus/messages';
import type { PromptApi } from '../../../src/intel/providers/builtin';
import { type LogRecord, setLogSink } from '../../../src/log';
import { standIn } from '../intel/stand-in';

const KEY = 'sk-ant-qa-invented-section-0123456789';
let root: HTMLElement;
let view: SettingsView;
let send: ReturnType<typeof vi.fn<(command: SettingCommand) => Promise<SettingResult>>>;
let sources: SettingsSources;
let records: LogRecord[];

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  view = {
    retentionDays: 90,
    readersOff: new Set(),
    autoCheckGmail: false,
    modelOn: false,
    modelByoOn: false,
    byoVendor: null,
    telemetryOn: false,
    health: [],
  };
  send = vi.fn<(command: SettingCommand) => Promise<SettingResult>>(() =>
    Promise.resolve({ ok: false, code: 'failed' }),
  );
  sources = { load: () => Promise.resolve(view), send, subscribe: () => () => undefined };
  records = [];
  setLogSink((record) => records.push(record));
});
afterEach(() => {
  render(null, root);
  root.remove();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(api: PromptApi | null = null): Promise<void> {
  await act(() => {
    render(h(ModelSection, { sources, promptApi: () => api }), root);
  });
  await settle();
}

const button = (name: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const alerts = () => [...root.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent.trim());

async function click(name: string): Promise<void> {
  const target = button(name);
  if (target === undefined) throw new Error(`no button ${name}`);
  await act(() => {
    target.click();
  });
  await settle();
}

async function typeKey(text: string): Promise<HTMLInputElement> {
  const input = root.querySelector<HTMLInputElement>('input[type="password"]');
  if (input === null) throw new Error('no key field');
  await act(() => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

describe('Chrome’s on-device model, when Chrome or the worker says no', () => {
  it('says Chrome did not download its model, and asks Chrome again what it has', async () => {
    const stand = standIn('downloadable');
    const availability = vi.fn(() => Promise.resolve(stand.availability));
    await show({
      availability,
      create: () => Promise.reject(new DOMException('no space', 'NotAllowedError')),
    });
    await click('Check Chrome’s on-device model');
    expect(availability).toHaveBeenCalledTimes(1);
    await click('Download Chrome’s on-device model');
    expect(alerts()).toEqual(['Chrome did not download its model. Try again later.']);
    expect(availability).toHaveBeenCalledTimes(2);
    expect(button('Turn on the on-device model')?.disabled).toBe(true);
    expect(records.map(({ event }) => event)).toContain('options.model_download_failed');
  });

  it('says "Not changed" when the switch is answered failed, and when its command is refused', async () => {
    await show(standIn('available').api);
    await click('Check Chrome’s on-device model');
    await click('Turn on the on-device model');
    expect(send).toHaveBeenCalledWith({ type: 'flag.set', flag: 'ATTEST_MODEL', on: true });
    expect(alerts()).toEqual(['Not changed. Try again.']);
    send.mockImplementation(() => Promise.reject(new BusError('invalid_outgoing')));
    await click('Turn on the on-device model');
    expect(alerts()).toEqual(['Not changed. Try again.']);
    expect(records.map(({ event }) => event)).toContain('options.model_toggle_failed');
  });
});

describe('the person’s own key, when the worker says no', () => {
  it('says "Not changed" when a key is not saved, keeps it typed, and never logs it', async () => {
    await show();
    const input = await typeKey(KEY);
    await click('Save key');
    expect(send).toHaveBeenCalledWith({ type: 'byo.save', vendor: 'anthropic', key: KEY });
    expect(alerts()).toEqual(['Not changed. Try again.']);
    expect(input.value).toBe(KEY);
    send.mockImplementation(() => Promise.reject(new BusError('invalid_outgoing')));
    await click('Save key');
    expect(alerts()).toEqual(['Not changed. Try again.']);
    expect(records.map(({ event }) => event)).toContain('options.byo_save_failed');
    expect(JSON.stringify(records)).not.toContain(KEY);
  });

  it('says "Not changed" when forgetting the key, or turning it on, is not done', async () => {
    view = { ...view, byoVendor: 'openai' };
    await show();
    await click('Forget my key');
    expect(send).toHaveBeenLastCalledWith({ type: 'byo.forget' });
    expect(alerts()).toEqual(['Not changed. Try again.']);
    send.mockImplementation(() => Promise.reject(new BusError('invalid_outgoing')));
    await click('Turn on my own key');
    expect(send).toHaveBeenLastCalledWith({ type: 'flag.set', flag: 'ATTEST_MODEL_BYO', on: true });
    expect(alerts()).toEqual(['Not changed. Try again.']);
    expect(records.map(({ event }) => event)).toContain('options.byo_toggle_failed');
  });
});

describe('the settings, when they cannot be read', () => {
  it('says to reload, and offers no switch', async () => {
    sources = { ...sources, load: () => Promise.reject(new Error('the ledger did not open')) };
    await show(standIn('available').api);
    expect(alerts()).toEqual(['Attest could not read its settings. Reload the page.']);
    expect(button('Turn on the on-device model')).toBeUndefined();
    expect(button('Turn on my own key')).toBeUndefined();
  });
});
