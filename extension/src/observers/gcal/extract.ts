/**
 * `extract()` for the Calendar observer (sprint_2 2.5): pure over the DOM and the previous snapshot it is handed
 * (agents/adapter_engineer.md rule 4). Reads the page once (./read.ts), builds this range's snapshot (./pass.ts),
 * and returns the rows the step from the previous snapshot implies plus the first sightings (./diff.ts), each a
 * RawRow whose fields are only the gcal.event allowlist's (`occurredAt`, `subjectHint`, `counterparty`), already on
 * one line; `redact.project()` keeps exactly those (Hard Rule 2).
 *
 * Throws `GcalError('unreadable_page')` on a page `health()` would report DEGRADED (only reachable when the two
 * were given different offset functions): the skeleton reports `extract.threw`, with no rows and no coverage.
 */
import type { OffsetAt } from '../../core/normalize';
import type { Sha256 } from '../../core/schema';
import { accountHashOf } from '../account';
import type { ExtractContext, RawRow } from '../types';
import { type CalendarDiff, diffSnapshots, passRows } from './diff';
import { GcalError } from './errors';
import { accountOf } from './page';
import { previousSnapshot, rangeOf, snapshotOf } from './pass';
import { type PageFacts, readCalendar } from './read';
import type { CalendarSnapshot } from './snapshot';

/** The page's facts; throws `GcalError('unreadable_page')` where `health()` would report DEGRADED. */
export function pageFacts(doc: Document, offsetAt: OffsetAt): PageFacts {
  const read = readCalendar(doc, offsetAt);
  if (!read.ok) throw new GcalError('unreadable_page');
  return read.facts;
}

/**
 * Where the previous snapshot of a range comes from: the stored one for this range and this page's account (its
 * hash), or null when there is none (sprint_2 2.7 stores them). Never asked for a page that shows no account.
 */
export type PreviousSnapshot = (range: string, accountHash: Sha256) => unknown;

/** One pass over the page: this range's snapshot (continuing the stored one) and its diff against it. */
export interface CalendarPass {
  readonly snapshot: CalendarSnapshot;
  readonly diff: CalendarDiff;
}

/**
 * Reads the page and diffs it against the stored snapshot of its range. A page whose account cannot be read is
 * compared with nothing (every event a first sighting, never a change): another account's calendar of the same
 * week would otherwise read as every event deleted and created (Hard Rule 5).
 */
export function calendarPass(doc: Document, ctx: ExtractContext, previous: PreviousSnapshot): CalendarPass {
  const facts = pageFacts(doc, ctx.offsetAt);
  const account = accountOf(doc);
  const accountHash = account === null ? null : accountHashOf(account);
  const stored = accountHash === null ? null : previousSnapshot(previous(rangeOf(facts), accountHash));
  const snapshot = snapshotOf(facts, ctx.observedAt, stored);
  return { snapshot, diff: diffSnapshots(stored, snapshot) };
}

/** The pass's rows: changes against the previous snapshot of this range, then first sightings. */
export function extractRows(
  doc: Document,
  ctx: ExtractContext,
  previous: PreviousSnapshot,
): readonly RawRow[] {
  return passRows(calendarPass(doc, ctx, previous).diff);
}
