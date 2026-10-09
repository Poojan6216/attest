// @vitest-environment happy-dom
/**
 * The options page's away detection (entrypoints/options/components/AwayDetection.tsx; sprint_3 3.14; Hard Rule 8):
 * the states away-detection.spec.ts leaves out (Sprint 3 QA review, qa_tester priority 6: UI states and a11y).
 *  - Checking: until Chrome says whether the permission is held, the page claims neither on nor off and offers no
 *    button.
 *  - Chrome keeps the permission when it is turned off: it stays on and says so.
 *  - A request that throws at once or rejects: it stays off, says something went wrong, and logs it (SEC-6).
 *  - A check Chrome cannot answer: it says Attest could not tell, never on, and logs it (SEC-6).
 *  - A problem shown once is cleared by the next try that works.
 *  - The section is a group named by its heading, its state a status line, its buttons plain buttons.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { AwayDetection } from '../../../entrypoints/options/components/AwayDetection';
import { type LogRecord, setLogSink } from '../../../src/log';

let root: HTMLElement;
let logged: LogRecord[];
let restoreLog: () => void;

type Asked = (asked: { readonly permissions: readonly string[] }) => Promise<boolean>;

/** What `permissions.<method>` answers in a test: the fake leaves the three unimplemented. */
function permission(method: 'contains' | 'request' | 'remove') {
  const mock = vi.fn<Asked>();
  Object.defineProperty(fakeBrowser.permissions, method, { value: mock, configurable: true, writable: true });
  return mock;
}

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
  logged = [];
  restoreLog = setLogSink((record) => logged.push(record));
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.restoreAllMocks();
  restoreLog();
});

const events = (): string[] => logged.map((record) => record.event);

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const status = (): string => root.querySelector('[role="status"]')?.textContent.trim() ?? '';
const alertText = (): string | null => root.querySelector('[role="alert"]')?.textContent.trim() ?? null;
const buttons = (): string[] => [...root.querySelectorAll('button')].map((b) => b.textContent.trim());

async function mount(held: boolean): Promise<void> {
  permission('contains').mockResolvedValue(held);
  render(h(AwayDetection, null), root);
  await settle();
}

async function press(): Promise<void> {
  await act(() => {
    root.querySelector('button')?.click();
  });
  await settle();
}

describe('away detection: while Chrome has not answered', () => {
  it('claims neither on nor off and offers no button, then shows what Chrome said', async () => {
    let answer: (held: boolean) => void = () => undefined;
    permission('contains').mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    render(h(AwayDetection, null), root);
    await settle();
    expect([status(), buttons(), alertText()]).toEqual(['', [], null]);
    await act(() => {
      answer(false);
    });
    await settle();
    expect([status(), buttons()]).toEqual(['Away detection is off.', ['Turn on']]);
  });
});

describe('away detection: Chrome says no, or fails', () => {
  it('turning it off when Chrome keeps the permission leaves it on and says so', async () => {
    await mount(true);
    permission('remove').mockResolvedValue(false);
    await press();
    expect([status(), buttons(), alertText()]).toEqual([
      'Away detection is on.',
      ['Turn off'],
      'Chrome kept it on. Try again.',
    ]);
  });

  it('a request that throws at once, or rejects, leaves it off and says something went wrong', async () => {
    await mount(false);
    const request = permission('request').mockImplementation(() => {
      throw new Error('not in a user gesture');
    });
    await press();
    expect([status(), alertText()]).toEqual(['Away detection is off.', 'Something went wrong. Try again.']);
    request.mockReset();
    request.mockRejectedValue(new Error('the browser said no'));
    await press();
    expect(request).toHaveBeenCalledWith({ permissions: ['idle'] });
    expect([status(), alertText()]).toEqual(['Away detection is off.', 'Something went wrong. Try again.']);
    expect(events()).toEqual(['options.away_change_failed', 'options.away_change_failed']);
  });

  it('a check Chrome cannot answer says Attest could not tell, offers to turn it on, and logs it', async () => {
    permission('contains').mockRejectedValue(new Error('no answer'));
    render(h(AwayDetection, null), root);
    await settle();
    expect([status(), buttons()]).toEqual([
      'Attest could not tell whether away detection is on.',
      ['Turn on'],
    ]);
    expect(events()).toEqual(['options.away_check_failed']);
  });

  it('a problem shown once is cleared by the next try that works', async () => {
    await mount(false);
    const request = permission('request').mockResolvedValue(false);
    await press();
    expect(alertText()).toBe('Chrome did not allow it, so it stays off.');
    request.mockResolvedValue(true);
    await press();
    expect([status(), buttons(), alertText()]).toEqual(['Away detection is on.', ['Turn off'], null]);
  });
});

describe('away detection: keyboard and screen reader', () => {
  it('is a group named by its heading, says its state in a status line, and uses plain buttons', async () => {
    await mount(false);
    const group = root.querySelector('[role="group"]');
    const heading = group?.getAttribute('aria-labelledby') ?? '';
    expect(root.querySelector(`#${heading}`)?.textContent.trim()).toBe('When you are away');
    expect(group?.querySelector('[role="status"]')?.textContent).toBe('Away detection is off.');
    for (const button of root.querySelectorAll('button')) expect(button.getAttribute('type')).toBe('button');
  });
});
