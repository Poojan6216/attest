// @vitest-environment happy-dom
/**
 * The options page's Model section (entrypoints/options/components/ModelSection.tsx; sprint_5 5.2 done-when, 5.4),
 * over stand-in settings and a stand-in Prompt API (tests/unit/intel/stand-in.ts): Chrome is asked about its model only
 * when the person clicks Check, never as the page opens; where Chrome has no model, or cannot run it, or has not
 * downloaded it, the switch is disabled and the section says why in one line; where it has it, the switch sends
 * `flag.set` for ATTEST_MODEL; a person's click downloads it, with progress, and the switch then works; turning it off
 * is always possible. Its text says the model runs on this computer and never decides a grade. Every value is invented.
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
import type { SettingResult } from '../../../src/bus/messages';
import type { PromptApi } from '../../../src/intel/providers/builtin';
import { setLogSink } from '../../../src/log';
import { type StandIn, standIn } from '../intel/stand-in';

let root: HTMLElement;
let view: SettingsView;
let send: ReturnType<typeof vi.fn<(command: SettingCommand) => Promise<SettingResult>>>;
let sources: SettingsSources;

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
  send = vi.fn<(command: SettingCommand) => Promise<SettingResult>>(() => Promise.resolve({ ok: true }));
  sources = { load: () => Promise.resolve(view), send, subscribe: () => () => undefined };
  setLogSink(() => undefined);
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

async function show(api: PromptApi | null): Promise<void> {
  await act(() => {
    render(h(ModelSection, { sources, promptApi: () => api }), root);
  });
  await settle();
}

const button = (name: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const status = () => root.querySelector('[role="group"] [role="status"]')?.textContent.trim();

/** Clicks Check, as a person asks whether Chrome can run its model here. */
async function checkModel(): Promise<void> {
  await act(() => {
    button('Check Chrome’s on-device model')?.click();
  });
  await settle();
}

describe('the Model section where Chrome cannot run its model', () => {
  it('says at once where this Chrome has no Prompt API, with nothing to check', async () => {
    await show(null);
    expect(status()).toBe(
      'The on-device model is off. This Chrome has no on-device model: it needs Chrome 138 or later on a computer that can run it.',
    );
    expect(button('Turn on the on-device model')?.disabled).toBe(true);
    expect(button('Check Chrome’s on-device model')).toBeUndefined();
  });

  it.each([
    ['unavailable', 'Chrome says this computer cannot run its on-device model.'],
    ['downloading', 'Chrome is downloading its on-device model. Come back once it has finished.'],
  ] as const)('disables the switch, and says why once the person checks (%s)', async (said, why) => {
    await show(standIn(said).api);
    expect(status()).toBe('The on-device model is off.');
    expect(button('Turn on the on-device model')?.disabled).toBe(true);
    await checkModel();
    expect(status()).toBe(`The on-device model is off. ${why}`);
    expect(button('Turn on the on-device model')?.disabled).toBe(true);
    expect(button('Download Chrome’s on-device model')).toBeUndefined();
  });

  it('says Chrome did not answer, never that it cannot run, when the check itself fails (SEC-10)', async () => {
    const stand = standIn('available');
    await show({ ...stand.api, availability: () => Promise.reject(new Error('the model service is down')) });
    await checkModel();
    expect(status()).toBe('The on-device model is off. Chrome did not answer. Check again.');
    expect(button('Turn on the on-device model')?.disabled).toBe(true);
    // The check can be asked again.
    expect(button('Check Chrome’s on-device model')?.disabled).toBe(false);
  });

  it('never asks Chrome as the page opens: only a click on Check does (Decisions [5.4])', async () => {
    const stand = standIn('available');
    const asked = vi.fn(() => Promise.resolve(stand.availability));
    await show({ ...stand.api, availability: asked });
    expect(asked).not.toHaveBeenCalled();
    await checkModel();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(button('Check Chrome’s on-device model')).toBeUndefined();
  });

  it('says the model runs on this computer, sees a few facts, and never decides a grade', async () => {
    await show(null);
    const text = root.textContent;
    expect(text).toContain('The model runs on this computer, inside Chrome: nothing is sent anywhere.');
    expect(text).toContain('It never sees a page or what you asked an agent.');
    expect(text).toContain('It never decides a grade.');
  });
});

