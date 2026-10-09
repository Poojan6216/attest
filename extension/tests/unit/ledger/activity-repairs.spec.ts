import 'fake-indexeddb/auto';
/**
 * Times away and session pings never become false UNASKED evidence (docs/grading.md §7 positive evidence only;
 * security review SEC-1 and SEC-3; Hard Rules 5, 7):
 *  - SEC-1: a time away the browser exited during is never stretched over the next session. Chrome reports no return
 *    from it, so the first watch of the next browser session closes it as it stands (src/background/idle.ts
 *    `startIdleSession`, src/ledger/activity.ts `endOpenIdle`); a service worker that restarted inside one session
 *    leaves it open for the return Chrome will report;
 *  - SEC-3: when the clock goes back, the guard removes every session ping and time away stamped after now, cuts a
 *    time away that reaches past now, and drops the open mark of a row it removed (src/ledger/clock-guard.ts step 6).
 * Every instant is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordIdleState, type SessionArea, startIdleSession } from '../../../src/background/idle';
import { SESSION_KEYS } from '../../../src/config';
import { IsoTs } from '../../../src/core/schema';
import { activityIn, closeIdle, OPEN_IDLE, openIdle, putSessions } from '../../../src/ledger/activity';
import { guardClock, noteStoredInstant } from '../../../src/ledger/clock-guard';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getMeta } from '../../../src/ledger/repo';
import { captureLogs, pinClock, releaseClock, uniqueDbName } from './fixtures';

let db: LedgerDb;
const ms = (iso: string) => Date.parse(iso);
const at = (iso: string) => IsoTs.parse(iso);
const WHOLE = [ms('2026-10-05T00:00:00Z'), ms('2026-10-09T00:00:00Z')] as const;
const spans = async () => (await activityIn(db, ...WHOLE)).idle.map(({ from, to }) => [ms(from), ms(to)]);
const sessions = async () => (await activityIn(db, ...WHOLE)).sessions.map((session) => ms(session.at));

/** `chrome.storage.session` as one browser session holds it: empty when the browser starts. */
function browserSession(): SessionArea & { readonly items: Record<string, unknown> } {
  const items: Record<string, unknown> = {};
  return {
    items,
    get: (key) => Promise.resolve(key in items ? { [key]: items[key] } : {}),
    set: (more) => {
      Object.assign(items, more);
      return Promise.resolve();
    },
  };
}

beforeEach(async () => {
  pinClock('2026-10-08T12:00:00-04:00');
  db = await openLedger(uniqueDbName('activity-repairs'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('SEC-1: a time away the browser exited during', () => {
  it('is closed as it stands by the next browser session, which records its own times away apart', async () => {
    const monday = browserSession();
    await startIdleSession(db, monday);
    await recordIdleState(db, 'locked', ms('2026-10-06T17:00:00-04:00'));
    // Chrome exits while the screen is locked; the next day a new browser session starts with empty session storage.
    const tuesday = browserSession();
    await startIdleSession(db, tuesday);
    expect(await getMeta(db, OPEN_IDLE)).toBeUndefined();
    expect(tuesday.items[SESSION_KEYS.IDLE_SESSION]).toBe(true);
    await recordIdleState(db, 'idle', ms('2026-10-07T12:01:00-04:00'));
    await recordIdleState(db, 'active', ms('2026-10-07T12:45:00-04:00'));
    expect(await spans()).toEqual([
      [ms('2026-10-06T17:00:00-04:00'), ms('2026-10-06T17:00:00-04:00')],
      [ms('2026-10-07T12:00:00-04:00'), ms('2026-10-07T12:45:00-04:00')],
    ]);
  });

  it('stays open across a service worker restarted inside one browser session, and closes at the return', async () => {
    const session = browserSession();
    await startIdleSession(db, session);
    await recordIdleState(db, 'locked', ms('2026-10-06T17:00:00-04:00'));
    await startIdleSession(db, session);
    expect(typeof (await getMeta(db, OPEN_IDLE))).toBe('string');
    await recordIdleState(db, 'active', ms('2026-10-06T17:30:00-04:00'));
    expect(await spans()).toEqual([[ms('2026-10-06T17:00:00-04:00'), ms('2026-10-06T17:30:00-04:00')]]);
  });
});

describe('SEC-3: the clock repair and activity stamped in the future', () => {
  it('removes pings and times away after now, cuts one that reaches past now, and drops a removed open mark', async () => {
    pinClock('2026-10-07T18:00:00Z');
    await putSessions(db, 'muse', [at('2026-10-06T17:00:00Z'), at('2026-10-07T16:20:00Z')]);
    await openIdle(db, at('2026-10-06T17:30:00Z'), at('2026-10-06T17:31:00Z'));
    await closeIdle(db, at('2026-10-07T16:00:00Z'));
    await openIdle(db, at('2026-10-07T16:40:00Z'), at('2026-10-07T16:41:00Z'));
    await db.transaction('rw', db.meta, () => noteStoredInstant(db, at('2026-10-07T16:41:00Z')));
    const logs = captureLogs();
    try {
      // The clock ran a day ahead; it reads the real time again: 18:00Z on 6 October.
      await guardClock(db, ms('2026-10-06T18:00:00Z'));
    } finally {
      logs.restore();
    }
    expect(await sessions()).toEqual([ms('2026-10-06T17:00:00Z')]);
    expect(await spans()).toEqual([[ms('2026-10-06T17:30:00Z'), ms('2026-10-06T18:00:00Z')]]);
    expect(await getMeta(db, OPEN_IDLE)).toBeUndefined();
    expect(logs.records.find((record) => record.event === 'ledger.clock_activity_repaired')?.fields).toEqual({
      rowCount: 3,
    });
  });

  it('leaves every row at or before now as it was', async () => {
    pinClock('2026-10-06T18:00:00Z');
    await putSessions(db, 'muse', [at('2026-10-06T17:00:00Z')]);
    await openIdle(db, at('2026-10-06T17:30:00Z'), at('2026-10-06T17:31:00Z'));
    await db.transaction('rw', db.meta, () => noteStoredInstant(db, at('2026-10-06T19:00:00Z')));
    await guardClock(db, ms('2026-10-06T18:00:00Z'));
    expect(await sessions()).toEqual([ms('2026-10-06T17:00:00Z')]);
    expect(await spans()).toEqual([[ms('2026-10-06T17:30:00Z'), ms('2026-10-06T17:31:00Z')]]);
    expect(typeof (await getMeta(db, OPEN_IDLE))).toBe('string');
  });
});
