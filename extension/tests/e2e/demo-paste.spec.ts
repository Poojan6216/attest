/**
 * The build_spec §2 demo end to end on the built extension (sprint_3 3.16; docs/claims-import.md; docs/grading.md
 * §16.13). On Friday 9 October the person opens Gmail's Sent list (the demo's sends of Tuesday 6 October) and their
 * Calendar week (every calendar shown, no event that week), then pastes Muse's activity log of 6 October into the side panel. The shipped
 * build's own content scripts read the pages, the side panel reads the paste, and the service worker grades: exactly
 *  - VERIFIED, the email Muse said it sent to Priya, matched to the 14:02 send;
 *  - NOT_FOUND, the "Q3 review" event Muse said it created, which no Calendar view shows;
 *  - UNASKED (likely Muse), the 14:03 send to the vendor nobody claimed: Muse's log says it worked at 14:02, and away
 *    detection recorded the person away from 14:00 to 14:09;
 * all FINAL. Grace is simulated by time itself: the story is three days old, so every view synced after its grace.
 * The away interval is the one input written by the test (./support/demo.ts DEMO_AWAY): Chrome reports idle only live.
 * The export then replays exactly through `pnpm attest replay` (the Sprint 3 Gate; QA review GAP 4), and the Gmail and
 * Calendar pages saw no input event while Attest read them, imported and graded (Hard Rule 3; QA review GAP 9).
 */
import { expect, test } from '@playwright/test';
import type { LedgerExport } from '../../src/ledger/export';

import { DEMO_LOG } from './support/demo';
import { openDemoPages, writeAway } from './support/demo-flow';
import { installRecorder, recorded } from './support/input-recorder';
import { pasteActivity } from './support/paste';
import { replayExport } from './support/replay';
import { withVendorSession } from './support/session';
import { readLedger } from './support/vendor-pages';

/** Each receipt as the demo states it: grade, state, its claim, its evidence, the agent, and "likely". */
function receiptsOf(ledger: LedgerExport) {
  return ledger.tables.receipts
    .map((r) => ({
      grade: r.grade,
      state: r.state,
      claim: r.claimId ?? null,
      evidence: r.observationIds[0] ?? null,
      agent: r.agent,
      attribution: r.attribution ?? null,
    }))
    .sort((a, b) => a.grade.localeCompare(b.grade));
}

test('the §2 demo, pasted: exactly VERIFIED, NOT_FOUND and UNASKED (likely Muse), all final', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async (session) => {
    await installRecorder(session.extension.context);
    const vendorPages = await openDemoPages(session);
    await writeAway(session);
    const panel = await session.extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
    const ledger = await readLedger(session.ledgerPage);
    const rowOf = (email: string) => ledger.tables.observations.find((o) => o.counterparty === email)?.id;
    const claimOf = (type: string) => ledger.tables.claims.find((c) => c.type === type)?.id;
    const final = { state: 'FINAL', agent: 'muse' };
    expect(receiptsOf(ledger)).toEqual([
      { ...final, grade: 'NOT_FOUND', claim: claimOf('calendar.created'), evidence: null, attribution: null },
      {
        ...final,
        grade: 'UNASKED',
        claim: null,
        evidence: rowOf('vendor@supplier.example'),
        attribution: 'likely',
      },
      {
        ...final,
        grade: 'VERIFIED',
        claim: claimOf('email.sent'),
        evidence: rowOf('priya@company.example'),
        attribution: null,
      },
    ]);
    // The replay records ride with the export, and every receipt is proven again from it (exit 0 means none differ).
    expect(Object.keys(ledger.receiptInputs).sort()).toEqual(
      ledger.tables.receipts.map((r) => r.inputsHash).sort(),
    );
    const summary = replayExport(ledger);
    expect(summary).toMatch(/^ {2}reproduced {2}3$/mu);
    expect(summary).toMatch(/^ {2}mismatched {2}0$/mu);
    // Attest read, imported and graded, and never acted on the pages it read (Hard Rule 3).
    for (const page of vendorPages) expect(await recorded(page)).toEqual([]);
  });
});
