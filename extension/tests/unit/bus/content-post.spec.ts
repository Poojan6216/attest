/**
 * Both content scripts post through `postAcked` (src/bus/send.ts; sprint_2 2.7; docs/adapters.md §3.3; Hard Rule 5):
 * it rejects when the service worker answers `{ ok: false }` or the message never arrives, so a pass stops before
 * it posts coverage after rows that were not stored. The skeleton's default `post` is the unchecked `send`, which
 * resolves on a transport failure, so an entrypoint that forgot to pass `post` would let coverage follow lost rows.
 * This pins each entrypoint's `startObserver(s)` options (wave C verifier, C2 residual), that the Gmail script starts
 * its two observers together (one watcher and one activity tracker for the tab, TECH-2), and that neither script
 * stops its observers on WXT's `ctx.onInvalidated`, which the page can fire (Decisions [2.close] S5, SEC-3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import gcalScript from '../../../entrypoints/content/gcal.content';
import gmailScript from '../../../entrypoints/content/gmail.content';
import type { BusMessage } from '../../../src/bus/messages';
import { postAcked, send } from '../../../src/bus/send';
import { OBSERVER_HEARTBEAT_MS } from '../../../src/config';
import { type ObserverHandle, startObserver, startObservers } from '../../../src/observers/base';
import { SNAPSHOT, VALID } from './harness';

vi.mock('../../../src/observers/base', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startObserver: vi.fn(),
  startObservers: vi.fn(),
}));

vi.mock('../../../src/bus/send', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  postAcked: vi.fn(),
  send: vi.fn(),
}));

const startedOne = vi.mocked(startObserver);
const startedMany = vi.mocked(startObservers);
const acked = vi.mocked(postAcked);
const invalidated = vi.fn();

/** A stand-in for WXT's content script context: only what `main` could use. */
function contextStub(): ContentScriptContext {
  const stub: Pick<ContentScriptContext, 'onInvalidated'> = { onInvalidated: invalidated };
  return stub as ContentScriptContext;
}

beforeEach(() => {
  const handle: ObserverHandle = { disconnect: vi.fn(), settled: () => Promise.resolve() };
  startedOne.mockReturnValue(handle);
  startedMany.mockReturnValue(handle);
  acked.mockResolvedValue(undefined);
});

/** Every observer started, by either function, with the options it was started with. */
function startedObservers(): (readonly [string, Parameters<typeof startObserver>[1]])[] {
  return [
    ...startedOne.mock.calls.map(([observer, options]) => [observer.id, options] as const),
    ...startedMany.mock.calls.flatMap(([observers, options]) =>
      observers.map((observer) => [observer.id, options] as const),
    ),
  ];
}

/** The `post` each observer was started with, by observer id. */
function postsByObserver(): Map<string, unknown> {
  return new Map(startedObservers().map(([id, options]) => [id, options?.post]));
}

describe('the content scripts post through postAcked', () => {
  it('Gmail: the Sent and receipt observers are each started with post: postAcked itself', async () => {
    await gmailScript.main(contextStub());
    const posts = postsByObserver();
    expect([...posts.keys()].sort()).toEqual(['gmail.receipt', 'gmail.sent']);
    for (const post of posts.values()) expect(post).toBe(postAcked);
  });

  it('Gmail: both observers start in one call, so the tab has one watcher and one activity tracker (TECH-2)', async () => {
    await gmailScript.main(contextStub());
    expect(startedOne).not.toHaveBeenCalled();
    expect(startedMany.mock.calls.map(([observers]) => observers.map((observer) => observer.id))).toEqual([
      ['gmail.sent', 'gmail.receipt'],
    ]);
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
    const beats = new Map(startedObservers().map(([id, options]) => [id, options?.heartbeatMs]));
    expect(beats.get('gcal.event')).toBe(OBSERVER_HEARTBEAT_MS);
    expect(beats.get('gmail.sent')).toBeUndefined();
    expect(beats.get('gmail.receipt')).toBeUndefined();
  });
});

describe('a page cannot stop the observers (Decisions [2.close] S5, SEC-3)', () => {
  it('neither content script ties its observers to ctx.onInvalidated, which WXT fires on a page-made event', async () => {
    await gmailScript.main(contextStub());
    await gcalScript.main(contextStub());
    expect(startedObservers().length).toBe(3);
    expect(invalidated).not.toHaveBeenCalled();
  });
});
