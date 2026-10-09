// @vitest-environment happy-dom
/**
 * The options page's away detection (sprint_3 3.14; entrypoints/options/components/AwayDetection.tsx; Hard Rule 8):
 * off until the person turns it on, which asks Chrome for the optional `idle` permission inside the click; a refusal
 * keeps it off and says so; turning it off gives the permission back. Anything that cannot be told is said, never
 * read as on (security review SEC-6).
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { AwayDetection } from '../../../entrypoints/options/components/AwayDetection';

let root: HTMLElement;

/** What `permissions.<method>` answers in a test: the fake leaves the three unimplemented. */
function permission(method: 'contains' | 'request' | 'remove') {
  const mock = vi.fn<(asked: { readonly permissions: readonly string[] }) => Promise<boolean>>();
  Object.defineProperty(fakeBrowser.permissions, method, { value: mock, configurable: true, writable: true });
  return mock;
}

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const status = (): string => root.querySelector('[role="status"]')?.textContent.trim() ?? '';
const button = (): HTMLButtonElement | null => root.querySelector('button');

async function mount(held: boolean | 'throws'): Promise<void> {
  const contains = permission('contains');
  if (held === 'throws') contains.mockRejectedValue(new Error('unknown'));
  else contains.mockResolvedValue(held);
  render(h(AwayDetection, null), root);
  await settle();
}

describe('away detection', () => {
  it('is off on a fresh install, and says so; what it cannot tell it says, never reading it as on', async () => {
    await mount(false);
    expect([status(), button()?.textContent]).toEqual(['Away detection is off.', 'Turn on']);
    render(null, root);
    await mount('throws');
    expect([status(), button()?.textContent]).toEqual([
      'Attest could not tell whether away detection is on.',
      'Turn on',
    ]);
  });

  it('turning it on asks Chrome for the idle permission, and shows it on once granted', async () => {
    await mount(false);
    const request = permission('request').mockResolvedValue(true);
    await act(() => {
      button()?.click();
    });
    await settle();
    expect(request).toHaveBeenCalledWith({ permissions: ['idle'] });
    expect([status(), button()?.textContent]).toEqual(['Away detection is on.', 'Turn off']);
  });

  it('a refusal keeps it off and says why', async () => {
    await mount(false);
    permission('request').mockResolvedValue(false);
    await act(() => {
      button()?.click();
    });
    await settle();
    expect(status()).toBe('Away detection is off.');
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Chrome did not allow it, so it stays off.',
    );
  });

  it('turning it off gives the permission back', async () => {
    await mount(true);
    const remove = permission('remove').mockResolvedValue(true);
    await act(() => {
      button()?.click();
    });
    await settle();
    expect(remove).toHaveBeenCalledWith({ permissions: ['idle'] });
    expect(status()).toBe('Away detection is off.');
  });
});
