/**
 * Audits the build that ships (pnpm e2e rebuilds it first), not the source:
 *  - the manifest says exactly what Decisions.md says (permissions, exactly the two observer host permissions of
 *    sprint_2 2.0 and no agent host while its reader is off, Decisions [3.10], strict CSP, the toolbar tooltip from
 *    the popup's <title>: TECH-14);
 *  - no test code ships: no file holds the observer harness marker (tests/e2e/support/observer-harness.ts), and no
 *    host, content-script match or web-accessible resource reaches the fixture server (sprint_2 2.0);
 *  - the content scripts are exactly the Gmail and Calendar ones, each matching exactly its own host, and no
 *    other (sprint_2 2.7: the E2E tests route fixtures to these hosts; there is no test build), and every shipped
 *    script is ASCII (Chrome refuses an extension whose content script holds a Unicode noncharacter);
 *  - no shipped script contains a network call, eval, or a Function constructor (SECURITY-6, Hard Rules 1
 *    and 9), apart from the allowlisted sites below;
 *  - the extension never runs in incognito tabs (Decisions [2.close] S3, SEC-9);
 *  - each content script stays within its size budget, and no shipped script carries zod's JSON Schema code
 *    (TECH-17: wxt.config.ts `zodWithoutJsonSchema`);
 *  - the popup's start load stays within its budget (sprint_4 close, tech review TECH-5);
 *  - the Gmail and Calendar content scripts hold no address the extension could send to, nor an agent's site: no model
 *    vendor's host or endpoint, no telemetry host, no agent host (Sprint 7 close, privacy review gap 15), so a person
 *    reading the code that reads their mail finds no other company's API in it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

import { AGENT_HOSTS } from '../../src/config-agents';
import { BYO_VENDORS, TELEMETRY_HOST } from '../../src/config-network';
import { EXTENSION_PATH } from './support/extension';
import { OBSERVER_HARNESS_MARKER, SENT_PASS_HARNESS_MARKER } from './support/observer-harness-marker';

/**
 * The only matches allowed, each a whole, exact construct, removed before the scan, and each held to where it may be:
 *  - Zod 4's eval probe, skipped when `jitless` is set (src/setup.ts sets it before any schema is built), in every
 *    chunk that bundles Zod;
 *  - the person's own model key's one call (src/intel/providers/byo.ts `post`; sprint_5 5.4, Decisions [5.4]): a fetch
 *    of a vendor's `endpoint` in BYO_VENDORS, nowhere else, once, in the service worker alone;
 *  - the opt-in telemetry's one call (src/telemetry/send.ts `post`; sprint_5 5.7, Decisions [5.7]): a POST of a body
 *    with exactly its options, once, in the service worker alone.
 */
