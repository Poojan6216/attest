/**
 * Replay of UNASKED receipts (docs/grading.md §3 orphans, §9; Hard Rule 4: replaying the ledger must reproduce every
 * receipt). An orphan is an observation from a source the policy lists for its type (§6.1 relevant sources, the rule
 * a claim's candidates obey, §4.1) whose `occurredAt` lies in a window of its own source (§3). gradeBatch and replay
 * read that rule from one predicate (batch-orphans.ts `isOrphanCandidate`): a row from a source the policy does not
 * list for its type neither verifies a claim nor accuses an agent (Hard Rule 5; Sprint 1 close), and a stored
 * UNASKED receipt for one is reported `uncovered`.
 *
 * Each ledger is graded by gradeBatch exactly as batch-orphans.spec.ts grades it, then replayed.
 */
import { describe, expect, it } from 'vitest';

import { attribute } from '../../../src/core/attribution';
import { gradeBatch } from '../../../src/core/batch';
import { isOrphanCandidate, seenWindows } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { grade } from '../../../src/core/grade';
import { loadPolicy } from '../../../src/core/policy';
import { type LedgerSnapshot, type ReceiptInputs, replay } from '../../../src/core/replay';
import type { Observation } from '../../../src/core/schema';
import { buildScenario, type LoadedScenario } from '../../golden/load';
import { Scenario } from '../../golden/scenario-schema';

/** The constants of batch-orphans.spec.ts. */
const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const GMAIL = {
  source: 'gmail.sent',
  lastSyncAt: EVALUATED_AT,
  windowStart: '2026-10-06T12:00:00-04:00',
  windowEnd: EVALUATED_AT,
  accountHash: 'acct-a',
} as const;
const CALENDAR = { ...GMAIL, source: 'gcal.event', allCalendars: true } as const;
const MUSE_ACTIVE = {
  sessions: [{ agent: 'muse', at: '2026-10-06T14:00:00-04:00' }],
  idle: [{ from: '2026-10-06T13:55:00-04:00', to: '2026-10-06T14:10:00-04:00' }],
  adapterSyncs: [{ agent: 'muse', lastSyncAt: '2026-10-06T14:50:00-04:00' }],
} as const;
const ORPHAN = {
  ref: 'o1',
  source: 'gmail.sent',
  type: 'email.sent',
  counterparty: 'vendor@supplier.example',
  subjectHint: 'Re: invoice',
  occurredAt: '2026-10-06T14:03:00-04:00',
} as const;
/** muse's claim of the send ORPHAN records. */
const CLAIM = {
  ref: 'c1',
  agent: 'muse',
  type: 'email.sent',
  counterparty: 'vendor@supplier.example',
  subjectHint: 'Re: invoice',
  claimedAt: '2026-10-06T14:03:00-04:00',
  observedAt: '2026-10-06T14:20:00-04:00',
} as const;

function load(input: Record<string, unknown>, policyPatch: Record<string, unknown> = {}): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'replay orphans unit',
    covers: ['test:replay'],
    mode: 'batch',
    policyPatch,
    input: {
      evaluatedAt: EVALUATED_AT,
      claims: [],
      observations: [],
      grants: [{ agent: 'muse' }],
      coverage: [],
      ...input,
    },
    expect: [],
  });
  return buildScenario('replay-orphans.spec.json', scenario);
}

/** The ledger one gradeBatch call over `loaded` stores: its receipts, their inputs, its policy (§9). */
async function ledgerOf(loaded: LoadedScenario): Promise<LedgerSnapshot> {
  const policy = loadPolicy(loaded.policyJson);
  const observations = [...loaded.observations.values()];
  const { batchClaims, grants, coverage, activity, fixed } = loaded;
  const index = createMemoryIndex(observations, 15);
  const graded = await gradeBatch(batchClaims, index, grants, policy, coverage, activity, fixed);
  const receiptInputs = new Map<string, ReceiptInputs>(
    graded.map(({ receipt, inputs }) => [receipt.inputsHash, { coverage, ...inputs }]),
  );
  return {
    claims: [...loaded.claims.values()],
    observations,
    receipts: graded.map((entry) => entry.receipt),
    receiptInputs,
    policies: new Map([[policy.policyHash, policy]]),
  };
}

