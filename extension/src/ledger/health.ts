/**
 * Observer health as the service worker keeps it (sprint_2 2.7; Decisions [2.7]; Hard Rule 6: fail loud, never cry
 * wolf).
 *
 * Two writers set an observer's health. The observer reports its own at the start of every pass (`adapter.health`:
 * OK, or DEGRADED with its reasons). The service worker sets it DEGRADED itself when it refuses what a pass sent: a
 * row the ledger refused (`invalid_input`, `id_conflict`, `late_sighting`), a ping or snapshot that cannot be what it
 * says. Those reasons are `ledger.<code>` (LEDGER_REASON_PREFIX), so the popup can tell them from the page's.
 *
 * The rule: a DEGRADED the service worker set stays until a later clean pass of the same observer is fully accepted.
 *  - An OK report from the observer does not clear it: that pass has not been accepted yet (its rows come after its
 *    health). The service worker clears it (`clearLedgerDegraded`) with that pass's own report once it has stored
 *    one of the pass's messages and refused none of them, at an instant after the DEGRADED one.
 *  - A DEGRADED report from the observer is stored with the service worker's reasons kept beside its own.
 *  - A pass that sends nothing but its health (a Gmail list view with no receipt open) clears nothing: there was
 *    nothing to accept.
 * Otherwise the observer's own report is stored as before: the latest wins (repo.ts `putAdapterHealth`).
 */
import { instantMs } from '../core/normalize';
import { SCHEMA_LIMITS } from '../core/schema';
import { readRow, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { AdapterHealth, ComponentId, type AdapterHealthInput, type IsoTs } from './types';

/** The prefix of the reasons the service worker gives (`ledger.late_sighting`). */
export const LEDGER_REASON_PREFIX = 'ledger.';

/** The version a DEGRADED report carries when the observer never reported one (a message forged before any). */
export const UNKNOWN_VERSION = 'unknown';

export function isLedgerReason(reason: string): boolean {
  return reason.startsWith(LEDGER_REASON_PREFIX);
}

/** Whether the stored report is a DEGRADED the service worker set. */
export function setByLedger(report: AdapterHealth | undefined): report is AdapterHealth {
  return report?.status === 'DEGRADED' && report.reasons.some(isLedgerReason);
}

function parseHealth(input: unknown): AdapterHealth {
  const parsed = AdapterHealth.safeParse(input);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)');
  throw new LedgerError('invalid_input', 'Invalid adapterHealth input', {
    table: 'adapterHealth',
    paths: [...new Set(paths)].join('|'),
  });
}

/** `a` then `b`, each reason once, at most SCHEMA_LIMITS.REASONS. */
function mergeReasons(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].slice(0, SCHEMA_LIMITS.REASONS);
}

const later = (a: IsoTs, b: IsoTs): IsoTs => (instantMs(b) > instantMs(a) ? b : a);

async function stored(db: LedgerDb, adapterId: string): Promise<AdapterHealth | undefined> {
  return readRow('adapterHealth', AdapterHealth, await db.adapterHealth.get(adapterId));
}

/**
 * Stores an observer's (or adapter's) own report by the rule in the header. Returns whether anything was written:
 * false for a report older than the stored one, and for an OK report while a DEGRADED the service worker set stands.
 */
export async function recordOwnHealth(
  db: LedgerDb,
  input: AdapterHealthInput,
): Promise<{ readonly written: boolean }> {
  const own = parseHealth(input);
  return db.transaction('rw', db.adapterHealth, async (): Promise<{ written: boolean }> => {
    const current = await stored(db, own.adapterId);
    if (current !== undefined && instantMs(own.checkedAt) < instantMs(current.checkedAt)) {
      return { written: false };
    }
    if (!setByLedger(current)) {
      await db.adapterHealth.put(own);
      return { written: true };
    }
    if (own.status === 'OK') return { written: false };
    const kept = current.reasons.filter(isLedgerReason);
    await db.adapterHealth.put({ ...own, reasons: mergeReasons(own.reasons, kept) });
    return { written: true };
  });
}

export interface LedgerDegraded {
  readonly adapterId: string;
  /** Each a `ledger.<code>` reason (LEDGER_REASON_PREFIX). */
  readonly reasons: readonly string[];
  /** The instant of the refused pass. The report is stamped at it, or at the stored report's when that is later. */
  readonly at: IsoTs;
  /** The observer's version from its message, used only when no report names one. */
  readonly version?: string | undefined;
}

/** Sets the observer DEGRADED with the service worker's reasons, kept beside any it already has. Never ignored. */
export async function markLedgerDegraded(db: LedgerDb, input: LedgerDegraded): Promise<void> {
  const reasons = input.reasons.filter(isLedgerReason);
  if (reasons.length === 0) {
    throw new LedgerError('invalid_input', 'A ledger DEGRADED needs ledger reasons', {
      table: 'adapterHealth',
      paths: 'reasons',
    });
  }
  const version = ComponentId.safeParse(input.version).data ?? UNKNOWN_VERSION;
  await db.transaction('rw', db.adapterHealth, async (): Promise<void> => {
    const current = await stored(db, input.adapterId);
    const report = parseHealth({
      adapterId: input.adapterId,
      version: current?.version ?? version,
      status: 'DEGRADED',
      reasons: mergeReasons(current?.status === 'DEGRADED' ? current.reasons : [], reasons),
      checkedAt: current === undefined ? input.at : later(input.at, current.checkedAt),
    });
    await db.adapterHealth.put(report);
  });
}

/**
 * A later pass of the observer was fully accepted: its own report (`own`, the one it sent at the start of that pass)
 * replaces a DEGRADED the service worker set before that pass. Returns whether it did.
 */
export async function clearLedgerDegraded(
  db: LedgerDb,
  input: AdapterHealthInput,
): Promise<{ readonly cleared: boolean }> {
  const own = parseHealth(input);
  return db.transaction('rw', db.adapterHealth, async (): Promise<{ cleared: boolean }> => {
    const current = await stored(db, own.adapterId);
    if (!setByLedger(current) || instantMs(own.checkedAt) <= instantMs(current.checkedAt)) {
      return { cleared: false };
    }
    await db.adapterHealth.put(own);
    return { cleared: true };
  });
}
