/**
 * Service-worker bus handlers. Every handler is a thin call into the ledger: no business logic here. UI queries are
 * answered from the ledger; observer messages (sprint_2 2.7) go to ./observer-messages.ts and ./calendar-pass.ts,
 * which store what they may and answer a `BusAck`. Adapters (3.6) add theirs here.
 *
 * Every observer message is first checked against the site it came from (./sender-site.ts, SEC-V1): an observer's
 * health, rows, pings and snapshots are taken only from a page on that observer's own site, so one site's content
 * script can never write another site's facts or health. Then against the person's choice (./readers.ts, sprint_4
 * 4.5): a reader turned off is answered `reader_off`, and nothing it sends is stored.
 *
 * Whatever an observer handler stored is announced to open UI pages with one `ledger.changed` broadcast (nobody may
 * be listening: src/bus send() logs that at debug only).
 */
import type { BusHandlers } from '../bus/listen';
import type { LedgerTable, UiQuery, UiResult } from '../bus/messages';
import { send } from '../bus/send';
import { nowIso } from '../clock';
import { DEFAULT_POLICY } from '../core/policy';
import { IsoTs } from '../core/schema';
import { exportLedger } from '../ledger/export';
import { getLedger, listAdapterHealth } from '../ledger/repo';
import { onCalendarSnapshot } from './calendar-pass';
import { type ImportContext, onClaimsImport } from './claims-import';
import { type FlagStorage, onFlagSet } from './flags';
import { onGrantSave } from './grant-save';
import { BROWSER_READERS, onReaderToggle, type ReaderDeps, readerOff, syncReaders } from './readers';
import { onLedgerWipe, onRetentionSave } from './settings';
import { onReceiptEvent } from './user-events';
import { type GradingDeps, SHIPPED_GRADING } from './grading';
import { type ObserverContext, onCoveragePing, onHealth, onObservations } from './observer-messages';
import { createPassState } from './observer-state';
import { wrongSite } from './sender-site';

/** The clock lives at the edge (never in src/core). ISO 8601 with the writer's local offset (src/clock.ts). */
export type Clock = () => string;

const systemClock: Clock = nowIso;

export async function answerUiQuery(query: UiQuery, clock: Clock = systemClock): Promise<UiResult> {
  const db = await getLedger();
  switch (query.kind) {
    case 'ledger.export':
      return {
        type: 'ui.result',
        kind: query.kind,
        ok: true,
        data: await exportLedger(db, { exportedAt: clock() }),
      };
    case 'health.list':
      return { type: 'ui.result', kind: query.kind, ok: true, data: await listAdapterHealth(db) };
  }
}

/** Broadcasts `ledger.changed` for `tables` (each once). Fire and forget: it never rejects. */
export function announce(clock: Clock): (tables: readonly LedgerTable[]) => void {
  return (tables) => {
    const unique = [...new Set(tables)];
    const at = IsoTs.safeParse(clock());
    if (unique.length === 0 || !at.success) return;
    void send({ type: 'ledger.changed', tables: unique, at: at.data });
  };
}

/** The observer handlers' context: the shared ledger, the loaded default policy, fresh in-memory pass state. */
export function observerContext(clock: Clock = systemClock): ObserverContext {
  return {
    db: getLedger,
    policy: DEFAULT_POLICY,
    state: createPassState(),
    now: clock,
    notify: announce(clock),
  };
}

export function importContext(
  clock: Clock = systemClock,
  grading: GradingDeps = SHIPPED_GRADING,
): ImportContext {
  return { db: getLedger, grading, notify: announce(clock) };
}

export function createHandlers(
  clock: Clock = systemClock,
  ctx: ObserverContext = observerContext(clock),
  imports: ImportContext = importContext(clock),
  readers: ReaderDeps = BROWSER_READERS,
  /** Where the feature flags are kept: `chrome.storage.local`, as the readers' choice is. */
  flags: FlagStorage = readers.storage,
): BusHandlers {
  const settings = { db: imports.db, notify: imports.notify };
  return {
    'ui.query': (message) => answerUiQuery(message.query, clock),
    'claims.import': (message) => onClaimsImport(imports, message),
    'grant.save': (message) => onGrantSave(imports, message),
    'receipt.event': (message) =>
      onReceiptEvent({ db: imports.db, nowMs: imports.grading.nowMs, notify: imports.notify }, message),
    'retention.save': (message) => onRetentionSave(settings, message),
    'reader.toggle': (message) => onReaderToggle(message, readers),
    'flag.set': (message) => onFlagSet(message, flags),
    'ledger.wipe': () => onLedgerWipe({ notify: imports.notify, syncReaders: () => syncReaders(readers) }),
    'adapter.health': async (message, sender) =>
      wrongSite(sender, message.health.adapterId, message.type) ??
      (await readerOff(message.health.adapterId, readers)) ??
      onHealth(ctx, message, sender),
    'observer.observations': async (message, sender) =>
      wrongSite(sender, message.observerId, message.type) ??
      (await readerOff(message.observerId, readers)) ??
      onObservations(ctx, message),
    'coverage.ping': async (message, sender) =>
      wrongSite(sender, message.ping.observerId, message.type) ??
      (await readerOff(message.ping.observerId, readers)) ??
      onCoveragePing(ctx, message, sender),
    'calendar.snapshot': async (message, sender) =>
      wrongSite(sender, message.observerId, message.type) ??
      (await readerOff(message.observerId, readers)) ??
      onCalendarSnapshot(ctx, message, sender),
  };
}
