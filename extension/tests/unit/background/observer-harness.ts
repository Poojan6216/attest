/**
 * The service worker's observer handlers over a real (fake-indexeddb) ledger, for the 2.7 handler tests: a context
 * with injected ledger, clock and notifier, and the messages an observer posts.
 */
import 'fake-indexeddb/auto';

import { type ObserverContext } from '../../../src/background/observer-messages';
import { createPassState } from '../../../src/background/observer-state';
import type { MessageSender } from '../../../src/bus/listen';
import {
  AdapterHealthMessage,
  CalendarSnapshotMessage,
  CoveragePingMessage,
  type LedgerTable,
  ObserverObservationsMessage,
} from '../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ObservationInput } from '../../../src/core/schema';
import type { LedgerDb } from '../../../src/ledger/db';
import type { CoveragePingInput } from '../../../src/ledger/types';
import type { CalendarSnapshot } from '../../../src/observers/gcal/snapshot';

/**
 * The clock the handlers read (held pings expire against it): after every pass instant the tests use, since a stored
 * Calendar record read later than the service worker's clock restarts its range's chain (calendar-pass.ts step 3).
 */
export const HANDLER_NOW = '2026-10-03T14:00:00-04:00';

export interface TestContext extends ObserverContext {
  readonly notified: LedgerTable[][];
}

export function contextOf(db: LedgerDb, overrides: Partial<ObserverContext> = {}): TestContext {
  const notified: LedgerTable[][] = [];
  return {
    db: () => Promise.resolve(db),
    policy: DEFAULT_POLICY,
    state: createPassState(),
    now: () => HANDLER_NOW,
    notify: (tables) => {
      notified.push([...tables]);
    },
    notified,
    ...overrides,
  };
}

/** One content script: a tab's top frame. */
export function tab(id = 7): MessageSender {
  const sender: MessageSender = { id: 'attest', frameId: 0, url: 'https://calendar.google.com/' };
  return { ...sender, tab: { id } as NonNullable<MessageSender['tab']> };
}

export function healthOf(adapterId: string, checkedAt: string, reasons: readonly string[] = []) {
  return AdapterHealthMessage.parse({
    type: 'adapter.health',
    health: {
      adapterId,
      version: '1.0.0',
      status: reasons.length === 0 ? 'OK' : 'DEGRADED',
      reasons: [...reasons],
      checkedAt,
    },
  });
}

export function rowsOf(observerId: string, observations: readonly ObservationInput[]) {
  return ObserverObservationsMessage.parse({
    type: 'observer.observations',
    observerId,
    version: '1.0.0',
    observations: [...observations],
  });
}

export function pingOf(ping: CoveragePingInput) {
  return CoveragePingMessage.parse({ type: 'coverage.ping', ping });
}

export function snapshotOf(snapshot: CalendarSnapshot, accountHash?: string, observerId = 'gcal.event') {
  return CalendarSnapshotMessage.parse({
    type: 'calendar.snapshot',
    observerId,
    snapshot,
    ...(accountHash === undefined ? {} : { accountHash }),
  });
}
