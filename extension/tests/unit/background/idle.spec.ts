import 'fake-indexeddb/auto';
/**
 * Away detection in the service worker (sprint_3 3.14; src/background/idle.ts): what Chrome reports becomes idle
 * intervals (positive evidence only: from the last instant input could have been), Chrome's `idle` is listened to once
 * and only when it is there (the optional permission held), and giving the permission back deletes every interval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type IdleApi,
  type IdleState,
  onPermissionsRemoved,
  recordIdleState,
} from '../../../src/background/idle';
import { IDLE_DETECTION_SECONDS } from '../../../src/config';
import { activityIn } from '../../../src/ledger/activity';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';

let db: LedgerDb;
const ms = (iso: string) => Date.parse(iso);
const WHOLE = [ms('2026-10-06T00:00:00Z'), ms('2026-10-08T00:00:00Z')] as const;
const spans = async () => (await activityIn(db, ...WHOLE)).idle.map(({ from, to }) => [ms(from), ms(to)]);

beforeEach(async () => {
  pinClock('2026-10-06T12:00:00Z');
  db = await openLedger(uniqueDbName('idle'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('recordIdleState', () => {
  it('idle starts an interval IDLE_DETECTION_SECONDS before Chrome said so; active closes it there', async () => {
    await recordIdleState(db, 'idle', ms('2026-10-06T18:01:00Z'));
    expect(await spans()).toEqual([
      [ms('2026-10-06T18:01:00Z') - IDLE_DETECTION_SECONDS * 1_000, ms('2026-10-06T18:01:00Z')],
    ]);
    await recordIdleState(db, 'active', ms('2026-10-06T18:09:00Z'));
    expect(await spans()).toEqual([[ms('2026-10-06T18:00:00Z'), ms('2026-10-06T18:09:00Z')]]);
  });

  it('a locked screen starts an interval at that instant, and an idle while locked opens no second', async () => {
    await recordIdleState(db, 'locked', ms('2026-10-06T18:01:00Z'));
    await recordIdleState(db, 'idle', ms('2026-10-06T18:05:00Z'));
    await recordIdleState(db, 'active', ms('2026-10-06T18:20:00Z'));
    expect(await spans()).toEqual([[ms('2026-10-06T18:01:00Z'), ms('2026-10-06T18:20:00Z')]]);
  });
});

/** Chrome's `idle` as a test holds it: the detection interval set and the listener to call. */
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

describe('watchIdle and the permission', () => {
  it('does nothing without Chrome’s idle (the permission not held), and listens once when it is there', async () => {
    vi.resetModules();
    const fresh = await import('../../../src/background/idle');
    expect(fresh.watchIdle(undefined)).toBe(false);
    const idle = fakeIdle();
    let clock = ms('2026-10-06T18:01:00Z');
    expect(
      fresh.watchIdle(
        idle,
        () => Promise.resolve(db),
        () => clock,
      ),
    ).toBe(true);
    expect(
      fresh.watchIdle(
        idle,
        () => Promise.resolve(db),
        () => clock,
      ),
    ).toBe(true);
    expect(idle.interval()).toBe(IDLE_DETECTION_SECONDS);
    idle.fire('idle');
    await vi.waitFor(async () => {
      expect(await spans()).toHaveLength(1);
    });
    clock = ms('2026-10-06T18:09:00Z');
    idle.fire('active');
    await vi.waitFor(async () => {
      expect(await spans()).toEqual([[ms('2026-10-06T18:00:00Z'), ms('2026-10-06T18:09:00Z')]]);
    });
  });

  it('giving the permission back deletes every interval; another permission changes nothing', async () => {
    await recordIdleState(db, 'idle', ms('2026-10-06T18:01:00Z'));
    await onPermissionsRemoved({ permissions: ['storage'] }, () => Promise.resolve(db));
    expect(await spans()).toHaveLength(1);
    await onPermissionsRemoved({ permissions: ['idle'] }, () => Promise.resolve(db));
    expect(await spans()).toEqual([]);
  });
});
