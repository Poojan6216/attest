import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyse, CHROMIUM_BACKGROUND_HOSTS } from '../../e2e/support/network-guard';
import {
  isBrowserInitiated,
  netLogPathFor,
  parseNetLog,
  readNetLogRequests,
  urlRequests,
} from '../../e2e/support/netlog';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const FIXTURES = 'http://127.0.0.1:43123';

function netLog(events: { url: string; initiator?: string; method?: string }[], typeId = 7): string {
  return JSON.stringify({
    constants: { logEventTypes: { URL_REQUEST_START_JOB: typeId, OTHER: 1 } },
    events: [
      { type: 1, params: { url: 'https://ignored-other-event.example.com/' } },
      ...events.map((params) => ({ type: typeId, params })),
      { type: typeId },
    ],
  });
}

describe('parseNetLog / urlRequests', () => {
  it('extracts URL_REQUEST_START_JOB url, method and initiator; ignores other events', () => {
    const doc = parseNetLog(
      netLog([
        { url: 'https://sw.example.com/x', initiator: EXT, method: 'POST' },
        { url: 'https://update.googleapis.com/u', initiator: 'not an origin' },
      ]),
    );
    expect(urlRequests(doc)).toEqual([
      { url: 'https://sw.example.com/x', method: 'POST', initiator: EXT },
      { url: 'https://update.googleapis.com/u', method: 'GET', initiator: 'not an origin' },
    ]);
  });

  it('treats a missing initiator as browser-initiated', () => {
    const [request] = urlRequests(parseNetLog(netLog([{ url: 'https://x.example.com/' }])));
    expect(request && isBrowserInitiated(request)).toBe(true);
  });

  it('repairs a log truncated mid-write instead of reporting zero requests', () => {
    const full = netLog([{ url: 'https://leak.example.com/', initiator: EXT }]);
    const truncated = full.slice(0, full.lastIndexOf(']'));
    expect(urlRequests(parseNetLog(truncated)).map((r) => r.url)).toContain('https://leak.example.com/');
  });

  it('throws on an unreadable log (fail closed)', () => {
    expect(() => parseNetLog('')).toThrow();
    expect(() => urlRequests(parseNetLog('{"constants":{"logEventTypes":{}},"events":[]}'))).toThrow(
      /URL_REQUEST_START_JOB/,
    );
  });
});

describe('readNetLogRequests: one NetLog per launch attempt', () => {
  it('reads every attempt, a hung (truncated) one included, and fails closed with none', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-netlog-unit-'));
    try {
      expect(() => readNetLogRequests(dir)).toThrow('no NetLog');
      const hung = netLog([{ url: 'https://hung-attempt.example.com/', initiator: EXT }]);
      writeFileSync(netLogPathFor(dir, 0), hung.slice(0, hung.lastIndexOf(']')));
      writeFileSync(netLogPathFor(dir, 1), netLog([{ url: 'https://second.example.com/', initiator: EXT }]));
      writeFileSync(path.join(dir, 'other.json'), 'not a netlog');
      expect(readNetLogRequests(dir).map((r) => new URL(r.url).host)).toEqual([
        'hung-attempt.example.com',
        'second.example.com',
      ]);
      writeFileSync(netLogPathFor(dir, 2), '');
      expect(() => readNetLogRequests(dir)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives each attempt its own file', () => {
    expect(netLogPathFor('/d', 0)).not.toBe(netLogPathFor('/d', 1));
  });
});

describe('analyse', () => {
  const options = { fixtureOrigin: FIXTURES, allowlist: [] as string[] };

  it('flags a request from the extension origin', () => {
    const report = analyse([{ url: 'https://example.com/a', method: 'GET', initiator: EXT }], [], options);
    expect(report.violations).toEqual(['example.com']);
  });

  it('flags a request initiated by a page origin (content scripts run there)', () => {
    const report = analyse(
      [{ url: 'https://evil.example.net/b', method: 'GET', initiator: 'https://mail.google.com' }],
      [],
      options,
    );
    expect(report.violations).toEqual(['evil.example.net']);
  });

  it('flags an opaque (null) initiator', () => {
    const report = analyse(
      [{ url: 'https://x.example.org/', method: 'GET', initiator: 'null' }],
      [],
      options,
    );
    expect(report.violations).toEqual(['x.example.org']);
  });

  it('flags route-recorded page requests', () => {
    const report = analyse(
      [],
      [{ url: 'https://beacon.example.com/p', from: `${FIXTURES}/a.html`, body: '', headers: '{}' }],
      options,
    );
    expect(report.violations).toEqual(['beacon.example.com']);
  });

  it('ignores local schemes, the fixture server and routed fixtures', () => {
    const report = analyse(
      [
        { url: `${EXT}/popup.html`, method: 'GET', initiator: EXT },
        { url: 'data:text/plain,hi', method: 'GET', initiator: EXT },
        { url: `${FIXTURES}/_harness/blank.html`, method: 'GET', initiator: 'not an origin' },
        { url: 'https://mail.google.com/mail/u/0/#sent', method: 'GET', initiator: 'not an origin' },
      ],
      [],
      { ...options, routedFixtureUrls: new Set(['https://mail.google.com/mail/u/0/#sent']) },
    );
    expect(report.attributed).toEqual([]);
    expect(report.violations).toEqual([]);
  });

  it('knows a routed address NetLog logs with its fragment, and still catches any other address on that host', () => {
    const routed = { ...options, routedFixtureUrls: new Set(['https://mail.google.com/mail/u/0/']) };
    const opened = (url: string) => analyse([{ url, method: 'GET', initiator: 'not an origin' }], [], routed);
    expect(opened('https://mail.google.com/mail/u/0/#sent').unknownBrowserHosts).toEqual([]);
    expect(opened('https://mail.google.com/mail/u/1/#sent').unknownBrowserHosts).toEqual(['mail.google.com']);
    expect(opened('https://mail.google.com/mail/u/0/?ui=2#sent').unknownBrowserHosts).toEqual([
      'mail.google.com',
    ]);
  });
});

describe('analyse: browser background traffic and the allowlist', () => {
  const options = { fixtureOrigin: FIXTURES, allowlist: [] as string[] };

  it('separates known Chromium background hosts from unknown browser-initiated hosts', () => {
    const report = analyse(
      [
        {
          url: 'https://update.googleapis.com/service/update2/json',
          method: 'POST',
          initiator: 'not an origin',
        },
        { url: 'https://surprise.example.com/', method: 'GET', initiator: 'not an origin' },
      ],
      [],
      options,
    );
    expect(report.violations).toEqual([]);
    expect(report.browserInternalHosts).toEqual(['update.googleapis.com']);
    expect(report.unknownBrowserHosts).toEqual(['surprise.example.com']);
  });

  it('passes allowlisted hosts and still flags everything else', () => {
    const report = analyse(
      [
        { url: 'https://telemetry.example.com/v1/aggregate', method: 'POST', initiator: EXT },
        { url: 'https://other.example.com/', method: 'POST', initiator: EXT },
      ],
      [],
      { ...options, allowlist: ['telemetry.example.com'] },
    );
    expect(report.violations).toEqual(['other.example.com']);
  });

  it('never lists a vendor or agent host as Chromium background traffic', () => {
    for (const host of [
      'mail.google.com',
      'calendar.google.com',
      'chatgpt.com',
      'claude.ai',
      'example.com',
    ]) {
      expect(CHROMIUM_BACKGROUND_HOSTS.has(host)).toBe(false);
    }
  });
});
