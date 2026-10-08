/**
 * Hard Rule 8 at the source: wxt.config.ts declares host_permissions as exactly the two observer hosts (Gmail, Google
 * Calendar; sprint_2 2.0, from src/config.ts OBSERVER_HOSTS) and the agent hosts that have a reader (sprint_3: each
 * enters with its content script, never before, Decisions [3.0]; Muse's since 2026-10-08), and nothing else that widens
 * access. tests/e2e/built-bundle.spec.ts checks the same in the manifest of the build that ships.
 */
import { describe, expect, it, vi } from 'vitest';

import { AGENT_HOSTS, OBSERVER_HOSTS } from '../../src/config';
import config from '../../wxt.config';

// wxt.config.ts imports `defineConfig` from 'wxt', which loads WXT and, in the background, its optional `web-ext` peer
// (not installed: an unhandled rejection under CI's coverage run). `defineConfig` returns its argument, so a stub that
// does the same keeps this file's reads exact and never loads WXT.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/** The manifest block of wxt.config.ts, as an object (it is a literal there, not a function). */
function manifest(): Record<string, unknown> {
  const block: unknown = config.manifest;
  if (typeof block !== 'object' || block === null) throw new Error('wxt.config.ts manifest is not an object');
  return { ...block };
}

describe('wxt.config.ts host permissions (sprint_2 2.0, sprint_3, Hard Rule 8)', () => {
  it('are exactly Gmail, Google Calendar and Muse', () => {
    expect(manifest().host_permissions).toEqual([
      'https://mail.google.com/*',
      'https://calendar.google.com/*',
      'https://muse.ai/*',
    ]);
  });

  it('are the observer hosts of src/config.ts and the agent hosts with a reader: no ChatGPT or Claude host yet', () => {
    expect(manifest().host_permissions).toEqual([
      ...OBSERVER_HOSTS.gmail,
      ...OBSERVER_HOSTS.gcal,
      ...AGENT_HOSTS.muse,
    ]);
    const unread: readonly string[] = [...AGENT_HOSTS.chatgpt, ...AGENT_HOSTS.claude];
    expect(unread.filter((host) => (manifest().host_permissions as string[]).includes(host))).toEqual([]);
  });

  it('declare no optional hosts, content scripts or web-accessible resources', () => {
    const block = manifest();
    expect(block).not.toHaveProperty('optional_host_permissions');
    expect(block).not.toHaveProperty('content_scripts');
    expect(block).not.toHaveProperty('web_accessible_resources');
    expect(block).not.toHaveProperty('externally_connectable');
  });

  it('keep the permissions and CSP unchanged', () => {
    const block = manifest();
    expect(block.permissions).toEqual(['storage', 'alarms']);
    expect(block.content_security_policy).toEqual({
      extension_pages: "script-src 'self'; object-src 'none'",
    });
  });
});