describe('the Model section where Chrome has its model, or can download it', () => {
  it('turns the model on through flag.set, and off again whatever Chrome says', async () => {
    await show(standIn('available').api);
    expect(status()).toBe('The on-device model is off.');
    await checkModel();
    expect(status()).toBe('The on-device model is off.');
    await act(() => {
      button('Turn on the on-device model')?.click();
    });
    await settle();
    expect(send).toHaveBeenCalledWith({ type: 'flag.set', flag: 'ATTEST_MODEL', on: true });
    render(null, root);
    view = { ...view, modelOn: true };
    await show(standIn('unavailable').api);
    expect(button('Turn off the on-device model')?.disabled).toBe(false);
  });

  it('downloads the model on a click, with progress, and then lets it be turned on', async () => {
    const stand: StandIn = standIn('downloadable');
    let finish: () => void = () => undefined;
    const create = stand.api.create.bind(stand.api);
    const api: PromptApi = {
      availability: stand.api.availability.bind(stand.api),
      create: (options) =>
        new Promise((resolve) => {
          void create(options).then((session) => {
            finish = () => {
              stand.availability = 'available';
              resolve(session);
            };
          });
        }),
    };
    await show(api);
    await checkModel();
    expect(status()).toBe('The on-device model is off. Chrome has not downloaded its on-device model yet.');
    await act(() => {
      button('Download Chrome’s on-device model')?.click();
    });
    await settle();
    await act(() => {
      stand.progress?.(0.42);
    });
    expect(root.textContent).toContain('Chrome is downloading its model: 42% so far.');
    await act(() => {
      finish();
    });
    await settle();
    expect(button('Turn on the on-device model')?.disabled).toBe(false);
    expect(stand.destroyed).toBe(1);
  });
});

const KEY = 'sk-ant-invented-test-key-0123456789';

/** Types `text` into the key field as a person would. */
async function typeKey(text: string): Promise<void> {
  const input = root.querySelector<HTMLInputElement>('input[type="password"]');
  if (input === null) throw new Error('no key field');
  await act(() => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the person’s own key (sprint_5 5.3)', () => {
  it('says exactly what is sent, and to whom, and where the key stays', async () => {
    await show(null);
    const text = root.textContent;
    expect(text).toContain('to Anthropic (api.anthropic.com) or OpenAI (api.openai.com)');
    expect(text).toContain(
      'what kind of action the claim was, who it was to (an email address or a name), its short subject, its amount and its time, and the same for the one sent email or event it partly matched, with Attest’s id for it and, for a purchase, the merchant.',
    );
    expect(text).toContain('Nothing else: never a page, never what you asked an agent.');
    expect(text).toContain(
      'Your key stays in this browser, where only Attest can read it, and goes only to that company.',
    );
  });

  it('refuses what is not a key before it is sent, and saves a key with the vendor chosen', async () => {
    await show(null);
    expect(button('Turn on my own key')?.disabled).toBe(true);
    await typeKey('my password');
    await act(() => {
      button('Save key')?.click();
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('That is not a key');
    expect(send).not.toHaveBeenCalled();
    const openai = [...root.querySelectorAll('label')].find((l) => l.textContent.trim() === 'OpenAI');
    await act(() => {
      openai?.querySelector('input')?.click();
    });
    // An Anthropic key under OpenAI is refused before it is sent (Sprint 5 close, SEC-7).
    await typeKey(KEY);
    await act(() => {
      button('Save key')?.click();
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'That key is not the chosen company’s: Anthropic’s keys begin sk-ant-, and OpenAI’s begin sk-.',
    );
    expect(send).not.toHaveBeenCalled();
    const openaiKey = 'sk-proj-invented-test-key-0123456789';
    await typeKey(openaiKey);
    await act(() => {
      button('Save key')?.click();
    });
    await settle();
    expect(send).toHaveBeenCalledWith({ type: 'byo.save', vendor: 'openai', key: openaiKey });
  });
});

describe('the person’s own key, saved (sprint_5 5.3)', () => {
  it('with a key saved, turns it on, and forgets it', async () => {
    view = { ...view, byoVendor: 'anthropic' };
    await show(null);
    expect(root.textContent).toContain('Your own key is off. Your Anthropic key is saved.');
    expect(root.querySelector('input[type="password"]')).toBeNull();
    await act(() => {
      button('Turn on my own key')?.click();
    });
    await settle();
    expect(send).toHaveBeenCalledWith({ type: 'flag.set', flag: 'ATTEST_MODEL_BYO', on: true });
    await act(() => {
      button('Forget my key')?.click();
    });
    await settle();
    expect(send).toHaveBeenLastCalledWith({ type: 'byo.forget' });
  });
});
