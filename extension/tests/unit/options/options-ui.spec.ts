// @vitest-environment happy-dom
/**
 * Options page shell (sprint 0.10) rendered with Preact in happy-dom. Added by the Sprint 0 QA review.
 * The E2E suite (tests/e2e/options.spec.ts, options-reset.spec.ts) covers the happy paths on the real build;
 * these tests cover the UI states it cannot reach, the failure paths (Hard Rule 6: fail loud): a storage read
 * that fails, a reset that fails or rejects, and a double confirm. They also mount the popup and side panel
 * shells.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { App as OptionsApp } from '../../../entrypoints/options/App';
import { InstallIdPanel } from '../../../entrypoints/options/components/InstallIdPanel';
import { ResetInstallIdControl } from '../../../entrypoints/options/components/ResetInstallIdControl';
import { SECTIONS, sectionTitle } from '../../../entrypoints/options/sections';
import { App as PopupApp } from '../../../entrypoints/popup/App';
import { App as SidePanelApp } from '../../../entrypoints/sidepanel/App';
import { STORAGE_KEYS } from '../../../src/config';
import { type LogRecord, setLogSink } from '../../../src/log';

const KEY = STORAGE_KEYS.INSTALL_ID;
const ID_A = '0b6f3a52-6f1e-4c43-9d6a-2f0e8f1c7a11';
const RESET_DONE = 'Install id reset. The new id is shown above.';
const RESET_FAILED = 'Could not reset the install id. Try again.';

let root: HTMLElement;
let records: LogRecord[] = [];
let restoreSink: () => void = () => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(() => {
  render(null, root);
  root.remove();
  restoreSink();
});

/** Lets pending promises, storage callbacks and Preact effects settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buttonNamed(name: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

function hasButton(name: string): boolean {
  return Array.from(root.querySelectorAll('button')).some((b) => b.textContent.trim() === name);
}

async function click(name: string): Promise<void> {
  await act(() => {
    buttonNamed(name).click();
  });
}

function statusText(): string {
  return root.querySelector('[role="status"]')?.textContent.trim() ?? '';
}

function errorEvents(): string[] {
  return records.filter((r) => r.level === 'error').map((r) => r.event);
}

describe('options App', () => {
  it('puts the privacy line first, then one h1, a nav and one h2 per section in SECTIONS order', async () => {
    await browser.storage.local.set({ [KEY]: ID_A });
    await act(() => {
      render(h(OptionsApp, null), root);
    });
    await settle();
    const main = root.querySelector('main');
    expect(main?.textContent.trim().startsWith('Nothing leaves your browser.')).toBe(true);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    const navLinks = Array.from(root.querySelectorAll('nav a')).map((a) => [
      a.getAttribute('href'),
      a.textContent,
    ]);
    expect(navLinks).toEqual(SECTIONS.map((s) => [`#${s.id}`, s.title]));
    const headings = Array.from(root.querySelectorAll('section > h2')).map((el) => el.textContent);
    expect(headings).toEqual(SECTIONS.map((s) => s.title));
    // Stubs say they are not built and carry no controls; the buttons are away detection (off on a fresh install,
    // sprint_3 3.14), the export and the reset.
    expect(Array.from(root.querySelectorAll('button')).map((b) => b.textContent.trim())).toEqual([
      'Turn on',
      'Export ledger',
      'Reset install id',
    ]);
    expect(root.querySelector('#install-id-value')?.textContent).toBe(ID_A);
  });

  it('sectionTitle falls back to the id for an unknown section', () => {
    expect(sectionTitle('danger-zone')).toBe('Danger zone');
    expect(sectionTitle('nope' as never)).toBe('nope');
  });
});

describe('the Adapters section (sprint_3 3.10)', () => {
  it("lists each reader, on or off, and why: Muse, ChatGPT and Claude off under their makers' terms", async () => {
    render(h(OptionsApp, null), root);
    await settle();
    const section = root.querySelector('#adapters');
    if (section === null) throw new Error('no Adapters section');
    const items = Array.from(section.querySelectorAll('li'), (item) => item.textContent);
    expect(items).toHaveLength(4);
    expect(items[0]).toContain('Gmail and Google Calendar');
    expect(items[0]).toContain('On');
    for (const [index, vendor] of [
      [1, 'Meta'],
      [2, 'OpenAI'],
      [3, 'Anthropic'],
    ] as const) {
      expect(items[index]).toContain('Off');
      expect(items[index]).toContain(`${vendor}'s terms`);
      expect(items[index]).toContain('permission');
    }
    expect(section.querySelectorAll('button, input, select')).toHaveLength(0);
  });
});

describe('InstallIdPanel states (Hard Rule 6: fail loud)', () => {
  it('shows Loading, then the stored id', async () => {
    await browser.storage.local.set({ [KEY]: ID_A });
    await act(() => {
      render(h(InstallIdPanel, null), root);
    });
    expect(root.textContent).toContain('Loading…');
    await settle();
    expect(root.querySelector('#install-id-value')?.textContent).toBe(ID_A);
  });

  it('a failed storage read shows an error, never a stale or invented id, and logs it', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('disk on fire'));
    await act(() => {
      render(h(InstallIdPanel, null), root);
    });
    await settle();
    expect(root.textContent).toContain('Could not read the install id.');
    expect(root.querySelector('#install-id-value')).toBeNull();
    expect(errorEvents()).toEqual(['options.install_id_read_failed']);
  });

  it('an id corrupted in another context is no longer shown', async () => {
    await browser.storage.local.set({ [KEY]: ID_A });
    await act(() => {
      render(h(InstallIdPanel, null), root);
    });
    await settle();
    await browser.storage.local.set({ [KEY]: 'not-an-id' });
    await settle();
    expect(root.querySelector('#install-id-value')).toBeNull();
    expect(root.textContent).toContain('No valid install id is stored.');
  });
});

describe('InstallIdPanel reset (Hard Rule 6: fail loud)', () => {
  it('a successful reset shows the new id and announces it', async () => {
    await browser.storage.local.set({ [KEY]: ID_A });
    await act(() => {
      render(h(InstallIdPanel, null), root);
    });
    await settle();
    await click('Reset install id');
    await click('Reset id');
    await settle();
    const shown = root.querySelector('#install-id-value')?.textContent;
    expect(shown).toMatch(/^[0-9a-f-]{36}$/);
    expect(shown).not.toBe(ID_A);
    expect(statusText()).toBe(RESET_DONE);
  });

  it('a failed reset keeps the old id, says it failed, and logs it', async () => {
    await browser.storage.local.set({ [KEY]: ID_A });
    await act(() => {
      render(h(InstallIdPanel, null), root);
    });
    await settle();
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'));
    await click('Reset install id');
    await click('Reset id');
    await settle();
    expect(root.querySelector('#install-id-value')?.textContent).toBe(ID_A);
    expect(statusText()).toBe(RESET_FAILED);
    expect(hasButton('Reset install id')).toBe(true);
    expect(errorEvents()).toEqual(['options.install_id_reset_failed']);
  });
});

describe('ResetInstallIdControl', () => {
  it('Cancel closes the question without resetting and returns focus to the start button', async () => {
    const onReset = vi.fn(() => Promise.resolve(true));
    await act(() => {
      render(h(ResetInstallIdControl, { onReset }), root);
    });
    await click('Reset install id');
    expect(document.activeElement?.textContent.trim()).toBe('Cancel');
    await click('Cancel');
    expect(onReset).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent.trim()).toBe('Reset install id');
    expect(statusText()).toBe('');
  });

  it('a double confirm resets once', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const onReset = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await act(() => {
      render(h(ResetInstallIdControl, { onReset }), root);
    });
    await click('Reset install id');
    await click('Reset id');
    await click('Reset id');
    expect(onReset).toHaveBeenCalledOnce();
    finish(true);
    await settle();
    expect(statusText()).toBe(RESET_DONE);
    expect(document.activeElement?.textContent.trim()).toBe('Reset install id');
  });

  it('an onReset that rejects shows the failure instead of a stuck control, and logs it', async () => {
    const onReset = vi.fn(() => Promise.reject(new Error('boom')));
    await act(() => {
      render(h(ResetInstallIdControl, { onReset }), root);
    });
    await click('Reset install id');
    await click('Reset id');
    await settle();
    expect(statusText()).toBe(RESET_FAILED);
    expect(hasButton('Reset install id')).toBe(true);
    expect(errorEvents()).toEqual(['options.install_id_reset_rejected']);
  });

  it('asking again clears the previous outcome', async () => {
    await act(() => {
      render(h(ResetInstallIdControl, { onReset: () => Promise.resolve(false) }), root);
    });
    await click('Reset install id');
    await click('Reset id');
    await settle();
    expect(statusText()).toBe(RESET_FAILED);
    await click('Reset install id');
    expect(statusText()).toBe('');
  });
});

describe('popup and side panel shells', () => {
  it('the popup states the privacy line, offers the timeline and the settings, and loads the day (sprint_4 4.2)', async () => {
    await act(() => {
      render(h(PopupApp, null), root);
    });
    expect(root.querySelector('h1')?.textContent).toBe('Attest');
    expect(root.textContent).toContain('Nothing leaves your browser.');
    // Skeleton rows while the ledger is read (tests/unit/popup/popup.spec.ts covers the day itself).
    expect(statusText()).toBe("Loading today's receipts");
    expect([...root.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual([
      'Open timeline',
      'Open settings',
    ]);
    expect(root.querySelectorAll('a, input')).toHaveLength(0);
  });

  it('the side panel states the privacy line and offers Add agent activity (sprint_3 3.12, 3.13)', async () => {
    await act(() => {
      render(h(SidePanelApp, null), root);
    });
    expect(root.querySelector('h1')?.textContent).toBe('Attest timeline');
    expect(root.textContent).toContain('Nothing leaves your browser.');
    expect([...root.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual([
      'Add agent activity',
    ]);
    expect(root.querySelectorAll('a, input, textarea')).toHaveLength(0);
  });
});

describe('entrypoint mounts', () => {
  afterEach(() => {
    document.getElementById('app')?.remove();
    vi.resetModules();
  });

  it.each(['options', 'popup', 'sidepanel'] as const)('%s/main.tsx renders into #app', async (name) => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    await act(async () => {
      await import(`../../../entrypoints/${name}/main.tsx`);
    });
    expect(app.querySelector('h1')).not.toBeNull();
    render(null, app);
  });

  // TECH-13: every surface mounts through src/ui/mount.ts, so popup and side panel fail loudly too.
  it.each(['options', 'popup', 'sidepanel'] as const)(
    '%s/main.tsx logs ui.root_missing when #app is missing',
    async (name) => {
      // A fresh module graph (resetModules) has its own logger instance: route that one.
      const freshLog = await import('../../../src/log');
      const seen: string[] = [];
      const restore = freshLog.setLogSink((record) =>
        seen.push(`${record.level}:${record.event}:${String(record.fields.surface)}`),
      );
      try {
        await import(`../../../entrypoints/${name}/main.tsx`);
      } finally {
        restore();
      }
      expect(seen).toEqual([`error:ui.root_missing:${name}`]);
    },
  );
});
