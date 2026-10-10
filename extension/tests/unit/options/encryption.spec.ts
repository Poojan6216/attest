// @vitest-environment happy-dom
/**
 * The options page's Encryption (sprint_6 6.5; entrypoints/options/components/EncryptionSection.tsx), over stand-in
 * sources: it says what encryption protects and what it does not; off, its form checks the new passphrase, its repeat
 * and the person's word before anything is sent, then sends `crypto.enable`; on and locked, it offers the unlock;
 * on and unlocked, Lock now, a passphrase change (checked the same way) and turning it off, each sent as its command;
 * a refusal is said in words; and while a job rewrites the records, it says which and how far. Every passphrase is
 * invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncryptionSection } from '../../../entrypoints/options/components/EncryptionSection';
import type { CryptoCommand, CryptoSources } from '../../../entrypoints/options/use-crypto-status';
import type { CryptoResult } from '../../../src/bus/messages';
import { setLogSink } from '../../../src/log';
import type { CryptoStatus } from '../../../src/ui/settings-data';

const PASSPHRASE = 'an invented passphrase';
const NEXT = 'another invented passphrase';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
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

function sourcesOf(status: CryptoStatus, answer: CryptoResult = { ok: true }) {
  const send = vi.fn<(command: CryptoCommand) => Promise<CryptoResult>>(() => Promise.resolve(answer));
  const sources: CryptoSources = {
    load: () => Promise.resolve(status),
    send,
    subscribe: () => () => undefined,
  };
  return { sources, send };
}

async function show(sources: CryptoSources): Promise<void> {
  await act(() => {
    render(h(EncryptionSection, { sources }), root);
  });
  await settle();
}

const text = () => root.textContent;
const formNamed = (heading: string): HTMLFormElement => {
  const form = [...root.querySelectorAll('form')].find((each) => each.textContent.includes(heading));
  if (form === undefined) throw new Error(`no form ${heading}`);
  return form;
};

async function type(form: HTMLFormElement, label: string, value: string): Promise<void> {
  const field = [...form.querySelectorAll('label')].find((each) => each.textContent.trim().startsWith(label));
  const input = field?.querySelector('input');
  if (input === null || input === undefined) throw new Error(`no field ${label}`);
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

describe('encryption off', () => {
  it('says what it protects and does not, and checks the form before anything is sent', async () => {
    const { sources, send } = sourcesOf({ on: false, locked: false });
    await show(sources);
    expect(text()).toContain('someone who copies your Chrome profile cannot read them');
    expect(text()).toContain('Not sealed: ids, hashes, dates, grades and states');
    expect(text()).toContain('Delete all data is the only way back');
    const form = formNamed('Turn on encryption');
    await type(form, 'New passphrase', 'too short');
    await type(form, 'Type it again', 'too short');
    await submit(form);
    expect(text()).toContain('Use at least 12 characters');
    await type(form, 'New passphrase', PASSPHRASE);
    await submit(form);
    expect(text()).toContain('The two new passphrases differ');
    await type(form, 'Type it again', PASSPHRASE);
    await submit(form);
    expect(text()).toContain('Tick the box first');
    expect(send).not.toHaveBeenCalled();
    const box = form.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(() => {
      box?.click();
    });
    await submit(form);
    expect(send).toHaveBeenCalledWith({ type: 'crypto.enable', passphrase: PASSPHRASE });
    expect(text()).toContain('Encryption is on. Attest is sealing your records.');
  });
});

describe('encryption on', () => {
  it('offers the unlock while locked, and says how far a job is', async () => {
    const { sources, send } = sourcesOf(
      { on: true, locked: true, job: { kind: 'reseal', table: 3, of: 9 } },
      { ok: false, code: 'wrong_passphrase' },
    );
    await show(sources);
    expect(text()).toContain(
      'Sealing your records again under the new passphrase: table 3 of 9. Unlock to let it finish.',
    );
    const form = formNamed('Unlock');
    await type(form, 'Passphrase', NEXT);
    await submit(form);
    expect(send).toHaveBeenCalledWith({ type: 'crypto.unlock', passphrase: NEXT });
    expect(text()).toContain('That passphrase does not open your records');
    expect(root.querySelector('form h3')).toBeNull();
  });

  it('locks, changes the passphrase after checking the new one, and turns off, each by its own command', async () => {
    const { sources, send } = sourcesOf({ on: true, locked: false });
    await show(sources);
    const lock = [...root.querySelectorAll('button')].find((each) => each.textContent.trim() === 'Lock now');
    await act(() => {
      lock?.click();
    });
    await settle();
    expect(send).toHaveBeenLastCalledWith({ type: 'crypto.lock' });
    const change = formNamed('Change the passphrase');
    await type(change, 'Passphrase in use', PASSPHRASE);
    await type(change, 'New passphrase', NEXT);
    await type(change, 'Type the new one again', `${NEXT}!`);
    await submit(change);
    expect(text()).toContain('The two new passphrases differ');
    await type(change, 'Type the new one again', NEXT);
    await submit(change);
    expect(send).toHaveBeenLastCalledWith({ type: 'crypto.change', passphrase: PASSPHRASE, next: NEXT });
    const off = formNamed('Turn off encryption');
    await type(off, 'Passphrase in use', PASSPHRASE);
    await submit(off);
    expect(send).toHaveBeenLastCalledWith({ type: 'crypto.disable', passphrase: PASSPHRASE });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('says a refusal in words', async () => {
    const { sources } = sourcesOf({ on: true, locked: false }, { ok: false, code: 'busy' });
    await show(sources);
    const off = formNamed('Turn off encryption');
    await type(off, 'Passphrase in use', PASSPHRASE);
    await submit(off);
    expect(text()).toContain('Attest is still rewriting your records');
  });
});
