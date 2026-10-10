/**
 * The opt-in telemetry on the built extension (sprint_5 5.7): a stand-in for the API at exactly the extension's
 * endpoint (src/config.ts TELEMETRY_ENDPOINT), registered after the route guard so it answers first, recording each
 * body and answering 204 as the API does (a browser's CORS preflight too); the switch turned on in the options page as
 * a person would; the telemetry alarm fired at once (an unpacked extension's alarm may fire within a second), its
 * firing read from the worker's own log; today's numbers sent from the options page; and the secret-seed test's plant.
 * Nothing reaches the network: the browser runs behind the dead proxy.
 */
import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { TELEMETRY_ENDPOINT } from '../../../src/config';
import type { LaunchedExtension } from './extension';

declare const chrome: WxtBrowser;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** Answers the telemetry endpoint (header); resolves the live list of the bodies POSTed to it. */
export async function stubTelemetry(context: BrowserContext): Promise<string[]> {
  const bodies: string[] = [];
  await context.route(TELEMETRY_ENDPOINT, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') bodies.push(request.postData() ?? '');
    await route.fulfill({ status: 204, headers: CORS });
  });
  return bodies;
}

/** Turns usage numbers on in the options page's Privacy section, as a person would. */
export async function turnTelemetryOn(extension: LaunchedExtension): Promise<void> {
  const options = await extension.openExtensionPage('options.html');
  const telemetry = options.getByRole('group', { name: 'Anonymous usage numbers' });
  await telemetry.getByRole('button', { name: 'Turn on usage numbers' }).click();
  await expect(telemetry.getByRole('status')).toHaveText('Usage numbers are on.');
  await options.close();
}

/** Fires the telemetry alarm at once and waits until the worker logged it fired and the alarm has ended. */
export async function fireTelemetryAlarm(worker: Worker, lines: readonly string[]): Promise<void> {
  const fired = (): number => lines.filter((line) => line.includes('"alarm":"attest.telemetry"')).length;
  const before = fired();
  await worker.evaluate(() => chrome.alarms.create('attest.telemetry', { when: Date.now() + 300 }));
  await expect.poll(fired, { timeout: 15_000 }).toBeGreaterThan(before);
  // The send runs after the log line: let it finish (a stand-in answers at once).
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

/**
 * Sends today's numbers with the options page's "Send a test payload now", the worker's clock a day ahead so the day it
 * reports is today (the session's own), and that clock put back after; resolves the payload the page showed.
 */
export async function sendTodaysNumbers(extension: LaunchedExtension): Promise<string> {
  const worker = await extension.serviceWorker();
  await worker.evaluate(() => {
    const before = Date.now.bind(Date);
    Reflect.set(globalThis, 'attestTelemetryClock', before);
    Reflect.set(Date, 'now', () => before() + 86_400_000);
  });
  try {
    const options = await extension.openExtensionPage('options.html');
    const telemetry = options.getByRole('group', { name: 'Anonymous usage numbers' });
    const shown = (await telemetry.getByLabel('The next send').textContent()) ?? '';
    await telemetry.getByRole('button', { name: 'Send a test payload now' }).click();
    await expect(telemetry.getByText(/^Sent the numbers for /u)).toBeVisible();
    return shown;
  } finally {
    await worker.evaluate(() => {
      Reflect.set(Date, 'now', Reflect.get(globalThis, 'attestTelemetryClock'));
    });
  }
}

/** The negative control's plant: `value` POSTed from an extension page to the telemetry endpoint's stand-in. */
export async function plantInTelemetry(page: Page, value: string): Promise<void> {
  await page.evaluate(([endpoint, body]) => fetch(endpoint, { method: 'POST', body }).then(() => undefined), [
    TELEMETRY_ENDPOINT,
    value,
  ] as const);
}
