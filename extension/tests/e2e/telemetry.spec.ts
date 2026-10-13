/**
 * Sprint 5.7 Done-when, end to end on the built extension (src/telemetry/send.ts; Hard Rule 1). With telemetry off, the
 * hourly alarm sends nothing. Turned on in the options page, the popup says the numbers are on (Sprint 5 close, security
 * review SEC-1), and the alarm sends one payload, which the schema parses and
 * which is exactly what the options page showed; fired again, the alarm sends nothing more, and "Send a test payload
 * now" says that day was already sent: once a day. NetLog and the route guard see no host but the telemetry host (the
 * allowlist the mandatory test holds empty while telemetry is off grows by exactly that one host while it is on). The
 * API is a stand-in at the extension's own endpoint (./support/telemetry.ts).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { allowedHosts } from '../../src/config-network';
import { TelemetryPayload } from '../../src/telemetry/schema';
import { startFixtureServer } from '../tools/serve-fixtures';
import { recordConsole } from './support/channels';
import { launchExtension } from './support/extension';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { analyse, guardArgs, installRouteGuard } from './support/network-guard';
import { fireTelemetryAlarm, stubTelemetry, turnTelemetryOn } from './support/telemetry';
import { FIXTURE_TIME_ZONE } from './support/vendor-pages';

/** The browser part (header), NetLog on, behind the route guard and the dead proxy; the browser closed after. */
async function runSession() {
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-netlog-telemetry-'));
  const extension = await launchExtension({
    extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    const guarded = await installRouteGuard(extension.context, { fixtureOrigin: server.origin });
    const bodies = await stubTelemetry(extension.context);
    const worker = await extension.serviceWorker();
    const lines: string[] = [];
    recordConsole(worker, 'service-worker', lines);

    // Off: the alarm fires and nothing is sent.
    await fireTelemetryAlarm(worker, lines);
    expect(bodies).toEqual([]);

    // On: the popup says so (Sprint 5 close, SEC-1); the alarm sends one payload, then nothing more; the button says
    // the day was sent.
    await turnTelemetryOn(extension);
    const popup = await extension.openExtensionPage('popup.html');
    const popupSays = popup.getByText('Usage numbers are on: counts go to Attest’s server once a day.');
    await expect(popupSays).toBeVisible();
    await popup.close();
    await fireTelemetryAlarm(worker, lines);
    await expect.poll(() => bodies.length).toBe(1);
    await fireTelemetryAlarm(worker, lines);
    const options = await extension.openExtensionPage('options.html');
    const telemetry = options.getByRole('group', { name: 'Anonymous usage numbers' });
    const shown = (await telemetry.getByLabel('The usage numbers').textContent()) ?? '';
    await telemetry.getByRole('button', { name: 'Send a test payload now' }).click();
    const said = telemetry.getByText(/^Already sent the numbers for /u);
    await expect(said).toBeVisible();
    const line = (await said.textContent()) ?? '';
    await extension.close();
    const report = analyse(readNetLogRequests(dir), guarded, {
      fixtureOrigin: server.origin,
      allowlist: allowedHosts({ telemetry: true, byo: null }),
    });
    return { bodies, shown, line, report, guarded };
  } finally {
    await extension.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('telemetry: nothing while off; on, one payload a day, the one the page showed, to its one host', async () => {
  test.setTimeout(3 * 60_000);
  const { bodies, shown, line, report, guarded } = await runSession();
  expect(bodies).toHaveLength(1);
  const [body] = bodies;
  const sent = TelemetryPayload.parse(JSON.parse(body ?? ''));
  // The page showed exactly what went.
  expect(JSON.parse(shown)).toEqual(sent);
  expect(line).toBe(`Already sent the numbers for ${sent.dayBucket}: Attest sends one day once.`);
  expect(report.violations).toEqual([]);
  expect(report.unknownBrowserHosts).toEqual([]);
  expect(guarded).toEqual([]);
});
