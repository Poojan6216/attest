import 'fake-indexeddb/auto';
/**
 * Alerts across a stopped service worker (sprint_4 4.6 done-when: "service-worker restart does not re-fire"; qa_tester
 * priority 7; Sprint 4 QA review). The alert of a batch is queued in the batch's own transaction and shown after it, so
 * a worker Chrome stops between the two leaves a pending alert in the ledger and nothing in memory. Modelled as Chrome
 * makes it (tests/unit/background/grace-alarm.spec.ts): the ledger stays, the connection and every module's memory go
 * (a fresh import). Then:
 *  - the next worker shows that alert exactly once, even when its start's delivery (entrypoints/background.ts) and a
 *    batch's delivery (src/background/grading.ts) run at once: each settles pending alerts in its own readwrite
 *    transaction, so the second finds none;
 *  - a worker started after that shows nothing again;
 *  - a person who marked the receipt while the worker was stopped gets no alert for it.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import type { AlertDeps, AlertNotification } from '../../../src/background/alerts';
import { type ImportContext, onClaimsImport } from '../../../src/background/claims-import';
import { ClaimsImportMessage } from '../../../src/bus/messages';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { IsoTs } from '../../../src/core/schema';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putGrant } from '../../../src/ledger/repo';
import { applyUserEvent } from '../../../src/ledger/user-events';
import { setLogSink } from '../../../src/log';
import { makeGrant, pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';

const PASTED_AT = '2026-10-08T17:00:00-04:00';

let name: string;
let db: LedgerDb;
let shown: [string, AlertNotification][];
let restoreSink: () => void;

/** Chrome's notifications as a worker sees them: each one asked for is recorded. */
const alertDeps = (): AlertDeps => ({
  notifications: {
    create: (id, options) => {
      shown.push([id, options]);
      return Promise.resolve(id);
    },
    clear: () => Promise.resolve(true),
  },
  iconUrl: () => 'chrome-extension://attest/icon/128.png',
  nowMs: () => Date.now(),
});

beforeEach(async () => {
  pinClock(PASTED_AT);
  name = uniqueDbName('alerts-restart');
  db = await openLedger(name);
  shown = [];
  restoreSink = setLogSink(() => undefined);
  // Muse may only create calendar events: an email it says it sent is OVER_SCOPE, FINAL at once, and alerts.
  await putGrant(
    db,
    makeGrant({ agent: 'muse', allowedTypes: ['calendar.created'], counterpartyAllowlist: [] }),
  );
});

afterEach(() => {
  restoreSink();
  db.close();
  releaseClock();
});

/**
 * Muse's log of one email, imported and graded by a worker that stops before it shows the alert: the batch's deps carry
 * no notifications, as a batch whose delivery never ran. Returns the receipt's id.
 */
async function gradedThenStopped(): Promise<string> {
  const read = readPastedLog(['Oct 6', 'Sent an email to sam@example.com', '2:02 pm'].join('\n'), {
    agent: 'muse',
    pastedAt: IsoTs.parse(PASTED_AT),
    offsetAt: () => -240,
  });
  if (!read.ok) throw new Error(read.refusal);
  const ctx: ImportContext = {
    db: () => Promise.resolve(db),
    grading: { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() },
    notify: () => undefined,
  };
  const message = ClaimsImportMessage.parse({
    type: 'claims.import',
    agent: 'muse',
    claims: read.log.claims,
    activeAt: [],
  });
  expect(await onClaimsImport(ctx, message)).toMatchObject({ ok: true, added: 1 });
  const alerts = await db.alerts.toArray();
  expect(alerts.map(({ grade, state }) => [grade, state])).toEqual([['OVER_SCOPE', 'pending']]);
  const [alert] = alerts;
  if (alert === undefined) throw new Error('no alert');
  // Chrome stops the worker: its connection goes, the ledger stays.
  db.close();
  return alert.receiptId;
}

/** A worker started afresh: new module instances, the ledger reopened by name. */
async function freshWorker(): Promise<{
  db: LedgerDb;
  deliver: (deps: AlertDeps) => Promise<number>;
}> {
  vi.resetModules();
  const [{ deliverAlerts }, migrations, log] = await Promise.all([
    import('../../../src/background/alerts'),
    import('../../../src/ledger/migrations'),
    import('../../../src/log'),
  ]);
  log.setLogSink(() => undefined);
  const reopened = await migrations.openLedger(name);
  return { db: reopened, deliver: (deps) => deliverAlerts(reopened, deps) };
}

describe('an alert queued before the worker stopped', () => {
  it('is shown once by the next worker, though its start and a batch deliver at once, and never again', async () => {
    const receiptId = await gradedThenStopped();
    expect(shown).toEqual([]);

    const next = await freshWorker();
    const counts = await Promise.all([next.deliver(alertDeps()), next.deliver(alertDeps())]);
    expect(counts.sort()).toEqual([0, 1]);
    expect(shown.map(([id, { title }]) => [id, title])).toEqual([[receiptId, 'Over scope: Muse']]);
    expect((await next.db.alerts.toArray()).map(({ state }) => state)).toEqual(['shown']);
    next.db.close();

    const later = await freshWorker();
    expect(await later.deliver(alertDeps())).toBe(0);
    expect(shown).toHaveLength(1);
    later.db.close();
    db = await openLedger(name);
  });

  it('is never shown when the person marked the receipt while the worker was stopped', async () => {
    const receiptId = await gradedThenStopped();
    db = await openLedger(name);
    expect(
      await applyUserEvent(db, receiptId, {
        kind: 'override',
        grade: 'VERIFIED',
        reason: 'Muse may email Sam',
      }),
    ).toMatchObject({ ok: true });
    db.close();

    const next = await freshWorker();
    expect(await next.deliver(alertDeps())).toBe(0);
    expect(shown).toEqual([]);
    expect((await next.db.alerts.toArray()).map(({ state }) => state)).toEqual(['overridden']);
    next.db.close();
    db = await openLedger(name);
  });
});
