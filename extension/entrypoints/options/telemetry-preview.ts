/**
 * The usage numbers the options page shows (sprint_5 5.7): the payload for the last whole day, built in the page from
 * its own connection to the ledger (src/ledger/shared.ts) with the same builder and facts the service worker sends with
 * (src/telemetry/aggregate.ts, src/telemetry/facts.ts), and whether that day was sent. The page sends nothing itself.
 * It reads the install id and never makes one: with none stored, there is nothing to show. Built again whenever what it
 * shows may have changed (Sprint 5 close, security review SEC-8): a change the service worker announces, the install id
 * changed or removed, and the day turning at midnight.
 */
import type { LedgerTable } from '../../src/bus/messages';
import { onInstallIdChanged, readInstallId } from '../../src/ledger/install-id';
import { getLedger } from '../../src/ledger/shared';
import { telemetrySentDay } from '../../src/ledger/telemetry-sent';
import { buildTelemetry, reportedDay } from '../../src/telemetry/aggregate';
import { telemetryFacts } from '../../src/telemetry/facts';
import type { TelemetryPayload } from '../../src/telemetry/schema';
import { onLedgerChanged } from '../../src/ui/data';

/** The tables the numbers are built from. */
const TELEMETRY_TABLES: readonly LedgerTable[] = ['receipts', 'adapterHealth', 'coverageIntervals', 'meta'];

/** What the page shows: the day, its payload (null when none can be built here), and whether that day was sent. */
export interface TelemetryView {
  readonly day: string;
  readonly payload: TelemetryPayload | null;
  readonly sent: boolean;
}

/** The view for the last whole day before `nowMs` (header). */
export async function previewTelemetry(nowMs: number): Promise<TelemetryView> {
  const day = reportedDay(nowMs);
  const db = await getLedger();
  const facts = await telemetryFacts(readInstallId);
  const payload = facts === null ? null : await buildTelemetry(db, facts, day);
  const sentDay = await telemetrySentDay(db);
  return { day: day.bucket, payload, sent: sentDay !== null && sentDay >= day.bucket };
}

/** Milliseconds from `nowMs` to just after the next midnight on the browser's clock. */
export function untilMidnight(nowMs: number): number {
  const next = new Date(nowMs);
  next.setHours(24, 0, 1, 0);
  return next.getTime() - nowMs;
}

/** Calls `onChange` whenever what the page shows may have changed (header); returns the unsubscribe. */
export function onTelemetryChanged(onChange: () => void, nowMs: () => number = Date.now): () => void {
  const offLedger = onLedgerChanged(TELEMETRY_TABLES, onChange);
  const offId = onInstallIdChanged(onChange);
  let timer: ReturnType<typeof setTimeout>;
  const atMidnight = (): void => {
    onChange();
    timer = setTimeout(atMidnight, untilMidnight(nowMs()));
  };
  timer = setTimeout(atMidnight, untilMidnight(nowMs()));
  return () => {
    offLedger();
    offId();
    clearTimeout(timer);
  };
}
