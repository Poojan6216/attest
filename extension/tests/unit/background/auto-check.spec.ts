import 'fake-indexeddb/auto';
/**
 * Auto-check Gmail (sprint_4 4.9; src/background/auto-check.ts, src/ledger/auto-check.ts), in the shipped policy
 * (`graceMin` 30: a claim is due 15 minutes after Attest read it). Off: nothing opens, ever. On, with the Gmail reader
 * on: an `email.sent` claim PENDING and unmarked, read 15 minutes ago, with no Gmail Sent list read since, opens
 * Gmail's Sent folder in one pinned, active tab in the window last used, recorded after it opened; nothing more opens
 * for 30 minutes, and a claim due at an open never opens another. A property holds it over random runs. Every value is
 * invented.
 */
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  type AutoCheckBrowser,
  type AutoCheckDeps,
  autoCheckGmail,
  autoCheckWaitMs,
  claimsDue,
} from '../../../src/background/auto-check';
import type { LedgerTable } from '../../../src/bus/messages';
import { AUTO_CHECK_URL, STORAGE_KEYS } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { type AutoCheckInputs, type CheckingEmailClaim, readAutoCheck } from '../../../src/ledger/auto-check';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putCoveragePing, putReceipt, upsertClaim } from '../../../src/ledger/repo';
import { IsoTs, type ReceiptInput, Ulid } from '../../../src/ledger/types';
import { type LogRecord, setLogSink } from '../../../src/log';
import {
  claimId,
  makeClaim,
  makePing,
  makeReceipt,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from '../ledger/fixtures';

const MINUTE = 60_000;
/** When the test's claim 1 was read. */
const READ_AT = '2026-10-01T10:30:00-04:00';
const READ_MS = Date.parse(READ_AT);
const WAIT_MS = 15 * MINUTE;
const WINDOW_MS = 30 * MINUTE;

let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;
let opened: { windowId: number; url: string }[];
let windowId: number | null;
let announced: (readonly LedgerTable[])[];
let nowMs: number;

const tabs: AutoCheckBrowser = {
  visibleWindow: () => Promise.resolve(windowId),
  openPinned: (id, url) => {
    opened.push({ windowId: id, url });
    return Promise.resolve();
  },
};

function deps(overrides: Partial<AutoCheckDeps> = {}): AutoCheckDeps {
  return {
    db: () => Promise.resolve(db),
    storage: browser.storage.local,
    policy: DEFAULT_POLICY,
    nowMs: () => nowMs,
    browser: tabs,
    notify: (tables) => {
      announced.push(tables);
    },
    ...overrides,
  };
}

beforeEach(async () => {
  pinClock();
  fakeBrowser.reset();
  db = await openLedger(uniqueDbName('auto-check'));
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
  opened = [];
  windowId = 7;
  announced = [];
  nowMs = READ_MS + WAIT_MS;
});

afterEach(() => {
  restore();
  db.close();
  releaseClock();
});

const turnOn = () => browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { ATTEST_AUTO_CHECK_GMAIL: true } });

type ClaimFields = Partial<Parameters<typeof makeClaim>[0]>;

/** The receipt of a claim still checking: PENDING, UNVERIFIABLE for now, final from 22:00. */
const PENDING_RECEIPT: Partial<ReceiptInput> = {
  grade: 'UNVERIFIABLE',
  ruleId: 'pending',
  reasons: [{ code: 'coverage.none', params: { source: 'gmail.sent' } }],
  observationIds: [],
  state: 'PENDING',
  finalFrom: '2026-10-01T22:00:00-04:00',
};

/** The same receipt made FINAL. */
const FINAL_RECEIPT: Partial<ReceiptInput> = {
  ...omit(PENDING_RECEIPT, 'finalFrom'),
  state: 'FINAL',
  finalAt: '2026-10-01T22:00:00-04:00',
};

/** The same receipt marked by the person while it was still checking. */
const MARKED_RECEIPT: Partial<ReceiptInput> = {
  ...omit(PENDING_RECEIPT, 'finalFrom'),
  state: 'USER_OVERRIDDEN',
  override: {
    grade: 'VERIFIED',
    reason: 'Sent it myself',
    at: '2026-10-01T10:40:00-04:00',
    previousState: 'PENDING',
  },
  reasons: [
    { code: 'coverage.none', params: { source: 'gmail.sent' } },
    { code: 'override.user', params: { grade: 'VERIFIED' } },
  ],
};

/** Claim `n` (rawHash `sha(n)`), read at `observedAt`, with its receipt. */
async function claim(
  n: number,
  observedAt: string,
  fields: ClaimFields = {},
  receipt: Partial<ReceiptInput> = PENDING_RECEIPT,
): Promise<void> {
  await upsertClaim(db, makeClaim({ rawHash: sha(n), observedAt, ...fields }));
  await putReceipt(db, makeReceipt({ id: ulid(300 + n), claimId: claimId(n), ...receipt }));
}

