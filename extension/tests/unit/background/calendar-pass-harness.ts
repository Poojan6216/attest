/**
 * Shared steps of the Calendar pass tests (src/background/calendar-pass.ts): one whole pass of the week Sun 4 to Sat 10
 * Oct 2026 (its held pings, then its snapshot), the rows a test stores as another tab's pass would, and the stored
 * coverage split into the passes' windows and the first-look markers (src/ledger/first-look.ts).
 */
import { expect } from 'vitest';

import { onCalendarSnapshot } from '../../../src/background/calendar-pass';
import { onCoveragePing, onObservations } from '../../../src/background/observer-messages';
import type { BusAck } from '../../../src/bus/messages';
import defaultPolicyJson from '../../../../policy/default.json';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { project } from '../../../src/core/redact';
import type { IsoTs, ObserverCoverage } from '../../../src/core/schema';
import { readInterval } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { isFirstLookMarker } from '../../../src/ledger/first-look';
import { CoveragePing, type CoveragePingInput } from '../../../src/ledger/types';
import type { CalendarSnapshot } from '../../../src/observers/gcal/snapshot';
import { ACCOUNT, event, type EventInput } from './calendar-fixtures';
import { pingOf, rowsOf, snapshotOf, tab, type TestContext } from './observer-harness';

/**
 * The shipped policy with hour-long attribution windows, for tests of another rule: no gap between two of their passes
 * makes a change one noticed late (src/background/calendar-step.ts `staleChangeMs`), so their changes stay changes.
 */
export const WIDE_WINDOWS_POLICY = loadPolicy({
  ...defaultPolicyJson,
  unasked: { ...defaultPolicyJson.unasked, windows: { sessionMin: 60, idleMin: 60, adjacentMin: 60 } },
});

export const WEEK_START = '2026-10-04T00:00:00-04:00';
export const WEEK_END = '2026-10-11T00:00:00-04:00';

/** Event `id` on `date` (`YYYY-MM-DD`, in the week) from `hour`:00 for one hour, New York time, with `overrides`. */
export function eventOn(id: string, date: string, hour = 9, overrides: Partial<EventInput> = {}): EventInput {
  const at = (h: number) => `${date}T${String(h).padStart(2, '0')}:00:00-04:00`;
  return event(id, { occurredAt: at(hour), endAt: at(hour + 1), days: [date], ...overrides });
}

/** The pass's one ping: the whole week it read at `readAt`. */
export function weekPing(readAt: IsoTs, overrides: Partial<CoveragePingInput> = {}): CoveragePingInput {
  return {
    observerId: 'gcal.event',
    source: 'gcal.event',
    accountHash: ACCOUNT,
    lastSyncAt: readAt,
    windowStart: WEEK_START,
    windowEnd: WEEK_END,
    allCalendars: false,
    userActive: false,
    ...overrides,
  };
}

/** One whole pass from tab `sender`: its pings (each held and answered ok), then its snapshot's answer. */
export async function runPass(
  ctx: TestContext,
  snapshot: CalendarSnapshot,
  options: { pings?: readonly CoveragePingInput[]; account?: string; sender?: number } = {},
): Promise<BusAck> {
  const account = options.account ?? ACCOUNT;
  const pings = options.pings ?? [weekPing(snapshot.readAt, { accountHash: account })];
  for (const ping of pings) {
    expect(await onCoveragePing(ctx, pingOf(ping), tab(options.sender))).toEqual({ ok: true });
  }
  return onCalendarSnapshot(ctx, snapshotOf(snapshot, account), tab(options.sender));
}

/** The row a pass would derive for `event` as `type`, sighted at `observedAt` (core `project`, as the worker does). */
export function rowOf(
  event: EventInput,
  observedAt: IsoTs,
  type: 'calendar.created' | 'calendar.updated' | 'calendar.deleted' = 'calendar.created',
) {
  const fields = {
    occurredAt: event.occurredAt,
    ...(event.subjectHint === undefined ? {} : { subjectHint: event.subjectHint }),
  };
  return project('gcal.event', fields, { type, observedAt, rowKey: event.key }, DEFAULT_POLICY);
}

/** Another tab's page with no account posts `event`'s first sighting at `observedAt` (stored with its marker). */
export async function postedElsewhere(ctx: TestContext, event: EventInput, observedAt: IsoTs): Promise<void> {
  expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(event, observedAt)]))).toEqual({ ok: true });
}

async function entries(db: LedgerDb): Promise<ObserverCoverage[]> {
  return (await db.coverageIntervals.toArray()).flatMap((row) => {
    const placed = readInterval(row);
    return placed === undefined ? [] : [placed.entry];
  });
}

/** The stored windows of the passes (every coverage interval but the markers). */
export async function windows(db: LedgerDb): Promise<ObserverCoverage[]> {
  return (await entries(db)).filter((entry) => !isFirstLookMarker(entry));
}

/** The stored first-look markers. */
export async function markers(db: LedgerDb): Promise<ObserverCoverage[]> {
  return (await entries(db)).filter(isFirstLookMarker);
}

/** The interval a ping asserts (the ping without its activity flag). */
export function entryOf(ping: CoveragePingInput): ObserverCoverage {
  const parsed = CoveragePing.parse(ping);
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'userActive'),
  ) as ObserverCoverage;
}

/** What a marker says of the pass that found its row: by default, account A's week with Family hidden. */
export interface MarkerPass {
  readonly accountHash?: string;
  readonly allCalendars?: boolean;
}

/** The marker of `event`'s first sighting at `sightedAt` by `found` (`{}`: a page with no account). */
export function markerOf(
  event: EventInput,
  sightedAt: IsoTs,
  found: MarkerPass = { accountHash: ACCOUNT, allCalendars: false },
): ObserverCoverage {
  return {
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt: sightedAt,
    windowStart: event.occurredAt,
    windowEnd: event.occurredAt,
    changesSince: sightedAt,
    ...found,
  } as ObserverCoverage;
}
