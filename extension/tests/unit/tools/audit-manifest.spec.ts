/**
 * The manifest audit (scripts/audit-manifest.ts; sprint_6 6.6 Done when: "audit green; adding `tabs` or a wildcard host
 * fails CI"): the manifest Attest builds passes, as wxt.config.ts declares it with what WXT adds; and each way of
 * asking for more fails, alone, with its own line: `tabs` or any other permission, a wildcard host, `<all_urls>`, an
 * agent's site, a missing observer host, an optional permission but `idle`, a content script or a web-accessible
 * resource, a CSP that loads remote or inline code or connects to another host, and an old or missing Chrome version.
 */
import { describe, expect, it, vi } from 'vitest';

import { auditManifest, CONNECT_HOSTS } from '../../../../scripts/audit-manifest';
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
  ['no Chrome version', { minimum_chrome_version: undefined }, 'minimum_chrome_version must be at least 114'],
  ['an old Chrome version', { minimum_chrome_version: '100' }, 'minimum_chrome_version must be at least 114'],
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
  ['an open object-src', "script-src 'self'; connect-src 'self'", "object-src is not 'none': "],
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
    if ('minimum_chrome_version' in change && change.minimum_chrome_version === undefined) {
      Reflect.deleteProperty(manifest, 'minimum_chrome_version');
    }
    expect(auditManifest(manifest)).toEqual([problem]);
  });

  it.each(LOOSER_CSP)('fails a CSP with %s', (_name, policy, problem) => {
    expect(auditManifest({ ...built(), ...csp(policy) })).toContain(problem);
  });

  it('lets the pages connect to the model vendors and the telemetry host only', () => {
    expect(CONNECT_HOSTS).toEqual([
      'https://api.anthropic.com',
      'https://api.openai.com',
      'https://telemetry.attest.invalid',
    ]);
    expect(
      auditManifest({
        ...built(),
        ...csp(`script-src 'self'; object-src 'none'; connect-src 'self' ${CONNECT_HOSTS.join(' ')}`),
      }),
    ).toEqual([]);
  });
});