const minutesAfterRead = (minutes: number) => new Date(READ_MS + minutes * MINUTE).toISOString();

describe('when the person has not turned it on', () => {
  it('opens nothing, however long a claim has waited unseen', async () => {
    await claim(1, READ_AT);
    for (const after of [WAIT_MS, WINDOW_MS, 24 * 60 * MINUTE]) {
      nowMs = READ_MS + after;
      expect(await autoCheckGmail(deps())).toBe(0);
    }
    expect(opened).toEqual([]);
    expect(await readAutoCheck(db)).toBeNull();
  });

  it('opens nothing while the Gmail reader is off', async () => {
    await turnOn();
    await browser.storage.local.set({ [STORAGE_KEYS.READERS_OFF]: ['gmail'] });
    await claim(1, READ_AT);
    expect(await autoCheckGmail(deps())).toBe(0);
    expect(opened).toEqual([]);
  });
});

describe('when it is on', () => {
  beforeEach(turnOn);

  it('opens the Sent folder once, pinned and active in the window last used, and records why', async () => {
    await claim(1, READ_AT);
    await claim(2, minutesAfterRead(-5), { agent: 'claude' });
    nowMs = READ_MS + WAIT_MS - 1;
    expect(await autoCheckGmail(deps())).toBe(1);
    expect(opened).toEqual([{ windowId: 7, url: AUTO_CHECK_URL }]);
    expect(AUTO_CHECK_URL).toBe('https://mail.google.com/mail/u/0/#sent');
    const record = await readAutoCheck(db);
    expect(record).toMatchObject({ claims: 1, agents: ['claude'] });
    expect(Date.parse(record?.at ?? '')).toBe(nowMs);
    expect(Date.parse(record?.until ?? '')).toBe(nowMs + WINDOW_MS);
    expect(announced).toEqual([['meta']]);
    expect(records.filter(({ event }) => event === 'autocheck.opened').map(({ fields }) => fields)).toEqual([
      { claims: 1 },
    ]);
  });

  it('opens nothing more within the window, nor later for a claim due at the open', async () => {
    await claim(1, READ_AT);
    expect(await autoCheckGmail(deps())).toBe(1);
    for (const after of [WAIT_MS + 5 * MINUTE, WAIT_MS + WINDOW_MS, 6 * 60 * MINUTE]) {
      nowMs = READ_MS + after;
      expect(await autoCheckGmail(deps())).toBe(0);
    }
    await claim(2, minutesAfterRead(WINDOW_MS / MINUTE));
    nowMs = READ_MS + WINDOW_MS + WAIT_MS;
    expect(await autoCheckGmail(deps())).toBe(1);
    expect(opened).toHaveLength(2);
  });

  it('opens one tab for every claim due at once', async () => {
    await claim(1, READ_AT);
    await claim(2, minutesAfterRead(-10), { agent: 'claude' });
    await claim(3, minutesAfterRead(-20));
    expect(await autoCheckGmail(deps())).toBe(3);
    expect(opened).toHaveLength(1);
    expect(await readAutoCheck(db)).toMatchObject({ claims: 3, agents: ['muse', 'claude'] });
  });
});

describe('when it is on, what holds a tab back', () => {
  beforeEach(turnOn);

  it.each<[string, { at?: string; fields?: ClaimFields; receipt?: Partial<ReceiptInput> }]>([
    ['a claim not 15 minutes old', { at: minutesAfterRead(1) }],
    ['a claim of another type', { fields: { type: 'calendar.created', targetAt: READ_AT } }],
    ['a FINAL receipt', { receipt: FINAL_RECEIPT }],
    ['a receipt the person marked', { receipt: MARKED_RECEIPT }],
  ])('opens nothing for %s', async (_label, { at = READ_AT, fields = {}, receipt = PENDING_RECEIPT }) => {
    await claim(1, at, fields, receipt);
    expect(await autoCheckGmail(deps())).toBe(0);
    expect(opened).toEqual([]);
  });

  it('opens nothing when a Gmail Sent list was read since Attest read the claim, and does for an older one', async () => {
    await claim(1, READ_AT);
    await putCoveragePing(
      db,
      makePing({ lastSyncAt: minutesAfterRead(-1), windowEnd: minutesAfterRead(-1) }),
    );
    await putCoveragePing(
      db,
      makePing({
        observerId: 'gmail.receipt',
        source: 'gmail.receipt',
        lastSyncAt: minutesAfterRead(5),
        windowStart: minutesAfterRead(5),
        windowEnd: minutesAfterRead(5),
      }),
    );
    expect(await autoCheckGmail(deps())).toBe(1);
    await claim(2, minutesAfterRead(WINDOW_MS / MINUTE));
    await putCoveragePing(
      db,
      makePing({ lastSyncAt: minutesAfterRead(31), windowEnd: minutesAfterRead(31) }),
    );
    nowMs = READ_MS + WINDOW_MS + WAIT_MS;
    expect(await autoCheckGmail(deps())).toBe(0);
    expect(opened).toHaveLength(1);
  });
});

