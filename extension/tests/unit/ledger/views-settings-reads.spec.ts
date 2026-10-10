import 'fake-indexeddb/auto';
/**
 * The two Sprint 4 page reads no unit test ran against a real ledger (Sprint 4 QA review; qa_tester rule 3): the pages'
 * own tests (tests/unit/sidepanel, tests/unit/options) use stand-in sources, so src/ledger/views.ts `sidePanelOverview`
 * (4.3) and `grantSettings` (4.4) ran only end to end.
 *  - `sidePanelOverview`: the coverage summary, the health reports, and the last batch instant (none before the first
 *    batch), read at one instant of the ledger, a small table whole and the rest by key, never a growing table whole;
 *  - `grantSettings`: every agent's grant, and an agent muted only when its stored mute is exactly `true`: a mute that
 *    is false, or a value that is no boolean, is no mute; no grant and no mute read as none.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alertsMutedKey } from '../../../src/ledger/agent-keys';
import { recordBatchInstant } from '../../../src/ledger/batch-instant';
import type { LedgerDb } from '../../../src/ledger/db';
import { lastImportKey } from '../../../src/ledger/meta-keys';
import { openLedger } from '../../../src/ledger/migrations';
import { putAdapterHealth, putCoveragePing, putGrant, setMeta } from '../../../src/ledger/repo';
import { grantSettings, sidePanelOverview } from '../../../src/ledger/views';
import { makeGrant, makeHealth, makePing, pinClock, releaseClock, uniqueDbName } from './fixtures';
import { fullScans, recordReads } from './read-recorder';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-01T12:00:00Z');
  db = await openLedger(uniqueDbName('views-settings-reads'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('sidePanelOverview', () => {
  it('reads nothing on an empty ledger, and no last batch before the first', async () => {
    expect(await sidePanelOverview(db)).toEqual({
      coverage: { coverage: [], imports: {} },
      health: [],
      lastBatchMs: null,
    });
  });

  it('reads the coverage summary, the health reports and the last batch, never a growing table whole', async () => {
    const ping = makePing();
    const health = makeHealth({ adapterId: 'gmail.sent', status: 'DEGRADED', reasons: ['selector_missing'] });
    await putCoveragePing(db, ping);
    await putAdapterHealth(db, health);
    await setMeta(db, lastImportKey('muse'), '2026-10-01T09:00:00-04:00');
    await recordBatchInstant(db, '2026-10-01T12:00:00Z');
    const recorder = await recordReads(db);
    const overview = await sidePanelOverview(db);
    expect(overview.coverage.coverage).toEqual([ping]);
    expect(overview.coverage.imports).toEqual({ muse: '2026-10-01T09:00:00-04:00' });
    expect(overview.health).toEqual([health]);
    expect(overview.lastBatchMs).toBe(Date.parse('2026-10-01T12:00:00Z'));
    expect(fullScans(recorder.reads)).toEqual([]);
  });
});

describe('grantSettings', () => {
  it('reads no grant and no mute on an empty ledger', async () => {
    expect(await grantSettings(db)).toEqual({ grants: [], muted: {} });
  });

  it('reads every grant, and a mute only where it is stored as true', async () => {
    await putGrant(db, makeGrant({ agent: 'muse' }));
    await putGrant(db, makeGrant({ agent: 'claude', allowedTypes: [] }));
    await setMeta(db, alertsMutedKey('muse'), true);
    await setMeta(db, alertsMutedKey('claude'), false);
    await setMeta(db, alertsMutedKey('dots'), 'yes');
    const recorder = await recordReads(db);
    const settings = await grantSettings(db);
    expect(settings.grants.map(({ agent }) => agent).sort()).toEqual(['claude', 'muse']);
    expect(settings.muted).toEqual({ muse: true });
    expect(fullScans(recorder.reads)).toEqual([]);
  });
});
