import 'fake-indexeddb/auto';
/**
 * The service-worker entry's away-detection wiring (entrypoints/background.ts; sprint_3 3.14; Hard Rule 8; Sprint 3
 * QA review). idle.spec.ts tests `watchIdle` and `onPermissionsRemoved` themselves, and background-entry.spec.ts
 * swallows the entry's permission listeners (chrome-fakes.ts); here they are kept and fired as Chrome fires them:
 *  - the person turns away detection off while the worker runs: every stored time away goes (the options page
 *    promises it), and a change to another permission keeps them;
 *  - the person turns it on while the worker runs: the worker starts listening at once, and the next time away is
 *    recorded.
 * Each test starts the entry afresh (new module instances), as a service worker starts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { IdleApi, IdleState } from '../../../src/background/idle';
import { IDLE_DETECTION_SECONDS } from '../../../src/config';
import { IsoTs } from '../../../src/core/schema';
import { pinClock, releaseClock } from '../ledger/fixtures';

type Added = Parameters<typeof fakeBrowser.permissions.onAdded.addListener>[0];
type Removed = Parameters<typeof fakeBrowser.permissions.onRemoved.addListener>[0];

const DAY = [Date.parse('2026-10-06T00:00:00Z'), Date.parse('2026-10-08T00:00:00Z')] as const;
let closeShared: () => Promise<void> = () => Promise.resolve();

beforeEach(() => {
  fakeBrowser.reset();
  pinClock('2026-10-06T18:01:00Z');
});

afterEach(async () => {
  await closeShared();
  releaseClock();
});

/** Chrome's `idle` as the worker sees it once the permission is held: the interval set and the listener to call. */
function fakeIdle(): IdleApi & {
  readonly interval: () => number | undefined;
  fire: (state: IdleState) => void;
} {
  let interval: number | undefined;
  const listeners: ((state: IdleState) => void)[] = [];
  return {
    setDetectionInterval: (seconds) => {
      interval = seconds;
    },
    onStateChanged: { addListener: (listener) => listeners.push(listener) },
    interval: () => interval,
    fire: (state) => {
      for (const listener of listeners) listener(state);
    },
  };
}

/** Starts the entry as Chrome starts a worker without the permission, keeping the listeners it registers. */
async function startWorker() {
  const added: Added[] = [];
  const removed: Removed[] = [];
  Object.defineProperty(fakeBrowser, 'idle', { value: undefined, configurable: true, writable: true });
  vi.spyOn(fakeBrowser.permissions.onAdded, 'addListener').mockImplementation((listener) => {
    added.push(listener);
  });
  vi.spyOn(fakeBrowser.permissions.onRemoved, 'addListener').mockImplementation((listener) => {
    removed.push(listener);
  });
  vi.resetModules();
  const repo = await import('../../../src/ledger/repo');
  const activity = await import('../../../src/ledger/activity');
  const { default: background } = await import('../../../entrypoints/background');
  background.main();
  closeShared = repo.closeLedger;
  const idleIn = async () => (await activity.activityIn(await repo.getLedger(), ...DAY)).idle;
  return { added, removed, repo, activity, idleIn };
}

describe('the entry’s away-detection wiring', () => {
  it('turning it off while the worker runs deletes every time away; another permission keeps them', async () => {
    const { removed, repo, activity, idleIn } = await startWorker();
    expect(removed).toHaveLength(1);
    const ledger = await repo.getLedger();
    await activity.openIdle(ledger, IsoTs.parse('2026-10-06T18:00:00Z'), IsoTs.parse('2026-10-06T18:01:00Z'));
    for (const listener of removed) listener({ permissions: ['storage'] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await idleIn()).toHaveLength(1);
    for (const listener of removed) listener({ permissions: ['idle'] });
    await vi.waitFor(async () => {
      expect(await idleIn()).toEqual([]);
    });
  });

  it('turning it on while the worker runs starts listening at once, and the next time away is recorded', async () => {
    const { added, idleIn } = await startWorker();
    expect(added).toHaveLength(1);
    const idle = fakeIdle();
    Object.defineProperty(fakeBrowser, 'idle', { value: idle, configurable: true, writable: true });
    for (const listener of added) listener({ permissions: ['idle'] });
    expect(idle.interval()).toBe(IDLE_DETECTION_SECONDS);
    idle.fire('idle');
    await vi.waitFor(async () => {
      expect(await idleIn()).toHaveLength(1);
    });
    // From the last instant input could have been to the instant Chrome said so (vi.waitFor moves the pinned clock).
    const [interval] = await idleIn();
    const [from, to] = [Date.parse(interval?.from ?? ''), Date.parse(interval?.to ?? '')];
    expect(to - from).toBe(IDLE_DETECTION_SECONDS * 1_000);
    expect(to).toBeGreaterThanOrEqual(Date.parse('2026-10-06T18:01:00Z'));
  });
});
