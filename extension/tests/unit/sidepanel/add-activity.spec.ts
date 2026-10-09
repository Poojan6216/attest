// @vitest-environment happy-dom
/**
 * The side panel's Add agent activity (sprint_3 3.12; docs/claims-import.md §2), rendered with Preact in happy-dom:
 *  - every state: the closed button, the form and its refusals, the preview with claims and with nothing to import,
 *    each reason an entry is not imported, importing, a failed import, and the result once imported;
 *  - keyboard and screen reader: a legend for the agent radios, a label and hint for the paste box, alerts for
 *    refusals, focus moved to the form, the preview heading, the paste box on Edit, and back to the button;
 *  - the text: only the claims go to `onImport`, and nothing of the text is kept once the preview closes.
 * Every log here is invented (no value from any real page).
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { AddActivity } from '../../../entrypoints/sidepanel/components/AddActivity';
import { SkippedItem } from '../../../entrypoints/sidepanel/components/SkippedItem';
import {
  type ImportClaims,
  type ImportOutcome,
  NO_AGENT,
  type PasteClock,
  REFUSALS,
} from '../../../entrypoints/sidepanel/use-paste-flow';
import { MAX_PASTE_CHARS } from '../../../src/adapters/paste';
import { IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';
import { setLogSink } from '../../../src/log';

const CLOCK: PasteClock = { now: () => IsoTs.parse('2026-10-08T17:00:00-04:00'), offsetAt: () => -240 };
const SECRET = 'zq-7781-private-note';

const LOG = [
  'Today',
  `Email the venue options ${SECRET}`,
  'Sent an email to dana@example.com with the venue options',
  '4:33 pm',
  'Order coffee beans',
  'Ordered 2 bags of coffee beans for €24.50',
  '3:10 pm',
  'Look up flights',
  'Searched for flights to Denver',
  '2:05 pm',
  'Unsubscribed you from the newsletter',
  '5:30 pm',
  'Earlier',
  'Created event "Standup" for Monday',
  '9:15 am',
].join('\n');

let root: HTMLElement;

// happy-dom has no `spellcheck` property, so Preact would drop `spellcheck={false}` here; Chrome has it and reflects it
// to the attribute (HTML spec), which this stands in for. The built extension is checked in Chrome end to end (3.14).
if (!('spellcheck' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'spellcheck', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('spellcheck') !== 'false';
    },
    set(this: HTMLElement, on: boolean) {
      this.setAttribute('spellcheck', on ? 'true' : 'false');
    },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

const done = (n: number): ImportOutcome => ({ ok: true, received: n, added: n });

function mount(
  onImport: ImportClaims = vi.fn<ImportClaims>((_agent, claims) => Promise.resolve(done(claims.length))),
): ImportClaims {
  render(h(AddActivity, { clock: CLOCK, onImport }), root);
  return onImport;
}

function button(name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
  if (found === undefined) throw new Error(`no button "${name}"`);
  return found;
}

const hasButton = (name: string): boolean =>
  [...root.querySelectorAll('button')].some((b) => b.textContent.trim() === name);
const box = (): HTMLTextAreaElement | null => root.querySelector('textarea');
const radio = (name: string): HTMLInputElement | undefined =>
  [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (r) => r.closest('label')?.textContent.trim() === name,
  );
const alerts = (): string[] => [...root.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim());
const status = (): string => root.querySelector('[role="status"]')?.textContent.trim() ?? '';
const items = (label: string): string[] =>
  [...root.querySelectorAll(`ul[aria-label="${label}"] > li, ul[aria-labelledby="${label}"] > li`)].map(
    (li) => li.textContent.replace(/\s+/gu, ' ').trim(),
  );

async function click(name: string): Promise<void> {
  await act(() => {
    button(name).click();
  });
}

async function choose(agent: string): Promise<void> {
  await act(() => {
    radio(agent)?.click();
  });
}

async function paste(text: string): Promise<void> {
  await act(() => {
    const textarea = box();
    if (textarea === null) throw new Error('no paste box');
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function previewOf(text: string, agent = 'Muse'): Promise<void> {
  await click('Add agent activity');
  await choose(agent);
  await paste(text);
  await click('Preview');
}

/** Lets a pending import settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Add agent activity: the form', () => {
  it('opens from its button on the agent picker, no agent chosen and the paste box empty', async () => {
    mount();
    expect(status()).toBe('');
    await click('Add agent activity');
    expect(radio('Muse')).toBe(document.activeElement);
    expect(['Muse', 'ChatGPT', 'Dots', 'Claude'].map((name) => radio(name)?.checked)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(box()?.value).toBe('');
  });

  it('labels every control for a screen reader, and keeps the paste box away from spell check', async () => {
    mount();
    await click('Add agent activity');
    expect(root.querySelector('fieldset > legend')?.textContent).toBe('Which agent’s activity is this?');
    expect(root.querySelectorAll('fieldset input[type="radio"][name="paste-agent"]')).toHaveLength(4);
    const textarea = box();
    expect(root.querySelector(`label[for="${textarea?.id ?? ''}"]`)?.textContent.trim()).toBe('Activity log');
    expect(textarea?.getAttribute('aria-describedby')).toBe('paste-log-hint');
    expect(root.querySelector('#paste-log-hint')?.textContent).toContain('day heading');
    expect([textarea?.getAttribute('spellcheck'), textarea?.getAttribute('autocomplete')]).toEqual([
      'false',
      'off',
    ]);
    for (const b of root.querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button');
  });

  it('asks for the agent, then for a paste, as alerts tied to the paste box', async () => {
    mount();
    await click('Add agent activity');
    await click('Preview');
    expect(alerts()).toEqual([NO_AGENT]);
    await choose('Claude');
    expect(alerts()).toEqual([]);
    await click('Preview');
    expect(alerts()).toEqual([REFUSALS.empty]);
    expect(box()?.getAttribute('aria-invalid')).toBe('true');
    expect(box()?.getAttribute('aria-describedby')).toBe('paste-log-hint paste-log-error');
  });
});

describe('Add agent activity: refusals and Cancel', () => {
  it('refuses an over-long paste and one with more claims than an import carries, never cutting them', async () => {
    mount();
    await previewOf('a'.repeat(MAX_PASTE_CHARS + 1));
    expect(alerts()).toEqual([REFUSALS.too_long]);
    const many = Array.from(
      { length: SCHEMA_LIMITS.BATCH + 1 },
      (_, i) => `Sent an email to person${String(i)}@example.com\n4:${String(i % 60).padStart(2, '0')} pm`,
    );
    await paste(['Today', ...many].join('\n'));
    await click('Preview');
    expect(alerts()).toEqual([REFUSALS.too_many_claims]);
    expect(root.querySelector('#paste-preview-heading')).toBeNull();
  });

  it('Cancel closes the form and returns focus to its button', async () => {
    mount();
    await click('Add agent activity');
    await click('Cancel');
    expect(box()).toBeNull();
    expect(button('Add agent activity')).toBe(document.activeElement);
  });
});

describe('Add agent activity: the preview', () => {
  it('lists each claim and each entry not imported with why, and moves focus to its heading', async () => {
    mount();
    await previewOf(LOG);
    expect(root.querySelector('#paste-preview-heading')).toBe(document.activeElement);
    expect(root.textContent).toContain('2 claims to import from Muse.');
    expect(items('Claims to import')).toEqual([
      'Email sent: dana@example.comThu 8 Oct, 4:33 pm',
      expect.stringMatching(/^Purchase: .*€24\.50Thu 8 Oct, 3:10 pm$/u),
    ]);
    expect(items('paste-skipped-heading')).toEqual([
      'Look up flights · Searched for flights to DenverToday, 2:05 pm. Nothing Attest checks.',
      'Unsubscribed you from the newsletterToday, 5:30 pm. Not imported: no time Attest can use.',
      'Created event "Standup" for MondayEarlier, 9:15 am. Not imported: no day. Copy the day heading, such as “Today”, with the entries.',
    ]);
    expect(root.querySelector('#paste-skipped-heading')?.textContent).toBe('Not imported (3)');
    expect(hasButton('Import 2 claims')).toBe(true);
  });

  it('with nothing to import, says so and offers no Import button', async () => {
    mount();
    await previewOf(['Today', 'Searched for flights to Denver', '2:05 pm'].join('\n'), 'ChatGPT');
    expect(root.textContent).toContain('Nothing to import from ChatGPT.');
    expect(root.querySelector('ul[aria-label="Claims to import"]')).toBeNull();
    expect([hasButton('Edit the paste'), hasButton('Cancel')]).toEqual([true, true]);
    expect([...root.querySelectorAll('button')].some((b) => b.textContent.startsWith('Import'))).toBe(false);
  });

  it('shows an entry Attest could not read as such (a bug, never expected)', () => {
    render(
      h(
        'ul',
        null,
        h(SkippedItem, { entry: { text: 'An entry', time: null, outcome: 'invalid', claims: [] } }),
      ),
      root,
    );
    expect(root.textContent).toBe('An entryNot imported: Attest could not read this entry.');
  });

  it('Edit the paste returns to the form with the agent and the text kept, focus in the paste box', async () => {
    mount();
    await previewOf(LOG, 'Dots');
    await click('Edit the paste');
    expect(radio('Dots')?.checked).toBe(true);
    expect(box()?.value).toBe(LOG);
    expect(box()).toBe(document.activeElement);
  });
});

describe('Add agent activity: importing', () => {
  it('sends the agent and the claims only, then closes, says how many, and returns focus to its button', async () => {
    const onImport = mount();
    await previewOf(LOG, 'Claude');
    await click('Import 2 claims');
    await settle();
    expect(onImport).toHaveBeenCalledTimes(1);
    const [agent, claims] = vi.mocked(onImport).mock.calls[0] ?? [];
    expect([agent, claims?.map((c) => c.type)]).toEqual(['claude', ['email.sent', 'purchase.made']]);
    expect(JSON.stringify(vi.mocked(onImport).mock.calls)).not.toContain(SECRET);
    expect(status()).toBe('Imported 2 claims.');
    expect(button('Add agent activity')).toBe(document.activeElement);
  });

  it('while importing, every button is disabled and a second press sends nothing', async () => {
    let finish: (outcome: ImportOutcome) => void = () => undefined;
    const onImport = mount(vi.fn(() => new Promise<ImportOutcome>((resolve) => (finish = resolve))));
    await previewOf(LOG);
    await click('Import 2 claims');
    expect(hasButton('Importing')).toBe(true);
    expect([...root.querySelectorAll('button')].map((b) => b.disabled)).toEqual([true, true, true]);
    await click('Importing');
    expect(onImport).toHaveBeenCalledTimes(1);
    await act(() => {
      finish({ ok: true, received: 2, added: 1 });
    });
    await settle();
    expect(status()).toBe('Imported 1 new claim; 1 was already in Attest.');
  });
});

describe('Add agent activity: a failed import, and the text', () => {
  it('a failed or rejected import keeps the preview open and says so, and a retry can succeed', async () => {
    const outcomes: (() => Promise<ImportOutcome>)[] = [
      () => Promise.resolve({ ok: false }),
      () => Promise.reject(new Error('the service worker stopped')),
      () => Promise.resolve({ ok: true, received: 2, added: 0 }),
    ];
    mount(vi.fn<ImportClaims>(() => outcomes.shift()?.() ?? Promise.resolve<ImportOutcome>({ ok: false })));
    await previewOf(LOG);
    const logged: string[] = [];
    const restore = setLogSink((record) => logged.push(record.event));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await click('Import 2 claims');
      await settle();
      expect(alerts()).toEqual(['Could not import the claims. Try again.']);
      expect(root.querySelector('#paste-preview-heading')).not.toBeNull();
    }
    restore();
    // The rejection is logged, never silent (SEC-6); a failure the worker answered was logged where it happened.
    expect(logged).toEqual(['sidepanel.import_failed']);
    await click('Import 2 claims');
    await settle();
    expect(status()).toBe('Attest already had all 2 claims.');
  });

  it('keeps nothing of the text once the preview closes, by Cancel or by an import', async () => {
    mount();
    for (const close of ['Cancel', 'Import 2 claims']) {
      await click('Add agent activity');
      await choose('Muse');
      await paste(LOG);
      expect(box()?.value).toContain(SECRET);
      await click('Preview');
      await click(close);
      await settle();
      expect(root.innerHTML).not.toContain(SECRET);
      await click('Add agent activity');
      expect(box()?.value).toBe('');
      expect(radio('Muse')?.checked).toBe(false);
      await click('Cancel');
    }
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
    expect([localStorage.length, sessionStorage.length]).toEqual([0, 0]);
  });
});
