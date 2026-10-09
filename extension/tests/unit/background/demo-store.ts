/**
 * The §2 demo (tests/unit/core/demo-ledger.ts) written into a real ledger as the service worker writes it, for the
 * grading batch and grace alarm tests (sprint_3 3.13): each write at its own instant, in time order.
 */
import { ensureDefaultGrants } from '../../../src/background/default-grants';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { type Claim, IsoTs } from '../../../src/core/schema';
import { recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { AT, buildDemo } from '../core/demo-ledger';
import { pinClock } from '../ledger/fixtures';

/**
 * The §2 demo's writes after `from` and up to `upTo`, as the service worker makes them, each with the clock at its
 * instant; `claims` stands for the demo's own claims (the paste path's, sprint_3 3.15). Tests write and grade in time
 * order: a clock moved back below what was stored would have the clock guard
 * delete the coverage synced "in the future" (src/ledger/clock-guard.ts), as it must.
 */
export async function storeDemo(
  db: LedgerDb,
  upTo: string,
  from = '',
  claims?: readonly Claim[],
): Promise<ReturnType<typeof buildDemo>> {
  const demo = buildDemo();
  if (from === '') await ensureDefaultGrants(db, IsoTs.parse('2026-10-06T08:00:00-04:00'));
  const steps: [string, () => Promise<unknown>][] = [
    [
      AT.museRead,
      async () => {
        for (const claim of claims ?? [demo.emailClaim, demo.calendarClaim]) await upsertClaim(db, claim);
      },
    ],
    [AT.firstLook, () => upsertObservation(db, demo.priyaRow, DEFAULT_POLICY)],
    [AT.firstLook, () => upsertObservation(db, demo.vendorRow, DEFAULT_POLICY)],
    ...demo.observers.map((entry): [string, () => Promise<unknown>] => [
      entry.lastSyncAt,
      () => recordCoverage(db, entry),
    ]),
  ];
  const due = steps.filter(
    ([at]) => (from === '' || Date.parse(at) > Date.parse(from)) && Date.parse(at) <= Date.parse(upTo),
  );
  due.sort(([a], [b]) => Date.parse(a) - Date.parse(b));
  for (const [at, write] of due) {
    pinClock(at);
    await write();
  }
  return demo;
}
