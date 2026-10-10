/**
 * Sprint 5's surfaces in the mandatory network session (Sprint 5 close, QA GAP 2; tests/e2e/network-intercept.spec.ts),
 * with both options that send off, as the session runs: the options page's Model section, Chrome's model checked where
 * the page offers it (a Chromium with no Prompt API says so at once), and an invented key saved and left off; the
 * Privacy section's usage numbers, read as the page shows them; the model-check page opened, where nothing can be
 * scored without Chrome's model; and the grace alarm fired, whose model step asks nothing with every model off. None of
 * it may reach any host. Runs after Sprint 4's surfaces, whose Delete all data would remove the key.
 */
import { expect, type Page } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { ALARM_NAMES } from '../../../src/config';
import { saveKey } from './byo-key';
import type { VendorSession } from './session';

declare const chrome: WxtBrowser;

const SURFACES_KEY = 'sk-ant-invented-surfaces-5Kq8Lm2Np';

/** Runs Sprint 5's surfaces (header); resolves the pages left open for the session's reloads. */
export async function sprint5Surfaces(session: VendorSession): Promise<Page[]> {
  const options = await session.extension.openExtensionPage('options.html');
  const model = options.getByRole('group', { name: 'Chrome’s on-device model' });
  await expect(model).toBeVisible();
  const check = model.getByRole('button', { name: 'Check Chrome’s on-device model' });
  if ((await check.count()) > 0) await check.click();
  await expect(options.getByRole('group', { name: 'Anonymous usage numbers' })).toBeVisible();
  await options.close();
  await saveKey(session.extension, SURFACES_KEY, { turnOn: false });
  const modelCheck = await session.extension.openExtensionPage('model-check.html');
  await expect(modelCheck.getByRole('heading', { name: 'Attest model check' })).toBeVisible();
  const worker = await session.extension.serviceWorker();
  await worker.evaluate((name) => chrome.alarms.create(name, { when: Date.now() + 300 }), ALARM_NAMES.GRADE);
  return [modelCheck];
}
