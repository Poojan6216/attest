/**
 * Sprint 2.0 Done-when "manifest diff shows exactly two hosts" (Hard Rule 8), at the source: wxt.config.ts declares
 * host_permissions as exactly Gmail and Google Calendar, from src/config.ts OBSERVER_HOSTS, and nothing else that
 * widens access. tests/e2e/built-bundle.spec.ts checks the same in the manifest of the build that ships.
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

describe('wxt.config.ts host permissions (sprint_2 2.0, Hard Rule 8)', () => {
  it('are exactly https://mail.google.com/* and https://calendar.google.com/*', () => {
    expect(manifest().host_permissions).toEqual([
      'https://mail.google.com/*',
      'https://calendar.google.com/*',
    ]);
  });

  it('are the observer hosts of src/config.ts, and no agent host yet (Sprint 3.0 adds those)', () => {
    expect(manifest().host_permissions).toEqual([...OBSERVER_HOSTS.gmail, ...OBSERVER_HOSTS.gcal]);
    const agentHosts: readonly string[] = Object.values(AGENT_HOSTS).flat();
    expect(agentHosts.filter((host) => (manifest().host_permissions as string[]).includes(host))).toEqual([]);
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
