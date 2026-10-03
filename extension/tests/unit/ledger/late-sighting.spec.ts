/**
 * R3-LEDGER-1 and RP3-3 (Hard Rule 4): replay rebuilds every batch from the ledger's stored rows, so a stored
 * row's `observedAt` never changes after a batch could have read it, and no row is stored with an `observedAt` at
 * or before the instant of a batch that did not read it. Each test drives the background's write path and its
 * batches over a real ledger (./live-ledger.ts, LedgerSim per batch) and replays the export: the verifier's probes
 * r3, r7, r9, late-sighting, late-write and late-calendar, each expecting the refusal or 0 mismatches.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { receiptId } from '../../../src/core/receipt';
import { replay } from '../../../src/core/replay';
import {
  Activity,
  type Claim,
  type ClaimInput,
  type Observation,
  type ObservationInput,
} from '../../../src/core/schema';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  CLAIMS,
  OBSERVATIONS,
  OVERRIDE_AT,
  receiptIdOf,
  scenarioLedger,
  scenarioWorld,
  T1,
  T1_MS,
  T2,
  T2_MS,
} from '../../tools/attest-scenario';
import {
  buildClaim,
  buildObservation,
  isoAt,
  makeGrants,
  makePass,
  makePolicies,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  START_MS,
  type World,
} from '../../tools/attest-world';
import { captureLogs, expectLedgerError, pinClock, releaseClock, uniqueDbName } from './fixtures';
import { LiveLedger, play, sightingWrites, type Step } from './live-ledger';

let db: LedgerDb;
let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('late-sighting'));
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  db.close();
  releaseClock();
});

/** The scenario's two batches and the user's three overrides between them (tests/tools/attest-scenario.ts). */
const SCENARIO_STEPS: readonly Step[] = [
  { at: T1, kind: 'batch' },
  { at: OVERRIDE_AT, kind: 'override', id: receiptIdOf('c5'), grade: 'VERIFIED' },
  { at: OVERRIDE_AT, kind: 'override', id: receiptIdOf('c7'), grade: 'NOT_FOUND' },
  { at: OVERRIDE_AT, kind: 'override', id: receiptIdOf('u9'), grade: 'VERIFIED' },
  { at: T2, kind: 'batch' },
];

async function scenario(writes: readonly Step[] = sightingWrites(scenarioWorld())): Promise<LiveLedger> {
  const live = new LiveLedger(db, scenarioWorld());
  await play(live, [...writes, ...SCENARIO_STEPS]);
  return live;
}

async function mismatches(live: LiveLedger) {
  return (await replay(await live.snapshot())).mismatches;
}