const ZOD_PROBE =
  /if\([\w$]+\.jitless\|\|[^;]{0,120}Cloudflare`\)\)return!1;try\{return Function\(``\),!0\}catch\{return!1\}/g;
const BYO_CALL = /\breturn fetch\([\w$]+\[[\w$]+\]\.endpoint,[\w$]+\)/g;
const TELEMETRY_CALL =
  /\breturn fetch\([\w$]+,\{method:`POST`,headers:\{"content-type":`application\/json`\},body:[\w$]+,credentials:`omit`,referrerPolicy:`no-referrer`,cache:`no-store`,redirect:`error`,signal:AbortSignal\.timeout\((?:[\w$]+|1e4)\)\}\)/g;
const ALLOWED = [ZOD_PROBE, BYO_CALL, TELEMETRY_CALL];

const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['eval(', /\beval\s*\(/],
  ['importScripts', /\bimportScripts\b/],
  ['Function constructor', /\bFunction\s*\(/],
  ['new Image (beacon)', /\bnew\s+Image\s*\(/],
  ['new Audio (beacon)', /\bnew\s+Audio\s*\(/],
  // No code or CSS injected into a tab, and no tab changed (sprint_4 close, security review SEC-8; Hard Rule 3).
  ['executeScript', /\bexecuteScript\b/],
  ['insertCSS', /\binsertCSS\b/],
  ['tabs.update', /\btabs\.update\b/],
];

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scripts(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('the shipped manifest matches the decisions', () => {
  const manifest = JSON.parse(readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  expect(manifest.action).toEqual({
    default_title: 'Attest: receipts for your AI agents',
    default_popup: 'popup.html',
  });
  // `scripting` registers the page readers at runtime, so a reader the person turns off is unregistered (sprint_4 4.5);
  // `notifications` shows the alerts (sprint_4 4.6).
  expect(manifest.permissions).toEqual(['storage', 'alarms', 'scripting', 'notifications', 'sidePanel']);
  // Hard Rule 8: away detection asks for `idle` only when the person turns it on (sprint_3 3.14).
  expect(manifest.optional_permissions).toEqual(['idle']);
  // Hard Rule 8: exactly Gmail and Google Calendar (sprint_2 2.0), nothing broader; no agent host while every agent
  // reader is off under its vendor's terms (Decisions [3.10]).
  expect(manifest.host_permissions).toEqual(['https://mail.google.com/*', 'https://calendar.google.com/*']);
  // connect-src (Sprint 5 close, SEC-3): Chrome refuses any host but these, a redirect's target included.
  expect(manifest.content_security_policy).toEqual({
    extension_pages:
      "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob:; form-action 'none'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://attest-production-5149.up.railway.app",
  });
  expect(manifest).not.toHaveProperty('optional_host_permissions');
  // Decisions [2.close] S3 (SEC-9): never in incognito, so no incognito page's facts reach the persistent ledger.
  expect(manifest.incognito).toBe('not_allowed');
});

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

test('no test code ships: no harness, and nothing reaches the fixture server (sprint_2 2.0)', () => {
  const shipped = files(EXTENSION_PATH);
  expect(shipped.length).toBeGreaterThan(3);
  const markers = [OBSERVER_HARNESS_MARKER, SENT_PASS_HARNESS_MARKER];
  const marked = shipped.filter((file) =>
    markers.some((marker) => readFileSync(file, 'utf8').includes(marker)),
  );
  expect(marked.map((file) => path.relative(EXTENSION_PATH, file))).toEqual([]);
  expect(
    shipped.filter((file) => /harness|[\\/]tests?[\\/]/i.test(path.relative(EXTENSION_PATH, file))),
  ).toEqual([]);
  const manifest = readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8');
  for (const local of ['127.0.0.1', 'localhost', 'file://', '<all_urls>', '*://*/*']) {
    expect(manifest, local).not.toContain(local);
  }
  const parsed = JSON.parse(manifest) as Record<string, unknown>;
  expect(parsed).not.toHaveProperty('web_accessible_resources');
  const scripts = (parsed.content_scripts ?? []) as { matches?: string[] }[];
  const hosts = new Set(parsed.host_permissions as string[]);
  expect(scripts.flatMap((script) => script.matches ?? []).filter((match) => !hosts.has(match))).toEqual([]);
});

/** How many UTF-16 code units of `text` are outside ASCII. */
function nonAscii(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) > 0x7f) count += 1;
  return count;
}

test('the content scripts are exactly Gmail and Calendar, registered at runtime, never in the manifest (sprint_4 4.5)', () => {
  const manifest = JSON.parse(readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  // The service worker registers each while the person keeps it on (src/background/readers.ts), on exactly its hosts:
  // tests/e2e/options-settings.spec.ts reads the registrations of the running build.
  expect(manifest).not.toHaveProperty('content_scripts');
  expect(
    readdirSync(path.join(EXTENSION_PATH, 'content-scripts')).filter((file) => file.endsWith('.js')),
  ).toEqual(['gcal.js', 'gmail.js']);
  for (const file of scripts(EXTENSION_PATH)) {
    expect(nonAscii(readFileSync(file, 'utf8')), path.relative(EXTENSION_PATH, file)).toBe(0);
  }
});

test('no shipped script reaches the network, evaluates code, or injects into a tab', () => {
  const files = scripts(EXTENSION_PATH);
  expect(files.length).toBeGreaterThan(3);
  const allowedIn = new Map<RegExp, string[]>(ALLOWED.map((allowed) => [allowed, []]));
  const hits: string[] = [];
  for (const file of files) {
    let source = readFileSync(file, 'utf8');
    for (const allowed of ALLOWED) {
      source = source.replace(allowed, () => {
        allowedIn.get(allowed)?.push(path.relative(EXTENSION_PATH, file));
        return '';
      });
    }
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(source)) hits.push(`${path.relative(EXTENSION_PATH, file)}: ${label}`);
    }
  }
  expect(hits).toEqual([]);
  // The allowlist is not stale: the Zod probe is really there (once per chunk that bundles Zod), and the one call a
  // person's own key makes and the telemetry's one call are each there once, in the service worker, and in no page or
  // content script.
  expect(allowedIn.get(ZOD_PROBE)?.length ?? 0).toBeGreaterThanOrEqual(1);
  expect(allowedIn.get(BYO_CALL)).toEqual(['background.js']);
  expect(allowedIn.get(TELEMETRY_CALL)).toEqual(['background.js']);
});

/**
 * The size budget of each content script, gzipped at level 9 (TECH-17): what a Gmail or Calendar tab downloads and
 * parses at every load. Measured at the Sprint 2 close: Gmail 66,574 B and Calendar 62,056 B (71,247 B and 66,753 B
 * before zod's JSON Schema code was left out). Growth past the budget is a decision, not a drift.
 */
const CONTENT_SCRIPT_BUDGET_GZIP = 75_000;

test('each content script is within its size budget, and no script ships zod JSON Schema code (TECH-17)', () => {
  for (const name of ['gmail', 'gcal']) {
    const file = path.join(EXTENSION_PATH, 'content-scripts', `${name}.js`);
    const size = gzipSync(readFileSync(file), { level: 9 }).length;
    console.info(
      `[bundle] content-scripts/${name}.js: ${String(size)} B gzipped (budget ${String(CONTENT_SCRIPT_BUDGET_GZIP)})`,
    );
    expect(size, name).toBeLessThanOrEqual(CONTENT_SCRIPT_BUDGET_GZIP);
  }
  const carrying = scripts(EXTENSION_PATH).filter((file) =>
    readFileSync(file, 'utf8').includes('json-schema.org'),
  );
  expect(carrying.map((file) => path.relative(EXTENSION_PATH, file))).toEqual([]);
});

/**
 * The popup's start load, gzipped at level 9 file by file (sprint_4 close, tech review TECH-5): its page's stylesheet
 * and module, and every module those import statically, transitively, before any `import()` (a receipt's detail and
 * the bus listener load later). The checklist's ceiling is 150 KB. The budget sits about 10% above what the popup
 * loads at the Sprint 4 close (113,062 B), as the content scripts' does, so its next growth is a decision, not a drift.
 */
const POPUP_START_BUDGET_GZIP = 125_000;

/** The files `page` loads before any `import()`: what its HTML names, and each module's static imports, transitively. */
function startLoad(page: string): string[] {
  const html = readFileSync(path.join(EXTENSION_PATH, page), 'utf8');
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!file.endsWith('.js')) return;
    const code = readFileSync(path.join(EXTENSION_PATH, file), 'utf8');
    for (const [, from = ''] of code.matchAll(
      /\b(?:import|export)\s*(?:[^"'();]*?from\s*)?["']([^"']+)["']/gu,
    )) {
      if (from.startsWith('.')) visit(path.posix.join(path.posix.dirname(file), from));
    }
  };
  for (const [, file = ''] of html.matchAll(/(?:src|href)="\/([^"]+\.(?:js|css))"/gu)) visit(file);
  return [...seen].sort();
}

test('the popup’s start load is within its budget (TECH-5)', () => {
  const files = startLoad('popup.html');
  expect(files.filter((file) => /^chunks\/popup-[\w-]+\.js$/u.test(file))).toHaveLength(1);
  const size = files.reduce(
    (sum, file) => sum + gzipSync(readFileSync(path.join(EXTENSION_PATH, file)), { level: 9 }).length,
    0,
  );
  console.info(
    `[bundle] popup start: ${String(files.length)} files, ${String(size)} B gzipped (budget ${String(POPUP_START_BUDGET_GZIP)})`,
  );
  expect(size).toBeLessThanOrEqual(POPUP_START_BUDGET_GZIP);
});

/** A string of @noble/ciphers' AES that minifying keeps: where it is, the cipher is. */
const CIPHER_MARKER = 'expected Uint8Array of length 16/24/32';

test('the popup’s start load carries no cipher, which loads only for an encrypted ledger (TECH-1)', () => {
  const read = (file: string) => readFileSync(path.join(EXTENSION_PATH, file), 'utf8');
  const carrying = startLoad('popup.html').filter(
    (file) => file.endsWith('.js') && read(file).includes(CIPHER_MARKER),
  );
  expect(carrying).toEqual([]);
  // The marker is the cipher's: the build holds it, in the chunk loaded when a ledger may hold sealed rows.
  expect(scripts(EXTENSION_PATH).some((file) => readFileSync(file, 'utf8').includes(CIPHER_MARKER))).toBe(
    true,
  );
});

test('the build is a production build: no development JSX, no path of this machine (QA-2)', () => {
  // Preact's development JSX passes each element's source file and place: its column key, and the file's absolute path.
  const repository = path.resolve(import.meta.dirname, '../../..');
  const developing = scripts(EXTENSION_PATH).filter((file) => {
    const code = readFileSync(file, 'utf8');
    return code.includes(repository) || /\bcolumnNumber\s*:/u.test(code);
  });
  expect(developing.map((file) => path.relative(EXTENSION_PATH, file))).toEqual([]);
});

test("the page readers hold no address Attest could send to, and no agent's site (privacy review gap 15)", () => {
  const hosts = [
    TELEMETRY_HOST,
    ...Object.values(BYO_VENDORS).flatMap((vendor) => [vendor.host, vendor.endpoint]),
    ...Object.values(AGENT_HOSTS).flatMap((patterns) =>
      patterns.map((pattern) => new URL(pattern.replace('*', '')).host),
    ),
  ];
  expect(hosts.length).toBeGreaterThan(5);
  for (const name of ['gmail', 'gcal']) {
    const code = readFileSync(path.join(EXTENSION_PATH, 'content-scripts', `${name}.js`), 'utf8');
    expect(
      hosts.filter((host) => code.includes(host)),
      name,
    ).toEqual([]);
  }
});