describe('when it is on, and Chrome or the clock gets in the way', () => {
  beforeEach(turnOn);

  it('waits for a window it can be seen in, records nothing meanwhile, and opens there', async () => {
    await claim(1, READ_AT);
    windowId = null;
    expect(await autoCheckGmail(deps())).toBe(0);
    expect(await readAutoCheck(db)).toBeNull();
    expect(records.filter(({ event }) => event === 'autocheck.no_window')).toHaveLength(1);
    windowId = 3;
    nowMs += 5 * MINUTE;
    expect(await autoCheckGmail(deps())).toBe(1);
    expect(opened).toEqual([{ windowId: 3, url: AUTO_CHECK_URL }]);
  });

  it('records nothing when the tab did not open, and logs it without detail', async () => {
    await claim(1, READ_AT);
    const failing: AutoCheckBrowser = {
      visibleWindow: () => Promise.resolve(1),
      openPinned: () => Promise.reject(new Error('No window with id: 1 at https://mail.google.com')),
    };
    expect(await autoCheckGmail(deps({ browser: failing }))).toBe(0);
    expect(await readAutoCheck(db)).toBeNull();
    expect(records.map(({ event }) => event)).toEqual(['autocheck.failed']);
    expect(JSON.stringify(records)).not.toContain('mail.google');
  });

  it('runs one check at a time: two at once open one tab', async () => {
    await claim(1, READ_AT);
    expect(await Promise.all([autoCheckGmail(deps()), autoCheckGmail(deps())])).toEqual([1, 0]);
    expect(opened).toHaveLength(1);
  });

  it('is held back by no record from a later instant than now: the clock went back', async () => {
    await claim(1, READ_AT);
    nowMs = READ_MS + 10 * 60 * MINUTE;
    expect(await autoCheckGmail(deps())).toBe(1);
    await claim(2, minutesAfterRead(30));
    nowMs = READ_MS + 30 * MINUTE + WAIT_MS;
    expect(await autoCheckGmail(deps())).toBe(2);
    expect(opened).toHaveLength(2);
  });
});

/** One open the simulation made: when, and for which claims. */
interface Open {
  readonly atMs: number;
  readonly due: readonly CheckingEmailClaim[];
  readonly gmailSyncMs: number | null;
}

/**
 * The grace alarm every 5 minutes for 7 hours, over claims read `readMin` minutes after READ_AT and Gmail Sent lists
 * read at `syncs` minutes, each due claim opening a tab that is recorded as the service worker records it.
 */
function simulate(readMins: readonly number[], syncs: readonly number[]): Open[] {
  let last: AutoCheckInputs['last'] = null;
  const opens: Open[] = [];
  for (let minute = 0; minute <= 420; minute += 5) {
    const now = READ_MS + minute * MINUTE;
    const synced = syncs.filter((at) => at <= minute).map((at) => READ_MS + at * MINUTE);
    const inputs: AutoCheckInputs = {
      claims: readMins
        .map((readMin, index) => ({
          id: Ulid.parse(ulid(index + 1)),
          agent: 'muse' as const,
          observedMs: READ_MS + readMin * MINUTE,
        }))
        .filter(({ observedMs }) => observedMs <= now),
      gmailSyncMs: synced.length === 0 ? null : Math.max(...synced),
      last,
    };
    const due = claimsDue(inputs, now, DEFAULT_POLICY);
    if (due.length === 0) continue;
    opens.push({ atMs: now, due, gmailSyncMs: inputs.gmailSyncMs });
    last = {
      at: IsoTs.parse(new Date(now).toISOString()),
      until: IsoTs.parse(new Date(now + WINDOW_MS).toISOString()),
      claims: due.length,
      agents: ['muse'],
    };
  }
  return opens;
}

describe('claimsDue, over random runs of the grace alarm', () => {
  it('opens at most once a window, at most once a claim, and only for a claim due', () => {
    const readMins = fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 1, maxLength: 12 });
    const syncs = fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 6 });
    fc.assert(
      fc.property(readMins, syncs, (reads, synced) => {
        const opens = simulate(reads, synced);
        opens.slice(1).forEach((open, index) => {
          expect(open.atMs - (opens[index]?.atMs ?? 0)).toBeGreaterThanOrEqual(WINDOW_MS);
        });
        for (const { atMs, due, gmailSyncMs } of opens) {
          for (const { observedMs } of due) {
            expect(atMs - observedMs).toBeGreaterThanOrEqual(WAIT_MS);
            expect(gmailSyncMs === null || gmailSyncMs < observedMs).toBe(true);
          }
        }
        const ids = opens.flatMap(({ due }) => due.map(({ id }) => id));
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });

  it('waits half the grace', () => {
    expect(autoCheckWaitMs(DEFAULT_POLICY)).toBe((DEFAULT_POLICY.windows.graceMin * MINUTE) / 2);
    expect(autoCheckWaitMs(DEFAULT_POLICY)).toBe(WAIT_MS);
  });
});