/** `row` sighted `ms` earlier than it was. */
function earlier(row: Claim | Observation, ms: number): ClaimInput | ObservationInput {
  return { ...row, observedAt: isoAt(Date.parse(row.observedAt) - ms, 0) };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
const AFTER_T2 = isoAt(T2_MS + MS_PER_HOUR, 0);

describe('the scenario through the ledger', () => {
  it('rows written as they are sighted: the batches grade what the scenario grades; replay holds', async () => {
    const live = await scenario();
    const { snapshot } = await scenarioLedger();
    expect([...live.receipts.values()].sort(byId)).toEqual([...snapshot.receipts].sort(byId));
    const rows = await live.rows();
    expect(rows.observations.sort(byId)).toEqual([...snapshot.observations].sort(byId));
    expect(rows.claims.sort(byId)).toEqual([...snapshot.claims].sort(byId));
    expect(await mismatches(live)).toEqual([]);
  });

  it('rows written 1.5 s after they are sighted are stored at the write; replay holds', async () => {
    const live = await scenario(sightingWrites(scenarioWorld(), 1500));
    const { observations } = await live.rows();
    const o1 = observations.find((row) => row.id === OBSERVATIONS.o1.id);
    expect(Date.parse(o1?.observedAt ?? '')).toBe(Date.parse(OBSERVATIONS.o1.observedAt) + 1500);
    expect(await mismatches(live)).toEqual([]);
  });
});

describe('a late sighting never moves a stored row (R3-LEDGER-1: probes r3, r7, late-sighting)', () => {
  it('an earlier sighting of o1, after T1 graded c1 VERIFIED FINAL with it, is refused', async () => {
    const live = await scenario();
    expect(live.receipts.get(receiptIdOf('c1'))).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    const error = await expectLedgerError(
      live.write(earlier(OBSERVATIONS.o1, 30_000), AFTER_T2),
      'late_sighting',
    );
    expect(error.context).toStrictEqual({ table: 'observations', id: OBSERVATIONS.o1.id });
    const { observations } = await live.rows();
    expect(observations.find((row) => row.id === OBSERVATIONS.o1.id)).toEqual(OBSERVATIONS.o1);
    expect(await mismatches(live)).toEqual([]);
  });

  it.each(['c1', 'c2', 'c6', 'c8', 'c10'] as const)(
    'an earlier sighting of %s, landing after T2, is refused and replay holds',
    async (ref) => {
      const live = await scenario();
      const claim = CLAIMS[ref];
      // c1 re-read 30 s before its stored sighting (r3); the others read an hour before T1 (r7).
      const sighting =
        ref === 'c1' ? earlier(claim, 30_000) : { ...claim, observedAt: isoAt(T1_MS - MS_PER_HOUR) };
      await expectLedgerError(live.write(sighting, AFTER_T2), 'late_sighting');
      const { claims } = await live.rows();
      expect(claims.find((row) => row.id === claim.id)).toEqual(claim);
      expect(await mismatches(live)).toEqual([]);
    },
  );
});

describe('control: what replay reports when a stored row moves (round 2 merge, probes r3 and r7)', () => {
  it.each([
    ['o1', OBSERVATIONS.o1.id, 'c1', 'observations'],
    ['c10', CLAIMS.c10.id, 'c10', 'claims'],
  ] as const)('%s lowered in place after the batches makes replay fail', async (_ref, id, receipt, table) => {
    const live = await scenario();
    // Round 2's merge: the stored row's observedAt lowered in place, after the batches read it.
    expect(await db.table(table).update(id, { observedAt: isoAt(T1_MS - MS_PER_HOUR) })).toBe(1);
    const found = (await mismatches(live)).map((mismatch) => [mismatch.receiptId, mismatch.field]);
    expect(found).toContainEqual([receiptIdOf(receipt), 'inputsHash']);
  });
});

describe('a row sighted before a batch but written after it is stored after it (RP3-3: late-write, r9)', () => {
  it('o1 sighted before T1 but written after it: T1 graded without it, and replay agrees', async () => {
    const lateMs = T1_MS + 5 * MS_PER_MINUTE;
    const writes = sightingWrites(scenarioWorld()).map((step) =>
      step.kind === 'write' && step.row.id === OBSERVATIONS.o1.id ? { ...step, at: isoAt(lateMs) } : step,
    );
    const live = await scenario(writes);
    const { observations } = await live.rows();
    expect(Date.parse(observations.find((row) => row.id === OBSERVATIONS.o1.id)?.observedAt ?? '')).toBe(
      lateMs,
    );
    expect(live.receipts.get(receiptIdOf('c1'))).toMatchObject({
      computedAt: T1,
      grade: 'NOT_FOUND',
      state: 'FINAL',
      observationIds: [],
    });
    expect(await mismatches(live)).toEqual([]);
  });

  it('a new row sighted before T1, written after T2 by a clock that went back, is stored after T2', async () => {
    const live = await scenario();
    const t = (minutes: number) => isoAt(T1_MS - minutes * MS_PER_MINUTE);
    const fields = { type: 'email.sent', counterparty: 'zed@acme.io', subjectHint: 'nothing' } as const;
    const o42 = buildObservation(42, { ...fields, occurredAt: t(360), observedAt: t(300) });
    expect(await live.write(o42, t(60))).toEqual({ id: o42.id, inserted: true });
    const { observations } = await live.rows();
    expect(Date.parse(observations.find((row) => row.id === o42.id)?.observedAt ?? '')).toBe(T2_MS + 1);
    expect(await mismatches(live)).toEqual([]);
  });
});

const DAY_MS = START_MS + MS_PER_DAY;
const at = (hours: number, minutes = 0) => isoAt(DAY_MS + hours * MS_PER_HOUR + minutes * MS_PER_MINUTE);
const EVENT = (observedAt: string) =>
  buildObservation(1, {
    type: 'calendar.created',
    counterparty: 'priya@acme.io',
    subjectHint: 'q3 review',
    occurredAt: at(40),
    observedAt,
  });
const CALENDAR_CLAIM = buildClaim(1, {
  agent: 'muse',
  type: 'calendar.created',
  counterparty: 'priya@acme.io',
  subjectHint: 'q3 review',
  claimedAt: at(14, 2),
  targetAt: at(40),
  observedAt: at(14, 10),
});

/** Probe late-calendar: one calendar.created claim at 14:02, one Calendar pass synced at 15:50, a batch at 16:00. */
function calendarWorld(): World {
  const policies = makePolicies();
  return {
    claims: [CALENDAR_CLAIM],
    observations: [],
    grants: makeGrants(DAY_MS + 30 * MS_PER_DAY),
    passes: [makePass('gcal.event', DAY_MS + 15 * MS_PER_HOUR + 50 * MS_PER_MINUTE, 3 * MS_PER_DAY)],
    activity: Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [] }),
    batchTimes: [at(16)],
    policyAt: () => policies[0],
    policies: [policies[0]],
  };
}

describe('calendar.created and the earliest sighting (probe late-calendar, OBS-2)', () => {
  const claimReceipt = (live: LiveLedger) =>
    live.receipts.get(receiptId({ k: 'claim', claimId: CALENDAR_CLAIM.id }));

  it('out of order: the earlier pass that lands after the batch is refused loud; replay holds', async () => {
    const live = new LiveLedger(db, calendarWorld());
    await play(live, [
      { at: at(14, 10), kind: 'write', row: CALENDAR_CLAIM },
      { at: at(14, 30), kind: 'write', row: EVENT(at(14, 30)) },
      { at: at(16), kind: 'batch' },
    ]);
    expect(claimReceipt(live)).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    await expectLedgerError(live.write(EVENT(at(9)), at(16, 30)), 'late_sighting');
    expect((await live.rows()).observations).toEqual([EVENT(at(14, 30))]);
    expect(await mismatches(live)).toEqual([]);
  });

  it('in order: the event already on the calendar never verifies "created"; replay holds', async () => {
    const live = new LiveLedger(db, calendarWorld());
    await play(live, [
      { at: at(9), kind: 'write', row: EVENT(at(9)) },
      { at: at(14, 10), kind: 'write', row: CALENDAR_CLAIM },
      { at: at(14, 30), kind: 'write', row: EVENT(at(14, 30)) },
      { at: at(16), kind: 'batch' },
    ]);
    expect((await live.rows()).observations).toEqual([EVENT(at(9))]);
    const receipt = claimReceipt(live);
    expect(receipt?.grade).not.toBe('VERIFIED');
    expect(receipt?.observationIds).toEqual([]);
    expect(await mismatches(live)).toEqual([]);
  });
});
