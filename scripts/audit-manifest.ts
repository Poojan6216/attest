/**
 * The manifest audit (sprint_6 6.6; Hard Rules 1, 3, 8, 9): the built manifest asks Chrome for no more than Attest
 * needs, and lets no code run but the extension's own. CI runs it on the build (`pnpm audit:manifest`, after `pnpm
 * build`), and `pnpm build:release` on the zip it makes. It fails, one line per problem, when:
 *  - the manifest holds a key outside the ones Attest uses (ALLOWED_KEYS; Sprint 6 close, security review SEC-3 and
 *    tech review TECH-4): `content_scripts`, `externally_connectable`, `web_accessible_resources` (the share image is
 *    drawn in the page and needs none), `optional_host_permissions`, `chrome_settings_overrides` and every other key
 *    not named there;
 *  - `permissions` holds anything outside storage, alarms, sidePanel, notifications, offscreen and scripting (`tabs`
 *    among them);
 *  - `optional_permissions` holds anything but `idle` (away detection, asked for when the person turns it on);
 *  - `host_permissions` is not exactly Gmail's and Calendar's: build_spec §5 names five hosts, the three agents' sites
 *    among them, and their readers are off (Decisions [3.10]), so the build asks for the two observer hosts only; a
 *    wildcard host, `<all_urls>` or an agent's site fails until a Decision turns its reader on;
 *  - `incognito` is anything but `not_allowed` (Decisions [2.close] S3: an incognito page is never read);
 *  - the extension pages' CSP does not hold `default-src` to the extension, lets a script come from anywhere but the
 *    extension, leaves `object-src` or `form-action` open, names a host in any directive but `connect-src`, or lets a
 *    page connect anywhere but the extension, the two model vendors' APIs and the opt-in telemetry's host; images may
 *    also come from `blob:`, the share image's preview;
 *  - `minimum_chrome_version` is missing or below MIN_CHROME_MAJOR (src/config-manifest.ts), the one the build sets.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MIN_CHROME_MAJOR } from '../extension/src/config-manifest';
import { BYO_VENDORS, TELEMETRY_HOST } from '../extension/src/config-network';

/** The manifest keys Attest uses, and `version_name`, which WXT may add: any other fails (header). */
export const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'manifest_version',
  'name',
  'description',
  'version',
  'version_name',
  'icons',
  'action',
  'background',
  'side_panel',
  'options_ui',
  'permissions',
  'optional_permissions',
  'host_permissions',
  'content_security_policy',
  'minimum_chrome_version',
  'incognito',
]);

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'storage',
  'alarms',
  'sidePanel',
  'notifications',
  'offscreen',
  'scripting',
]);
export const ALLOWED_OPTIONAL_PERMISSIONS: ReadonlySet<string> = new Set(['idle']);
/** The two observer hosts, exactly (header). */
export const HOST_PERMISSIONS: readonly string[] = [
  'https://mail.google.com/*',
  'https://calendar.google.com/*',
];
/** What an extension page may connect to besides itself: each model vendor's API and the telemetry host. */
export const CONNECT_HOSTS: readonly string[] = [
  ...Object.values(BYO_VENDORS).map((vendor) => `https://${vendor.host}`),
  `https://${TELEMETRY_HOST}`,
];
export const MIN_CHROME_VERSION = MIN_CHROME_MAJOR;
/** The sources a directive may name: the extension, or nothing; `connect-src` and `img-src` a few more (header). */
const KEYWORDS: readonly string[] = ["'self'", "'none'"];
const SOURCES: Readonly<Record<string, readonly string[]>> = {
  'connect-src': ["'self'", ...CONNECT_HOSTS],
  // The share image's preview is a blob: URL the page made from its own canvas (src/ui/use-share-image.ts).
  'img-src': [...KEYWORDS, 'blob:'],
};
/** Directives whose sources must be exactly these. */
const EXACT: Readonly<Record<string, string>> = {
  'script-src': "'self'",
  'object-src': "'none'",
  'form-action': "'none'",
};

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** The extension pages' CSP as directive name to its sources. */
function directives(csp: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/u);
    if (name !== undefined && name !== '') parsed.set(name, sources);
  }
  return parsed;
}

