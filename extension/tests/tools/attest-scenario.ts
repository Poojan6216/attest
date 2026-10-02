/**
 * A small hand-built ledger for the replay unit tests and the CLI tests: two batches, T1 and T2 a day apart, one
 * agent (muse), Gmail Sent coverage bound to the agent's account, and every situation replay must rebuild
 * (docs/grading.md §4.3, §8, §9), each pinned by a test:
 *
 *  - fixed (c1, c2 → o1): c1 is VERIFIED and FINAL at T1 holding o1; c2, first seen after T1, restates o1 and is
 *    NOT_FOUND at T2 because o1 is fixed to c1.
 *  - membership (c3, c4 → o3): c3 is VERIFIED but PENDING at T1 (grace not yet seen) and FINAL at T2, so its stored
 *    receipt is from T2; at T1 it still took o3 from c4, which is NOT_FOUND and FINAL at T1.
 *  - override from PENDING (c5, c6 → o5): c5 is VERIFIED and PENDING at T1, overridden to VERIFIED before T2 (never
 *    regraded), so o5 is fixed to c5 at T2 and c6 is NOT_FOUND.
 *  - override to NOT_FOUND (c7, c8 → o7): c7 is VERIFIED and FINAL at T1, overridden to NOT_FOUND before T2, which
 *    releases o7: c8 takes it at T2 and is VERIFIED.
 *  - overridden UNASKED (o9, c10): o9 is an orphan at T1 that muse likely sent (a session and positive idle
 *    evidence), UNASKED and FINAL; overridden before T2, it is taken, so c10 cannot have it and is NOT_FOUND.
 *  - c11: NOT_FOUND at T1, holding nothing and blocking nothing.
 *  - c12: a vague claim (no counterparty, no subject): never assignable, UNVERIFIABLE at once (§5.2).
 *  - an observed scope muse holds but the user never declared: an OVER_SCOPE scope receipt at T1.
 */
import type { LedgerSnapshot } from '../../src/core/replay';
import { receiptId } from '../../src/core/receipt';
import { Activity, Grant, IsoTs, type Observation, type Ulid } from '../../src/core/schema';

import { LedgerSim } from './attest-ledger';
import {
  ACCOUNT,
  buildClaim,
  buildObservation,
  isoAt,
  makePass,
  makePolicies,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  START_MS,
  type World,
} from './attest-world';

export const T1_MS = START_MS + MS_PER_DAY + 12 * MS_PER_HOUR;
export const T2_MS = T1_MS + MS_PER_DAY;
export const T1 = isoAt(T1_MS, 0);
export const T2 = isoAt(T2_MS, 0);
/** When the user overrides c5, c7 and the UNASKED receipt of o9: between the batches. */
export const OVERRIDE_AT = IsoTs.parse(isoAt(T1_MS + MS_PER_HOUR, 0));
export const OBSERVED_SCOPE = 'gmail.read';

const minutesBefore = (ms: number, minutes: number): string => isoAt(ms - minutes * MS_PER_MINUTE, 0);

/** One sent email: occurred `minutes` before T1, first seen a minute later. */
function sent(n: number, local: string, subjectHint: string, minutes: number): Observation {
  return buildObservation(n, {
    type: 'email.sent',
    counterparty: `${local}@acme.io`,
    subjectHint,
    occurredAt: minutesBefore(T1_MS, minutes),
    observedAt: minutesBefore(T1_MS, minutes - 1),
  });
}

/** A muse claim of sending `local`@acme.io `subjectHint`, claimed `minutes` before T1, read at `observedAt`. */
function claim(i: number, local: string, subjectHint: string, minutes: number, observedAt: string) {
  return buildClaim(i, {
    agent: 'muse',
    type: 'email.sent',
    counterparty: `${local}@acme.io`,
    subjectHint,
    claimedAt: minutesBefore(T1_MS, minutes),
    observedAt,
  });
}

const BEFORE_T1 = (minutes: number) => minutesBefore(T1_MS, minutes);
const AFTER_T1 = isoAt(T1_MS + 2 * MS_PER_HOUR, 0);

