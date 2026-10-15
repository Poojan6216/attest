/**
 * The manifest audit (scripts/audit-manifest.ts; sprint_6 6.6 Done when: "audit green; adding `tabs` or a wildcard host
 * fails CI"): the manifest Attest builds passes, as wxt.config.ts declares it with what WXT adds; and each way of
 * asking for more fails, alone, with its own line: `tabs` or any other permission, a wildcard host, `<all_urls>`, an
 * agent's site, a missing observer host, an optional permission but `idle`, a content script or a web-accessible
 * resource, a CSP that loads remote or inline code or connects to another host, and an old or missing Chrome version.
 * Since the Sprint 6 close (security review SEC-3, tech review TECH-4), also: any key Attest does not use, an optional
 * host among them; incognito allowed; a Chrome older than the build's own; and a CSP without `default-src 'self'`, with
 * a host in any directive but `connect-src`, or with forms sent anywhere. Since sprint_7 7.2, a homepage other than the
 * privacy policy's public address. A release zip's manifest is read too.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  auditManifest,
  CONNECT_HOSTS,
  MIN_CHROME_VERSION,
  readManifest,
} from '../../../../scripts/audit-manifest';
import { HOMEPAGE_URL, MIN_CHROME_MAJOR } from '../../../src/config-manifest';
import config from '../../../wxt.config';

// As in tests/unit/docs/doc-pins.spec.ts: `defineConfig` returns its argument, so the stub never loads WXT.
vi.mock('wxt', () => ({ defineConfig: (block: unknown) => block }));

/** The built manifest: wxt.config.ts's, with what WXT adds (the side panel's permission, the entry points). */
function built(): Record<string, unknown> {
  const declared: unknown = config.manifest;
  if (typeof declared !== 'object' || declared === null)
    throw new Error('wxt.config.ts manifest is not an object');
  const permissions: unknown = Reflect.get(declared, 'permissions');
  return {
    ...declared,
    manifest_version: 3,
    version: '0.0.1',
    permissions: [...(Array.isArray(permissions) ? permissions.map(String) : []), 'sidePanel'],
    background: { type: 'module', service_worker: 'background.js' },
    action: { default_popup: 'popup.html' },
    side_panel: { default_path: 'sidepanel.html' },
  };
}

const csp = (extensionPages: string) => ({ content_security_policy: { extension_pages: extensionPages } });

/** One way each of asking for more, and the one problem it is reported as. */
const ASKING_FOR_MORE: readonly [string, Record<string, unknown>, string][] = [
  ['tabs', { permissions: ['storage', 'tabs'] }, 'permission tabs is not allowed'],
  ['history', { permissions: ['storage', 'history'] }, 'permission history is not allowed'],
  [
    'a wildcard host',
    { host_permissions: ['https://mail.google.com/*', 'https://calendar.google.com/*', 'https://*/*'] },
    'host permission https://*/* is not allowed',
  ],
  [
    '<all_urls>',
    { host_permissions: ['<all_urls>', 'https://mail.google.com/*', 'https://calendar.google.com/*'] },
    'host permission <all_urls> is not allowed',
  ],
  [
    'a wildcard subdomain',
    {
      host_permissions: [
        'https://mail.google.com/*',
        'https://*.google.com/*',
        'https://calendar.google.com/*',
      ],
    },
    'host permission https://*.google.com/* is not allowed',
  ],
  [
    "an agent's site",
    {
      host_permissions: [
        'https://mail.google.com/*',
        'https://calendar.google.com/*',
        'https://chatgpt.com/*',
      ],
    },
    'host permission https://chatgpt.com/* is not allowed',
  ],
  [
    'a missing observer host',
    { host_permissions: ['https://mail.google.com/*'] },
    'host permission https://calendar.google.com/* is missing',
  ],
  ['an optional tabs', { optional_permissions: ['idle', 'tabs'] }, 'optional permission tabs is not allowed'],
  [
    'a content script',
    { content_scripts: [{ matches: ['<all_urls>'], js: ['x.js'] }] },
    'content_scripts is not allowed',
  ],
  [
    'a web-accessible resource',
    { web_accessible_resources: [{ resources: ['*'], matches: ['<all_urls>'] }] },
    'web_accessible_resources is not allowed',
  ],
  [
    'externally_connectable',
    { externally_connectable: { matches: ['https://*/*'] } },
    'externally_connectable is not allowed',
  ],
  [
    'no Chrome version',
    { minimum_chrome_version: undefined },
    `minimum_chrome_version must be at least ${String(MIN_CHROME_MAJOR)}`,
  ],
  [
    'an old Chrome version',
    { minimum_chrome_version: '100' },
    `minimum_chrome_version must be at least ${String(MIN_CHROME_MAJOR)}`,
  ],
  [
    'Chrome 114',
    { minimum_chrome_version: '114' },
    `minimum_chrome_version must be at least ${String(MIN_CHROME_MAJOR)}`,
  ],
  // The last Chrome without storage buckets, which the ledger lives in (Sprint 6 close; src/ledger/place.ts).
  [
    'Chrome 121',
    { minimum_chrome_version: '121' },
    `minimum_chrome_version must be at least ${String(MIN_CHROME_MAJOR)}`,
  ],
  ['no homepage', { homepage_url: undefined }, `homepage_url must be ${HOMEPAGE_URL}`],
  [
    'another homepage',
    { homepage_url: 'https://attest.example/privacy' },
    `homepage_url must be ${HOMEPAGE_URL}`,
  ],
  [
    'every host, optionally',
    { optional_host_permissions: ['<all_urls>'] },
    'optional_host_permissions is not allowed',
  ],
  [
    'a wildcard host, optionally',
    { optional_host_permissions: ['https://*/*'] },
    'optional_host_permissions is not allowed',
  ],
  [
    'a search engine override',
    {
      chrome_settings_overrides: { search_provider: { search_url: 'https://evil.example/?q={searchTerms}' } },
    },
    'chrome_settings_overrides is not allowed',
  ],
  ['a sandboxed page', { sandbox: { pages: ['sandbox.html'] } }, 'sandbox is not allowed'],
  [
    'a key Attest does not use',
    { update_url: 'https://evil.example/updates.xml' },
    'update_url is not allowed',
  ],
  ['incognito, spanning', { incognito: 'spanning' }, 'incognito is not not_allowed: spanning'],
  ['incognito, split', { incognito: 'split' }, 'incognito is not not_allowed: split'],
  ['incognito left to Chrome', { incognito: undefined }, 'incognito is not not_allowed: undefined'],
];

