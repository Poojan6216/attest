/**
 * Forged and out-of-order observer messages, in the shipped build (sprint_2 2.7; SEC-V1; Hard Rules 2, 4, 5, 6).
 * Moved here from observers.spec.ts when the service worker began checking which site an observer message comes
 * from (src/background/sender-site.ts): a message the ledger must judge now has to come from a page on its observer's
 * site, so these send it from Attest's own content-script world in a vendor tab (./support/content-world.ts), what a
 * buggy or compromised content script on that site could send.
 *  - A forged `observer.observations` (a gcal.event with merchant fields and a self-chosen contentHash) sent from a
 *    Calendar tab writes nothing and turns the observer DEGRADED until a later clean pass of it is accepted. The same
 *    message from an extension page is refused before any handler and turns nothing DEGRADED: a page on another site
 *    cannot speak for the Calendar observer, in either direction.
 *  - Two passes of one row delivered out of order from a Gmail tab: the first is stored, the second refused
 *    `late_sighting`, and the observer is DEGRADED (Hard Rules 4, 6).
 */
import { expect, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { idFromHash } from '../../src/core/hash';
import { instantMs } from '../../src/core/normalize';
import type { LedgerExport } from '../../src/ledger/export';
import { contentScriptPost } from './support/content-world';
import { type VendorSession, withVendorSession } from './support/session';
import {
  expectedObservation,
  openVendorPage,
  readLedger,
  sightingOf,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

const health = (ledger: LedgerExport, observer: string) =>
  ledger.tables.adapterHealth.find((report) => report.adapterId === observer);

const holds = (ledger: LedgerExport, hash: string): boolean =>
  ledger.tables.observations.some((row) => row.contentHash === hash);

/** A gcal.event row with merchant fields and a self-chosen contentHash: what no Calendar pass can send. */
function forgedCalendarRows(): unknown {
  const contentHash = 'ab'.repeat(32);
  return {
    type: 'observer.observations',
    observerId: 'gcal.event',
    version: '1.2.0',
    observations: [
      {
        id: idFromHash(contentHash),
        source: 'gcal.event',
        type: 'calendar.created',
        merchant: 'Acme Store',
        amountCents: 4200,
        currency: 'USD',
        occurredAt: '2026-10-08T19:00:00-04:00',
        observedAt: new Date().toISOString(),
        contentHash,
      },
    ],
  };
}

/** The forged rows (see the module comment): refused from an extension page, refused and DEGRADED from Calendar. */
async function forgedWritesNothing(session: VendorSession): Promise<void> {
  const week = vendorFixture('gcal', 'synthetic-gcal-week-before.html');
  const tab = await openVendorPage(session.extension.context, session.routes, week);
  const firstLook = week.events.map((event) => sightingOf(week, event).contentHash);
  await waitForLedger(
    session.ledgerPage,
    (state) => firstLook.every((hash) => holds(state, hash)) && health(state, 'gcal.event')?.status === 'OK',
  );
  const forged = forgedCalendarRows();
  const fromPage: unknown = await session.ledgerPage.evaluate(
    (message) => chrome.runtime.sendMessage(message),
    forged,
  );
  expect(fromPage).toEqual({ ok: false, code: 'invalid_input' });
  expect(health(await readLedger(session.ledgerPage), 'gcal.event')).toMatchObject({ status: 'OK' });

  const post = await contentScriptPost(tab, session.extension.extensionId);
  expect(await post(forged)).toEqual({ ok: false, code: 'invalid_input' });
  const ledger = await readLedger(session.ledgerPage);
  expect(holds(ledger, 'ab'.repeat(32))).toBe(false);
  expect(ledger.tables.observations.filter((row) => 'merchant' in row)).toEqual([]);
  const degraded = health(ledger, 'gcal.event');
  expect(degraded).toMatchObject({ status: 'DEGRADED', reasons: ['ledger.invalid_input'] });

  // It stays DEGRADED until a later clean pass of the same observer is fully accepted: the tab reads the week again.
  await tab.reload();
  const cleared = await waitForLedger(
    session.ledgerPage,
    (state) => health(state, 'gcal.event')?.status === 'OK',
  );
  const report = health(cleared, 'gcal.event');
  expect(instantMs(report?.checkedAt ?? '')).toBeGreaterThan(instantMs(degraded?.checkedAt ?? ''));
  expect(cleared.tables.calendarSnapshots).toHaveLength(1);
}

/** The same row twice from a Gmail tab, the later sighting delivered first. */
async function outOfOrderRefused(session: VendorSession): Promise<void> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  const tab = await openVendorPage(session.extension.context, session.routes, sent);
  const shown = sent.observations.map((fact) => expectedObservation(sent, fact).contentHash);
  await waitForLedger(session.ledgerPage, (state) => shown.every((hash) => holds(state, hash)));
  const [fact] = sent.observations;
  if (fact === undefined) throw new Error('page 1 has no observation');
  // A send the page does not show, so the tab's own passes never sight it.
  const row = expectedObservation(sent, {
    ...fact,
    subjectHint: 'Sent from elsewhere',
    rowKey: 'forged-row-key',
  });
  const now = Date.now();
  const later = new Date(now - 30_000).toISOString();
  const earlier = new Date(now - 90_000).toISOString();
  const pass = (observedAt: string) => ({
    type: 'observer.observations',
    observerId: 'gmail.sent',
    version: '1.0.0',
    observations: [{ ...row, observedAt }],
  });
  const post = await contentScriptPost(tab, session.extension.extensionId);
  expect(await post(pass(later))).toEqual({ ok: true });
  expect(await post(pass(earlier))).toEqual({ ok: false, code: 'late_sighting' });

  const ledger = await readLedger(session.ledgerPage);
  const stored = ledger.tables.observations.filter((each) => each.contentHash === row.contentHash);
  expect(stored).toHaveLength(1);
  expect(instantMs(stored[0]?.sightedAt ?? stored[0]?.observedAt ?? '')).toBe(instantMs(later));
  expect(health(ledger, 'gmail.sent')).toMatchObject({
    status: 'DEGRADED',
    reasons: ['ledger.late_sighting'],
  });
}

test.describe('forged and out-of-order observer messages (sprint_2 2.7; SEC-V1)', () => {
  test('a forged observer.observations message writes nothing and turns the observer DEGRADED', async () => {
    test.setTimeout(2 * 60_000);
    await withVendorSession(forgedWritesNothing);
  });

  test('two passes of one row delivered out of order: the first is stored, the second refused late_sighting', async () => {
    test.setTimeout(2 * 60_000);
    await withVendorSession(outOfOrderRefused);
  });
});
