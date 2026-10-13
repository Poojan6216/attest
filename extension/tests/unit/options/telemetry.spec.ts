// @vitest-environment happy-dom
/**
 * The options page's opt-in telemetry (sprint_5 5.7; entrypoints/options/components/TelemetryToggle.tsx), over stand-in
 * sources: it says what is sent, to whom and how to stop; it shows the next send exactly, on or off, and a day already
 * sent as sent, never as the next (Sprint 5 close, SEC-8); it reads the numbers again on every change its sources
 * announce and after its own command; its switch sends `flag.set` for ATTEST_TELEMETRY; "Send a test payload now" works
 * only while it is on, and says in one line what the service worker did; a command that fails is said, never left busy
 * (TECH-6). Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type TelemetrySources,
  TelemetryToggle,
} from '../../../entrypoints/options/components/TelemetryToggle';
import type { TelemetryView } from '../../../entrypoints/options/telemetry-preview';
import type { SettingResult, TelemetrySendResult } from '../../../src/bus/messages';
import { TELEMETRY_HOST } from '../../../src/config';
import { LedgerError } from '../../../src/ledger/errors';
import { setLogSink } from '../../../src/log';
import { TelemetryPayload } from '../../../src/telemetry/schema';

const zero = { VERIFIED: 0, PARTIAL: 0, NOT_FOUND: 0, UNASKED: 0, OVER_SCOPE: 0, UNVERIFIABLE: 0 };
const PAYLOAD = TelemetryPayload.parse({
  installId: '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  extVersion: '0.1.0',
  chromeMajor: 154,
  dayBucket: '2026-10-09',
  adaptersEnabled: { muse: false, chatgpt: false, dots: false, claude: false },
  observersEnabled: { gmail: true, gcal: true },
  counts: { muse: { ...zero, VERIFIED: 3 }, chatgpt: zero, dots: zero, claude: zero },
  adapterHealth: { 'gmail.sent': 'OK' },
  coverageHours: { gmail: 6, gcal: 2 },
});

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

const button = (name: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);

async function show(
  on: boolean,
  sources: TelemetrySources,
  toggle = vi.fn(() => Promise.resolve<SettingResult>({ ok: true })),
) {
  await act(() => {
    render(h(TelemetryToggle, { on, toggle, sources }), root);
  });
  await settle();
  return toggle;
}

/** Stand-in sources: the numbers of 2026-10-09 (`payload`, sent or not), the change callback kept in `changed`. */
const sources = (result: TelemetrySendResult, payload: TelemetryPayload | null = PAYLOAD, sent = false) => {
  const changed: { current: () => void } = { current: () => undefined };
  const view: TelemetryView = { day: '2026-10-09', payload, sent };
  return {
    preview: vi.fn(() => Promise.resolve(view)),
    subscribe: (onChange: () => void) => {
      changed.current = onChange;
      return () => undefined;
    },
    sendNow: vi.fn(() => Promise.resolve(result)),
    changed,
  };
};

describe('the telemetry switch', () => {
  it('says what goes where, shows the next send exactly while off, and turns on through flag.set', async () => {
    const stand = sources({ ok: true, outcome: 'off', day: '2026-10-09' });
    const toggle = await show(false, stand);
    expect(root.textContent).toContain(`Once a day, Attest sends ${TELEMETRY_HOST} the numbers below`);
    expect(root.textContent).toContain('never an address, a name, a subject or anything Attest read');
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Usage numbers are off.');
    expect(JSON.parse(root.querySelector('pre')?.textContent ?? '')).toEqual(PAYLOAD);
    expect(root.querySelector('figcaption')?.textContent).toBe(
      'Exactly what the next send holds, the numbers for 2026-10-09:',
    );
    expect(button('Send a test payload now')?.disabled).toBe(true);
    await act(() => {
      button('Turn on usage numbers')?.click();
    });
    await settle();
    expect(toggle).toHaveBeenCalledWith(true);
    expect(stand.sendNow).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: true, outcome: 'sent', day: '2026-10-09' }, 'Sent the numbers for 2026-10-09.'],
    [
      { ok: true, outcome: 'already_sent', day: '2026-10-09' },
      'Already sent the numbers for 2026-10-09: Attest sends one day once.',
    ],
    [
      { ok: true, outcome: 'failed', day: '2026-10-09' },
      'Not sent: the server did not take them. Attest tries again within the hour.',
    ],
    [
      { ok: true, outcome: 'not_built', day: '2026-10-09' },
      'Not sent: Attest could not build the numbers for 2026-10-09.',
    ],
    [{ ok: false, code: 'failed' }, 'Not sent. Try again.'],
  ] as const)('sends a test payload while on, and says what happened (%o)', async (result, line) => {
    const stand = sources(result);
    await show(true, stand);
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Usage numbers are on.');
    await act(() => {
      button('Send a test payload now')?.click();
    });
    await settle();
    expect(stand.sendNow).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain(line);
    // The page reads the numbers again after its own command.
    expect(stand.preview).toHaveBeenCalledTimes(2);
  });
});

describe('the telemetry numbers and failures', () => {
  it('says a day already sent is sent, and reads again on a change its sources announce', async () => {
    const stand = sources({ ok: true, outcome: 'sent', day: '2026-10-09' }, PAYLOAD, true);
    await show(true, stand);
    expect(root.querySelector('figcaption')?.textContent).toBe('The numbers for 2026-10-09, already sent:');
    expect(root.textContent).not.toContain('next send');
    await act(() => {
      stand.changed.current();
    });
    await settle();
    expect(stand.preview).toHaveBeenCalledTimes(2);
  });

  it('says a command that fails, and is no longer busy', async () => {
    const toggle = vi.fn(() => Promise.reject(new Error('the bus is down')));
    await show(true, sources({ ok: true, outcome: 'sent', day: '2026-10-09' }), toggle);
    await act(() => {
      button('Turn off usage numbers')?.click();
    });
    await settle();
    expect(root.textContent).toContain('Not done. Try again.');
    expect(button('Turn off usage numbers')?.disabled).toBe(false);
  });

  it('says the records are locked, never that the numbers cannot be built (Sprint 6 close, TECH-8)', async () => {
    const stand = sources({ ok: true, outcome: 'off', day: '2026-10-09' });
    stand.preview.mockRejectedValue(new LedgerError('locked', 'The ledger is locked', { table: 'receipts' }));
    await show(true, stand);
    expect(root.textContent).toContain(
      'Your records are locked. Unlock them to see the numbers the next send would hold.',
    );
    expect(root.textContent).not.toContain('cannot build');
  });

  it('says when no payload can be built here, and when the switch did not change', async () => {
    const toggle = vi.fn(() => Promise.resolve<SettingResult>({ ok: false, code: 'failed' }));
    await show(true, sources({ ok: true, outcome: 'sent', day: '2026-10-09' }, null), toggle);
    expect(root.textContent).toContain('Attest cannot build the numbers for 2026-10-09 on this browser.');
    await act(() => {
      button('Turn off usage numbers')?.click();
    });
    await settle();
    expect(root.textContent).toContain('Not changed. Try again.');
  });
});
