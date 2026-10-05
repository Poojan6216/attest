/**
 * `health()` for the Calendar observer (sprint_2 2.5; agents/adapter_engineer.md rule 2): runs first, on every pass.
 * OK only when every landmark the extractor needs is there (the grid in `role="main"`, consecutive visible days,
 * the calendar list), the page's time-zone hint agrees with the offset function, and every event chip reads.
 * Otherwise DEGRADED with ./read.ts's reason codes (`selector.missing.grid`, `time_zone.mismatch`, …): codes,
 * never page text (Hard Rules 2, 6). Nothing is then extracted and no coverage is written (Hard Rule 5).
 *
 * A page still drawing its range (./page.ts `pageBusy`) is OK and is not read: the pass reports no rows, no
 * coverage and no snapshot (sprint_2 2.7), and the next pass reads the page once it is drawn. Drawing is not a
 * fault, so it is not DEGRADED while it lasts as long as drawing does. But a page that never stops looking busy (a
 * wrapper left `aria-busy`, a progress bar kept in the grid, after a Calendar change) would be OK with no coverage
 * forever: a silent zero (Hard Rule 6, SEC-10). So the passes that find the page busy are counted as a run, from the
 * first one's instant, and once a run has lasted BUSY_LIMIT_MS the next busy pass is DEGRADED `page.busy` until a
 * pass finds the page drawn. A pass more than BUSY_GAP_MS after the run's last one starts a new run (the tab was
 * hidden or quiet in between: nothing says the page stayed busy).
 */
import { OBSERVER_HEARTBEAT_MS } from '../../config';
import { MS_PER_MINUTE } from '../../core/units';
import type { HealthCheck } from '../types';
import type { PassRead } from './pass-read';

/** How long a run of busy passes may last before the next busy pass is DEGRADED `page.busy` (SEC-10). */
export const BUSY_LIMIT_MS = 5 * MS_PER_MINUTE;

/** A gap between two busy passes longer than this breaks their run: two heartbeats of a visible tab. */
export const BUSY_GAP_MS = 2 * OBSERVER_HEARTBEAT_MS;

/** A run of passes that found the page busy: the first one's instant and the last one's (epoch ms). */
export interface BusyRun {
  readonly sinceMs: number;
  readonly lastMs: number;
}

/** The run after a busy pass at `atMs` (a new run when there is none, or the gap since its last pass is too long). */
export function extendBusyRun(run: BusyRun | null, atMs: number): BusyRun {
  const kept = continuedRun(run, atMs);
  return kept === null ? { sinceMs: atMs, lastMs: atMs } : { sinceMs: kept.sinceMs, lastMs: atMs };
}

/**
 * `run` as a busy pass at `atMs` finds it: the same run, or null when a gap longer than BUSY_GAP_MS or a clock that
 * went back broke it (nothing says the page stayed busy in between).
 */
export function continuedRun(run: BusyRun | null, atMs: number): BusyRun | null {
  return run === null || atMs - run.lastMs > BUSY_GAP_MS || atMs < run.lastMs ? null : run;
}

/** Whether a run has lasted long enough that a busy page is DEGRADED `page.busy`. */
function busyOverdue(run: BusyRun | null): boolean {
  return run !== null && run.lastMs - run.sinceMs >= BUSY_LIMIT_MS;
}

/** The page's health from the pass's read, given the run of busy passes so far. */
export function healthOf(read: PassRead, run: BusyRun | null): HealthCheck {
  if (read.busy) return busyOverdue(run) ? { status: 'DEGRADED', reasons: ['page.busy'] } : { status: 'OK' };
  return read.page.ok ? { status: 'OK' } : { status: 'DEGRADED', reasons: read.page.reasons };
}
