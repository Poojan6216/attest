/**
 * Observer health as the service worker keeps it (sprint_2 2.7; Decisions [2.7]; Hard Rule 6: fail loud, never cry
 * wolf).
 *
 * Two writers set an observer's health. The observer reports its own at the start of every pass (`adapter.health`:
 * OK, IDLE or DEGRADED with its reasons). The service worker sets it DEGRADED itself when it refuses what a pass sent: a
 * row the ledger refused (`invalid_input`, `id_conflict`, `late_sighting`), a ping or snapshot that cannot be what it
 * says. Those reasons are `ledger.<code>` (LEDGER_REASON_PREFIX), so the popup can tell them from the page's.
 *
 * The rule: a DEGRADED the service worker set stays until a later clean pass of the same observer is fully accepted.
 *  - An OK report from the observer does not clear it: that pass has not been accepted yet (its rows come after its
 *    health). The service worker clears it (`clearLedgerDegraded`) with that pass's own report once it has stored
 *    one of the pass's messages and refused none of them, at an instant after the DEGRADED one.
 *  - A DEGRADED report from the observer is stored with the service worker's reasons kept beside its own.
 *  - A pass that sends nothing but its health (an opened conversation with no receipt, an IDLE page) clears nothing:
 *    there was nothing to accept.
 * Otherwise the observer's own report is stored as before: the latest wins (repo.ts `putAdapterHealth`).
 *
 * IDLE (sprint_2 2.11): a report from a page the observer does not read (an Inbox tab beside the Sent tab, a list with
 * no conversation open) is neither OK nor broken. It is stored where nothing is, over an IDLE, and over the report of
 * its own tab (`sameSource`: the tab moved off the page it reported, so its OK or DEGRADED no longer stands; the third
 * review, QA-L8 and SEC-L5: a one-pass `view.mismatch` stayed for hours), never over another tab's report and never
 * over a DEGRADED the service worker set. A stored IDLE never holds back a report from a page the observer reads,
 * whatever its instant. Several tabs then never flip an observer's health, and a page that broke stays DEGRADED while
 * other tabs show other folders (Hard Rule 6).
 *
 * A report that says what the stored one says (status, reasons and version) is written only once the stored one is
 * OBSERVER_HEALTH_REFRESH_MS old (TECH-2): a pass runs every few seconds on a busy page, and rewriting the same row
 * each time cost a readwrite transaction per pass. The stored `checkedAt` stays at most that old while a page the
 * observer reads keeps reporting (an IDLE report from another tab writes nothing, so `checkedAt` is when such a page
 * last reported: TECH-L3), and a change of status, reasons or version is always written at once (`changed`), so a page that
 * recovers still clears its DEGRADED at its next pass (Hard Rule 6). Every instant written here raises the clock's
 * high water (./clock-high-water.ts), so a report stamped while the clock ran ahead is repaired with the rest of the
 * ledger when the clock comes back (./clock-guard.ts, SEC-4).
 */
import { OBSERVER_HEALTH_REFRESH_MS } from '../config';
import { instantMs } from '../core/normalize';
import { SCHEMA_LIMITS } from '../core/schema';
import { noteStoredInstant } from './clock-high-water';
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

/** What a health write did: whether a row was written, and whether it says something the stored one did not. */
export interface HealthWrite {
  readonly written: boolean;
  /** Status, reasons or version differ from the stored report (or there was none): open UI pages must re-read. */
  readonly changed: boolean;
  /** The stored report says what this one says (status, reasons, version): its tab's status is the one that stands. */
  readonly agrees: boolean;
}

/** How a report relates to the stored one, beyond what it says. */
export interface OwnHealthOptions {
  /** The stored report came from the same tab as this one (src/background/observer-state.ts `tabKey`). */
  readonly sameSource?: boolean;
}

type Planned = Pick<HealthWrite, 'written' | 'changed'>;

const UNWRITTEN: Planned = Object.freeze({ written: false, changed: false });

/** Whether two reports say the same thing: status, reasons (in order) and version. */
function sameReport(a: AdapterHealth, b: AdapterHealth): boolean {
  return (
    a.status === b.status &&
    a.version === b.version &&
    a.reasons.length === b.reasons.length &&
    a.reasons.every((reason, index) => reason === b.reasons[index])
  );
}

