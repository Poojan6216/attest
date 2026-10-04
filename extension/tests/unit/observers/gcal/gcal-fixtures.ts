/**
 * The Calendar observer's fixtures (tests/fixtures/pages/gcal/<date>/, labelled per tests/fixtures/pages/README.md),
 * shared by its tests and by bench/observers/gcal.ts. Not observer code.
 *
 * Each page is parsed with happy-dom in Node. A pass reads it as of the page fact's `readAt` (its `observedAt`) in
 * the page fact's IANA zone (the offset function, from Intl), so results do not depend on the machine's zone.
 *
 * Labels name a Calendar event by `data-eventid` as written; the observer's rows carry the SHA-256 of it as their
 * row key (src/observers/gcal/snapshot.ts: the vendor id embeds the calendar owner's address and is never stored).
 * `expectedObservation` projects a labelled fact the same way, so a row and its label compare by contentHash.
 */
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { hashRowKey, project } from '../../../../src/core/redact';
import { IsoTs, type Observation } from '../../../../src/core/schema';
import { createGcalObserver, type GcalObserver } from '../../../../src/observers/gcal/observer';
import type { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import type { ExtractContext } from '../../../../src/observers/types';
import {
  type LabelledFixture,
  loadVendor,
  type ObservationFact,
  projectArgs,
} from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';

/** Every labelled Calendar fixture, across date folders. */
export const GCAL_FIXTURES: readonly LabelledFixture[] = loadVendor('gcal');

const happyWindow = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    handleDisabledFileLoadingAsSuccess: true,
  },
});

function isDocument(value: unknown): value is Document {
  return (
    typeof value === 'object' && value !== null && 'querySelectorAll' in value && 'documentElement' in value
  );
}

/** `html` parsed as a page (no script runs). */
export function parseDocument(html: string): Document {
  const parsed: unknown = new happyWindow.DOMParser().parseFromString(html, 'text/html');
  if (!isDocument(parsed)) throw new Error('happy-dom returned no document');
  return parsed;
}

const html = new Map<string, string>();

/** The fixture's HTML (read once). */
export function htmlOf(fixture: LabelledFixture): string {
  const cached = html.get(fixture.htmlPath);
  if (cached !== undefined) return cached;
  const text = readFileSync(fixture.htmlPath, 'utf8');
  html.set(fixture.htmlPath, text);
  return text;
}

/** A fresh document of the fixture. */
export function docOf(fixture: LabelledFixture): Document {
  return parseDocument(htmlOf(fixture));
}

/** The labelled fixture named `file` (in the first date folder that has it). */
export function fixture(file: string): LabelledFixture {
  const found = GCAL_FIXTURES.find((f) => f.file === file);
  if (found === undefined) throw new Error(`no gcal fixture ${file}`);
  return found;
}

/** The pass context of a fixture: read at its `readAt`, in its zone. */
export function ctxOf(f: LabelledFixture): ExtractContext {
  return { observedAt: IsoTs.parse(f.page.readAt), offsetAt: zoneOffset(f.page.timeZone) };
}

/** The observer as a content script builds it for this fixture, with `previous` as the stored snapshot. */
export function observerFor(f: LabelledFixture, previous: CalendarSnapshot | null = null): GcalObserver {
  return createGcalObserver({ offsetAt: zoneOffset(f.page.timeZone), previous: () => previous });
}

/** The snapshot a clean pass over `f` stores. */
export function snapshotOfFixture(f: LabelledFixture): CalendarSnapshot {
  const snapshot = observerFor(f).snapshot(docOf(f), ctxOf(f));
  if (snapshot === null) throw new Error(`${f.file}: no snapshot`);
  return snapshot;
}

/** A labelled observation as `project()` stores it from the observer's row (row key: SHA-256 of the event id). */
export function expectedObservation(fact: ObservationFact, readAt: string): Observation {
  const { source, raw, ctx } = projectArgs(fact, readAt);
  const rowKey = ctx.rowKey === undefined ? undefined : hashRowKey(ctx.rowKey);
  return project(source, raw, { type: ctx.type, observedAt: ctx.observedAt, rowKey }, DEFAULT_POLICY);
}

/** The observations `project()` makes of rows an observer returned for a pass at `readAt`. */
export function projectRows(
  rows: readonly { type: Observation['type']; rowKey?: string | undefined; fields: object }[],
  readAt: string,
): Observation[] {
  return rows.map((row) =>
    project(
      'gcal.event',
      row.fields,
      { type: row.type, observedAt: readAt, rowKey: row.rowKey },
      DEFAULT_POLICY,
    ),
  );
}