function observation(loaded: LoadedScenario, ref: string): Observation {
  const found = loaded.observations.get(ref);
  if (found === undefined) throw new Error(`no observation ${ref}`);
  return found;
}

/** [grade, observation id] of every stored receipt. */
const graded = (ledger: LedgerSnapshot) => ledger.receipts.map((r) => [r.grade, r.observationIds[0]]);

/** Both sources listed for email.sent: a gcal.event row is then a relevant source of the type. */
const BOTH_SOURCES = { sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } };

describe('a row from a source the policy does not list for its type is never an orphan (§3)', () => {
  it('an email.sent row from the calendar observer: no UNASKED receipt, and the empty ledger replays', async () => {
    const loaded = load({
      observations: [{ ...ORPHAN, ref: 'o2', source: 'gcal.event' }],
      coverage: [CALENDAR, GMAIL],
      activity: MUSE_ACTIVE,
    });
    const ledger = await ledgerOf(loaded);
    expect(graded(ledger)).toEqual([]);
    expect(await replay(ledger)).toMatchObject({ receipts: 0, mismatched: 0, mismatches: [] });
  });

  it('a purchase.made row read from gmail.sent (the review probe): no UNASKED receipt', async () => {
    // A gmail.sent row holds gmail.sent's allowlisted fields only (the golden loader hashes those, as project does).
    const purchase = { ...ORPHAN, type: 'purchase.made' };
    const loaded = load({ observations: [purchase], coverage: [GMAIL], activity: MUSE_ACTIVE });
    expect(graded(await ledgerOf(loaded))).toEqual([]);
  });

  it('is an orphan under a policy listing both sources, and replays: each row reads its own window', async () => {
    const loaded = load(
      {
        observations: [ORPHAN, { ...ORPHAN, ref: 'o2', source: 'gcal.event' }],
        coverage: [CALENDAR],
        activity: MUSE_ACTIVE,
      },
      BOTH_SOURCES,
    );
    const ledger = await ledgerOf(loaded);
    expect(graded(ledger)).toEqual([['UNASKED', observation(loaded, 'o2').id]]);
    expect(await replay(ledger)).toMatchObject({ receipts: 1, reproduced: 1, mismatched: 0 });
  });
});

describe('a claim whose only matching row comes from an unlisted source keeps its own grade', () => {
  it('NOT_FOUND for the claim, no UNASKED for the row that the same agent reported, and it replays', async () => {
    // The stray-claim probe: muse claims the 14:03 send; the only matching row is an email.sent row from gcal.event.
    // Both windows cover 14:03 and muse's session plus the user's idleness score the row 7/10.
    const input = {
      claims: [CLAIM],
      observations: [{ ...ORPHAN, ref: 'o2', source: 'gcal.event' }],
      coverage: [GMAIL, CALENDAR],
      activity: MUSE_ACTIVE,
    };
    const loaded = load(input);
    const ledger = await ledgerOf(loaded);
    const claimId = loaded.claims.get('c1')?.id;
    expect(
      ledger.receipts.map((r) => [r.claimId === claimId ? 'c1' : r.id, r.grade, r.state, r.observationIds]),
    ).toEqual([['c1', 'NOT_FOUND', 'FINAL', []]]);
    expect(await replay(ledger)).toMatchObject({ receipts: 1, reproduced: 1, mismatched: 0 });
    // Under a policy listing gcal.event for email.sent, the same row verifies the claim instead.
    const both = await ledgerOf(load(input, BOTH_SOURCES));
    expect(both.receipts.map((r) => [r.grade, r.observationIds])).toEqual([
      ['VERIFIED', [observation(loaded, 'o2').id]],
    ]);
  });
});

