/**
 * What a red-team case sets before its logs are pasted (sprint_6 6.3): an agent's grant, in the options page as a person
 * sets one, and the spans the person was away, written into the ledger's activity store from the service worker as the
 * §2 demo's test writes one (./demo-flow.ts `writeAway`), since Chrome reports idle only live. Every value is invented.
 */
import { AGENT_NAMES, claimTypeLabel } from '../../../src/ui/labels';
import type { AttackCase, AttackGrant } from '../../redteam/attack-schema';
import type { LaunchedExtension } from './extension';
import { MINUTE_MS } from './priya';
import { FIXTURE_TIME_ZONE } from './vendor-pages';

type AwaySpan = NonNullable<AttackCase['away']>[number];

/** `grant` saved in the options page, each field filled as a person fills it. */
export async function setGrant(extension: LaunchedExtension, grant: AttackGrant): Promise<void> {
  const options = await extension.openExtensionPage('options.html');
  const name = AGENT_NAMES[grant.agent];
  const form = options.getByRole('region', { name });
  if (grant.spendCeiling !== undefined)
    await form.getByLabel('Spend ceiling').fill(String(grant.spendCeiling));
  if (grant.currency !== undefined) await form.getByLabel('Currency').selectOption(grant.currency);
  for (const type of grant.denied ?? [])
    await form.getByLabel(claimTypeLabel(type), { exact: true }).uncheck();
  if (grant.mayWriteTo !== undefined) await form.getByLabel('May write to').fill(grant.mayWriteTo.join('\n'));
  await form.getByRole('button', { name: `Save ${name}’s grant` }).click();
  await form
    .getByRole('status')
    .filter({ hasText: /^Saved\./u })
    .waitFor();
  await options.close();
}

/** `ms` as the ledger writes an instant: ISO 8601 to the second, with the fixtures' zone offset. */
function isoAt(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: FIXTURE_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  const zone = String(parts.timeZoneName);
  const offset = zone === 'GMT' ? '+00:00' : zone.replace('GMT', '');
  return `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}T${String(parts.hour)}:${String(parts.minute)}:${String(parts.second)}${offset}`;
}

/** The away `spans`, as the ledger's activity rows (src/ledger/activity.ts): id, kind, from, to and their epoch ms. */
function awayRows(spans: readonly AwaySpan[], nowMs: number) {
  return spans.map((span, index) => {
    const startMs = nowMs - span.fromMinutesAgo * MINUTE_MS;
    const endMs = nowMs - span.toMinutesAgo * MINUTE_MS;
    const id = `${'0'.repeat(62)}${index.toString(16).padStart(2, '0')}`;
    return { id, kind: 'idle', from: isoAt(startMs), to: isoAt(endMs), startMs, endMs };
  });
}

/** Writes the away `spans` into the ledger from its service worker; the ledger must exist (a page was read). */
export async function writeAway(
  extension: LaunchedExtension,
  spans: readonly AwaySpan[],
  nowMs: number,
): Promise<void> {
  if (spans.length === 0) return;
  const worker = await extension.serviceWorker();
  await worker.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('attest');
        open.onerror = () => {
          reject(new Error('the ledger did not open'));
        };
        open.onsuccess = () => {
          const tx = open.result.transaction('activity', 'readwrite');
          for (const row of rows) tx.objectStore('activity').put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error('the away spans were not stored'));
          };
        };
      }),
    awayRows(spans, nowMs),
  );
}
