/**
 * Sprint 0.8: src/config.ts. Every feature flag is off by default, the host lists are exactly the
 * vendor and observer domains of build_spec §5 (Hard Rule 8, never broader, Muse never guessed), and
 * the network allowlist is empty (Hard Rule 1).
 */
import { describe, expect, it } from 'vitest';

import {
  AGENT_HOSTS,
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAGS,
  type FeatureFlag,
  NETWORK_ALLOWLIST,
  OBSERVER_HOSTS,
} from '../../src/config';

/** Chrome match pattern for exactly one https host and all of its paths. No wildcard hosts. */
const EXACT_HOST_PATTERN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\*$/;

const allHostPatterns = (): string[] =>
  [...Object.values(OBSERVER_HOSTS), ...Object.values(AGENT_HOSTS)].flat();

describe('feature flags', () => {
  it('are exactly the four named flags', () => {
    const expected: readonly FeatureFlag[] = [
      'ATTEST_DOTS',
      'ATTEST_AUTO_CHECK_GMAIL',
      'ATTEST_TELEMETRY',
      'ATTEST_MODEL',
    ];
    expect(FEATURE_FLAGS).toEqual(expected);
    expect(Object.keys(FEATURE_FLAG_DEFAULTS).sort()).toEqual([...expected].sort());
  });

  it('every flag defaults to false', () => {
    FEATURE_FLAGS.forEach((flag) => {
      expect(FEATURE_FLAG_DEFAULTS[flag]).toBe(false);
    });
    expect(Object.values(FEATURE_FLAG_DEFAULTS)).toEqual(FEATURE_FLAGS.map(() => false));
  });

  it('the defaults cannot be switched on at runtime', () => {
    expect(Object.isFrozen(FEATURE_FLAG_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(FEATURE_FLAGS)).toBe(true);
    expect(() => {
      (FEATURE_FLAG_DEFAULTS as Record<FeatureFlag, boolean>).ATTEST_TELEMETRY = true;
    }).toThrow(TypeError);
    expect(FEATURE_FLAG_DEFAULTS.ATTEST_TELEMETRY).toBe(false);
  });
});

describe('host lists', () => {
  it('observer hosts are exactly Gmail and Google Calendar', () => {
    expect(OBSERVER_HOSTS).toEqual({
      gmail: ['https://mail.google.com/*'],
      gcal: ['https://calendar.google.com/*'],
    });
  });

  it('agent hosts are exactly ChatGPT and Claude; Muse has none until its host is confirmed', () => {
    expect(AGENT_HOSTS).toEqual({
      chatgpt: ['https://chatgpt.com/*'],
      claude: ['https://claude.ai/*'],
      muse: [],
    });
  });

  it('every pattern names one exact https host: no <all_urls>, no wildcard host, no http', () => {
    const patterns = allHostPatterns();
    expect(patterns).toHaveLength(4);
    expect(patterns.filter((pattern) => !EXACT_HOST_PATTERN.test(pattern))).toEqual([]);
    expect(EXACT_HOST_PATTERN.test('<all_urls>')).toBe(false);
    expect(EXACT_HOST_PATTERN.test('https://*.google.com/*')).toBe(false);
    expect(EXACT_HOST_PATTERN.test('http://mail.google.com/*')).toBe(false);
  });

  it('the host lists are frozen at every depth', () => {
    for (const hosts of [OBSERVER_HOSTS, AGENT_HOSTS]) {
      expect(Object.isFrozen(hosts)).toBe(true);
      expect(Object.values(hosts).every((list) => Object.isFrozen(list))).toBe(true);
    }
    expect(() => (AGENT_HOSTS.muse as string[]).push('https://example.com/*')).toThrow(TypeError);
    expect(AGENT_HOSTS.muse).toEqual([]);
  });
});

describe('network allowlist', () => {
  it('is empty: nothing leaves the browser (Hard Rule 1)', () => {
    expect(NETWORK_ALLOWLIST).toEqual([]);
  });
});
