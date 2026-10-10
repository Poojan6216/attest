/**
 * A generated Gmail Sent head of many rows (sprint_6 6.4: "Gmail fixture with 10,000 sent rows (generated)"): the
 * synthetic Sent head (./demo.ts) with its rows replaced by `count` sends, one a minute back from `newestMs`, each to an
 * invented person with a subject of its own, so every row is one observation. Served at the synthetic head's Gmail
 * address (./vendor-pages.ts `fixtureUrl`).
 */
import { readFileSync } from 'node:fs';

import { demoSentPage, type SentRow } from './demo';
import { gmailTitle, MINUTE_MS } from './priya';
import { fixtureUrl, vendorFixture } from './vendor-pages';

const SENT_HEAD = vendorFixture('gmail', 'synthetic-sent-page-1.html');
/** Gmail's message ids are hex; each row's is this plus its index. */
const FIRST_ID = 0x1a10_0000_0000_0000n;

/** The head of `count` rows, newest first, the newest at `newestMs`. */
export function bigSentPage(
  count: number,
  newestMs: number,
): { readonly url: string; readonly html: string } {
  const rows: SentRow[] = Array.from({ length: count }, (_, index) => ({
    name: `Person ${String(index)}`,
    email: `person${String(index)}@company.example`,
    subject: `Note ${String(index)}`,
    snippet: 'Invented.',
    title: gmailTitle(newestMs - index * MINUTE_MS),
    messageId: (FIRST_ID + BigInt(index)).toString(16),
  }));
  return { url: fixtureUrl(SENT_HEAD), html: demoSentPage(readFileSync(SENT_HEAD.htmlPath, 'utf8'), rows) };
}
