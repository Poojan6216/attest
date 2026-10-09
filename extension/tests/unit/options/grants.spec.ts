// @vitest-environment happy-dom
/**
 * The options page's Grants (sprint_4 4.4; entrypoints/options/components/GrantsSection.tsx), rendered with Preact in
 * happy-dom over stand-in sources: one form per agent, its grant in plain language; a recipient that is not a domain or
 * an address, or a ceiling that is not a whole number, is said beside its field and blocks the save; a valid save sends
 * the person's choices and the mute (`grant.save`) and says it was saved; a failed save says so; a change to grants or
 * meta reads them again. Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GrantsSection } from '../../../entrypoints/options/components/GrantsSection';
import type { GrantSources } from '../../../entrypoints/options/use-grant-settings';
import { GrantChoices } from '../../../src/bus/messages';
import { Grant } from '../../../src/core/schema';
import { setLogSink } from '../../../src/log';
import { makeGrant } from '../ledger/fixtures';

let root: HTMLElement;
let announce: () => void;
let sources: GrantSources & {
  load: ReturnType<typeof vi.fn<GrantSources['load']>>;
  save: ReturnType<typeof vi.fn<GrantSources['save']>>;
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  announce = () => undefined;
  sources = {
    load: vi.fn<GrantSources['load']>(() =>
      Promise.resolve({ grants: [Grant.parse(makeGrant({ agent: 'muse' }))], muted: { claude: true } }),
    ),
    save: vi.fn<GrantSources['save']>(() => Promise.resolve({ ok: true })),
    subscribe: (_tables, onChange) => {
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

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function show(): Promise<void> {
  await act(() => {
    render(h(GrantsSection, { sources }), root);
  });
  await settle();
}

const form = (name: string) =>
  [...root.querySelectorAll('section section')].find(
    (section) => section.querySelector('h3')?.textContent === name,
  );

async function type(
  field: HTMLTextAreaElement | HTMLInputElement | null | undefined,
  value: string,
): Promise<void> {
  if (field === null || field === undefined) throw new Error('no field');
  await act(() => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click');
  await act(() => {
    element.click();
  });
  await settle();
}

describe('Grants', () => {
  it('shows one form per agent, its grant in plain language, the default for an agent with none', async () => {
    await show();
    expect([...root.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Muse',
      'ChatGPT',
      'Dots',
      'Claude',
    ]);
    expect(form('Muse')?.textContent).toContain(
      'Muse may: send email, create calendar events; write only to example.com',
    );
    expect(form('Dots')?.textContent).toContain('write to anyone; spend without a ceiling.');
    expect(
      form('Claude')?.querySelector<HTMLInputElement>('input[type="checkbox"]:last-of-type'),
    ).toBeDefined();
  });

  it('says beside each field what to fix, and saves nothing', async () => {
    await show();
    const muse = form('Muse');
    await type(muse?.querySelector('textarea'), 'company.com\nnot a domain');
    await type(muse?.querySelector('input[inputmode="numeric"]'), '12.50');
    await click(
      [...(muse?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Save Muse’s grant'),
    );
    const alerts = [...(muse?.querySelectorAll('[role="alert"]') ?? [])].map((alert) => alert.textContent);
    expect(alerts).toEqual([
      '“not a domain” is not a domain, such as company.com, or an address, such as priya@company.com.',
      'Write a whole number, such as 50, or leave it blank for no ceiling.',
      'Not saved: fix the fields marked above.',
    ]);
    expect(sources.save).not.toHaveBeenCalled();
  });
});

describe('Grants: saving', () => {
  it('saves the choices and the mute, says it was saved, and reads again when the ledger changes', async () => {
    await show();
    const dots = form('Dots');
    await type(dots?.querySelector('textarea'), 'Company.com');
    await type(dots?.querySelector('input[inputmode="numeric"]'), '50');
    const mute = [...(dots?.querySelectorAll('label') ?? [])].find(
      (label) => label.textContent === 'Mute alerts for Dots',
    );
    await click(mute?.querySelector('input'));
    await click(
      [...(dots?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Save Dots’s grant'),
    );
    const [grant, muted] = sources.save.mock.calls[0] ?? [];
    expect(grant).toMatchObject({
      agent: 'dots',
      counterpartyAllowlist: ['company.com'],
      spendCeilingCents: 5000,
      spendCurrency: 'USD',
    });
    expect(GrantChoices.safeParse(grant).success).toBe(true);
    expect(muted).toBe(true);
    expect(dots?.querySelector('[role="status"]')?.textContent).toBe(
      'Saved. It applies to this agent’s open receipts now, and never changes a final one.',
    );
    await act(() => {
      announce();
    });
    await settle();
    expect(sources.load).toHaveBeenCalledTimes(2);
  });

  it('says a save that failed', async () => {
    sources.save.mockRejectedValue(new Error('no worker'));
    await show();
    const chatgpt = form('ChatGPT');
    await click(
      [...(chatgpt?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Save ChatGPT’s grant'),
    );
    expect(chatgpt?.querySelector('[role="alert"]')?.textContent).toBe('Not saved. Try again.');
  });
});
