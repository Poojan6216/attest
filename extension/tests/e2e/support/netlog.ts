/**
 * Chrome NetLog parsing for the @mandatory network-intercept test (Hard Rule 1).
 *
 * NetLog is written by Chromium's network stack itself, from process start, for every context
 * (service worker, extension pages, content scripts, the browser process). It is the ground truth
 * for "did anything leave the browser". Each URL request records its initiator:
 *   - `chrome-extension://<id>`  → the extension (service worker, popup, options, offscreen, …)
 *   - a web origin               → a page (where content scripts run) or that page's own subresources
 *   - `not an origin`            → the browser process itself (component updater, sign-in, GCM, …)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface NetLogRequest {
  readonly url: string;
  readonly method: string;
  /** The request initiator as NetLog records it; `not an origin` for browser-internal requests. */
  readonly initiator: string;
}

interface NetLogDocument {
  readonly constants: { readonly logEventTypes: Readonly<Record<string, number>> };
  readonly events: readonly {
    readonly type: number;
    readonly params?: Readonly<Record<string, unknown>>;
  }[];
}

const BROWSER_INITIATOR = 'not an origin';

/**
 * Parses a NetLog JSON file. Chromium writes a complete document on clean shutdown; if the process
 * died mid-write the events array is unterminated, so a truncated tail is repaired rather than
 * silently treated as "no requests" (an unparseable log throws: the test must fail, not pass).
 */
export function parseNetLog(text: string): NetLogDocument {
  const trimmed = text.trimEnd();
  try {
    return JSON.parse(trimmed) as NetLogDocument;
  } catch {
    const lastEvent = trimmed.lastIndexOf('}');
    if (lastEvent === -1) throw new Error('NetLog is empty or unreadable');
    return JSON.parse(`${trimmed.slice(0, lastEvent + 1)}]}`) as NetLogDocument;
  }
}

/** Every URL request the network stack started, with its initiator. */
export function urlRequests(doc: NetLogDocument): NetLogRequest[] {
  const startJob = doc.constants.logEventTypes.URL_REQUEST_START_JOB;
  if (startJob === undefined) throw new Error('NetLog constants lack URL_REQUEST_START_JOB');
  const requests: NetLogRequest[] = [];
  for (const event of doc.events) {
    if (event.type !== startJob || event.params === undefined) continue;
    const { url, method, initiator } = event.params;
    if (typeof url !== 'string') continue;
    requests.push({
      url,
      method: typeof method === 'string' ? method : 'GET',
      initiator: typeof initiator === 'string' ? initiator : BROWSER_INITIATOR,
    });
  }
  return requests;
}

export function isBrowserInitiated(request: NetLogRequest): boolean {
  return request.initiator === BROWSER_INITIATOR;
}

const NETLOG_FILE = /^netlog-\d+\.json$/;

/**
 * The NetLog file for one browser launch attempt in `dir`. The launcher may replace a start-up that hung
 * (tests/e2e/support/extension.ts), so each attempt logs to its own file and none is overwritten.
 */
export function netLogPathFor(dir: string, attempt: number): string {
  return path.join(dir, `netlog-${String(attempt)}.json`);
}

/**
 * Every URL request in every attempt's NetLog in `dir`. Fails closed: no NetLog at all, or one that cannot
 * be read, throws, so a hung start's requests can never go unexamined.
 */
export function readNetLogRequests(dir: string): NetLogRequest[] {
  const files = readdirSync(dir)
    .filter((file) => NETLOG_FILE.test(file))
    .sort();
  if (files.length === 0) throw new Error(`no NetLog was written in ${dir}`);
  return files.flatMap((file) => urlRequests(parseNetLog(readFileSync(path.join(dir, file), 'utf8'))));
}
