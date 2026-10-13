/**
 * The extension connects to its own hosts only (Sprint 5 close, security review SEC-3; Hard Rules 1 and 9;
 * wxt.config.ts `connectSources`): its content security policy lists the extension itself, the two model vendors'
 * endpoints and the telemetry host. On the built extension, a fetch from the service worker or an extension page to
 * any other host fails before a request is made, so neither the route guard nor NetLog sees one; a WebSocket fails so
 * too, even to a listed host (a `https:` source does not cover `wss:`); and an allowed host that answers with a
 * redirect to another host is refused at the redirect, even by a call that follows redirects. The telemetry endpoint
 * answers through a stand-in; nothing reaches the network (the dead proxy).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { allowedHosts, BYO_VENDORS, TELEMETRY_ENDPOINT } from '../../src/config-network';
import { startFixtureServer } from '../tools/serve-fixtures';
import { launchExtension } from './support/extension';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { analyse, guardArgs, installRouteGuard } from './support/network-guard';
import { FIXTURE_TIME_ZONE } from './support/vendor-pages';

const ELSEWHERE = 'csp-canary.example.com';
const REDIRECT_TARGET = 'redirect-target.example.com';
const VENDOR = new URL(BYO_VENDORS.anthropic.endpoint).host;

/** A WebSocket opened in the worker to `url`, and whether it opened or was refused. */
const socketTo = (url: string): Promise<'opened' | 'refused'> =>
  new Promise((resolve) => {
    try {
      const socket = new WebSocket(url);
      socket.onopen = () => {
        resolve('opened');
      };
      socket.onerror = () => {
        resolve('refused');
      };
    } catch {
      resolve('refused');
    }
  });

/** A fetch made in a page or worker, and whether it came back or was refused. */
const attempt = (url: string): Promise<'answered' | 'refused'> =>
  fetch(url, { method: 'POST', body: '{}' }).then(
    () => 'answered' as const,
    () => 'refused' as const,
  );

test('the extension can reach its own hosts only, a redirect’s target included', async () => {
  test.setTimeout(3 * 60_000);
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-netlog-csp-'));
  const extension = await launchExtension({
    extraArgs: (n) => guardArgs(netLogPathFor(dir, n)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    const guarded = await installRouteGuard(extension.context, { fixtureOrigin: server.origin });
    // The telemetry endpoint answers with a redirect to another host (registered after the guard, so it answers first).
    await extension.context.route(TELEMETRY_ENDPOINT, (route) =>
      route.fulfill({
        status: 307,
        headers: { location: `https://${REDIRECT_TARGET}/attest`, 'access-control-allow-origin': '*' },
      }),
    );
    const worker = await extension.serviceWorker();
    const options = await extension.openExtensionPage('options.html');
    const outcomes = {
      worker: await worker.evaluate(attempt, `https://${ELSEWHERE}/from-worker`),
      page: await options.evaluate(attempt, `https://${ELSEWHERE}/from-page`),
      redirected: await worker.evaluate(attempt, TELEMETRY_ENDPOINT),
      socketElsewhere: await worker.evaluate(socketTo, `wss://${ELSEWHERE}/socket`),
      socketToVendor: await worker.evaluate(socketTo, `wss://${VENDOR}/socket`),
    };
    await extension.close();
    const report = analyse(readNetLogRequests(dir), guarded, {
      fixtureOrigin: server.origin,
      allowlist: allowedHosts({ telemetry: true, byo: null }),
    });
    expect(outcomes).toEqual({
      worker: 'refused',
      page: 'refused',
      redirected: 'refused',
      socketElsewhere: 'refused',
      socketToVendor: 'refused',
    });
    const hosts = report.attributed.map(({ host }) => host);
    expect(hosts).not.toContain(ELSEWHERE);
    expect(hosts).not.toContain(REDIRECT_TARGET);
    expect(hosts).not.toContain(VENDOR);
    expect(guarded.map(({ url }) => new URL(url).host)).not.toContain(REDIRECT_TARGET);
    expect(report.violations).toEqual([]);
  } finally {
    await extension.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
