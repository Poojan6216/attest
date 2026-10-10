// @vitest-environment happy-dom
/**
 * The options page's Model section (entrypoints/options/components/ModelSection.tsx; sprint_5 5.2 done-when), over
 * stand-in settings and a stand-in Prompt API (tests/unit/intel/stand-in.ts): where Chrome has no model, or cannot run
 * it, or has not downloaded it, the switch is disabled and the section says why in one line; where it has it, the
 * switch sends `flag.set` for ATTEST_MODEL; a person's click downloads it, with progress, and the switch then works;
 * turning it off is always possible. Its text says the model runs on this computer and never decides a grade. Every
 * value is invented.
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
  view = { retentionDays: 90, readersOff: new Set(), autoCheckGmail: false, modelOn: false, health: [] };
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

describe('the Model section where Chrome cannot run its model', () => {
  it.each([
    [null, 'This Chrome has no on-device model: it needs Chrome 138 or later on a computer that can run it.'],
    ['unavailable', 'Chrome says this computer cannot run its on-device model.'],
    ['downloading', 'Chrome is downloading its on-device model. Come back once it has finished.'],
  ] as const)('disables the switch and says why (%s)', async (said, why) => {
    await show(said === null ? null : standIn(said).api);
    expect(status()).toBe(`The on-device model is off. ${why}`);
    expect(button('Turn on the on-device model')?.disabled).toBe(true);
    expect(button('Download Chrome’s on-device model')).toBeUndefined();
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
