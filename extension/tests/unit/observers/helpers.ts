/**
 * Shared pieces for the observer skeleton tests (sprint_2 2.0): a synthetic Sent-list page and an observer that
 * reads it. Synthetic structure, written by hand: not a capture of any vendor page (fixtures first; the real
 * Gmail and Calendar observers are written against captured fixtures in 2.2 and 2.5).
 */
import seededJson from '../../fixtures/secrets/seeded.json';
import type { BusMessage } from '../../../src/bus/messages';
import { OBSERVER_HOSTS } from '../../../src/config';
import { instantMs } from '../../../src/core/normalize';
import type { Observer, RawRow, VisibleWindow } from '../../../src/observers/base';
import { oneLine } from '../../../src/observers/text';

export const SEEDS: readonly string[] = seededJson.seeds.map((seed) => seed.value);

/** The pass instant tests use: ISO 8601 with an offset, as src/clock.ts writes it. */
export const NOW = '2026-10-01T14:30:00.000-04:00';
export const ACCOUNT = 'Priya Raman <Priya.Raman@Example.com>';

export interface SyntheticRow {
  readonly to?: string;
  readonly subject?: string;
  readonly at?: string;
  readonly key?: string;
}

export const ROWS: readonly SyntheticRow[] = [
  { to: 'alex@example.com', subject: 'Q3   deck\n  and plan', at: '2026-10-01T14:02:00-04:00', key: 'r1' },
  { to: 'sam@example.org', subject: 'Re: invoice', at: '2026-10-01T13:10:00-04:00', key: 'r2' },
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rowHtml(row: SyntheticRow): string {
  const key = row.key === undefined ? '' : ` data-row-key="${escapeHtml(row.key)}"`;
  const to = row.to === undefined ? '' : `<span email="${escapeHtml(row.to)}">${escapeHtml(row.to)}</span>`;
  const at =
    row.at === undefined ? '' : `<time datetime="${escapeHtml(row.at)}">${escapeHtml(row.at)}</time>`;
  return `<div role="row"${key}>${to}<span data-subject>${escapeHtml(row.subject ?? '')}</span>${at}<span data-body>${escapeHtml(SEEDS.join(' '))}</span></div>`;
}

export interface PageOptions {
  readonly folder?: string;
  readonly rows?: readonly SyntheticRow[];
  readonly account?: string | null;
}

/** The synthetic page's HTML: an account switcher, a main landmark with a folder, and one role=row per row. */
export function pageHtml(options: PageOptions = {}): string {
  const account = options.account === undefined ? ACCOUNT : options.account;
  const header = account === null ? '' : `<header><a data-account="${escapeHtml(account)}">me</a></header>`;
  const rows = (options.rows ?? ROWS).map(rowHtml).join('');
  return `<!doctype html><html><body>${header}<main role="main" data-folder="${options.folder ?? 'sent'}"><div role="grid">${rows}</div></main></body></html>`;
}

export function syntheticDocument(options: PageOptions = {}): Document {
  return new DOMParser().parseFromString(pageHtml(options), 'text/html');
}

function rowsOf(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('[role="main"] [role="row"]'));
}

/** Reads one row the way a real extractor does: attributes and structure, names and subjects on one line. */
function readRow(row: Element): RawRow {
  return {
    type: 'email.sent',
    rowKey: row.getAttribute('data-row-key') ?? undefined,
    fields: {
      counterparty: row.querySelector('[email]')?.getAttribute('email') ?? undefined,
      subjectHint: oneLine(row.querySelector('[data-subject]')?.textContent ?? ''),
      occurredAt: row.querySelector('time')?.getAttribute('datetime') ?? undefined,
      // Not allowlisted for gmail.sent: project() must drop it (Hard Rule 2).
      body: row.querySelector('[data-body]')?.textContent ?? '',
    },
  };
}

/** Oldest visible row to the pass instant: a newest-first list whose head the pass saw (docs/grading.md §3). */
function sentWindow(doc: Document, observedAt: string): VisibleWindow | null {
  const times = rowsOf(doc)
    .map((row) => row.querySelector('time')?.getAttribute('datetime'))
    .filter((at): at is string => typeof at === 'string');
  if (times.length === 0) return null;
  const oldest = times.reduce((a, b) => (instantMs(a) <= instantMs(b) ? a : b));
  return { windowStart: oldest, windowEnd: observedAt };
}

/** A synthetic observer of the synthetic Sent list. `overrides` replaces any member. */
export function sentObserver(overrides: Partial<Observer> = {}): Observer {
  return {
    id: 'synthetic.sent',
    vendor: 'synthetic',
    version: '1.0.0',
    hosts: OBSERVER_HOSTS.gmail,
    source: 'gmail.sent',
    health: (doc) =>
      doc.querySelector('[role="main"][data-folder="sent"]') === null
        ? { status: 'DEGRADED', reasons: ['not_sent_folder'] }
        : { status: 'OK' },
    extract: (doc) => rowsOf(doc).map(readRow),
    account: (doc) => doc.querySelector('[data-account]')?.getAttribute('data-account') ?? null,
    visibleWindow: (doc, ctx) => sentWindow(doc, ctx.observedAt),
    ...overrides,
  };
}

/** A `post` that records every message (JSON round-tripped, as Chrome's messaging does) and answers at once. */
export function recordingPost(): { post: (message: BusMessage) => Promise<unknown>; messages: BusMessage[] } {
  const messages: BusMessage[] = [];
  return {
    messages,
    post: (message) => {
      messages.push(JSON.parse(JSON.stringify(message)) as BusMessage);
      return Promise.resolve(undefined);
    },
  };
}

/** Every seeded secret, and the raw account address, that appears anywhere in `messages`. */
export function leaks(messages: readonly BusMessage[]): string[] {
  const text = JSON.stringify(messages).toLowerCase();
  return [...SEEDS, 'priya.raman@example.com', 'Priya Raman'].filter((secret) =>
    text.includes(secret.toLowerCase()),
  );
}
