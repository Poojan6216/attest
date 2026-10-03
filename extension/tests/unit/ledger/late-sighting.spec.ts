/**
 * R3-LEDGER-1 and RP3-3 (Hard Rule 4): replay rebuilds every batch from the ledger's stored rows, so a stored
 * row's `observedAt` never changes after a batch could have read it, and no row is stored with an `observedAt` at
 * or before the instant of a batch that did not read it. Each test drives the background's write path and its
 * batches over a real ledger (./live-ledger.ts, LedgerSim per batch) and replays the export: the verifier's probes
 * r3, r7, r9, late-sighting, late-write and late-calendar, each expecting the refusal (an observation), the no-op
 * (a claim, whose sighting grades nothing) or 0 mismatches.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { receiptId } from '../../../src/core/receipt';
import { replay } from '../../../src/core/replay';
import {
  Activity,
  type Claim,
  type ClaimInput,
  IsoTs,
  type Observation,
  type ObservationInput,
  type Receipt,
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

/**
 * `receipt` with its override instant written in UTC. The live ledger stamps an override where it writes it, with
 * the host's offset (src/clock.ts); the scenario's LedgerSim is handed OVERRIDE_AT in UTC. Same instant, so the
 * receipts must then be equal field for field.
 */
function overrideInUtc(receipt: Receipt): Receipt {
  const { override } = receipt;
  if (override === undefined) return receipt;
  return { ...receipt, override: { ...override, at: IsoTs.parse(new Date(override.at).toISOString()) } };
}

describe('the scenario through the ledger', () => {
  it('rows written as they are sighted: the batches grade what the scenario grades; replay holds', async () => {
    const live = await scenario();
    const { snapshot } = await scenarioLedger();
    const overridden = [...live.receipts.values()].filter((receipt) => receipt.override !== undefined);
    expect(overridden.map((receipt) => Date.parse(receipt.override?.at ?? ''))).toEqual(
      [0, 1, 2].map(() => Date.parse(OVERRIDE_AT)),
    );
    expect([...live.receipts.values()].map(overrideInUtc).sort(byId)).toEqual(
      [...snapshot.receipts].map(overrideInUtc).sort(byId),
    );
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

  // A claim's sighting grades nothing (§3, §10): an earlier re-read is a no-op, never late_sighting.
  it.each(['c1', 'c2', 'c6', 'c8', 'c10'] as const)(
    'an earlier sighting of %s, landing after T2, is a no-op and replay holds',
    async (ref) => {
      const live = await scenario();
      const claim = CLAIMS[ref];
      const before = await live.rows();
      // c1 re-read 30 s before its stored sighting (r3); the others read an hour before T1 (r7).
      const sighting =
        ref === 'c1' ? earlier(claim, 30_000) : { ...claim, observedAt: isoAt(T1_MS - MS_PER_HOUR) };
      expect(await live.write(sighting, AFTER_T2)).toEqual({ id: claim.id, inserted: false });
      const after = await live.rows();
      expect(after.claims.find((row) => row.id === claim.id)).toEqual(claim);
      expect(after).toEqual(before);
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

  // The known limit (Decisions.md, SIM-2): the stored row says first seen 14:30, so the claim still verifies.
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

describe('the stamp never makes an event look first seen later than it was (SIM-2, probe repro-created)', () => {
  const WRITTEN_LATE = isoAt(DAY_MS + 14 * MS_PER_HOUR + 5 * MS_PER_MINUTE + 500);

  /** Batches at 14:05 and 16:00; the event, on the calendar since 13:50, written at `writeAt`. */
  async function created(writeAt: string): Promise<LiveLedger> {
    const live = new LiveLedger(await openLedger(uniqueDbName('created')), calendarWorld());
    await play(live, [
      { at: at(14, 5), kind: 'batch' },
      { at: writeAt, kind: 'write', row: EVENT(at(13, 50)) },
      { at: at(14, 10), kind: 'write', row: CALENDAR_CLAIM },
      { at: at(16), kind: 'batch' },
    ]);
    return live;
  }

  const graded = (live: LiveLedger) => {
    const receipt = live.receipts.get(receiptId({ k: 'claim', claimId: CALENDAR_CLAIM.id }));
    return [receipt?.grade, receipt?.ruleId, receipt?.state, receipt?.observationIds];
  };

  it('written 0.5 s after the 14:05 batch: stored with its sighting, graded as if written on time', async () => {
    const onTime = await created(at(13, 50));
    const late = await created(WRITTEN_LATE);
    try {
      expect((await onTime.rows()).observations).toEqual([EVENT(at(13, 50))]);
      const [stored] = (await late.rows()).observations;
      expect(Date.parse(stored?.observedAt ?? '')).toBe(Date.parse(WRITTEN_LATE));
      expect(stored).toEqual({ ...EVENT(at(13, 50)), observedAt: stored?.observedAt, sightedAt: at(13, 50) });
      expect(graded(late)).toEqual(graded(onTime));
      expect(graded(late)[3]).toEqual([]);
      expect(await mismatches(late)).toEqual([]);
      expect(await mismatches(onTime)).toEqual([]);
    } finally {
      onTime.db.close();
      late.db.close();
    }
  });

  it('a second sighting between the stored sighting and the stamp changes nothing; an earlier one is refused', async () => {
    const live = await created(WRITTEN_LATE);
    try {
      const before = await live.rows();
      expect(await live.write(EVENT(at(14)), at(16, 30))).toEqual({ id: EVENT(at(14)).id, inserted: false });
      await expectLedgerError(live.write(EVENT(at(13, 40)), at(16, 30)), 'late_sighting');
      expect(await live.rows()).toEqual(before);
      expect(await mismatches(live)).toEqual([]);
    } finally {
      live.db.close();
    }
  });
});
