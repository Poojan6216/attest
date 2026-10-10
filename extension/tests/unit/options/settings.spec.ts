// @vitest-environment happy-dom
/**
 * The options page's settings (sprint_4 4.5), rendered with Preact in happy-dom over stand-in sources. Adapters: each
 * page reader on or off with its observers' health (status in words, version, last check; reasons when it needs
 * repair; none yet), and the button that turns it off or on (`reader.toggle`), which says when it failed. Privacy: the
 * link to the privacy architecture, the retention window saved explicitly (`retention.save`), and the telemetry
 * choice present but disabled. Danger zone: Delete all data asked twice before `ledger.wipe`, and what came of it.
 * Every value is invented.
 */
import { type ComponentChild, h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdaptersSection } from '../../../entrypoints/options/components/AdaptersSection';
import { DangerZone } from '../../../entrypoints/options/components/DangerZone';
import { PrivacySection } from '../../../entrypoints/options/components/PrivacySection';
import type {
  SettingCommand,
  SettingsSources,
  SettingsView,
} from '../../../entrypoints/options/use-settings';
import type { SettingResult } from '../../../src/bus/messages';
import { PRIVACY_DOC_URL } from '../../../src/config';
import { AdapterHealth } from '../../../src/ledger/types';
import { setLogSink } from '../../../src/log';

const NOW_MS = Date.parse('2026-10-09T14:30:00-04:00');
let root: HTMLElement;
let view: SettingsView;
let send: ReturnType<typeof vi.fn<(command: SettingCommand) => Promise<SettingResult>>>;
let sources: SettingsSources;
let announce: () => void;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  announce = () => undefined;
  view = {
    retentionDays: 90,
    readersOff: new Set(['gcal']),
    autoCheckGmail: false,
    modelOn: false,
    health: [
      AdapterHealth.parse({
        adapterId: 'gmail.sent',
        version: '1.4.0',
        status: 'OK',
        reasons: [],
        checkedAt: new Date(NOW_MS - 5 * 60_000).toISOString(),
      }),
      AdapterHealth.parse({
        adapterId: 'gmail.receipt',
        version: '1.1.0',
        status: 'DEGRADED',
        reasons: ['selector.missing'],
        checkedAt: new Date(NOW_MS - 60 * 60_000).toISOString(),
      }),
    ],
  };
  send = vi.fn<(command: SettingCommand) => Promise<SettingResult>>(() => Promise.resolve({ ok: true }));
  sources = {
    load: () => Promise.resolve(view),
    send,
    subscribe: (onChange) => {
      announce = onChange;
      return () => undefined;
    },
  };
  setLogSink(() => undefined);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(node: ComponentChild): Promise<void> {
  await act(() => {
    render(node, root);
  });
  await settle();
}

const button = (name: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((each) => each.textContent.trim() === name);

async function click(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) throw new Error('nothing to click');
  await act(() => {
    element.click();
  });
  await settle();
}

describe('Adapters', () => {
  it("shows each reader on or off with its observers' health, and turns one on", async () => {
    await show(h(AdaptersSection, { sources, nowMs: () => NOW_MS }));
    const [gmail, calendar] = [...root.querySelectorAll('ul.space-y-3 > li')].map((item) => item.textContent);
    expect(gmail).toContain('Gmail On');
    expect(gmail).toContain('Gmail Sent reader: Working. Version 1.4.0, last checked 14:25.');
    expect(gmail).toContain(
      'Gmail receipts reader: Needs repair: its receipts may be Unverifiable (selector.missing).',
    );
    expect(calendar).toContain('Google Calendar Off');
    expect(calendar).toContain('Calendar reader: not checked yet.');
    await click(button('Turn on Google Calendar'));
    expect(send.mock.calls).toEqual([[{ type: 'reader.toggle', reader: 'gcal', on: true }]]);
    view = { ...view, readersOff: new Set() };
    await act(() => {
      announce();
    });
    await settle();
    expect(button('Turn off Google Calendar')).toBeDefined();
  });

  it('says when a reader could not be changed', async () => {
    send.mockResolvedValue({ ok: false, code: 'failed' });
    await show(h(AdaptersSection, { sources, nowMs: () => NOW_MS }));
    await click(button('Turn off Gmail'));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Not changed. Try again.');
  });
});

