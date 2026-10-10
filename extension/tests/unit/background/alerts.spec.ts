import 'fake-indexeddb/auto';
/**
 * Alerts in the service worker (sprint_4 4.6; src/background/alerts.ts, src/background/grading.ts): a batch that makes a
 * receipt FINAL as OVER_SCOPE shows one notification, named by the receipt's id and worded without counterparty or
 * subject; later batches and a restarted worker show it never again; a muted agent's receipt shows none, then or after
 * unmuting; a notification Chrome refuses is logged and not retried. A click opens the side panel on that receipt in
 * the click's own turn, or the side panel's page in a tab when Chrome refuses (logged). More than ALERT_BURST at once
 * show as one notice that opens the timeline (sprint_4 close, tech review TECH-12). Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import {
  type AlertDeps,
  type AlertNotification,
  deliverAlerts,
  onAlertClicked,
  type OpenDeps,
} from '../../../src/background/alerts';
import { type ImportContext, onClaimsImport } from '../../../src/background/claims-import';
import { runGradingBatch } from '../../../src/background/grading';
import { ClaimsImportMessage } from '../../../src/bus/messages';
import { ALERT_BURST, ALERTS_NOTIFICATION_ID } from '../../../src/config';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { IsoTs } from '../../../src/core/schema';
import { alertsMutedKey } from '../../../src/ledger/agent-keys';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putGrant, setMeta } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { clockTime } from '../../../src/ui/format';
import { makeGrant, pinClock, releaseClock, ulid, uniqueDbName } from '../ledger/fixtures';

const PASTED_AT = '2026-10-08T17:00:00-04:00';
let db: LedgerDb;
let created: [string, AlertNotification][];
let alerts: AlertDeps;
let ctx: ImportContext;
let records: LogRecord[];
let restore: () => void;

function alertDeps(create: AlertDeps['notifications']['create']): AlertDeps {
  return {
    notifications: { create, clear: () => Promise.resolve(true) },
    iconUrl: () => 'chrome-extension://attest/icon/128.png',
    nowMs: () => Date.now(),
  };
}

beforeEach(async () => {
  pinClock(PASTED_AT);
  db = await openLedger(uniqueDbName('alerts-worker'));
  created = [];
  alerts = alertDeps((id, options) => {
    created.push([id, options]);
    return Promise.resolve(id);
  });
  ctx = {
    db: () => Promise.resolve(db),
    grading: {
      policy: DEFAULT_POLICY,
      policyDocument: DEFAULT_POLICY_DOCUMENT,
      nowMs: () => Date.now(),
      alerts,
    },
    notify: () => undefined,
  };
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
  // Muse may only create calendar events: an email it says it sent is OVER_SCOPE, FINAL at once.
  await putGrant(
    db,
    makeGrant({ agent: 'muse', allowedTypes: ['calendar.created'], counterpartyAllowlist: [] }),
  );
});

afterEach(() => {
  restore();
  db.close();
  releaseClock();
});

/** Muse's log of one email, sent on 6 October at 14:02. */
async function importSend(): Promise<string> {
  const read = readPastedLog(['Oct 6', 'Sent an email to sam@example.com', '2:02 pm'].join('\n'), {
    agent: 'muse',
    pastedAt: IsoTs.parse(PASTED_AT),
    offsetAt: () => -240,
  });
  if (!read.ok) throw new Error(read.refusal);
  const message = ClaimsImportMessage.parse({
    type: 'claims.import',
    agent: 'muse',
    claims: read.log.claims,
    activeAt: [],
  });
  await onClaimsImport(ctx, message);
  const [claim] = read.log.claims;
  if (claim === undefined) throw new Error('no claim');
  return claim.claimedAt;
}

const receiptIds = async () => (await db.receipts.toArray()).map(({ id }) => id);

