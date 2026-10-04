/**
 * TEST ONLY (sprint_2 2.0 Done-when): the observer skeleton running on a synthetic fixture page, so
 * tests/e2e/observer-skeleton.spec.ts can time its first coverage.ping in a real Chromium.
 *
 * Never shipped and never given a host: WXT builds only entrypoints/, this file lives under tests/, and the spec
 * bundles it itself and injects it into the fixture page (main world) next to a recording stand-in for
 * `browser.runtime`, so the real src/bus `send()` validates every message. tests/e2e/built-bundle.spec.ts checks no
 * shipped file holds OBSERVER_HARNESS_MARKER and the manifest grants no other host.
 *
 * It reads the synthetic pages tests/fixtures/pages/_harness/synthetic-observer*.html (hand-written structure, not
 * a capture of any vendor page) the way a real extractor reads one: roles, data attributes and structure only.
 */
import '../../../src/setup';
import { OBSERVER_HOSTS } from '../../../src/config';
import { instantMs } from '../../../src/core/normalize';
import { type Observer, type RawRow, startObserver, type VisibleWindow } from '../../../src/observers/base';
import { oneLine } from '../../../src/observers/text';
import { OBSERVER_HARNESS_MARKER } from './observer-harness-marker';

function rowsOf(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('[role="main"] [role="grid"] [role="row"]'));
}

function readRow(row: Element): RawRow {
  return {
    type: 'email.sent',
    rowKey: row.getAttribute('data-row-key') ?? undefined,
    fields: {
      counterparty: row.querySelector('[email]')?.getAttribute('email') ?? undefined,
      subjectHint: oneLine(row.querySelector('[data-subject]')?.textContent ?? ''),
      occurredAt: row.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined,
      snippet: row.querySelector('[data-snippet]')?.textContent ?? undefined,
    },
  };
}

function visibleWindow(doc: Document, observedAt: string): VisibleWindow | null {
  const times = rowsOf(doc).flatMap((row) => {
    const at = row.querySelector('time[datetime]')?.getAttribute('datetime');
    return at === null || at === undefined ? [] : [at];
  });
  if (times.length === 0) return null;
  const oldest = times.reduce((a, b) => (instantMs(a) <= instantMs(b) ? a : b));
  return { windowStart: oldest, windowEnd: observedAt };
}

export const harnessObserver: Observer = {
  id: 'harness.sent',
  vendor: OBSERVER_HARNESS_MARKER,
  version: '0.0.1',
  hosts: OBSERVER_HOSTS.gmail,
  source: 'gmail.sent',
  health: (doc) =>
    doc.querySelector('[role="main"][data-folder="sent"] [role="grid"]') === null
      ? { status: 'DEGRADED', reasons: ['not_sent_folder'] }
      : { status: 'OK' },
  extract: (doc) => rowsOf(doc).map(readRow),
  account: (doc) => doc.querySelector('[data-account-email]')?.getAttribute('data-account-email') ?? null,
  visibleWindow: (doc, ctx) => visibleWindow(doc, ctx.observedAt),
};

/** As a content script at document_idle: start once the DOM is parsed. */
function boot(): void {
  startObserver(harnessObserver);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