/** One way each of loosening the pages' CSP, and a problem it is reported as. */
const LOOSER_CSP: readonly [string, string, string][] = [
  [
    'a remote script',
    "script-src 'self' https://cdn.example; object-src 'none'; connect-src 'self'",
    "script-src is not 'self' alone: 'self' https://cdn.example",
  ],
  [
    'eval',
    "script-src 'self' 'unsafe-eval'; object-src 'none'; connect-src 'self'",
    "script-src is not 'self' alone: 'self' 'unsafe-eval'",
  ],
  ['an open object-src', "script-src 'self'; connect-src 'self'", "object-src is not 'none' alone: "],
  [
    'no default-src',
    "script-src 'self'; object-src 'none'; connect-src 'self'",
    "default-src is not 'self' or 'none' alone: ",
  ],
  [
    'a host in default-src',
    "default-src 'self' https://cdn.example; script-src 'self'; object-src 'none'; connect-src 'self'",
    'default-src allows https://cdn.example',
  ],
  ...['img-src', 'style-src', 'font-src', 'media-src', 'frame-src', 'worker-src', 'script-src-elem'].map(
    (directive): [string, string, string] => [
      `a host in ${directive}`,
      `default-src 'self'; script-src 'self'; object-src 'none'; ${directive} 'self' https://cdn.example; connect-src 'self'`,
      `${directive} allows https://cdn.example`,
    ],
  ),
  [
    'inline script attributes',
    "default-src 'self'; script-src 'self'; script-src-attr 'unsafe-inline'; object-src 'none'; connect-src 'self'",
    "script-src-attr allows 'unsafe-inline'",
  ],
  [
    'images from data:',
    "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' data:; connect-src 'self'",
    'img-src allows data:',
  ],
  [
    'forms sent anywhere',
    "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'self'",
    "form-action is not 'none' alone: ",
  ],
  [
    'forms sent to a host',
    "default-src 'self'; script-src 'self'; object-src 'none'; form-action https://evil.example; connect-src 'self'",
    'form-action allows https://evil.example',
  ],
  [
    'another host to connect to',
    "script-src 'self'; object-src 'none'; connect-src 'self' https://evil.example",
    'connect-src allows https://evil.example',
  ],
  [
    'any https host',
    "script-src 'self'; object-src 'none'; connect-src 'self' https:",
    'connect-src allows https:',
  ],
  [
    'no connect-src',
    "script-src 'self'; object-src 'none'",
    'connect-src is missing, so pages may connect anywhere default-src allows',
  ],
];
describe('the manifest audit', () => {
  it('passes the manifest Attest builds', () => {
    expect(auditManifest(built())).toEqual([]);
  });

  it.each(ASKING_FOR_MORE)('fails %s', (_name, change, problem) => {
    const manifest = { ...built(), ...change };
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) Reflect.deleteProperty(manifest, key);
    }
    expect(auditManifest(manifest)).toEqual([problem]);
  });

  it('holds Chrome to the version the build sets, from one constant', () => {
    expect(MIN_CHROME_VERSION).toBe(MIN_CHROME_MAJOR);
    expect(built().minimum_chrome_version).toBe(String(MIN_CHROME_MAJOR));
  });

  it('reads the manifest inside a release zip', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-audit-'));
    try {
      writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(built()));
      execFileSync('zip', ['-q', 'release.zip', 'manifest.json'], { cwd: dir });
      expect(auditManifest(readManifest(path.join(dir, 'release.zip')))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(LOOSER_CSP)('fails a CSP with %s', (_name, policy, problem) => {
    expect(auditManifest({ ...built(), ...csp(policy) })).toContain(problem);
  });

  it('lets the pages connect to the model vendors and the telemetry host only', () => {
    expect(CONNECT_HOSTS).toEqual([
      'https://api.anthropic.com',
      'https://api.openai.com',
      'https://attest-production-5149.up.railway.app',
    ]);
    expect(
      auditManifest({
        ...built(),
        ...csp(
          `default-src 'self'; script-src 'self'; object-src 'none'; form-action 'none'; connect-src 'self' ${CONNECT_HOSTS.join(' ')}`,
        ),
      }),
    ).toEqual([]);
  });
});
