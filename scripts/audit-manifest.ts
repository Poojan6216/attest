/**
 * The manifest audit (sprint_6 6.6; Hard Rules 1, 3, 8, 9): the built manifest asks Chrome for no more than Attest
 * needs, and lets no code run but the extension's own. CI runs it on the build (`pnpm audit:manifest`, after `pnpm
 * build`), and it fails, one line per problem, when:
 *  - `permissions` holds anything outside storage, alarms, sidePanel, notifications, offscreen and scripting (`tabs`
 *    among them);
 *  - `optional_permissions` holds anything but `idle` (away detection, asked for when the person turns it on);
 *  - `host_permissions` is not exactly Gmail's and Calendar's: build_spec §5 names five hosts, the three agents' sites
 *    among them, and their readers are off (Decisions [3.10]), so the build asks for the two observer hosts only; a
 *    wildcard host, `<all_urls>` or an agent's site fails until a Decision turns its reader on;
 *  - a content script, `externally_connectable`, `web_accessible_resources` (the share image is drawn in the page and
 *    needs none), `sandbox`, `oauth2` or `chrome_url_overrides` appears;
 *  - the extension pages' CSP lets a script come from anywhere but the extension, allows eval or inline code, leaves
 *    `object-src` open, or lets a page connect anywhere but the extension, the two model vendors' APIs and the opt-in
 *    telemetry's host;
 *  - `minimum_chrome_version` is missing or below 114 (the side panel; storage access levels need 102, and the service
 *    worker's keep-awake while the ledger is unlocked, 110).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BYO_VENDORS, TELEMETRY_HOST } from '../extension/src/config-network';

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
export const MIN_CHROME_VERSION = 114;
const FORBIDDEN_KEYS = [
  'content_scripts',
  'externally_connectable',
  'web_accessible_resources',
  'sandbox',
  'oauth2',
  'chrome_url_overrides',
] as const;

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
  const scripts = csp.get('script-src') ?? [];
  if (scripts.length !== 1 || scripts[0] !== "'self'")
    problems.push(`script-src is not 'self' alone: ${scripts.join(' ')}`);
  const objects = csp.get('object-src') ?? [];
  if (objects.length !== 1 || objects[0] !== "'none'")
    problems.push(`object-src is not 'none': ${objects.join(' ')}`);
  const allowed = new Set(["'self'", ...CONNECT_HOSTS]);
  for (const source of csp.get('connect-src') ?? []) {
    if (!allowed.has(source)) problems.push(`connect-src allows ${source}`);
  }
  if (!csp.has('connect-src'))
    problems.push('connect-src is missing, so pages may connect anywhere default-src allows');
  for (const [name, sources] of csp) {
    for (const unsafe of sources.filter((source) => /unsafe|^\*$|^data:|^blob:|^https?:$/u.test(source))) {
      problems.push(`${name} allows ${unsafe}`);
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
  for (const key of FORBIDDEN_KEYS) {
    if (key in fields) problems.push(`${key} is not allowed`);
  }
  problems.push(...cspProblems(fields));
  const stated = fields.minimum_chrome_version;
  const version = typeof stated === 'string' ? Number.parseInt(stated, 10) : Number.NaN;
  if (!(version >= MIN_CHROME_VERSION))
    problems.push(`minimum_chrome_version must be at least ${String(MIN_CHROME_VERSION)}`);
  return problems;
}

/** `pnpm audit:manifest [path]`: the built manifest by default. */
function main(): void {
  const file = process.argv[2] ?? 'extension/.output/chrome-mv3/manifest.json';
  const problems = auditManifest(JSON.parse(readFileSync(file, 'utf8')));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`audit-manifest: ${problem}`);
    process.exit(1);
  }
  console.log(`audit-manifest: OK (${file})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