describe('an alert', () => {
  it('is shown once for a receipt made FINAL OVER_SCOPE, and never again, a restart included', async () => {
    const claimedAt = await importSend();
    const [receiptId] = await receiptIds();
    expect(created).toEqual([
      [
        receiptId,
        {
          type: 'basic',
          iconUrl: 'chrome-extension://attest/icon/128.png',
          title: 'Over scope: Muse',
          message: `Muse said it sent an email at ${clockTime(claimedAt, Date.now())}, beyond what its grant allows.`,
          priority: 0,
        },
      ],
    ]);
    expect(JSON.stringify(created)).not.toContain('sam@example.com');
    pinClock('2026-10-08T17:10:00-04:00');
    await runGradingBatch(db, ctx.grading);
    // A worker that starts again settles what is pending: nothing.
    expect(
      await deliverAlerts(
        db,
        alertDeps(() => Promise.reject(new Error('shown twice'))),
      ),
    ).toBe(0);
    expect(created).toHaveLength(1);
    expect((await db.alerts.toArray()).map(({ state }) => state)).toEqual(['shown']);
  });

  it("is never shown for a muted agent's receipt, then or after unmuting", async () => {
    await setMeta(db, alertsMutedKey('muse'), true);
    await importSend();
    expect(created).toEqual([]);
    expect((await db.alerts.toArray()).map(({ state }) => state)).toEqual(['muted']);
    await setMeta(db, alertsMutedKey('muse'), false);
    pinClock('2026-10-08T17:10:00-04:00');
    await runGradingBatch(db, ctx.grading);
    expect(created).toEqual([]);
  });

  it('Chrome refused is logged, and not shown again', async () => {
    ctx = {
      ...ctx,
      grading: { ...ctx.grading, alerts: alertDeps(() => Promise.reject(new Error('no notification'))) },
    };
    await importSend();
    expect(records.filter(({ event }) => event === 'alerts.show_failed')).toHaveLength(1);
    expect(await deliverAlerts(db, alerts)).toBe(0);
    expect(created).toEqual([]);
  });
});

describe('a burst of alerts (TECH-12)', () => {
  it('shows one notice saying how many receipts need a look, and none of them again', async () => {
    const lines = ['Oct 6'];
    for (let n = 1; n <= ALERT_BURST + 2; n += 1)
      lines.push(`Sent an email to a${String(n)}@example.com`, `2:0${String(n)} pm`);
    const read = readPastedLog(lines.join('\n'), {
      agent: 'muse',
      pastedAt: IsoTs.parse(PASTED_AT),
      offsetAt: () => -240,
    });
    if (!read.ok) throw new Error(read.refusal);
    await onClaimsImport(
      ctx,
      ClaimsImportMessage.parse({
        type: 'claims.import',
        agent: 'muse',
        claims: read.log.claims,
        activeAt: [],
      }),
    );
    expect(created.map(([id, { title }]) => [id, title])).toEqual([
      [ALERTS_NOTIFICATION_ID, `${String(ALERT_BURST + 2)} receipts need a look`],
    ]);
    expect(await deliverAlerts(db, alerts)).toBe(0);
    expect(created).toHaveLength(1);
  });
});

describe('a click on an alert', () => {
  function openDeps(refuse = false) {
    const deps = {
      openSidePanel: vi.fn(() => (refuse ? Promise.reject(new Error('no gesture')) : Promise.resolve())),
      openTab: vi.fn(() => Promise.resolve()),
      name: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
      pageUrl: (path: string) => `chrome-extension://attest${path}`,
    } satisfies OpenDeps;
    return deps;
  }

  it('opens the side panel in its own turn, naming the receipt, and clears the alert', async () => {
    const deps = openDeps();
    onAlertClicked(ulid(1), deps);
    // Called before anything is awaited: Chrome opens a side panel only in answer to the click itself.
    expect(deps.openSidePanel).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(deps.name).toHaveBeenCalledWith(ulid(1));
    });
    expect(deps.clear).toHaveBeenCalledWith(ulid(1));
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it("opens the side panel's page in a tab when Chrome will not open the panel, and ignores an id not Attest's", async () => {
    const deps = openDeps(true);
    onAlertClicked(ulid(2), deps);
    await vi.waitFor(() => {
      expect(deps.openTab).toHaveBeenCalledWith(
        `chrome-extension://attest/sidepanel.html#receipt=${ulid(2)}`,
      );
    });
    const other = openDeps();
    onAlertClicked('some-other-notification', other);
    expect(other.openSidePanel).not.toHaveBeenCalled();
    expect(other.name).not.toHaveBeenCalled();
    expect(records.filter(({ event }) => event === 'alerts.side_panel_failed')).toHaveLength(1);
  });

  it('on the notice of a burst, opens the timeline (the side panel, or its page in a tab), naming no receipt', async () => {
    const deps = openDeps();
    onAlertClicked(ALERTS_NOTIFICATION_ID, deps);
    expect(deps.openSidePanel).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(deps.clear).toHaveBeenCalledWith(ALERTS_NOTIFICATION_ID);
    });
    expect(deps.name).not.toHaveBeenCalled();
    const refused = openDeps(true);
    onAlertClicked(ALERTS_NOTIFICATION_ID, refused);
    await vi.waitFor(() => {
      expect(refused.openTab).toHaveBeenCalledWith('chrome-extension://attest/sidepanel.html');
    });
  });
});
