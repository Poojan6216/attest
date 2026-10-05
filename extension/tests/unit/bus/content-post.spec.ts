/**
 * Both content scripts post through `postAcked` (src/bus/send.ts; sprint_2 2.7; docs/adapters.md §3.3; Hard Rule 5):
 * it rejects when the service worker answers `{ ok: false }` or the message never arrives, so a pass stops before
 * it posts coverage after rows that were not stored. The skeleton's default `post` is the unchecked `send`, which
 * resolves on a transport failure, so an entrypoint that forgot to pass `post` would let coverage follow lost rows.
 * This pins each entrypoint's `startObserver` options (wave C verifier, C2 residual).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import gcalScript from '../../../entrypoints/content/gcal.content';
import gmailScript from '../../../entrypoints/content/gmail.content';
import type { BusMessage } from '../../../src/bus/messages';
import { postAcked, send } from '../../../src/bus/send';
import { OBSERVER_HEARTBEAT_MS } from '../../../src/config';
import { type ObserverHandle, startObserver } from '../../../src/observers/base';
import { SNAPSHOT, VALID } from './harness';

vi.mock('../../../src/observers/base', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startObserver: vi.fn(),
}));

vi.mock('../../../src/bus/send', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  postAcked: vi.fn(),
  send: vi.fn(),
}));

const started = vi.mocked(startObserver);
const acked = vi.mocked(postAcked);

/** A stand-in for WXT's content script context: only what `main` uses. */
function contextStub(): ContentScriptContext {
  const stub: Pick<ContentScriptContext, 'onInvalidated'> = { onInvalidated: vi.fn() };
  return stub as ContentScriptContext;
}

beforeEach(() => {
  const handle: ObserverHandle = { disconnect: vi.fn(), settled: () => Promise.resolve() };
  started.mockReturnValue(handle);
  acked.mockResolvedValue(undefined);
});

/** The `post` each `startObserver` call was given, by observer id. */
function postsByObserver(): Map<string, unknown> {
  return new Map(started.mock.calls.map(([observer, options]) => [observer.id, options?.post]));
}

describe('the content scripts post through postAcked', () => {
  it('Gmail: the Sent and receipt observers are each started with post: postAcked itself', async () => {
    await gmailScript.main(contextStub());
    const posts = postsByObserver();
    expect([...posts.keys()].sort()).toEqual(['gmail.receipt', 'gmail.sent']);
    for (const post of posts.values()) expect(post).toBe(postAcked);
  });

  it('Calendar: its post hands every message to postAcked, the snapshot with its account, never to send', async () => {
    await gcalScript.main(contextStub());
    const post = postsByObserver().get('gcal.event');
    if (typeof post !== 'function') throw new Error('the Calendar observer was started without a post');
    const ping = VALID['coverage.ping'];
    await (post as (message: BusMessage) => Promise<void>)(ping);
    const snapshot = { type: 'calendar.snapshot' as const, observerId: 'gcal.event', snapshot: SNAPSHOT };
    await (post as (message: BusMessage) => Promise<void>)(snapshot);
    expect(acked.mock.calls.map(([message]) => message.type)).toEqual(['coverage.ping', 'calendar.snapshot']);
    expect(vi.mocked(send)).not.toHaveBeenCalled();
  });

  it('a post that rejects reaches the observer: the Calendar post does not swallow a refusal', async () => {
    await gcalScript.main(contextStub());
    const post = postsByObserver().get('gcal.event') as (message: BusMessage) => Promise<void>;
    acked.mockRejectedValueOnce(new Error('refused'));
    await expect(post(VALID['coverage.ping'])).rejects.toThrow('refused');
  });
});

describe('the Calendar content script keeps its snapshot fresh', () => {
  it('Calendar runs with the heartbeat; the Gmail observers run on changes only', async () => {
    await gcalScript.main(contextStub());
    await gmailScript.main(contextStub());
    const beats = new Map(
      started.mock.calls.map(([observer, options]) => [observer.id, options?.heartbeatMs]),
    );
    expect(beats.get('gcal.event')).toBe(OBSERVER_HEARTBEAT_MS);
    expect(beats.get('gmail.sent')).toBeUndefined();
    expect(beats.get('gmail.receipt')).toBeUndefined();
  });
});
