/**
 * `extract()` for the Calendar observer (sprint_2 2.5, 2.7; Decisions [2.7]; Hard Rules 5, 7): pure over the page's
 * read (./pass-read.ts; agents/adapter_engineer.md rule 4). Each row is a RawRow whose fields are only the gcal.event
 * allowlist's (`occurredAt`, `subjectHint`, `counterparty`), already on one line; `redact.project()` keeps exactly
 * those (Hard Rule 2).
 *
 * Who derives the Calendar rows. A content script cannot read the ledger, so it never holds a range's previous
 * snapshot; the service worker does. So on a page whose account it names, a pass reports no rows of its own: it posts
 * its health, its coverage pings and its snapshot, and the service worker derives every row from the step between the
 * stored snapshot and this one (src/background/calendar-step.ts). Otherwise a first look in every tab would post each
 * event as a first sighting, and an event edited while no Calendar tab was open would come back as a
 * `calendar.created` of its new state: a creation nobody made. A page that names no account is compared with nothing:
 * its pass reports a first sighting of every event (./diff.ts with no previous snapshot), never a change, because
 * another account's calendar of the same week would otherwise read as every event deleted and created (Hard Rule 5).
 * A page whose account cannot be told ('') reports no rows either; its pass is DEGRADED `account.invalid`.
 *
 * Throws `GcalError('unreadable_page')` on a page `health()` would report DEGRADED (only reachable when the two were
 * given different offset functions): the skeleton reports `extract.threw`, with no rows and no coverage.
 */
import type { IsoTs } from '../../core/schema';
import type { RawRow } from '../types';
import { diffSnapshots } from './diff';
import { GcalError } from './errors';
import type { PassRead } from './pass-read';
import { snapshotOf } from './pass';
import type { PageFacts } from './read';

/** The page's facts; throws `GcalError('unreadable_page')` where `health()` would report DEGRADED. */
function factsOf(read: Extract<PassRead, { busy: false }>): PageFacts {
  if (!read.page.ok) throw new GcalError('unreadable_page');
  return read.page.facts;
}

/** The rows one pass reports from its read at `at` (see the module comment); none while the page is busy. */
export function calendarRows(read: PassRead, at: IsoTs): readonly RawRow[] {
  if (read.busy) return [];
  const facts = factsOf(read);
  if (facts.account !== null) return [];
  return diffSnapshots(null, snapshotOf(facts, at)).sightings;
}
