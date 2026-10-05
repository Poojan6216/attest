/**
 * What a clean pass may assert as seen, read from the page (sprint_2 2.0, 2.7; docs/grading.md §3 "Observer
 * obligations", §6.1; Hard Rules 5, 6). ./plan.ts calls `readCoverage` after `project()`, in the same synchronous
 * read of the page as the rows, so the windows, the account and the snapshot describe the page the rows came from.
 *
 *  - Windows: the observer's `visibleWindows()` (each checked as one window is), or its one `visibleWindow()`. Each
 *    is two ISO instants with an offset, the start not after the end, and, except for a source that sees ahead
 *    (`gcal.event`), the end not after the pass instant (`window.future`). Identical windows are asserted once.
 *    An empty list asserts no coverage by design; null is `window.unknown`.
 *  - `allCalendars` (`gcal.event` only): read once when the pass has a window, sent on each of its pings.
 *  - The snapshot (`gcal.event` only): read on every clean pass; kept only when the account is known.
 *  - The account: read only when there is a window or a snapshot to post; only its hash is kept (./account.ts).
 * Any failure is one reason code: the pass is then DEGRADED and asserts nothing (no ping, no snapshot).
 */
import { instantMs } from '../core/normalize';
import { IsoTs, type ObservationSource, type Sha256 } from '../core/schema';
import { accountHashOf } from './account';
import type { PassInput, PassReason } from './plan';
import type { VisibleWindow } from './types';

/** One coverage ping's facts (the skeleton adds the observer, its source, the sync instant and activity). */
export interface CoverageFacts {
  readonly windowStart: IsoTs;
  readonly windowEnd: IsoTs;
  readonly accountHash?: Sha256;
  /** `gcal.event` only: every listed calendar was shown (docs/grading.md §3, §6.1). */
  readonly allCalendars?: boolean;
}

/** What a clean pass asserts: its pings (none by design when empty) and, with a known account, its snapshot. */
export interface PassCoverage {
  readonly coverage: readonly CoverageFacts[];
  /** Present only when the observer gave one and the account is known (sprint_2 2.7 interface 5). */
  readonly snapshot?: unknown;
}

export type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: PassReason };

export const ok = <T>(value: T): Step<T> => ({ ok: true, value });
export const fail = <T>(reason: PassReason): Step<T> => ({ ok: false, reason });

/**
 * The sources whose visible window may end after the pass instant: a calendar shows days to come. Every other
 * source is a list of what already happened, so its window ends at the pass instant at the latest (§3).
 */
const SEES_AHEAD: ReadonlySet<ObservationSource> = new Set<ObservationSource>(['gcal.event']);

interface Span {
  readonly windowStart: IsoTs;
  readonly windowEnd: IsoTs;
}

/** One window as the contract allows it, or why it is not one. */
function checkWindow(input: PassInput, span: unknown): Step<Span> {
  if (typeof span !== 'object' || span === null) return fail('window.invalid');
  const { windowStart, windowEnd } = span as Partial<Record<keyof VisibleWindow, unknown>>;
  const start = IsoTs.safeParse(windowStart);
  const end = IsoTs.safeParse(windowEnd);
  if (!start.success || !end.success) return fail('window.invalid');
  if (instantMs(end.data) < instantMs(start.data)) return fail('window.invalid');
  const ahead = instantMs(end.data) > instantMs(input.ctx.observedAt);
  if (ahead && !SEES_AHEAD.has(input.observer.source)) return fail('window.future');
  return ok({ windowStart: start.data, windowEnd: end.data });
}

/** What the observer's window reader answered: a list, null, or a throw. */
function askWindows(input: PassInput): Step<unknown> {
  const { observer, doc, ctx } = input;
  try {
    if (observer.visibleWindows !== undefined) return ok(observer.visibleWindows(doc, ctx));
    if (observer.visibleWindow === undefined) return fail('window.unknown');
    const span = observer.visibleWindow(doc, ctx);
    return ok(span === null ? null : [span]);
  } catch {
    return fail('window.threw');
  }
}

/** Every window this pass saw, checked, each once; [] when it asserts none by design. */
function readWindows(input: PassInput): Step<Span[]> {
  const asked = askWindows(input);
  if (!asked.ok) return asked;
  if (asked.value === null) return fail('window.unknown');
  if (!Array.isArray(asked.value)) return fail('window.invalid');
  const spans: Span[] = [];
  const seen = new Set<string>();
  for (const candidate of asked.value as readonly unknown[]) {
    const span = checkWindow(input, candidate);
    if (!span.ok) return span;
    const key = `${span.value.windowStart}/${span.value.windowEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spans.push(span.value);
  }
  return ok(spans);
}

/** The account's hash, undefined when the page shows none. */
function readAccount(input: PassInput): Step<Sha256 | undefined> {
  let raw: unknown;
  try {
    raw = input.observer.account(input.doc);
  } catch {
    return fail('account.threw');
  }
  if (raw === null) return ok(undefined);
  const hash = typeof raw === 'string' ? accountHashOf(raw) : null;
  return hash === null ? fail('account.invalid') : ok(hash);
}

/** `allCalendars` for a `gcal.event` pass with a window; undefined for any other (the observer gives none). */
function readAllCalendars(input: PassInput): Step<boolean | undefined> {
  const read = input.observer.allCalendars;
  if (read === undefined || input.observer.source !== 'gcal.event') return ok(undefined);
  let all: unknown;
  try {
    all = read(input.doc);
  } catch {
    return fail('calendars.threw');
  }
  if (all === null) return fail('calendars.unknown');
  return typeof all === 'boolean' ? ok(all) : fail('calendars.invalid');
}

/** The pass's snapshot, null when the observer gives none (or none for this page). */
function readSnapshot(input: PassInput): Step<unknown> {
  const read = input.observer.snapshot;
  if (read === undefined || input.observer.source !== 'gcal.event') return ok(null);
  try {
    return ok(read(input.doc, input.ctx) ?? null);
  } catch {
    return fail('snapshot.threw');
  }
}

/** The coverage facts of one window. */
function factsOf(span: Span, accountHash: Sha256 | undefined, all: boolean | undefined): CoverageFacts {
  return {
    ...span,
    ...(accountHash === undefined ? {} : { accountHash }),
    ...(all === undefined ? {} : { allCalendars: all }),
  };
}

/** What a clean pass asserts (see the module comment), or the one reason it may assert nothing. */
export function readCoverage(input: PassInput): Step<PassCoverage> {
  const spans = readWindows(input);
  if (!spans.ok) return spans;
  const all = spans.value.length === 0 ? ok(undefined) : readAllCalendars(input);
  if (!all.ok) return all;
  const snapshot = readSnapshot(input);
  if (!snapshot.ok) return snapshot;
  if (spans.value.length === 0 && snapshot.value === null) return ok({ coverage: [] });
  const account = readAccount(input);
  if (!account.ok) return account;
  const coverage = spans.value.map((span) => factsOf(span, account.value, all.value));
  const known = account.value !== undefined && snapshot.value !== null;
  return ok(known ? { coverage, snapshot: snapshot.value } : { coverage });
}