describe('replay of a stored UNASKED receipt that is no orphan by §3 reports `uncovered`', () => {
  it('for a row from a source the policy does not list for its type (a receipt gradeBatch never issues)', async () => {
    const stray = { ...ORPHAN, ref: 'o2', source: 'gcal.event' };
    const loaded = load({ observations: [stray], coverage: [CALENDAR], activity: MUSE_ACTIVE });
    const policy = loadPolicy(loaded.policyJson);
    const o2 = observation(loaded, 'o2');
    const attribution = attribute(o2, loaded.activity, policy, EVALUATED_AT);
    if (attribution === null) throw new Error('muse is likely');
    const [grant] = loaded.grants;
    if (grant === undefined) throw new Error('one grant');
    const context = { priorSpendCents: 0, attribution };
    const receipt = grade(null, [o2], grant, policy, loaded.coverage, context);
    expect(receipt.grade).toBe('UNASKED');
    const report = await replay({
      claims: [],
      observations: [o2],
      receipts: [receipt],
      receiptInputs: new Map([
        [receipt.inputsHash, { coverage: loaded.coverage, grant, context, policyHash: policy.policyHash }],
      ]),
      policies: new Map([[policy.policyHash, policy]]),
    });
    expect(report.mismatches).toEqual([
      { receiptId: receipt.id, field: 'orphan', stored: o2.id, replayed: 'uncovered' },
    ]);
  });

  it("when the stored coverage holds no window of the row's own source", async () => {
    const loaded = load({ observations: [ORPHAN], coverage: [GMAIL], activity: MUSE_ACTIVE });
    const ledger = await ledgerOf(loaded);
    const [receipt] = ledger.receipts;
    const inputs = receipt === undefined ? undefined : ledger.receiptInputs.get(receipt.inputsHash);
    if (receipt === undefined || inputs === undefined) throw new Error('one UNASKED receipt expected');
    // gcal.event saw the instant; gmail.sent, the row's own source, saw nothing.
    const { coverage } = load({ coverage: [CALENDAR] });
    const receiptInputs = new Map(ledger.receiptInputs).set(receipt.inputsHash, { ...inputs, coverage });
    const report = await replay({ ...ledger, receiptInputs });
    expect(report.mismatches).toEqual([
      { receiptId: receipt.id, field: 'orphan', stored: observation(loaded, 'o1').id, replayed: 'uncovered' },
    ]);
  });
});

describe('isOrphanCandidate: the one definition of an orphan candidate (§3)', () => {
  const calendarOnly = load({ coverage: [CALENDAR] });
  const windows = seenWindows(calendarOnly.coverage);
  const policy = loadPolicy(calendarOnly.policyJson);
  const both = loadPolicy(load({}, BOTH_SOURCES).policyJson);
  const row = (fields: Record<string, unknown>) =>
    observation(load({ observations: [{ ...ORPHAN, ...fields }] }), 'o1');

  it("is true inside its own source's window for a source the policy lists for its type", () => {
    expect(isOrphanCandidate(row({ source: 'gcal.event', type: 'calendar.created' }), windows, policy)).toBe(
      true,
    );
    expect(isOrphanCandidate(row({ source: 'gcal.event' }), windows, both)).toBe(true);
  });

  it('is false for an unlisted source, in another source’s window only, for a type with no sources, and outside', () => {
    expect(isOrphanCandidate(row({ source: 'gcal.event' }), windows, policy)).toBe(false);
    expect(isOrphanCandidate(row({}), windows, policy)).toBe(false);
    expect(isOrphanCandidate(row({}), windows, both)).toBe(false);
    expect(isOrphanCandidate(row({ source: 'gcal.event', type: 'message.sent' }), windows, policy)).toBe(
      false,
    );
    const late = row({
      source: 'gcal.event',
      type: 'calendar.created',
      occurredAt: '2026-10-06T15:00:00.001-04:00',
    });
    expect(isOrphanCandidate(late, windows, policy)).toBe(false);
  });

  it('is closed at both ends of a window', () => {
    for (const occurredAt of [GMAIL.windowStart, GMAIL.windowEnd]) {
      const event = row({ source: 'gcal.event', type: 'calendar.created', occurredAt });
      expect(isOrphanCandidate(event, windows, policy)).toBe(true);
    }
  });
});