export const OBSERVATIONS = {
  o1: sent(1, 'priya', 'q3 deck', 180),
  o3: sent(3, 'bob', 'invoice', 25),
  o5: sent(5, 'carol', 'contract', 25),
  o7: sent(7, 'dan', 'renewal', 180),
  o9: sent(9, 'erin', 'hello', 300),
} as const;

export const CLAIMS = {
  c1: claim(1, 'priya', 'q3 deck', 180, BEFORE_T1(120)),
  c2: claim(2, 'priya', 'q3 deck', 180, AFTER_T1),
  c3: claim(3, 'bob', 'invoice', 25, BEFORE_T1(20)),
  c4: claim(4, 'bob', 'invoice', 70, BEFORE_T1(60)),
  c5: claim(5, 'carol', 'contract', 25, BEFORE_T1(20)),
  c6: claim(6, 'carol', 'contract', 25, AFTER_T1),
  c7: claim(7, 'dan', 'renewal', 180, BEFORE_T1(120)),
  c8: claim(8, 'dan', 'renewal', 180, AFTER_T1),
  c10: claim(10, 'erin', 'hello', 300, AFTER_T1),
  c11: claim(11, 'zed', 'nothing', 360, BEFORE_T1(300)),
  c12: buildClaim(12, {
    agent: 'muse',
    type: 'email.sent',
    claimedAt: minutesBefore(T1_MS, 30),
    observedAt: BEFORE_T1(20),
  }),
} as const;

export type ClaimRef = keyof typeof CLAIMS;
export const CLAIM_REFS: readonly ClaimRef[] = [
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'c10',
  'c11',
  'c12',
];

export type ReceiptRef = ClaimRef | 'u9' | 'scope';

/** The receipt id of a claim ref, of o9's UNASKED receipt (`u9`), or of the scope receipt. */
export function receiptIdOf(ref: ReceiptRef): Ulid {
  if (ref === 'u9') return receiptId({ k: 'unasked', observationId: OBSERVATIONS.o9.id });
  if (ref === 'scope') return receiptId({ k: 'scope', agent: 'muse', scope: OBSERVED_SCOPE });
  return receiptId({ k: 'claim', claimId: CLAIMS[ref].id });
}

const GRANT = Grant.parse({
  agent: 'muse',
  allowedTypes: ['email.sent'],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  observedScopes: [OBSERVED_SCOPE],
  accounts: { 'gmail.sent': [ACCOUNT] },
  updatedAt: isoAt(START_MS - MS_PER_DAY, 0),
});

/** A session of muse a minute after o9 and the user idle around it: UNASKED, likely muse (§7). */
const ACTIVITY = Activity.parse({
  sessions: [{ agent: 'muse', at: minutesBefore(T1_MS, 299) }],
  idle: [{ from: minutesBefore(T1_MS, 310), to: minutesBefore(T1_MS, 290) }],
  entries: [],
  adapterSyncs: [{ agent: 'muse', lastSyncAt: minutesBefore(T1_MS, 60) }],
  claims: [],
});

export function scenarioWorld(): World {
  const policies = makePolicies();
  const sync = (ms: number) => makePass('gmail.sent', ms - 10 * MS_PER_MINUTE, 2 * MS_PER_DAY);
  return {
    claims: Object.values(CLAIMS),
    observations: Object.values(OBSERVATIONS),
    grants: [GRANT],
    passes: [sync(T1_MS), sync(T2_MS)],
    activity: ACTIVITY,
    batchTimes: [T1, T2],
    policyAt: () => policies[0],
    policies: [policies[0]],
  };
}

/** The scenario graded: T1, the three overrides, T2. */
export async function scenarioLedger(): Promise<{ sim: LedgerSim; snapshot: LedgerSnapshot }> {
  const world = scenarioWorld();
  const sim = new LedgerSim(world);
  const { policy } = world.policyAt(0);
  await sim.grade(T1, policy);
  sim.override(receiptIdOf('c5'), 'VERIFIED', OVERRIDE_AT);
  sim.override(receiptIdOf('c7'), 'NOT_FOUND', OVERRIDE_AT);
  sim.override(receiptIdOf('u9'), 'VERIFIED', OVERRIDE_AT);
  await sim.grade(T2, policy);
  return { sim, snapshot: sim.snapshot() };
}
