/**
 * The side panel's Add agent activity as a person uses it (sprint_3 3.12, 3.13; docs/claims-import.md §2), for the
 * end-to-end tests and the launch's pictures: choose the agent, paste, preview; then import, and wait for the service
 * worker's answer. The two halves are apart so the demo can show the preview before the import (Sprint 7 close, tech
 * review TECH-7), on the same steps every test takes.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import type { Seed } from './leaks';

/** Pastes `log` as `agent`'s activity and previews it; resolves the import button the preview shows. */
export async function previewActivity(page: Page, agent: string, log: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add agent activity' }).click();
  await page.getByRole('radio', { name: agent }).check();
  await page.getByLabel('Activity log').fill(log);
  await page.getByRole('button', { name: 'Preview' }).click();
  const importButton = page.getByRole('button', { name: /^Import \d+ claims?$/u });
  await expect(importButton).toBeVisible();
  return importButton;
}

/** Imports what was previewed, by its `importButton`; resolves the status line the side panel shows after. */
export async function importActivity(page: Page, importButton: Locator): Promise<string> {
  await importButton.click();
  // The panel's other status lines (the timeline loading, an empty timeline) are not the import's: its line is the one
  // that says what was imported.
  const status = page.getByRole('status').filter({ hasText: /^(?:Imported \d+|Attest already had)/u });
  await expect(status).toBeVisible({ timeout: 30_000 });
  return (await status.textContent()) ?? '';
}

/** Pastes `log` as `agent`'s activity and imports it; resolves the status line the side panel shows after. */
export async function pasteActivity(page: Page, agent: string, log: string): Promise<string> {
  return importActivity(page, await previewActivity(page, agent, log));
}

/**
 * The instant `minutesAgo` before now as a log writes a dated time ("Oct 8, 4:33 pm"), in `timeZone` (the browser's,
 * which the side panel reads it in): always before the paste, whatever time of day the suite runs.
 */
export function datedClock(minutesAgo: number, timeZone: string): string {
  return clockAt(Date.now() - minutesAgo * 60_000, timeZone);
}

/** The instant `ms` as a log writes a dated time ("Oct 8, 4:33 pm"), in `timeZone`. */
export function clockAt(ms: number, timeZone: string): string {
  const at = new Date(ms);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(at)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.month ?? ''} ${parts.day ?? ''}, ${parts.hour ?? ''}:${parts.minute ?? ''} ${(parts.dayPeriod ?? '').toLowerCase()}`;
}

/** Sentences that each report one action and hold no seed: the claims of a seeded log. */
const ACTIONS = [
  'Sent an email to sam@example.com',
  'Created event "Design review" for Friday',
  'Unsubscribed you from the newsletter',
];

/**
 * A pasted log in Muse's shape whose every seed sits on a line of its own, as a title or a remark beside an action:
 * where a pasted log carries what must never be stored (Hard Rule 2). No seed reads as a claim, so a seed found in
 * any channel afterwards is a leak.
 */
export function seededLog(seeds: readonly Seed[], timeZone: string): string {
  const lines: string[] = [];
  seeds.forEach((seed, index) => {
    lines.push(seed.value);
    if (index % 6 === 5 || index === seeds.length - 1) {
      lines.push(ACTIONS[Math.floor(index / 6) % ACTIONS.length] ?? 'Searched for flights to Denver');
      lines.push(datedClock(40 - index, timeZone));
    }
  });
  return lines.join('\n');
}