/** The row the rule in the header stores for `own` over `current`, or null when it stores nothing. */
function nextOwnReport(
  own: AdapterHealth,
  current: AdapterHealth | undefined,
  sameSource: boolean,
): AdapterHealth | null {
  if (current === undefined) return own;
  const older = instantMs(own.checkedAt) < instantMs(current.checkedAt);
  if (own.status === 'IDLE') {
    if (older) return null;
    return current.status === 'IDLE' || (sameSource && !setByLedger(current)) ? own : null;
  }
  if (older && current.status !== 'IDLE') return null;
  if (!setByLedger(current)) return own;
  if (own.status === 'OK') return null;
  return { ...own, reasons: mergeReasons(own.reasons, current.reasons.filter(isLedgerReason)) };
}

/** What writing `next` over `current` comes to: nothing for a repeat of the stored report younger than the refresh. */
function plannedWrite(next: AdapterHealth | null, current: AdapterHealth | undefined): Planned {
  if (next === null) return UNWRITTEN;
  if (current === undefined || !sameReport(current, next)) return { written: true, changed: true };
  const age = instantMs(next.checkedAt) - instantMs(current.checkedAt);
  return age >= OBSERVER_HEALTH_REFRESH_MS ? { written: true, changed: false } : UNWRITTEN;
}

/**
 * Stores an observer's (or adapter's) own report by the rule in the header. Returns whether anything was written
 * (false for a report older than the stored one, for an OK report while a DEGRADED the service worker set stands, for
 * an IDLE over another tab's report, and for a repeat of the stored report younger than OBSERVER_HEALTH_REFRESH_MS),
 * whether it changed what the stored report says, and whether the stored report now says what this one says
 * (`agrees`: the caller then knows the stored health is this tab's). The common case, a repeat, is decided by a read
 * alone: no readwrite transaction.
 */
export async function recordOwnHealth(
  db: LedgerDb,
  input: AdapterHealthInput,
  options: OwnHealthOptions = {},
): Promise<HealthWrite> {
  const own = parseHealth(input);
  const sameSource = options.sameSource ?? false;
  const agrees = (report: AdapterHealth | undefined): boolean =>
    report !== undefined && sameReport(report, own);
  const seen = await stored(db, own.adapterId);
  if (!plannedWrite(nextOwnReport(own, seen, sameSource), seen).written)
    return { ...UNWRITTEN, agrees: agrees(seen) };
  return db.transaction('rw', [db.adapterHealth, db.meta], async (): Promise<HealthWrite> => {
    const current = await stored(db, own.adapterId);
    const next = nextOwnReport(own, current, sameSource);
    const write = plannedWrite(next, current);
    if (!write.written || next === null) return { ...UNWRITTEN, agrees: agrees(current) };
    await db.adapterHealth.put(next);
    await noteStoredInstant(db, next.checkedAt);
    return { ...write, agrees: agrees(next) };
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
  await db.transaction('rw', [db.adapterHealth, db.meta], async (): Promise<void> => {
    const current = await stored(db, input.adapterId);
    const report = parseHealth({
      adapterId: input.adapterId,
      version: current?.version ?? version,
      status: 'DEGRADED',
      reasons: mergeReasons(current?.status === 'DEGRADED' ? current.reasons : [], reasons),
      checkedAt: current === undefined ? input.at : later(input.at, current.checkedAt),
    });
    await db.adapterHealth.put(report);
    await noteStoredInstant(db, report.checkedAt);
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
  const clears = (current: AdapterHealth | undefined): boolean =>
    setByLedger(current) && instantMs(own.checkedAt) > instantMs(current.checkedAt);
  // Nearly every accepted message finds nothing to clear: a read decides that, with no readwrite transaction.
  if (!clears(await stored(db, own.adapterId))) return { cleared: false };
  return db.transaction('rw', [db.adapterHealth, db.meta], async (): Promise<{ cleared: boolean }> => {
    if (!clears(await stored(db, own.adapterId))) return { cleared: false };
    await db.adapterHealth.put(own);
    await noteStoredInstant(db, own.checkedAt);
    return { cleared: true };
  });
}
