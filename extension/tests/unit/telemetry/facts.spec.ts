/**
 * The telemetry's facts and guards (sprint_5 5.7): Chrome's major version read from a user agent (headless Chrome's
 * too), or none; the hosts the extension may contact for each choice (src/config-network.ts `allowedHosts`: none with
 * everything off, the telemetry host only while telemetry is on, a vendor's only while the person's own key is on); and
 * a store build refused while the telemetry host is the `.invalid` stand-in, or while PRIVACY.md holds a blank to fill
 * or does not name the host (wxt.config.ts `assertReleasable`; Sprint 7 close). Every value is invented.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  allowedHosts,
  BYO_VENDORS,
  NETWORK_ALLOWLIST,
  TELEMETRY_ENDPOINT,
  TELEMETRY_HOST,
} from '../../../src/config-network';
import { chromeMajorOf } from '../../../src/telemetry/facts';
import { assertReleasable, POLICY_TO_FILL } from '../../../wxt.config';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

// As in tests/unit/manifest-hosts.spec.ts: `defineConfig` returns its argument, so the stub never loads WXT.
vi.mock('wxt', () => ({ defineConfig: (block: unknown) => block }));

describe('chromeMajorOf', () => {
  it('reads Chrome’s major version, and gives none for a browser that names none', () => {
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.7340.12 Safari/537.36';
    expect(chromeMajorOf(chrome)).toBe(154);
    expect(
      chromeMajorOf(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36',
      ),
    ).toBe(153);
    expect(
      chromeMajorOf('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'),
    ).toBeNull();
  });
});

describe('allowedHosts', () => {
  it('is none with everything off, and grows by exactly the host each choice turns on', () => {
    expect(NETWORK_ALLOWLIST).toEqual([]);
    expect(allowedHosts({ telemetry: false, byo: null })).toEqual([]);
    expect(allowedHosts({ telemetry: true, byo: null })).toEqual([TELEMETRY_HOST]);
    expect(allowedHosts({ telemetry: false, byo: 'openai' })).toEqual([BYO_VENDORS.openai.host]);
    expect(allowedHosts({ telemetry: true, byo: 'anthropic' })).toEqual([
      TELEMETRY_HOST,
      BYO_VENDORS.anthropic.host,
    ]);
    expect(new URL(TELEMETRY_ENDPOINT).host).toBe(TELEMETRY_HOST);
    expect(new URL(TELEMETRY_ENDPOINT).pathname).toBe('/v1/aggregate');
  });
});

describe('assertReleasable', () => {
  const HOST = 'attest-telemetry.up.railway.app';
  const POLICY = `reports go to Attest's own telemetry server, ${HOST}`;

  it('refuses a store build while the telemetry host is the .invalid stand-in, and allows any other build', () => {
    expect(TELEMETRY_HOST.endsWith('.invalid')).toBe(true);
    expect(() => {
      assertReleasable(true, TELEMETRY_HOST, POLICY);
    }).toThrow(/telemetry host is still telemetry\.attest\.invalid/u);
    expect(() => {
      assertReleasable(false, TELEMETRY_HOST, '');
    }).not.toThrow();
    expect(() => {
      assertReleasable(true, HOST, POLICY);
    }).not.toThrow();
  });

  it('refuses a store build while the privacy policy holds a blank to fill, or does not name the host', () => {
    expect(() => {
      assertReleasable(true, HOST, `${POLICY}. Contact: ${POLICY_TO_FILL}: a private contact address]`);
    }).toThrow(/PRIVACY\.md still holds/u);
    expect(() => {
      assertReleasable(true, HOST, "reports go to Attest's own telemetry server");
    }).toThrow(/does not name the telemetry host attest-telemetry\.up\.railway\.app/u);
    // The founder filled both blanks on 2026-10-13 (MANUAL.md, Sprint 7): the policy itself holds none.
    expect(readFileSync(path.join(REPO_ROOT, 'PRIVACY.md'), 'utf8')).not.toContain(POLICY_TO_FILL);
  });
});
