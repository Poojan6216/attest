/**
 * The person's own key's provider against the clock and a broken network (Sprint 5 QA review; sprint_5 Gate: "built-in
 * and BYO providers fail silent on timeout"; 5.3: "same timeout/parse/fail-silent contract"; Hard Rules 6, 10).
 * byo.spec.ts holds the provider to its request and its refusals, and builtin.spec.ts holds the on-device model to the
 * time limit, but no test held this provider to it. Here `fetch` is stubbed (never a network), and:
 *  - a vendor that does not answer gives no score once the time allowed is up (INTEL_TIMEOUT_MS, 2 s, read on a fake
 *    clock), and not a moment before; the request is aborted, since the call's signal reached `fetch`; the log says
 *    `intel.timeout` for `byo` and never the key; for each vendor;
 *  - a vendor that ignores the abort cannot hold the call past its time;
 *  - a network that fails, a reply that is not JSON, and a late answer after the time is up give no score either.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECK_INPUTS } from '../../../entrypoints/model-check/inputs';
import { INTEL_TIMEOUT_MS } from '../../../src/config';
import { scoresFor } from '../../../src/intel';
import type { IntelInput } from '../../../src/intel/input';
import { byoProvider } from '../../../src/intel/providers/byo';
import { type LogRecord, setLogSink } from '../../../src/log';

const KEY = 'sk-ant-qa-invented-timeout-0123456789';
const INPUT: IntelInput =
  CHECK_INPUTS[0] ??
  (() => {
    throw new Error('no check claim');
  })();

let records: LogRecord[];
let restore: () => void;
let signals: AbortSignal[];

beforeEach(() => {
  records = [];
  signals = [];
  restore = setLogSink((record) => records.push(record));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restore();
});

const logged = () => records.map(({ level, event, fields }) => [level, event, fields.provider]);
const noKeyLogged = () => {
  expect(JSON.stringify(records)).not.toContain(KEY);
};

/** A `fetch` that never answers, and rejects as Chrome's does once its signal aborts. */
function silentVendor(): void {
  vi.stubGlobal(
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (signal === null || signal === undefined) return;
        signals.push(signal);
        signal.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      }),
  );
}

describe('the person’s own key against the clock', () => {
  it.each(['anthropic', 'openai'] as const)(
    '%s: no answer in INTEL_TIMEOUT_MS is no score, not a moment before; the request is aborted, the key in no log',
    async (vendor) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      silentVendor();
      let settled = false;
      const call = scoresFor(byoProvider(vendor, KEY), INPUT).then((scores) => {
        settled = true;
        return scores;
      });
      await vi.advanceTimersByTimeAsync(INTEL_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      expect(signals.map(({ aborted }) => aborted)).toEqual([false]);
      await vi.advanceTimersByTimeAsync(1);
      expect(await call).toBeUndefined();
      expect(signals.map(({ aborted }) => aborted)).toEqual([true]);
      expect(logged()).toEqual([['warn', 'intel.timeout', 'byo']]);
      noKeyLogged();
    },
  );

  it('the time allowed is the sprint’s 2 seconds', () => {
    expect(INTEL_TIMEOUT_MS).toBe(2_000);
  });

  it('a vendor that ignores the abort cannot hold the call past its time, and its late answer counts for nothing', async () => {
    let answerLate: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          answerLate = resolve;
        }),
    );
    const started = Date.now();
    expect(await scoresFor(byoProvider('anthropic', KEY), INPUT, 30)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
    const reply = { content: [{ type: 'text', text: '{"scores":[]}' }] };
    answerLate(new Response(JSON.stringify(reply), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logged()).toEqual([['warn', 'intel.timeout', 'byo']]);
    noKeyLogged();
  });
});

describe('the person’s own key on a broken network', () => {
  it('a network that fails is no score, logged as a failure by provider, never with the key', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError(`Failed to fetch with ${KEY}`)));
    expect(await scoresFor(byoProvider('openai', KEY), INPUT)).toBeUndefined();
    expect(logged()).toEqual([['warn', 'intel.failed', 'byo']]);
    noKeyLogged();
  });

  it('a reply that is not JSON at all is no score', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 200 })));
    expect(await scoresFor(byoProvider('anthropic', KEY), INPUT)).toBeUndefined();
    expect(logged()).toEqual([['warn', 'intel.failed', 'byo']]);
    noKeyLogged();
  });

  it('a reply in the vendor’s shape whose text scores a candidate it was not given is no score', async () => {
    const stranger = '01JA0000000000000000009999';
    const text = JSON.stringify({ scores: [{ candidateId: stranger, score: 1 }] });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 })),
    );
    expect(await scoresFor(byoProvider('anthropic', KEY), INPUT)).toBeUndefined();
    expect(logged()).toEqual([['warn', 'intel.answer_invalid', 'byo']]);
  });
});