describe('Adapters: Check Gmail for me (sprint_4 4.9)', () => {
  const group = () => root.querySelector('[role="group"][aria-labelledby="auto-check-heading"]');

  it('is off, says what it would open, when, how often and that it only reads, and turns on', async () => {
    await show(h(AdaptersSection, { sources, nowMs: () => NOW_MS }));
    const text = group()?.textContent ?? '';
    expect(text).toContain('Off unless you turn it on.');
    expect(text).toContain('in the 15 minutes since Attest read that claim');
    expect(text).toContain('one tab, pinned and in front of you, never in the background');
    expect(text).toContain('at most one tab every 30 minutes, and never twice for the same claim');
    expect(text).toContain('This is the only time Attest opens a page.');
    expect(text).toContain('never acts on it');
    expect(group()?.querySelector('[role="status"]')?.textContent).toBe('Checking Gmail for you is off.');
    await click(button('Turn on checking Gmail'));
    expect(send.mock.calls).toEqual([[{ type: 'flag.set', flag: 'ATTEST_AUTO_CHECK_GMAIL', on: true }]]);
    view = { ...view, autoCheckGmail: true, readersOff: new Set(['gmail']) };
    await act(() => {
      announce();
    });
    await settle();
    expect(group()?.querySelector('[role="status"]')?.textContent).toBe(
      'Checking Gmail for you is on. It does nothing while the Gmail reader is off.',
    );
    expect(button('Turn off checking Gmail')).toBeDefined();
  });

  it('says when it could not be changed', async () => {
    send.mockRejectedValue(new Error('no receiver'));
    await show(h(AdaptersSection, { sources, nowMs: () => NOW_MS }));
    await click(button('Turn on checking Gmail'));
    expect(group()?.querySelector('[role="alert"]')?.textContent).toBe('Not changed. Try again.');
  });
});

describe('Privacy', () => {
  it('links the privacy architecture, saves the retention window explicitly, and shows telemetry off and disabled', async () => {
    await show(h(PrivacySection, { sources }));
    const link = [...root.querySelectorAll('a')].find(({ href }) => href === PRIVACY_DOC_URL);
    expect(link?.target).toBe('_blank');
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[name="retention"]')];
    expect(radios.map(({ value, checked }) => [value, checked])).toEqual([
      ['30', false],
      ['90', true],
      ['180', false],
    ]);
    expect(button('Save retention')?.disabled).toBe(true);
    await click(radios[0]);
    await click(button('Save retention'));
    expect(send.mock.calls).toEqual([[{ type: 'retention.save', days: 30 }]]);
    view = { ...view, retentionDays: 30 };
    await act(() => {
      announce();
    });
    await settle();
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      'Saved. Attest keeps 30 days of history.',
    );
    const telemetry = root.querySelector<HTMLInputElement>('input[aria-describedby="telemetry-note"]');
    expect([telemetry?.disabled, telemetry?.checked]).toEqual([true, false]);
    expect(root.querySelector('#telemetry-note')?.textContent).toContain('Coming in a later version.');
  });

  it('says when the window was not saved', async () => {
    send.mockResolvedValue({ ok: false, code: 'failed' });
    await show(h(PrivacySection, { sources }));
    await click([...root.querySelectorAll<HTMLInputElement>('input[name="retention"]')][2]);
    await click(button('Save retention'));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Not saved. Try again.');
  });
});

describe('Danger zone: Delete all data', () => {
  it('asks twice: the question, then a box ticked before Delete everything; Cancel leaves everything', async () => {
    await show(h(DangerZone, { send }));
    await click(button('Delete all data'));
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(button('Delete everything')?.disabled).toBe(true);
    await click(button('Cancel'));
    expect(send).not.toHaveBeenCalled();
    await click(button('Delete all data'));
    await click(root.querySelector<HTMLInputElement>('[role="group"] input[type="checkbox"]') ?? undefined);
    expect(button('Delete everything')?.disabled).toBe(false);
    await click(button('Delete everything'));
    expect(send.mock.calls).toEqual([[{ type: 'ledger.wipe' }]]);
    const statuses = [...root.querySelectorAll('[role="status"]')].map((status) => status.textContent);
    expect(statuses).toContain(
      'Deleted. Attest keeps nothing from before, and reads pages you open from now on.',
    );
  });

  it('says when it could not delete everything', async () => {
    send.mockRejectedValue(new Error('no worker'));
    await show(h(DangerZone, { send }));
    await click(button('Delete all data'));
    await click(root.querySelector<HTMLInputElement>('[role="group"] input[type="checkbox"]') ?? undefined);
    await click(button('Delete everything'));
    const statuses = [...root.querySelectorAll('[role="status"]')].map((status) => status.textContent);
    expect(statuses).toContain('Could not delete everything. Try again.');
  });
});
