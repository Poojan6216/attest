/**
 * Network guard for the @mandatory network-intercept test (Hard Rule 1: nothing leaves the browser).
 *
 * Three layers, so that a broken recorder can never make the test pass:
 *  1. NetLog (Chromium's network stack, from process start): every request initiated by the extension
 *     or by a page the test opened (where content scripts run) must target an allowlisted host.
 *  2. Requests the browser process makes on its own (`not an origin`) must go to a known Chromium
 *     host; an unknown host fails the test (fail closed in case an extension request is misattributed).
 *  3. Playwright routing records and aborts every page-level request that is not to the fixture server
 *     or a routed fixture, and a dead proxy makes sure nothing actually leaves the machine even when
 *     the test is failing.
 * The negative-control test in network-intercept.spec.ts proves layers 1 and 3 detect a canary fetch
 * from the service worker, an extension page, and a fixture page on every run.
 */
import type { BrowserContext, Request } from '@playwright/test';

import { isBrowserInitiated, type NetLogRequest } from './netlog';

/**
 * Hosts Chromium contacts by itself in a Playwright-launched profile even with
 * --disable-background-networking (observed with Chromium 153, 2026-10-01: sign-in, GCM check-in,
 * component updater, network time). Requests to these hosts count only when the extension or a page
 * initiated them. Add a host here only with NetLog evidence that the browser process made the request.
 */
export const CHROMIUM_BACKGROUND_HOSTS: ReadonlySet<string> = new Set([
  'accounts.google.com',
  'android.clients.google.com',
  'clients1.google.com',
  'clients2.google.com',
  'clientservices.googleapis.com',
  'content-autofill.googleapis.com',
  'edgedl.me.gvt1.com',
  'mtalk.google.com',
  'optimizationguide-pa.googleapis.com',
  'redirector.gvt1.com',
  'safebrowsingohttpgateway.googleapis.com',
  'update.googleapis.com',
  'www.google.com',
  'www.gstatic.com',
]);

/** Schemes that never reach the network. */
const LOCAL_SCHEMES = new Set([
  'chrome-extension:',
  'data:',
  'blob:',
  'about:',
  'chrome:',
  'devtools:',
  'chrome-untrusted:',
]);

/** A dead proxy: if anything does try to leave, it fails to connect. Loopback bypasses proxies. */
const DEAD_PROXY = 'http://127.0.0.1:9';

export interface RouteRecord {
  readonly url: string;
  /** URL of the frame or worker that made the request, when Playwright knows it. */
  readonly from: string;
  /** Request body, if any (searched by the no-leak test). */
  readonly body: string;
  /** Every request header, as JSON (searched by the no-leak test: a key travels in a header; Sprint 5 close, SEC-3). */
  readonly headers: string;
}

export interface AttributedRequest {
  readonly url: string;
  readonly host: string;
  readonly initiator: string;
  readonly via: 'netlog' | 'route';
}

export interface NetworkReport {
  /** Requests made by the extension or a page, outside the fixture server: these must be allowlisted. */
  readonly attributed: readonly AttributedRequest[];
  /** Hosts of attributed requests that are not on the allowlist. Must be empty. */
  readonly violations: readonly string[];
  /** Browser-initiated hosts that are not known Chromium background hosts. Must be empty. */
  readonly unknownBrowserHosts: readonly string[];
  /** Browser-initiated hosts that were ignored, for the test log. */
  readonly browserInternalHosts: readonly string[];
}

export interface AnalyseOptions {
  readonly fixtureOrigin: string;
  readonly allowlist: readonly string[];
  /** Exact URLs the test fulfilled from fixtures via routing (vendor pages served locally). */
  readonly routedFixtureUrls?: ReadonlySet<string>;
}

/** The Chromium switch that sends every request leaving the machine to the dead proxy. */
export const DEAD_PROXY_ARG = `--proxy-server=${DEAD_PROXY}`;

/** Chromium switches that turn on NetLog capture and the dead proxy. */
export function guardArgs(netLogPath: string): string[] {
  return [`--log-net-log=${netLogPath}`, '--net-log-capture-mode=Default', DEAD_PROXY_ARG];
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The address a request asks the server for: a URL without its fragment, which never leaves the browser. NetLog keeps
 * the fragment on a navigation (a tab the extension opens at `…/mail/u/0/#sent`, sprint_4 4.9), and a route matches
 * the request without it; both sides are compared without it (sprint_4 close), so no other address is exempted.
 */
function requestTarget(url: URL): string {
  const target = new URL(url.href);
  target.hash = '';
  return target.href;
}

function isExempt(url: URL, options: AnalyseOptions, routedTargets: ReadonlySet<string>): boolean {
  return (
    LOCAL_SCHEMES.has(url.protocol) ||
    url.origin === options.fixtureOrigin ||
    routedTargets.has(requestTarget(url))
  );
}

/** The frame or worker URL that made a request; `frame()` throws for service-worker requests. */
function requestSource(request: Request): string {
  try {
    return request.frame().url();
  } catch {
    return request.serviceWorker()?.url() ?? 'unknown';
  }
}

/**
 * Records and aborts every page-level request that is not local, not the fixture server, and not a
 * routed fixture. Returns the live list of records.
 */
export async function installRouteGuard(
  context: BrowserContext,
  options: { fixtureOrigin: string; routedFixtures?: ReadonlyMap<string, string> },
): Promise<RouteRecord[]> {
  const records: RouteRecord[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = parse(request.url());
    const routed = options.routedFixtures?.get(request.url());
    if (routed !== undefined) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: routed });
      return;
    }
    if (url !== null && (LOCAL_SCHEMES.has(url.protocol) || url.origin === options.fixtureOrigin)) {
      await route.continue();
      return;
    }
    records.push({
      url: request.url(),
      from: requestSource(request),
      body: request.postData() ?? '',
      headers: JSON.stringify(await request.allHeaders()),
    });
    await route.abort('blockedbyclient');
  });
  return records;
}

/** Turns NetLog requests and route records into the verdict the test asserts on. */
export function analyse(
  netLog: readonly NetLogRequest[],
  routeRecords: readonly RouteRecord[],
  options: AnalyseOptions,
): NetworkReport {
  const attributed: AttributedRequest[] = [];
  const unknownBrowserHosts = new Set<string>();
  const browserInternalHosts = new Set<string>();
  const routedTargets = new Set(
    [...(options.routedFixtureUrls ?? [])].flatMap((routed) => {
      const url = parse(routed);
      return url === null ? [] : [requestTarget(url)];
    }),
  );

  for (const request of netLog) {
    const url = parse(request.url);
    if (url === null || isExempt(url, options, routedTargets)) continue;
    if (isBrowserInitiated(request)) {
      if (CHROMIUM_BACKGROUND_HOSTS.has(url.hostname)) browserInternalHosts.add(url.hostname);
      else unknownBrowserHosts.add(url.hostname);
      continue;
    }
    attributed.push({ url: request.url, host: url.hostname, initiator: request.initiator, via: 'netlog' });
  }
  for (const record of routeRecords) {
    const url = parse(record.url);
    if (url !== null && isExempt(url, options, routedTargets)) continue;
    attributed.push({
      url: record.url,
      host: url?.hostname ?? record.url,
      initiator: record.from,
      via: 'route',
    });
  }

  const allowed = new Set(options.allowlist);
  const violations = [...new Set(attributed.map((r) => r.host).filter((host) => !allowed.has(host)))].sort();
  return {
    attributed,
    violations,
    unknownBrowserHosts: [...unknownBrowserHosts].sort(),
    browserInternalHosts: [...browserInternalHosts].sort(),
  };
}
