/**
 * `health()` for the Calendar observer (sprint_2 2.5; agents/adapter_engineer.md rule 2): runs first, on every pass.
 * OK only when every landmark the extractor needs is there (the grid in `role="main"`, consecutive visible days,
 * the calendar list), the page's time-zone hint agrees with the offset function, and every event chip reads.
 * Otherwise DEGRADED with ./read.ts's reason codes (`selector.missing.grid`, `time_zone.mismatch`, …): codes,
 * never page text (Hard Rules 2, 6). Nothing is then extracted and no coverage is written (Hard Rule 5).
 *
 * A page still drawing its range (./page.ts `pageBusy`) is OK and is not read: the pass reports no rows, no
 * coverage and no snapshot (sprint_2 2.7), and the next pass reads the page once it is drawn.
 */
import type { OffsetAt } from '../../core/normalize';
import type { HealthCheck } from '../types';
import { pageBusy } from './page';
import { readCalendar } from './read';

/** The page's health, read with `offsetAt` (the browser's UTC offset function). */
export function gcalHealth(doc: Document, offsetAt: OffsetAt): HealthCheck {
  if (pageBusy(doc)) return { status: 'OK' };
  const read = readCalendar(doc, offsetAt);
  return read.ok ? { status: 'OK' } : { status: 'DEGRADED', reasons: read.reasons };
}
