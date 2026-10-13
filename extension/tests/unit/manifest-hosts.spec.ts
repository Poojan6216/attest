/**
 * Hard Rule 8 at the source: wxt.config.ts declares host_permissions as exactly the two observer hosts (Gmail, Google
 * Calendar; sprint_2 2.0, from src/config.ts OBSERVER_HOSTS) and no agent host while its reader is off (sprint_3,
 * Decisions [3.0], [3.10]: every agent reader is off under its vendor's terms), and nothing else that widens access.
 * tests/e2e/built-bundle.spec.ts checks the same in the manifest of the build that ships.
 */
import { describe, expect, it, vi } from 'vitest';

import { OBSERVER_HOSTS } from '../../src/config';
import { AGENT_HOSTS, AGENT_READERS } from '../../src/config-agents';
import config, { EXTENSION_PAGES_CSP, withDevServer } from '../../wxt.config';

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
  it('are exactly https://mail.google.com/* and https://calendar.google.com/*', () => {
    expect(manifest().host_permissions).toEqual([
      'https://mail.google.com/*',
      'https://calendar.google.com/*',
    ]);
  });

  it('are the observer hosts of src/config.ts, and no agent host while its reader is off', () => {
    expect(manifest().host_permissions).toEqual([...OBSERVER_HOSTS.gmail, ...OBSERVER_HOSTS.gcal]);
    const offHosts = Object.entries(AGENT_HOSTS)
      .filter(([agent]) => AGENT_READERS[agent as keyof typeof AGENT_READERS] === 'off')
      .flatMap(([, hosts]) => hosts);
    expect(offHosts.length).toBeGreaterThan(0);
    expect(offHosts.filter((host) => (manifest().host_permissions as string[]).includes(host))).toEqual([]);
  });

  it('ask for one optional permission, idle, and only when the person turns away detection on (sprint_3 3.14)', () => {
    expect(manifest().permissions).toEqual(['storage', 'alarms', 'scripting', 'notifications']);
    expect(manifest().optional_permissions).toEqual(['idle']);
  });

  it('declare no optional hosts, content scripts or web-accessible resources', () => {
    const block = manifest();
    expect(block).not.toHaveProperty('optional_host_permissions');
    expect(block).not.toHaveProperty('content_scripts');
    expect(block).not.toHaveProperty('web_accessible_resources');
    expect(block).not.toHaveProperty('externally_connectable');
  });

  it('keep the permissions and CSP unchanged: scripting for the page readers, notifications for alerts', () => {
    const block = manifest();
    // `scripting` registers the readers' content scripts at runtime, so one the person turns off is unregistered
    // (sprint_4 4.5; src/background/readers.ts; Decisions [4.5]). It reaches no host beyond host_permissions.
    // `notifications` shows one alert per FINAL NOT_FOUND, UNASKED or OVER_SCOPE receipt (sprint_4 4.6; Decisions [4.6]).
    expect(block.permissions).toEqual(['storage', 'alarms', 'scripting', 'notifications']);
    // connect-src (Sprint 5 close, SEC-3): the extension itself, the two model vendors' endpoints and the telemetry
    // host, so Chrome refuses every other host, a redirect's target included.
    expect(block.content_security_policy).toEqual({
      extension_pages:
        "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob:; form-action 'none'; connect-src 'self' https://api.anthropic.com https://api.openai.com https://telemetry.attest.invalid",
    });
  });

  it('let the development server connect only in `pnpm dev`, never in a build', () => {
    expect(withDevServer(EXTENSION_PAGES_CSP, 'http://localhost:3000')).toBe(
      "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob:; form-action 'none'; connect-src http://localhost:3000 ws://localhost:3000 'self' https://api.anthropic.com https://api.openai.com https://telemetry.attest.invalid",
    );
    expect(manifest().content_security_policy).toEqual({ extension_pages: EXTENSION_PAGES_CSP });
  });
});