function cspProblems(manifest: Record<string, unknown>): string[] {
  const policy: unknown = Reflect.get(Object(manifest.content_security_policy), 'extension_pages');
  if (typeof policy !== 'string') return ['content_security_policy.extension_pages is missing'];
  const csp = directives(policy);
  const problems: string[] = [];
  for (const [name, wanted] of Object.entries(EXACT)) {
    const sources = csp.get(name) ?? [];
    if (sources.length !== 1 || sources[0] !== wanted)
      problems.push(`${name} is not ${wanted} alone: ${sources.join(' ')}`);
  }
  const defaults = csp.get('default-src') ?? [];
  if (defaults.length !== 1 || !KEYWORDS.includes(defaults[0] ?? ''))
    problems.push(`default-src is not 'self' or 'none' alone: ${defaults.join(' ')}`);
  if (!csp.has('connect-src'))
    problems.push('connect-src is missing, so pages may connect anywhere default-src allows');
  for (const [name, sources] of csp) {
    const allowed = SOURCES[name] ?? KEYWORDS;
    for (const source of sources.filter((named) => !allowed.includes(named))) {
      problems.push(`${name} allows ${source}`);
    }
  }
  return problems;
}

/** Every problem with `manifest` (header); none when it passes. */
export function auditManifest(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) return ['the manifest is not an object'];
  const fields = manifest as Record<string, unknown>;
  const problems: string[] = [];
  for (const permission of list(fields.permissions)) {
    if (!ALLOWED_PERMISSIONS.has(permission)) problems.push(`permission ${permission} is not allowed`);
  }
  for (const permission of list(fields.optional_permissions)) {
    if (!ALLOWED_OPTIONAL_PERMISSIONS.has(permission))
      problems.push(`optional permission ${permission} is not allowed`);
  }
  const hosts = list(fields.host_permissions);
  for (const host of hosts) {
    if (!HOST_PERMISSIONS.includes(host)) problems.push(`host permission ${host} is not allowed`);
  }
  for (const host of HOST_PERMISSIONS) {
    if (!hosts.includes(host)) problems.push(`host permission ${host} is missing`);
  }
  for (const key of Object.keys(fields)) {
    if (!ALLOWED_KEYS.has(key)) problems.push(`${key} is not allowed`);
  }
  if (fields.incognito !== 'not_allowed')
    problems.push(`incognito is not not_allowed: ${String(fields.incognito)}`);
  problems.push(...cspProblems(fields));
  const stated = fields.minimum_chrome_version;
  const version = typeof stated === 'string' ? Number.parseInt(stated, 10) : Number.NaN;
  if (!(version >= MIN_CHROME_VERSION))
    problems.push(`minimum_chrome_version must be at least ${String(MIN_CHROME_VERSION)}`);
  return problems;
}

/** The manifest at `file`: a manifest.json, or the one inside a zip `pnpm build:release` made. */
export function readManifest(file: string): unknown {
  const text = file.endsWith('.zip')
    ? execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' })
    : readFileSync(file, 'utf8');
  return JSON.parse(text);
}

/** `pnpm audit:manifest [path...]`: each manifest or zip given, the built manifest when none is. */
function main(): void {
  const files = process.argv.slice(2);
  let failed = false;
  for (const file of files.length > 0 ? files : ['extension/.output/chrome-mv3/manifest.json']) {
    const problems = auditManifest(readManifest(file));
    for (const problem of problems) console.error(`audit-manifest: ${problem} (${file})`);
    if (problems.length > 0) failed = true;
    else console.log(`audit-manifest: OK (${file})`);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
